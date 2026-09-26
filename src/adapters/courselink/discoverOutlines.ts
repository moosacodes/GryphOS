/**
 * Discover syllabus/outline files from CourseLink during sync.
 * Deterministic heuristics only — never invents academic data.
 *
 * Brightspace shapes:
 * - GET /content/toc → { Modules: [{ Topics, Modules }] }
 * - GET /content/root/ → ContentObject modules with Structure[] (Type 0=module, Type 1=topic)
 * - Topic file: /content/topics/{id}/file
 * - Topic Url: /content/enforced/... (session cookie fetch)
 * - Overview: /overview (+ /overview/attachment)
 * - News posts mentioning outline/grading (text only)
 */
import { parseOutlineBuffer } from "@/adapters/outline";
import { extractPdfDocument, extractPdfText } from "@/adapters/outline/pdf";
import { understandPlainText } from "@/documentIntelligence/pipeline";
import { COURSELINK_ORIGIN } from "@/domain/constants";
import type {
  Course,
  ImportedDocument,
  OutlineDiscoveryStatus,
  OutlineParseResult,
} from "@/domain/types";
import {
  getContentToc,
  getContentTopicFile,
  getNews,
  getOverview,
  getOverviewAttachment,
  HttpError,
  SignedOutError,
} from "./api";
import type { RawContentModule, RawContentTopic } from "./raw";

const OUTLINE_NAME =
  /\b(course[\s_-]*outline|syllabus|course\s*info(?:rmation)?|welcome\s*package|course\s*overview|grading\s*scheme|evaluation\s*scheme|assessment\s*overview)\b/i;
const WEAK_OUTLINE =
  /\b(outline|overview|introduction|welcome|policies|expectations)\b/i;
const FILE_EXT = /\.(pdf|txt|html?|htm|rtf|md)(\?|$)/i;

export interface OutlineDiscoveryHit {
  document: ImportedDocument | null;
  parseResult: OutlineParseResult | null;
  score: number;
  status: OutlineDiscoveryStatus;
  statusDetail: string;
  candidatesTried: number;
  blueprint?: import("@/documentIntelligence/types").CourseBlueprint | null;
  memory?: import("@/documentIntelligence/types").DocumentMemoryEntry | null;
  layout?: import("@/documentIntelligence/types").DocumentLayout | null;
}

export interface FlatTopic {
  title: string;
  url: string | null;
  id: number | null;
  parentTitle: string | null;
  isFileLike: boolean;
  dueDate: string | null;
}

function topicId(t: RawContentTopic): number | null {
  const raw = t.TopicId ?? t.Id ?? t.Identifier;
  if (raw == null) return null;
  const n = typeof raw === "number" ? raw : Number(raw);
  return Number.isFinite(n) ? n : null;
}

function isTopicNode(node: RawContentModule | RawContentTopic): boolean {
  const any = node as RawContentTopic & RawContentModule;
  if (any.Type === 1) return true;
  if (any.Type === 0) return false;
  if (any.TopicId != null || any.TopicType != null) return true;
  if (
    Array.isArray(any.Structure) ||
    Array.isArray(any.Modules) ||
    Array.isArray(any.Topics)
  ) {
    return false;
  }
  return Boolean(any.Url || any.Title);
}

function isFileLike(t: RawContentTopic): boolean {
  const url = t.Url ?? "";
  const typeId = (t.TypeIdentifier ?? "").toLowerCase();
  if (FILE_EXT.test(url) || FILE_EXT.test(t.Title ?? "")) return true;
  if (typeId.includes("file") || typeId.includes("document")) return true;
  if (t.TopicType === 1) return true;
  if (t.Type === 1 && url && !/^https?:\/\//i.test(url)) return true;
  return false;
}

/** Flatten TOC (Topics/Modules) and ContentObject (Structure) trees. */
export function flattenContentTopics(modules: RawContentModule[]): FlatTopic[] {
  const out: FlatTopic[] = [];

  function walk(mods: RawContentModule[], parentTitle: string | null) {
    for (const m of mods) {
      if (m.IsHidden) continue;
      const modTitle = m.Title ?? parentTitle;
      for (const t of m.Topics ?? []) {
        if (t.IsHidden || t.IsBroken) continue;
        out.push({
          title: t.Title ?? "Untitled",
          url: t.Url ?? null,
          id: topicId(t),
          parentTitle: modTitle ?? null,
          isFileLike: isFileLike(t),
          dueDate: t.DueDate ?? null,
        });
      }
      if (m.Modules?.length) walk(m.Modules, modTitle ?? parentTitle);
      for (const node of m.Structure ?? []) {
        if (isTopicNode(node)) {
          const t = node as RawContentTopic;
          if (t.IsHidden || t.IsBroken) continue;
          out.push({
            title: t.Title ?? "Untitled",
            url: t.Url ?? null,
            id: topicId(t),
            parentTitle: modTitle ?? parentTitle,
            isFileLike: isFileLike(t),
            dueDate: t.DueDate ?? null,
          });
        } else {
          walk([node as RawContentModule], modTitle ?? parentTitle);
        }
      }
    }
  }

  walk(modules, null);
  return out;
}

export function scoreOutlineCandidate(
  title: string,
  url?: string | null,
  parentTitle?: string | null,
): number {
  const hay = `${parentTitle ?? ""} ${title} ${url ?? ""}`.toLowerCase();
  let score = 0;
  if (OUTLINE_NAME.test(hay)) score += 50;
  if (/\bcourse[\s_-]*outline\b/i.test(hay)) score += 30;
  if (/syllabus/.test(hay)) score += 20;
  if (/outline/.test(hay) && !OUTLINE_NAME.test(hay)) score += 15;
  if (WEAK_OUTLINE.test(hay) && !OUTLINE_NAME.test(hay)) score += 12;
  if (parentTitle && OUTLINE_NAME.test(parentTitle)) score += 35;
  if (parentTitle && WEAK_OUTLINE.test(parentTitle)) score += 15;
  if (FILE_EXT.test(hay)) score += 10;
  if (/\.pdf(\?|$)/i.test(hay)) score += 8;
  if (/\.(docx?|pptx?|zip)(\?|$)/i.test(hay)) score -= 30;
  if (/lecture|week\s*\d|assignment\s*\d|lab\s*\d|quiz\s*\d|chapter\s*\d/.test(hay)) {
    score -= 25;
  }
  if (/\b(rubric|solution|answer\s*key|sample)\b/i.test(hay)) score -= 20;
  // CIS*2520-F26.pdf / CIS2520_F26 style filenames
  const courseCodeTerm =
    /\b[a-z]{2,5}\s*[*_-]?\s*\d{4}\s*[-_]?\s*(f|w|s|fall|winter|summer)?\s*[-_]?\s*\d{2,4}\b/i.test(hay) ||
    /\b[a-z]{2,5}\d{4}[-_][fws]\d{2}\b/i.test(hay);
  if (courseCodeTerm && FILE_EXT.test(hay)) score += 28;
  if (courseCodeTerm && parentTitle && WEAK_OUTLINE.test(parentTitle)) score += 15;
  if (parentTitle && OUTLINE_NAME.test(parentTitle) && /lecture|week\s*\d/.test(hay)) {
    score += 15;
  }
  return score;
}

async function materializeText(
  buffer: ArrayBuffer,
  contentType: string,
  filename: string,
): Promise<string | null> {
  const lower = `${contentType} ${filename}`.toLowerCase();
  if (lower.includes("pdf") || filename.toLowerCase().endsWith(".pdf")) {
    try {
      const doc = await extractPdfDocument(buffer);
      return doc.text;
    } catch {
      try {
        return await extractPdfText(buffer);
      } catch {
        return null;
      }
    }
  }
  if (
    lower.includes("html") ||
    lower.includes("text") ||
    lower.includes("json") ||
    /\.(txt|html?|htm|md|rtf)$/i.test(filename)
  ) {
    const text = new TextDecoder("utf-8", { fatal: false }).decode(buffer);
    if (lower.includes("html") || /\.html?$/i.test(filename)) {
      return text
        .replace(/<script[\s\S]*?<\/script>/gi, " ")
        .replace(/<style[\s\S]*?<\/style>/gi, " ")
        .replace(/<[^>]+>/g, " ")
        .replace(/\s+/g, " ")
        .trim();
    }
    return text;
  }
  // Unknown binary — try UTF-8 decode if it looks textual
  const bytes = new Uint8Array(buffer.slice(0, 64));
  let textual = bytes.length > 0;
  for (const b of bytes) {
    if (b === 0) {
      textual = false;
      break;
    }
    // tab, lf, cr, or printable ASCII
    if (!(b === 9 || b === 10 || b === 13 || (b >= 32 && b <= 126) || b >= 128)) {
      textual = false;
      break;
    }
  }
  if (textual) {
    return new TextDecoder("utf-8", { fatal: false }).decode(buffer);
  }
  return null;
}

async function fetchContentUrl(
  pathOrUrl: string,
): Promise<
  | { buffer: ArrayBuffer; contentType: string; filename: string; blocked?: false }
  | { buffer: null; contentType: string; filename: string; blocked: true; status: number }
  | null
> {
  try {
    const url = pathOrUrl.startsWith("http")
      ? pathOrUrl
      : pathOrUrl.startsWith("/")
        ? `${COURSELINK_ORIGIN}${pathOrUrl}`
        : `${COURSELINK_ORIGIN}/${pathOrUrl}`;
    if (new URL(url).origin !== COURSELINK_ORIGIN) return null;
    const res = await fetch(url, { credentials: "include", redirect: "follow" });
    if (res.status === 401 || res.status === 403) {
      return {
        buffer: null,
        contentType: res.headers.get("content-type") ?? "application/octet-stream",
        filename: pathOrUrl.split("/").pop() ?? "download",
        blocked: true,
        status: res.status,
      };
    }
    if (!res.ok) return null;
    const contentType = res.headers.get("content-type") ?? "application/octet-stream";
    const cd = res.headers.get("content-disposition") ?? "";
    const nameMatch = cd.match(/filename\*?=(?:UTF-8''|")?([^";]+)/i);
    const filename = nameMatch
      ? decodeURIComponent(nameMatch[1].replace(/"/g, ""))
      : pathOrUrl.split("/").pop() ?? "download";
    return { buffer: await res.arrayBuffer(), contentType, filename };
  } catch {
    return null;
  }
}

function emptyHit(
  status: OutlineDiscoveryStatus,
  detail: string,
  tried = 0,
): OutlineDiscoveryHit {
  return {
    document: null,
    parseResult: null,
    score: 0,
    status,
    statusDetail: detail,
    candidatesTried: tried,
  };
}

function looksLikeOutline(parseResult: OutlineParseResult, score: number): boolean {
  if (parseResult.assessments.length >= 2) return true;
  if (parseResult.confidence >= 0.45) return true;
  if (score >= 60 && parseResult.assessments.length >= 1) return true;
  if (score >= 80 && (parseResult.policies.length > 0 || parseResult.instructors.length > 0)) {
    return true;
  }
  // High-name-score file with substantial text still worth keeping as "found"
  return false;
}

function buildDoc(
  course: Course,
  idSuffix: string,
  filename: string,
  mimeType: string,
  text: string,
  parseResult: OutlineParseResult,
): ImportedDocument {
  return {
    id: `auto:${course.id}:${idSuffix}`,
    courseId: course.id,
    filename,
    mimeType,
    importedAt: new Date().toISOString(),
    textContent: text.slice(0, 500_000),
    parseResult,
    parseError: null,
  };
}


/** Score extracted text body — outlines carry weights / evaluation language. */
export function scoreOutlineContents(text: string): number {
  const t = text.toLowerCase();
  let score = 0;
  if (/\b(evaluation|grading|assessment|marking scheme|grade breakdown)\b/.test(t)) score += 25;
  if ((t.match(/\d{1,3}\s*%/g) ?? []).length >= 3) score += 30;
  if (/\b(mid[- ]?term|final\s+exam)\b/.test(t)) score += 15;
  if (/\b(instructor|professor)\b/.test(t)) score += 10;
  if (/\b(best\s*\d+|drop\s*(the\s+)?lowest)\b/.test(t)) score += 12;
  if (/\b(syllabus|course\s*outline)\b/.test(t)) score += 10;
  if (/\blecture\s*\d+|assignment\s*solution|answer\s*key\b/.test(t)) score -= 20;
  return score;
}

export async function discoverCourseOutline(
  course: Course,
  le: string,
): Promise<OutlineDiscoveryHit> {
  let modules: RawContentModule[] = [];
  let sawForbidden = false;
  let lastBlocked: string | null = null;

  try {
    modules = await getContentToc(le, course.orgUnitId);
  } catch (e) {
    if (e instanceof SignedOutError) throw e;
    if (e instanceof HttpError && (e.status === 403 || e.status === 401)) {
      sawForbidden = true;
    }
  }

  const topics = flattenContentTopics(modules);
  const ranked = topics
    .map((t) => ({
      ...t,
      score:
        scoreOutlineCandidate(t.title, t.url, t.parentTitle) + (t.isFileLike ? 8 : 0),
    }))
    .filter((x) => x.score >= 18)
    .sort((a, b) => b.score - a.score)
    .slice(0, 14);

  let tried = 0;

  for (const cand of ranked) {
    tried += 1;
    let file: { buffer: ArrayBuffer; contentType: string; filename: string } | null =
      null;

    if (cand.id != null) {
      try {
        file = await getContentTopicFile(le, course.orgUnitId, cand.id);
      } catch (e) {
        if (e instanceof SignedOutError) throw e;
        if (e instanceof HttpError && (e.status === 403 || e.status === 401)) {
          sawForbidden = true;
          lastBlocked = `Download blocked for “${cand.title}”`;
        }
      }
    }

    if (!file && cand.url) {
      const fetched = await fetchContentUrl(cand.url);
      if (fetched && "blocked" in fetched && fetched.blocked) {
        sawForbidden = true;
        lastBlocked = `Download blocked for "${cand.title}" (HTTP ${fetched.status}) — upload the PDF under Documents to apply the same blueprint path.`;
      } else if (fetched && fetched.buffer) {
        file = {
          buffer: fetched.buffer,
          contentType: fetched.contentType,
          filename: fetched.filename,
        };
      }
    }

    if (!file || !file.buffer || file.buffer.byteLength === 0) continue;

    const understood = await parseOutlineBuffer(
      file.buffer,
      file.filename || cand.title,
      file.contentType,
      { courseId: course.id, documentId: `auto:${course.id}:topic:${cand.id ?? "url"}` },
    );
    const text = understood.text;
    if (!text || text.trim().length < 80) continue;

    const contentScore = scoreOutlineContents(text);
    const parseResult = understood.result;
    const combinedScore = cand.score + Math.min(40, contentScore);
    const strong = looksLikeOutline(parseResult, combinedScore);
    // Keep high-scoring named files even if parse is weak (semester planning)
    if (!strong && combinedScore < 55) continue;

    const document = {
      ...buildDoc(
        course,
        `topic:${cand.id ?? "url"}`,
        file.filename || cand.title || "Course outline",
        file.contentType,
        text,
        parseResult,
      ),
      blueprintId: understood.blueprint?.id ?? null,
      contentHash: understood.blueprint?.contentHash ?? null,
      extractionQuality: understood.blueprint?.quality.score ?? null,
      layoutSummary: understood.blueprint?.layoutSummary
        ? { ...understood.blueprint.layoutSummary }
        : null,
    };

    const parsedWell =
      parseResult.assessments.length > 0 || parseResult.confidence >= 0.45;

    return {
      document,
      parseResult,
      score: combinedScore,
      status: parsedWell ? "parsed" : "found",
      statusDetail: parsedWell
        ? `Outline “${document.filename}” understood (${parseResult.assessments.length} assessment(s), quality=${(understood.blueprint?.quality.score ?? parseResult.confidence).toFixed(2)})`
        : `Outline “${document.filename}” found; limited structured parse`,
      candidatesTried: tried,
      blueprint: understood.blueprint,
      memory: understood.memory,
      layout: understood.layout,
    };
  }

  // Overview attachment + HTML
  try {
    const overview = await getOverview(le, course.orgUnitId);
    if (overview?.HasAttachment) {
      tried += 1;
      try {
        const att = await getOverviewAttachment(le, course.orgUnitId);
        if (att && att.buffer.byteLength > 0) {
          const text = await materializeText(
            att.buffer,
            att.contentType,
            att.filename || "Course Overview",
          );
          if (text && text.trim().length >= 80) {
            const understood = understandPlainText(text, {
              courseId: course.id,
              documentId: `auto:${course.id}:overview`,
              filename: att.filename || "Course Overview Attachment",
              mimeType: att.contentType,
            });
            const parseResult = {
              ...understood.blueprint.outlineParse,
              extractionIncomplete: understood.blueprint.quality.incomplete,
              qualityChecks: understood.blueprint.quality.checks,
            };
            const document = {
              ...buildDoc(
                course,
                "overview",
                att.filename || "Course Overview Attachment",
                att.contentType,
                text,
                parseResult,
              ),
              blueprintId: understood.blueprint.id,
              contentHash: understood.blueprint.contentHash,
              extractionQuality: understood.blueprint.quality.score,
              layoutSummary: { ...understood.blueprint.layoutSummary },
            };
            const parsedWell =
              parseResult.assessments.length > 0 || parseResult.confidence >= 0.45;
            return {
              document,
              parseResult,
              score: 70 + Math.min(20, scoreOutlineContents(text)),
              status: parsedWell ? "parsed" : "found",
              statusDetail: parsedWell
                ? `Overview attachment understood (${parseResult.assessments.length} assessments)`
                : "Overview attachment found; limited structured parse",
              candidatesTried: tried,
              blueprint: understood.blueprint,
              memory: understood.memory,
              layout: understood.layout,
            };
          }
        }
      } catch (e) {
        if (e instanceof SignedOutError) throw e;
        if (e instanceof HttpError && (e.status === 403 || e.status === 401)) {
          sawForbidden = true;
          lastBlocked = "Overview attachment download blocked";
        }
      }
    }

    const html = overview?.Description?.Html ?? overview?.Description?.Text ?? "";
    const plain = html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    if (
      plain.length >= 100 &&
      (OUTLINE_NAME.test(plain) ||
        WEAK_OUTLINE.test(plain) ||
        /\b(%|weight|grading|evaluation)\b/i.test(plain))
    ) {
      tried += 1;
      const understood = understandPlainText(plain, {
        courseId: course.id,
        documentId: `auto:${course.id}:overview-html`,
        filename: "Course Overview",
        mimeType: "text/html",
      });
      const parseResult = {
        ...understood.blueprint.outlineParse,
        extractionIncomplete: understood.blueprint.quality.incomplete,
        qualityChecks: understood.blueprint.quality.checks,
      };
      const document = {
        ...buildDoc(
          course,
          "overview-html",
          "Course Overview",
          "text/html",
          plain,
          parseResult,
        ),
        blueprintId: understood.blueprint.id,
        contentHash: understood.blueprint.contentHash,
        extractionQuality: understood.blueprint.quality.score,
        layoutSummary: { ...understood.blueprint.layoutSummary },
      };
      const parsedWell =
        parseResult.assessments.length > 0 || parseResult.confidence >= 0.4;
      return {
        document,
        parseResult,
        score: 45 + Math.min(20, scoreOutlineContents(plain)),
        status: parsedWell ? "parsed" : "found",
        statusDetail: parsedWell
          ? `Overview HTML understood (${parseResult.assessments.length} assessments)`
          : "Overview HTML captured for planning",
        candidatesTried: tried,
        blueprint: understood.blueprint,
        memory: understood.memory,
        layout: understood.layout,
      };
    }
  } catch (e) {
    if (e instanceof SignedOutError) throw e;
    if (e instanceof HttpError && (e.status === 403 || e.status === 401)) {
      sawForbidden = true;
    }
  }

  // News posts with outline/grading content
  try {
    const news = await getNews(le, course.orgUnitId);
    for (const item of news.slice(0, 8)) {
      const body = `${item.Title ?? ""} ${item.Body?.Text ?? ""} ${item.Body?.Html ?? ""}`;
      const plain = body
        .replace(/<[^>]+>/g, " ")
        .replace(/\s+/g, " ")
        .trim();
      if (plain.length < 100) continue;
      if (!OUTLINE_NAME.test(plain) && !/\bgrading\b.*%/i.test(plain)) continue;
      tried += 1;
      const understood = understandPlainText(plain, {
        courseId: course.id,
        documentId: `auto:${course.id}:news:${item.Id}`,
        filename: item.Title || "News (outline-related)",
        mimeType: "text/html",
      });
      const parseResult = understood.blueprint.outlineParse;
      if (parseResult.assessments.length === 0 && parseResult.policies.length === 0) {
        continue;
      }
      const document = {
        ...buildDoc(
          course,
          `news:${item.Id}`,
          item.Title || "News (outline-related)",
          "text/html",
          plain,
          parseResult,
        ),
        blueprintId: understood.blueprint.id,
        contentHash: understood.blueprint.contentHash,
        extractionQuality: understood.blueprint.quality.score,
        layoutSummary: { ...understood.blueprint.layoutSummary },
      };
      return {
        document,
        parseResult,
        score: 40 + Math.min(15, scoreOutlineContents(plain)),
        status: parseResult.assessments.length > 0 ? "parsed" : "found",
        statusDetail: `News post “${document.filename}” used as outline source`,
        candidatesTried: tried,
        blueprint: understood.blueprint,
        memory: understood.memory,
        layout: understood.layout,
      };
    }
  } catch (e) {
    if (e instanceof SignedOutError) throw e;
  }

  if (sawForbidden) {
    return emptyHit(
      "blocked",
      lastBlocked
        ? `${lastBlocked}. Brightspace may list outline files in Content that the API cannot download — open the file in CourseLink or upload it under Documents.`
        : "Brightspace blocked outline file access (403). Try opening the outline in CourseLink Content, or upload under Documents.",
      tried,
    );
  }

  if (topics.length === 0) {
    return emptyHit(
      "none_accessible",
      "No content topics accessible (empty TOC/root or content not available for this course).",
      tried,
    );
  }

  if (ranked.length === 0) {
    return emptyHit(
      "none_accessible",
      `Scanned ${topics.length} content item(s); none matched outline/syllabus naming.`,
      tried,
    );
  }

  return emptyHit(
    "none_accessible",
    `Tried ${tried} outline candidate(s) but could not download or extract usable text.` +
      (lastBlocked ? ` ${lastBlocked}` : ""),
    tried,
  );
}
