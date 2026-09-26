import { normalizeTitleKey } from "@/domain/ids";
import type { Assessment, AssessmentType } from "@/domain/types";

const TYPE_COMPAT: Record<AssessmentType, AssessmentType[]> = {
  assignment: ["assignment", "project", "other"],
  quiz: ["quiz", "other"],
  lab: ["lab", "assignment", "other"],
  project: ["project", "assignment", "other"],
  midterm: ["midterm", "quiz", "other"],
  final: ["final", "other"],
  participation: ["participation", "other"],
  presentation: ["presentation", "other"],
  discussion: ["discussion", "other"],
  other: ["other", "assignment", "quiz", "lab", "project"],
};

function tokenSet(title: string): Set<string> {
  return new Set(normalizeTitleKey(title).split(" ").filter((t) => t.length > 1));
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  return inter / (a.size + b.size - inter);
}

function numberHint(title: string): string | null {
  const m =
    title.match(/\b(?:assignment|quiz|lab|project|homework|hw)\s*#?\s*(\d+)\b/i) ??
    title.match(/\b([aqhlp])\s*#?\s*(\d+)\b/i) ??
    title.match(/#\s*(\d+)\b/) ??
    title.match(/\b(\d+)\b/);
  if (!m) return null;
  return m[2] ?? m[1];
}

/** Expand A1 / Assignment #1 / Assign 1 into shared tokens. */
function canonicalTitleTokens(title: string): Set<string> {
  let t = title.toLowerCase();
  t = t.replace(/\bassignments?\b/g, "assignment");
  t = t.replace(/\bassign\.?\b/g, "assignment");
  t = t.replace(/\bhomework\b|\bhw\b/g, "assignment");
  t = t.replace(/\bquizzes\b/g, "quiz");
  t = t.replace(/\blaborator(?:y|ies)\b/g, "lab");
  t = t.replace(/\bmid[\s-]?terms?\b/g, "midterm");
  t = t.replace(/\bfinal\s+exams?\b|\bfinal\s+examinations?\b/g, "final");
  // A1 / Q2 / L3 / P4
  t = t.replace(/\ba\s*#?\s*(\d+)\b/g, "assignment $1");
  t = t.replace(/\bq\s*#?\s*(\d+)\b/g, "quiz $1");
  t = t.replace(/\bl\s*#?\s*(\d+)\b/g, "lab $1");
  t = t.replace(/\bp\s*#?\s*(\d+)\b/g, "project $1");
  t = t.replace(/#\s*(\d+)\b/g, "$1");
  return new Set(t.replace(/[^a-z0-9]+/g, " ").split(" ").filter((x) => x.length > 0));
}

/** Conservative match score 0..1. Prefer false negative over false positive. */
export function matchScore(a: Assessment, b: Assessment): number {
  if (a.courseId !== b.courseId) return 0;
  if (a.id === b.id) return 1;

  const ka = normalizeTitleKey(a.title);
  const kb = normalizeTitleKey(b.title);
  if (ka === kb) return 0.98;

  const compat = TYPE_COMPAT[a.type] ?? ["other"];
  if (!compat.includes(b.type) && a.type !== b.type) return 0;

  let score = Math.max(
    jaccard(tokenSet(a.title), tokenSet(b.title)),
    jaccard(canonicalTitleTokens(a.title), canonicalTitleTokens(b.title)),
  );
  const na = numberHint(a.title);
  const nb = numberHint(b.title);
  if (na && nb) {
    if (na === nb) score += 0.25;
    else return 0;
  }

  const da = a.due.iso ? Date.parse(a.due.iso) : NaN;
  const db = b.due.iso ? Date.parse(b.due.iso) : NaN;
  if (Number.isFinite(da) && Number.isFinite(db)) {
    const days = Math.abs(da - db) / 864e5;
    if (days <= 3) score += 0.15;
    else if (days > 21) score -= 0.2;
  }

  return Math.max(0, Math.min(1, score));
}

export const MATCH_THRESHOLD = 0.72;
