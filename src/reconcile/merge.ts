import type { AcademicDateValue, Assessment, Conflict, SourceType } from "@/domain/types";
import { MATCH_THRESHOLD, matchScore } from "./match";
import { applyManualOverrides, resolveDueConflict, resolveWeightConflict } from "./conflicts";

function pickBetterDate(a: AcademicDateValue, b: AcademicDateValue): AcademicDateValue {
  const rank = (d: AcademicDateValue) =>
    d.certainty === "exact" ? 3 : d.certainty === "approximate" ? 2 : d.certainty === "conflicting" ? 1 : 0;
  if (rank(b) > rank(a)) return b;
  if (rank(a) > rank(b)) return a;
  if (!a.iso && b.iso) return b;
  return a;
}

function mergeTwo(a: Assessment, b: Assessment): { assessment: Assessment; conflicts: Conflict[] } {
  const conflicts: Conflict[] = [];
  const dueCandidates: Array<{ sourceType: SourceType; value: AcademicDateValue; label: string }> = [];
  for (const x of [a, b]) {
    const prov = x.fieldProvenance.due;
    if (x.due.certainty !== "unknown" || x.due.iso || x.due.label) {
      dueCandidates.push({
        sourceType: (prov?.sourceType as SourceType) ?? "courselink_dropbox",
        value: x.due,
        label: x.due.iso ?? x.due.label ?? "unknown",
      });
    }
  }
  const dueRes = resolveDueConflict(a.id, dueCandidates);
  if (dueRes.conflict) conflicts.push(dueRes.conflict);

  const weightCandidates: Array<{ sourceType: SourceType; value: number; label: string }> = [];
  for (const x of [a, b]) {
    if (x.weightPercent != null) {
      const prov = x.fieldProvenance.weightPercent;
      weightCandidates.push({
        sourceType: (prov?.sourceType as SourceType) ?? "course_outline",
        value: x.weightPercent,
        label: `${x.weightPercent}%`,
      });
    }
  }
  const weightRes = resolveWeightConflict(a.id, weightCandidates);
  if (weightRes.conflict) conflicts.push(weightRes.conflict);

  const merged: Assessment = {
    ...a,
    title: a.title.length >= b.title.length ? a.title : b.title,
    type: a.type !== "other" ? a.type : b.type,
    due: dueRes.conflict ? dueRes.value : pickBetterDate(a.due, b.due),
    start: pickBetterDate(a.start, b.start),
    end: pickBetterDate(a.end, b.end),
    weightPercent: weightRes.value ?? a.weightPercent ?? b.weightPercent,
    pointsPossible: a.pointsPossible ?? b.pointsPossible,
    pointsEarned: a.pointsEarned ?? b.pointsEarned,
    submissionState:
      a.submissionState !== "unknown" ? a.submissionState : b.submissionState,
    submittedAt: a.submittedAt ?? b.submittedAt,
    gradeDisplay: a.gradeDisplay ?? b.gradeDisplay,
    url: a.url ?? b.url,
    notes: a.notes ?? b.notes,
    isBonus: a.isBonus || b.isBonus,
    sourceRecords: [...new Set([...a.sourceRecords, ...b.sourceRecords])],
    fieldProvenance: { ...b.fieldProvenance, ...a.fieldProvenance },
    conflictIds: [...new Set([...a.conflictIds, ...b.conflictIds, ...conflicts.map((c) => c.id)])],
    manualOverrides: { ...b.manualOverrides, ...a.manualOverrides },
    updatedAt: new Date().toISOString(),
  };

  return { assessment: applyManualOverrides(merged), conflicts };
}

/** Deduplicate assessments across sources within each course. */
export function reconcileAssessments(items: Assessment[]): {
  assessments: Assessment[];
  conflicts: Conflict[];
} {
  const byCourse = new Map<string, Assessment[]>();
  for (const a of items) {
    const list = byCourse.get(a.courseId) ?? [];
    list.push(a);
    byCourse.set(a.courseId, list);
  }

  const out: Assessment[] = [];
  const conflicts: Conflict[] = [];

  for (const group of byCourse.values()) {
    const used = new Set<number>();
    for (let i = 0; i < group.length; i++) {
      if (used.has(i)) continue;
      let current = applyManualOverrides(group[i]);
      for (let j = i + 1; j < group.length; j++) {
        if (used.has(j)) continue;
        if (matchScore(current, group[j]) >= MATCH_THRESHOLD) {
          const merged = mergeTwo(current, group[j]);
          current = merged.assessment;
          conflicts.push(...merged.conflicts);
          used.add(j);
        }
      }
      out.push(current);
      used.add(i);
    }
  }

  out.sort((a, b) => {
    const ta = a.due.iso ? Date.parse(a.due.iso) : Number.POSITIVE_INFINITY;
    const tb = b.due.iso ? Date.parse(b.due.iso) : Number.POSITIVE_INFINITY;
    return ta - tb;
  });

  return { assessments: out, conflicts };
}
