import type { Assessment, Course, GradeCategory } from "@/domain/types";

export interface AssessmentGradeRow {
  assessment: Assessment;
  percent: number | null;
  counted: boolean;
  dropped: boolean;
}

export interface CourseGradeSummary {
  courseId: string;
  courseCode: string;
  /** Official CourseLink displayed average if we have one — otherwise null */
  officialDisplay: string | null;
  /** gryphOS weighted average on completed (non-dropped) work, 0..100 */
  calculatedPercent: number | null;
  completedWeight: number;
  remainingWeight: number;
  gradedCount: number;
  ungradedCount: number;
  rows: AssessmentGradeRow[];
}

function assessmentPercent(a: Assessment): number | null {
  if (a.pointsEarned != null && a.pointsPossible && a.pointsPossible > 0) {
    return (a.pointsEarned / a.pointsPossible) * 100;
  }
  if (a.gradeDisplay) {
    const m = a.gradeDisplay.match(/(\d+(?:\.\d+)?)\s*%/);
    if (m) return Number(m[1]);
  }
  return null;
}

function applyDropRules(
  items: Assessment[],
  categories: GradeCategory[],
): Set<string> {
  const dropped = new Set<string>();
  for (const cat of categories) {
    const members = items.filter((a) => a.categoryId === cat.id);
    if (cat.dropLowest > 0) {
      const scored = members
        .map((a) => ({ a, p: assessmentPercent(a) }))
        .filter((x) => x.p != null)
        .sort((x, y) => (x.p! - y.p!));
      for (let i = 0; i < cat.dropLowest && i < scored.length; i++) {
        dropped.add(scored[i].a.id);
      }
    }
    if (cat.bestN != null && cat.bestN > 0) {
      const scored = members
        .map((a) => ({ a, p: assessmentPercent(a) }))
        .filter((x) => x.p != null)
        .sort((x, y) => (y.p! - x.p!));
      const keep = new Set(scored.slice(0, cat.bestN).map((x) => x.a.id));
      for (const m of members) {
        if (assessmentPercent(m) != null && !keep.has(m.id)) dropped.add(m.id);
      }
    }
  }
  return dropped;
}

export function summarizeCourseGrades(
  course: Course,
  assessments: Assessment[],
  categories: GradeCategory[] = [],
): CourseGradeSummary {
  const items = assessments.filter((a) => a.courseId === course.id && !a.isBonus);
  const dropped = applyDropRules(items, categories.filter((c) => c.courseId === course.id));

  const rows: AssessmentGradeRow[] = items.map((a) => {
    const percent = assessmentPercent(a);
    const isDropped = dropped.has(a.id);
    return {
      assessment: a,
      percent,
      counted: percent != null && !isDropped && a.weightPercent != null,
      dropped: isDropped,
    };
  });

  let weightedSum = 0;
  let completedWeight = 0;
  let totalKnownWeight = 0;

  for (const row of rows) {
    const w = row.assessment.weightPercent;
    if (w == null) continue;
    totalKnownWeight += w;
    if (row.counted && row.percent != null) {
      weightedSum += row.percent * w;
      completedWeight += w;
    }
  }

  const remainingWeight = Math.max(0, totalKnownWeight - completedWeight);
  const calculatedPercent =
    completedWeight > 0 ? weightedSum / completedWeight : null;

  return {
    courseId: course.id,
    courseCode: course.code,
    officialDisplay: null,
    calculatedPercent,
    completedWeight,
    remainingWeight,
    gradedCount: rows.filter((r) => r.percent != null).length,
    ungradedCount: rows.filter((r) => r.percent == null).length,
    rows,
  };
}

/** Required average on remaining weight to hit target (0..100). */
export function requiredAverageOnRemaining(
  summary: CourseGradeSummary,
  targetPercent: number,
): number | null {
  const { calculatedPercent, completedWeight, remainingWeight } = summary;
  if (remainingWeight <= 0) return null;
  const current = calculatedPercent ?? 0;
  const total = completedWeight + remainingWeight;
  const needed = (targetPercent * total - current * completedWeight) / remainingWeight;
  return needed;
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
  // Treat remaining non-final as unknown → only solve for final among remaining
  const totalWeight = otherCompleted + finalWeight;
  if (totalWeight <= 0) return null;
  const needed = (targetPercent * totalWeight - otherWeightContribution) / finalWeight;
  return needed;
}
