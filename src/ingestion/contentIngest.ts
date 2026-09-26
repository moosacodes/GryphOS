/**
 * Deep content ingestion: hierarchy fields, file download, text extract, hash versioning.
 */
import { getContentTopicFile } from "@/adapters/courselink/api";
import { extractPdfText } from "@/adapters/outline/pdf";
import type { RawContentModule, RawContentTopic } from "@/adapters/courselink/raw";
import { COURSELINK_ORIGIN } from "@/domain/constants";
import {
  classifyDocument,
  type CourseContentItem,
  type CourseContentModule,
  type DocumentClass,
  type LibraryResource,
} from "@/domain/content";
import { simpleTextDiff, syncContentHash } from "@/domain/facts";
import type { Assessment, ChangeEvent } from "@/domain/types";

const MAX_FILE_BYTES = 8 * 1024 * 1024; // 8MB
const MAX_TEXT_CHARS = 200_000;
const SKIP_MIME = /^(video|audio|image)\//i;
const TEXTISH =
  /pdf|text\/|html|markdown|msword|officedocument\.wordprocessingml|officedocument\.presentationml|json|xml/i;

function modId(courseId: string, raw: RawContentModule, fallback: string): string {
  const id = raw.ModuleId ?? raw.Id;
  return `content-mod:${courseId}:${id ?? fallback}`;
}

function topicLocalId(courseId: string, t: RawContentTopic, fallback: string): string {
  const id = t.TopicId ?? t.Id ?? t.Identifier;
  return `content-item:${courseId}:${id ?? fallback}`;
}

function topicUrl(ou: number, t: RawContentTopic): string | null {
  if (t.Url) {
    if (/^https?:\/\//i.test(t.Url)) return t.Url;
    return `${COURSELINK_ORIGIN}${t.Url.startsWith("/") ? "" : "/"}${t.Url}`;
  }
  const id = t.TopicId ?? t.Id;
  if (id != null) return `${COURSELINK_ORIGIN}/d2l/le/content/${ou}/viewContent/${id}/View`;
  return null;
}

function richText(r?: { Text?: string | null; Html?: string | null } | null): string | null {
  if (!r) return null;
  const t = (r.Text ?? r.Html?.replace(/<[^>]+>/g, " ") ?? "").replace(/\s+/g, " ").trim();
  return t || null;
}

function weekHint(moduleTitle: string | null, title: string): string | null {
  const blob = `${moduleTitle ?? ""} ${title}`;
  const m = blob.match(/\bweek\s*(\d{1,2})\b/i);
  return m ? `Week ${m[1]}` : null;
}

export function buildDeepContentTree(
  courseId: string,
  orgUnitId: number,
  modules: RawContentModule[],
  assessmentNames: string[],
): { modules: CourseContentModule[]; items: CourseContentItem[] } {
  const outMods: CourseContentModule[] = [];
  const outItems: CourseContentItem[] = [];
  let order = 0;

  function walk(mods: RawContentModule[], parentModuleId: string | null) {
    for (const m of mods) {
      order += 1;
      const id = modId(courseId, m, `o${order}`);
      const rawId = m.ModuleId ?? m.Id ?? null;
      outMods.push({
        id,
        courseId,
        title: m.Title ?? "Module",
        sortOrder: order,
        parentModuleId,
        descriptionText: richText(m.Description),
        startDate: null,
        endDate: null,
        isHidden: !!m.IsHidden,
        rawModuleId: typeof rawId === "number" ? rawId : rawId != null ? Number(rawId) : null,
      });

      const pushTopic = (t: RawContentTopic, sort: number) => {
        if (t.IsBroken) return;
        const tid = t.TopicId ?? t.Id ?? null;
        const numId = tid != null ? Number(tid) : null;
        const url = topicUrl(orgUnitId, t);
        const isExternal = !!(t.Url && /^https?:\/\//i.test(t.Url) && !t.Url.includes("courselink"));
        const desc = richText(t.Description);
        const cls = classifyDocument(t.Title ?? "", {
          moduleTitle: m.Title,
          bodySnippet: desc,
          assessmentNames,
        });
        outItems.push({
          id: topicLocalId(courseId, t, `${id}:${t.Title}`),
          moduleId: id,
          courseId,
          title: t.Title ?? "Untitled",
          url,
          documentClass: cls,
          contentHash: desc ? syncContentHash(desc) : null,
          updatedAt: t.LastModifiedDate ?? null,
          topicId: Number.isFinite(numId as number) ? (numId as number) : null,
          mimeType: null,
          topicType: t.TopicType ?? t.Type ?? null,
          descriptionText: desc,
          bodyText: desc,
          startDate: null,
          endDate: null,
          dueDate: t.DueDate ?? null,
          completionRequired: null,
          completionCompleted: null,
          isHidden: !!t.IsHidden,
          isExternal,
          externalUrl: isExternal ? t.Url ?? null : null,
          linkedActivityId: null,
          sortOrder: sort,
          libraryResourceId: null,
          previousContentHash: null,
        });
      };

      let sort = 0;
      for (const t of m.Topics ?? []) {
        sort += 1;
        pushTopic(t, sort);
      }
      if (m.Modules?.length) walk(m.Modules, id);
      for (const node of m.Structure ?? []) {
        const asTopic = node as RawContentTopic;
        if ((asTopic.TopicId != null || asTopic.Type === 1) && asTopic.Title) {
          sort += 1;
          pushTopic(asTopic, sort);
        } else {
          walk([node as RawContentModule], id);
        }
      }
    }
  }

  walk(modules, null);
  return { modules: outMods, items: outItems };
}

function matchAssessmentId(title: string, assessments: Assessment[]): string | null {
  const t = title.toLowerCase();
  for (const a of assessments) {
    const at = a.title.toLowerCase();
    if (t.includes(at) || at.includes(t.slice(0, Math.min(24, t.length)))) return a.id;
  }
  const m = t.match(/\b(assignment|lab|quiz|project|homework|a)\s*#?\s*(\d+)\b/);
  if (m) {
    const re = new RegExp(`\\b${m[1]}\\s*#?\\s*${m[2]}\\b`, "i");
    const hit = assessments.find((a) => re.test(a.title));
    if (hit) return hit.id;
  }
  return null;
}

async function extractContentText(buffer: ArrayBuffer, contentType: string): Promise<string | null> {
  if (SKIP_MIME.test(contentType)) return null;
  const bytes = new Uint8Array(buffer);
  const isPdf =
    contentType.includes("pdf") || (bytes.length >= 2 && bytes[0] === 0x25 && bytes[1] === 0x50);
  if (isPdf) {
    try {
      const text = await extractPdfText(buffer);
      const trimmed = text.replace(/\s+/g, " ").trim();
      if (trimmed.length > 40) return trimmed.slice(0, MAX_TEXT_CHARS);
    } catch {
      /* fall through to latin1 scrape */
    }
    try {
      const asLatin = new TextDecoder("latin1").decode(bytes.slice(0, Math.min(bytes.length, 2_000_000)));
      const streams = asLatin.match(/BT[\s\S]{0,500}?ET/g) ?? [];
      if (streams.length) {
        const rough = streams
          .join(" ")
          .replace(/[^\x20-\x7E\n]/g, " ")
          .replace(/\s+/g, " ")
          .trim();
        if (rough.length > 40) return rough.slice(0, MAX_TEXT_CHARS);
      }
    } catch {
      /* ignore */
    }
    return null; // scanned / encrypted — caller keeps metadata; outline path uses OCR when available
  }
  if (!TEXTISH.test(contentType) && buffer.byteLength > 512_000) return null;
  try {
    let text = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
    if (/html/i.test(contentType) || /<html/i.test(text.slice(0, 200))) {
      text = text.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ");
      text = text.replace(/<[^>]+>/g, " ");
    }
    text = text.replace(/\s+/g, " ").trim();
    return text.slice(0, MAX_TEXT_CHARS);
  } catch {
    return null;
  }
}

export interface ContentIngestResult {
  items: CourseContentItem[];
  library: LibraryResource[];
  changes: ChangeEvent[];
}

/** Download & extract text for relevant content items; hash-skip unchanged. */
export async function ingestContentFiles(
  le: string,
  ou: number,
  courseId: string,
  items: CourseContentItem[],
  modules: CourseContentModule[],
  prevLibrary: LibraryResource[],
  assessments: Assessment[],
  maxDownloads = 40,
): Promise<ContentIngestResult> {
  const modById = new Map(modules.map((m) => [m.id, m]));
  const prevByItem = new Map(
    prevLibrary.filter((l) => l.contentItemId).map((l) => [l.contentItemId!, l]),
  );
  const library: LibraryResource[] = [];
  const changes: ChangeEvent[] = [];
  const outItems: CourseContentItem[] = [];
  let downloads = 0;
  const assessmentNames = assessments.map((a) => a.title);

  for (const item of items) {
    const next = { ...item };
    const mod = modById.get(item.moduleId);
    const prev = prevByItem.get(item.id);

    // Keep description hash if no file
    if (item.topicId == null || item.isExternal) {
      if (item.bodyText) {
        const hash = syncContentHash(item.bodyText);
        if (prev && prev.contentHash !== hash) {
          changes.push({
            id: `chg:content:${item.id}:${Date.now()}`,
            courseId,
            entityId: item.id,
            kind: "document_version",
            title: `Content updated: ${item.title}`,
            detail: simpleTextDiff(prev.textContent.slice(0, 2000), item.bodyText.slice(0, 2000)),
            createdAt: new Date().toISOString(),
            read: false,
            evidenceIds: [],
            beforeValue: prev.contentHash,
            afterValue: hash,
          });
          next.previousContentHash = prev.contentHash;
        }
        next.contentHash = hash;
        const lr: LibraryResource = {
          id: `lib:${item.id}`,
          courseId,
          contentItemId: item.id,
          assessmentId: matchAssessmentId(item.title, assessments),
          filename: item.title,
          mimeType: "text/plain",
          documentClass: item.documentClass,
          textContent: item.bodyText.slice(0, MAX_TEXT_CHARS),
          contentHash: hash,
          byteLength: item.bodyText.length,
          moduleTitle: mod?.title ?? null,
          weekHint: weekHint(mod?.title ?? null, item.title),
          retrievedAt: new Date().toISOString(),
          url: item.url,
        };
        library.push(lr);
        next.libraryResourceId = lr.id;
      }
      outItems.push(next);
      continue;
    }

    // Skip huge media by title heuristics
    if (/\.(mp4|mov|avi|mkv|mp3|wav|png|jpe?g|gif|webp)$/i.test(item.title)) {
      outItems.push(next);
      continue;
    }

    if (downloads >= maxDownloads) {
      outItems.push(next);
      continue;
    }

    // Prefer docs that look academic
    const clsGuess = classifyDocument(item.title, {
      moduleTitle: mod?.title,
      assessmentNames,
      bodySnippet: item.descriptionText,
    });
    const priority =
      clsGuess === "course_outline" ||
      clsGuess === "assignment_specification" ||
      clsGuess === "lab_instructions" ||
      clsGuess === "grading_rubric" ||
      clsGuess === "grading_scheme" ||
      clsGuess === "exam_information" ||
      clsGuess === "policy" ||
      clsGuess === "lecture_notes" ||
      clsGuess === "lecture_slides" ||
      clsGuess === "tutorial";

    if (!priority && downloads > maxDownloads / 2) {
      outItems.push(next);
      continue;
    }

    try {
      const file = await getContentTopicFile(le, ou, item.topicId);
      downloads += 1;
      if (file.buffer.byteLength > MAX_FILE_BYTES) {
        outItems.push(next);
        continue;
      }
      if (SKIP_MIME.test(file.contentType)) {
        outItems.push({ ...next, mimeType: file.contentType });
        continue;
      }
      const text = await extractContentText(file.buffer, file.contentType);
      if (!text) {
        outItems.push({ ...next, mimeType: file.contentType });
        continue;
      }
      const hash = syncContentHash(text);
      next.mimeType = file.contentType;
      next.documentClass = classifyDocument(item.title, {
        mimeHint: file.contentType,
        moduleTitle: mod?.title,
        assessmentNames,
        bodySnippet: text.slice(0, 500),
      }) as DocumentClass;
      next.bodyText = text.slice(0, 50_000);
      if (prev && prev.contentHash === hash) {
        // unchanged — retain association, skip reparse noise
        next.contentHash = hash;
        next.libraryResourceId = prev.id;
        library.push({ ...prev, retrievedAt: new Date().toISOString() });
      } else {
        if (prev) {
          next.previousContentHash = prev.contentHash;
          changes.push({
            id: `chg:content:${item.id}:${Date.now()}`,
            courseId,
            entityId: item.id,
            kind: "document_version",
            title: `Content updated: ${item.title}`,
            detail: simpleTextDiff(prev.textContent.slice(0, 3000), text.slice(0, 3000)),
            createdAt: new Date().toISOString(),
            read: false,
            evidenceIds: [],
            beforeValue: prev.contentHash,
            afterValue: hash,
          });
        }
        next.contentHash = hash;
        const linkedAssessmentId = matchAssessmentId(item.title, assessments);
        const lr: LibraryResource = {
          id: `lib:${item.id}:${hash.slice(0, 12)}`,
          courseId,
          contentItemId: item.id,
          assessmentId: linkedAssessmentId,
          filename: file.filename || item.title,
          mimeType: file.contentType,
          documentClass: next.documentClass,
          textContent: text,
          contentHash: hash,
          byteLength: file.buffer.byteLength,
          moduleTitle: mod?.title ?? null,
          weekHint: weekHint(mod?.title ?? null, item.title),
          retrievedAt: new Date().toISOString(),
          url: item.url,
        };
        library.push(lr);
        next.libraryResourceId = lr.id;
      }
    } catch {
      // 403/404 — keep metadata only
    }
    outItems.push(next);
  }

  return { items: outItems, library, changes };
}
