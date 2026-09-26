import type { Assessment, Course, GradeCategory, WhatIfOverride } from "@/domain/types";
import type { AcademicRule } from "@/domain/rules";
import { ensureTypedRule } from "@/domain/rules";
import { applyGradeRules, type DropCertainty } from "./rules";

export interface AssessmentGradeRow {
  assessment: Assessment;
  percent: number | null;
  counted: boolean;
  dropped: boolean;
  provisionalDrop: boolean;
  dropCertainty: DropCertainty | "none";
  missed: boolean;
}

export interface CourseGradeSummary {
  courseId: string;
  courseCode: string;
  officialDisplay: string | null;
  calculatedPercent: number | null;
  completedWeight: number;
  remainingWeight: number;
  gradedCount: number;
  ungradedCount: number;
  missedCount: number;
  cappedPercent: number | null;
  capReason: string | null;
  thresholdDetail: string | null;
  rows: AssessmentGradeRow[];
}

function assessmentPercent(a: Assessment): number | null {
  if (a.state?.missed && a.pointsEarned == null) return null;
  if (a.pointsEarned != null && a.pointsPossible && a.pointsPossible > 0) {
    return (a.pointsEarned / a.pointsPossible) * 100;
  }
  if (a.gradeDisplay) {
    const m = a.gradeDisplay.match(/(\d+(?:\.\d+)?)\s*%/);
    if (m) return Number(m[1]);
  }
  return null;
}

function withWhatIf(a: Assessment, overrides: WhatIfOverride[]): Assessment {
  const o = overrides.find((x) => x.assessmentId === a.id);
  if (!o) return a;
  return {
    ...a,
    pointsEarned: o.pointsEarned ?? a.pointsEarned,
    pointsPossible: o.pointsPossible ?? a.pointsPossible,
    state: {
      ...a.state,
      missed: o.missed ?? a.state?.missed ?? false,
      dropped: o.dropped ?? a.state?.dropped ?? false,
    },
  };
}

function rawWeightedPercent(rows: AssessmentGradeRow[]): number | null {
  let weightedSum = 0;
  let completedWeight = 0;
  for (const row of rows) {
    const w = row.assessment.weightPercent;
    if (w == null) continue;
    if (row.dropped) continue;
    if (row.counted && row.percent != null) {
      weightedSum += row.percent * w;
      completedWeight += w;
    }
  }
  return completedWeight > 0 ? weightedSum / completedWeight : null;
}

export function summarizeCourseGrades(
  course: Course,
  assessments: Assessment[],
  categories: GradeCategory[] = [],
  rules: AcademicRule[] = [],
  whatIf: WhatIfOverride[] = [],
): CourseGradeSummary {
  const items = assessments
    .filter((a) => a.courseId === course.id && !a.isBonus)
    .map((a) => withWhatIf(a, whatIf));

  const typedRules = rules.map(ensureTypedRule);

  // First pass without cap to get raw standing for CombinedComponentThreshold
  const preliminaryRows: AssessmentGradeRow[] = items.map((a) => {
    const percent = assessmentPercent(a);
    const missed = !!a.state?.missed;
    return {
      assessment: a,
      percent,
      counted: percent != null && !missed && a.weightPercent != null,
      dropped: !!a.state?.dropped,
      provisionalDrop: false,
      dropCertainty: "none" as const,
      missed,
    };
  });
  const raw = rawWeightedPercent(preliminaryRows);

  const effect = applyGradeRules(
    items,
    categories.filter((c) => c.courseId === course.id),
    typedRules,
    raw,
  );

  const rows: AssessmentGradeRow[] = items.map((a) => {
    const percent = assessmentPercent(a);
    const isDropped = effect.droppedIds.has(a.id) || !!a.state?.dropped;
    const provisionalDrop = effect.provisionalDroppedIds.has(a.id);
    const missed = !!a.state?.missed;
    const dropCertainty = effect.dropCertainty.get(a.id) ?? "none";
    return {
      assessment: a,
      percent,
      counted: percent != null && !isDropped && !missed && a.weightPercent != null,
      dropped: isDropped,
      provisionalDrop,
      dropCertainty,
      missed,
    };
  });

  let weightedSum = 0;
  let completedWeight = 0;
  let totalKnownWeight = 0;

  for (const row of rows) {
    const w = row.assessment.weightPercent;
    if (w == null) continue;
    if (row.dropped) continue;
    totalKnownWeight += w;
    if (row.counted && row.percent != null) {
      weightedSum += row.percent * w;
      completedWeight += w;
    }
  }

  const remainingWeight = Math.max(0, totalKnownWeight - completedWeight);
  let calculatedPercent = completedWeight > 0 ? weightedSum / completedWeight : null;
  if (
    calculatedPercent != null &&
    effect.cappedCoursePercent != null &&
    calculatedPercent > effect.cappedCoursePercent
  ) {
    calculatedPercent = effect.cappedCoursePercent;
  } else if (
    calculatedPercent == null &&
    effect.cappedCoursePercent != null &&
    effect.capReason
  ) {
    // Cap applies to final course grade once raw known; keep null if no standing yet
  }

  // Re-apply combined threshold against actual calculated standing
  if (calculatedPercent != null) {
    const effect2 = applyGradeRules(
      items,
      categories.filter((c) => c.courseId === course.id),
      typedRules,
      calculatedPercent,
    );
    if (effect2.thresholdDetail) effect.thresholdDetail = effect2.thresholdDetail;
    if (effect2.cappedCoursePercent != null) {
      effect.cappedCoursePercent = effect2.cappedCoursePercent;
      effect.capReason = effect2.capReason;
      if (calculatedPercent > effect2.cappedCoursePercent) {
        calculatedPercent = effect2.cappedCoursePercent;
      }
    }
  }

  return {
    courseId: course.id,
    courseCode: course.code,
    officialDisplay: null,
    calculatedPercent,
    completedWeight,
    remainingWeight,
    gradedCount: rows.filter((r) => r.percent != null).length,
    ungradedCount: rows.filter((r) => r.percent == null && !r.missed).length,
    missedCount: rows.filter((r) => r.missed).length,
    cappedPercent: effect.cappedCoursePercent,
    capReason: effect.capReason,
    thresholdDetail: effect.thresholdDetail,
    rows,
  };
}

export function requiredAverageOnRemaining(
  summary: CourseGradeSummary,
  targetPercent: number,
): number | null {
  const { calculatedPercent, completedWeight, remainingWeight } = summary;
  if (remainingWeight <= 0) return null;
  const current = calculatedPercent ?? 0;
  const total = completedWeight + remainingWeight;
  return (targetPercent * total - current * completedWeight) / remainingWeight;
}

export function requiredFinalExamScore(
  summary: CourseGradeSummary,
  finalWeight: number,
  targetPercent: number,
): number | null {
  if (finalWeight <= 0) return null;
  const otherCompleted = summary.completedWeight;
  const current = summary.calculatedPercent ?? 0;
  const otherWeightContribution = current * otherCompleted;
  const totalWeight = otherCompleted + finalWeight;
  if (totalWeight <= 0) return null;
  return (targetPercent * totalWeight - otherWeightContribution) / finalWeight;
}

export function whatIfSummary(
  course: Course,
  assessments: Assessment[],
  categories: GradeCategory[],
  rules: AcademicRule[],
  overrides: WhatIfOverride[],
): CourseGradeSummary {
  return summarizeCourseGrades(course, assessments, categories, rules, overrides);
}
