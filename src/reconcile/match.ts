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
  const m = title.match(/\b(?:assignment|quiz|lab|project|a|q|l|p)\s*#?\s*(\d+)\b/i)
    ?? title.match(/\b(\d+)\b/);
  return m ? m[1] : null;
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

  let score = jaccard(tokenSet(a.title), tokenSet(b.title));
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
