/**
 * Full gradebook map: categories, items, weights, unmatched surface.
 */
import type { RawGradeCategory } from "@/adapters/courselink/api.extras";
import type { RawGradeObject, RawGradeValue } from "@/adapters/courselink/raw";
import { normalizeTitleKey } from "@/domain/ids";
import type { Assessment, GradeCategory, GradeRecord } from "@/domain/types";

export function mapGradeCategories(
  courseId: string,
  cats: RawGradeCategory[],
): GradeCategory[] {
  return cats.map((c) => ({
    id: `gcat:${courseId}:${c.Id}`,
    courseId,
    name: c.Name?.trim() || "Category",
    weightPercent: c.Weight ?? null,
    dropLowest: c.NumberOfLowestToDrop ?? 0,
    bestN: null,
    gradeCapPercent: null,
    thresholdPercent: null,
    brightspaceCategoryId: c.Id,
  }));
}

export function mapGradebook(
  courseId: string,
  objects: RawGradeObject[],
  values: RawGradeValue[],
  assessments: Assessment[],
  categories: GradeCategory[],
): { records: GradeRecord[]; unmatched: GradeRecord[] } {
  const valueById = new Map(values.map((v) => [String(v.GradeObjectIdentifier), v]));
  const records: GradeRecord[] = [];
  const unmatched: GradeRecord[] = [];
  const now = new Date().toISOString();

  for (const g of objects) {
    const v = valueById.get(String(g.Id));
    // Match assessment
    const toolItemId = g.AssociatedTool?.ToolItemId;
    let assessmentId: string | null = null;
    if (toolItemId != null) {
      assessmentId =
        assessments.find(
          (a) => a.courseId === courseId && a.id.endsWith(`:${toolItemId}`),
        )?.id ?? null;
    }
    if (!assessmentId) {
      const key = normalizeTitleKey(g.Name);
      const hit = assessments
        .filter((a) => a.courseId === courseId)
        .map((a) => ({ a, s: normalizeTitleKey(a.title) === key ? 100 : normalizeTitleKey(a.title).includes(key) || key.includes(normalizeTitleKey(a.title)) ? 70 : 0 }))
        .filter((x) => x.s >= 70)
        .sort((x, y) => y.s - x.s)[0];
      assessmentId = hit?.a.id ?? null;
    }

    // Category association by name heuristics (Brightspace grade objects may nest under category)
    let categoryId: string | null = null;
    const catHit = categories.find((c) =>
      normalizeTitleKey(g.Name).includes(normalizeTitleKey(c.name).slice(0, 8)),
    );
    if (catHit) categoryId = catHit.id;

    const rec: GradeRecord = {
      id: `grade:${courseId}:${g.Id}`,
      assessmentId,
      courseId,
      pointsEarned: v?.PointsNumerator ?? null,
      pointsPossible: v?.PointsDenominator ?? g.MaxPoints ?? null,
      displayedGrade: v?.DisplayedGrade ?? null,
      official: true,
      retrievedAt: now,
      gradeObjectId: String(g.Id),
      categoryId,
      feedbackText: null,
      maxPoints: g.MaxPoints ?? null,
      weightPercent: g.Weight ?? null,
      unmatched: assessmentId == null,
    };
    records.push(rec);
    if (rec.unmatched) unmatched.push(rec);
  }
  return { records, unmatched };
}
