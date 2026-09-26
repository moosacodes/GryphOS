/**
 * Relative deadlines are first-class (not fabricated timestamps).
 * "≈8 days after lab introduced" + registered lab occurrence → candidate;
 * exact CourseLink due dates win later in reconcile.
 */
import type { RelativeDeadlineRule, SourceCitation } from "./types";

const REL =
  /(?:~|≈|about|approximately|roughly)?\s*(\d+)\s*(?:business\s+)?days?\s+after\s+(?:the\s+)?(lab|lecture|tutorial|assignment|week)\b([\s\S]{0,40})/i;
const REL2 =
  /\b(\d+)\s*days?\s+after\s+(?:it\s+is\s+)?(?:introduced|released|posted|assigned)\b/i;

export function extractRelativeDeadlineRules(
  text: string,
  citationFor?: (snippet: string) => SourceCitation | null,
): RelativeDeadlineRule[] {
  const rules: RelativeDeadlineRule[] = [];
  const lines = text.split(/\n/);
  let idx = 0;
  for (const line of lines) {
    const m = line.match(REL) ?? line.match(REL2);
    if (!m) continue;
    const days = Number(m[1]);
    if (!Number.isFinite(days) || days < 0 || days > 120) continue;
    const anchorRaw = (m[2] ?? "lab").toLowerCase();
    const anchorKind =
      anchorRaw.startsWith("lab")
        ? "lab_introduced"
        : anchorRaw.startsWith("lecture")
          ? "lecture_introduced"
          : anchorRaw.startsWith("assignment")
            ? "assignment_released"
            : anchorRaw.startsWith("week")
              ? "week_start"
              : "other";
    const titleHint =
      line.match(/\b(lab\s*\d+|assignment\s*\d+|quiz\s*\d+|project\s*\d+)/i)?.[0] ??
      line.slice(0, 60);
    const approx = /~|≈|about|approximately|roughly/i.test(line);
    const snippet = line.slice(0, 200);
    rules.push({
      id: `rel:${idx++}:${days}d`,
      assessmentTitleHint: titleHint,
      offsetDays: days,
      approx,
      anchorKind: anchorKind as RelativeDeadlineRule["anchorKind"],
      anchorLabel: (m[0] ?? line).slice(0, 80),
      raw: line.slice(0, 240),
      citation: citationFor?.(snippet) ?? {
        page: null,
        snippet,
        bbox: null,
        confidence: 0.7,
        viewLabel: "View source",
      },
      resolvedCandidateIso: null,
    });
  }
  return rules;
}

/** Personalize relative rule once a lab/lecture occurrence ISO is known. */
export function resolveRelativeCandidate(
  rule: RelativeDeadlineRule,
  anchorIso: string,
): RelativeDeadlineRule {
  const t = Date.parse(anchorIso);
  if (!Number.isFinite(t)) return rule;
  const ms = t + rule.offsetDays * 864e5;
  // End-of-day style candidate — still approximate if rule.approx
  const d = new Date(ms);
  d.setUTCHours(23, 59, 0, 0);
  return {
    ...rule,
    resolvedCandidateIso: d.toISOString(),
  };
}

export function applyLabOccurrences(
  rules: RelativeDeadlineRule[],
  labOccurrenceIsoByWeek: Record<number, string>,
): RelativeDeadlineRule[] {
  return rules.map((r) => {
    if (r.resolvedCandidateIso) return r;
    if (r.anchorKind !== "lab_introduced" && r.anchorKind !== "lecture_introduced") return r;
    const weekHint = r.assessmentTitleHint.match(/\d+/)?.[0];
    const week = weekHint ? Number(weekHint) : null;
    const iso =
      (week != null && labOccurrenceIsoByWeek[week]) ||
      labOccurrenceIsoByWeek[0] ||
      Object.values(labOccurrenceIsoByWeek)[0];
    if (!iso) return r;
    return resolveRelativeCandidate(r, iso);
  });
}
