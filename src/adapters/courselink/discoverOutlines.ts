/**
 * Discover syllabus/outline files from CourseLink content modules during sync.
 * Deterministic heuristics only — never invents academic data.
 */
import { parseOutlineText } from "@/adapters/outline/parse";
import { extractPdfText } from "@/adapters/outline/pdf";
import type { Course, ImportedDocument, OutlineParseResult } from "@/domain/types";
import { getContentToc, getContentTopicFile, HttpError, SignedOutError } from "./api";
import type { RawContentModule, RawContentTopic } from "./raw";

const OUTLINE_NAME =
  /\b(syllabus|outline|course\s*outline|course\s*info(?:rmation)?|welcome\s*package|course\s*overview|grading\s*scheme|evaluation)\b/i;
const FILE_EXT = /\.(pdf|txt|html?|htm)$/i;

export interface DiscoveredOutline {
  document: ImportedDocument;
  parseResult: OutlineParseResult;
  score: number;
}

function topicId(t: RawContentTopic): number | null {
  const id = t.TopicId ?? t.Id;
  return typeof id === "number" && Number.isFinite(id) ? id : null;
}

function flattenTopics(modules: RawContentModule[], out: RawContentTopic[] = []): RawContentTopic[] {
  for (const m of modules) {
    if (m.IsHidden) continue;
    for (const t of m.Topics ?? []) {
      if (!t.IsHidden && !t.IsLocked) out.push(t);
    }
    if (m.Modules?.length) flattenTopics(m.Modules, out);
  }
  return out;
}

export function scoreOutlineCandidate(title: string, url?: string | null): number {
  const hay = `${title} ${url ?? ""}`.toLowerCase();
  let score = 0;
  if (OUTLINE_NAME.test(hay)) score += 50;
  if (/syllabus/.test(hay)) score += 20;
  if (/outline/.test(hay)) score += 15;
  if (FILE_EXT.test(hay)) score += 10;
  if (/\.(docx?|pptx?|zip)$/i.test(hay)) score -= 30;
  if (/lecture|week\s*\d|assignment\s*\d|lab\s*\d|quiz\s*\d/.test(hay)) score -= 25;
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
      return await extractPdfText(buffer);
    } catch {
      return null;
    }
  }
  if (
    lower.includes("html") ||
    lower.includes("text") ||
    /\.(txt|html?|htm)$/i.test(filename)
  ) {
    const text = new TextDecoder("utf-8", { fatal: false }).decode(buffer);
    if (lower.includes("html")) {
      return text
        .replace(/<script[\s\S]*?<\/script>/gi, " ")
        .replace(/<style[\s\S]*?<\/style>/gi, " ")
        .replace(/<[^>]+>/g, " ");
    }
    return text;
  }
  return null;
}

export async function discoverCourseOutline(
  course: Course,
  le: string,
): Promise<DiscoveredOutline | null> {
  let modules: RawContentModule[] = [];
  try {
    modules = await getContentToc(le, course.orgUnitId);
  } catch (e) {
    if (e instanceof SignedOutError) throw e;
    if (e instanceof HttpError && (e.status === 403 || e.status === 404)) return null;
    return null;
  }
  if (!modules.length) return null;

  const topics = flattenTopics(modules)
    .map((t) => ({
      topic: t,
      id: topicId(t),
      score: scoreOutlineCandidate(t.Title, t.Url),
    }))
    .filter((x) => x.id != null && x.score >= 40)
    .sort((a, b) => b.score - a.score)
    .slice(0, 4);

  for (const cand of topics) {
    try {
      const file = await getContentTopicFile(le, course.orgUnitId, cand.id!);
      const text = await materializeText(file.buffer, file.contentType, file.filename || cand.topic.Title);
      if (!text || text.trim().length < 80) continue;
      const parseResult = parseOutlineText(text);
      // Require some signal that this looks like an outline
      if (parseResult.confidence < 0.45 && parseResult.assessments.length < 2) continue;

      const document: ImportedDocument = {
        id: `auto:${course.id}:topic:${cand.id}`,
        courseId: course.id,
        filename: file.filename || cand.topic.Title || "Course outline",
        mimeType: file.contentType,
        importedAt: new Date().toISOString(),
        textContent: text.slice(0, 500_000),
        parseResult,
        parseError: null,
      };
      return { document, parseResult, score: cand.score };
    } catch (e) {
      if (e instanceof SignedOutError) throw e;
      // try next candidate
    }
  }
  return null;
}
