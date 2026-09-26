/**
 * Extraction quality score + self-check + contradiction second-pass.
 * Incomplete if major outline categories missing; never claims success on 4 regex hits.
 */
import type {
  BlueprintAssessmentInstance,
  BlueprintCategory,
  CourseBlueprint,
  ExtractionQuality,
} from "./types";

const MAJOR = ["assessment", "weight", "instructor", "schedule"] as const;

export function scoreExtraction(input: {
  courseCode: string | null;
  instructors: number;
  instances: BlueprintAssessmentInstance[];
  categories: BlueprintCategory[];
  tableCount: number;
  hasSchedule: boolean;
  policies: number;
}): ExtractionQuality {
  const checks: ExtractionQuality["checks"] = [];
  const missing: string[] = [];
  const contradictions: string[] = [];

  const catSum = input.categories.reduce((s, c) => s + (c.weightPercent ?? 0), 0);
  // Prefer category weights when instances are expansions
  const totalWeight =
    catSum > 0
      ? catSum +
        input.instances
          .filter((i) => !i.categoryName)
          .reduce((s, i) => s + (i.weightPercent ?? 0), 0)
      : input.instances.reduce((s, i) => s + (i.weightPercent ?? 0), 0);

  const weightOk = totalWeight > 0 && Math.abs(totalWeight - 100) <= 5;
  checks.push({
    id: "weights_near_100",
    ok: weightOk,
    detail: `weightSum=${Math.round(totalWeight * 100) / 100}`,
  });
  if (!weightOk && totalWeight > 0) {
    contradictions.push(`Weights sum to ${totalWeight}, expected ~100`);
  }

  for (const cat of input.categories) {
    if (cat.promisedCount != null) {
      const found = input.instances.filter(
        (i) => i.categoryName?.toLowerCase() === cat.name.toLowerCase(),
      ).length;
      const ok = found === cat.promisedCount;
      checks.push({
        id: `promised_${cat.name}`,
        ok,
        detail: `promised ${cat.promisedCount}, found ${found}`,
      });
      if (!ok) {
        contradictions.push(
          `Category “${cat.name}” promised ${cat.promisedCount} instance(s), found ${found}`,
        );
      }
    }
    if (cat.bestN != null && cat.promisedCount != null && cat.bestN > cat.promisedCount) {
      contradictions.push(`bestN ${cat.bestN} > promised ${cat.promisedCount} for ${cat.name}`);
      checks.push({ id: `bestn_${cat.name}`, ok: false, detail: "bestN exceeds count" });
    } else if (cat.bestN != null) {
      checks.push({ id: `bestn_${cat.name}`, ok: true, detail: `best ${cat.bestN}` });
    }
  }

  if (!input.courseCode) missing.push("course_code");
  if (input.instructors === 0) missing.push("instructor");
  if (input.instances.length < 2) missing.push("assessments");
  if (input.tableCount === 0 && input.instances.length < 3) missing.push("evaluation_table");
  if (!input.hasSchedule) missing.push("schedule");

  checks.push({
    id: "has_assessments",
    ok: input.instances.length >= 2,
    detail: `${input.instances.length} instance(s)`,
  });
  checks.push({
    id: "has_instructor",
    ok: input.instructors > 0,
    detail: `${input.instructors} instructor(s)`,
  });

  let score = 0.2;
  if (input.courseCode) score += 0.1;
  if (input.instructors) score += 0.1;
  if (input.instances.length >= 2) score += 0.15;
  if (input.instances.length >= 4) score += 0.05;
  if (weightOk) score += 0.2;
  else if (totalWeight > 40) score += 0.08;
  if (input.tableCount > 0) score += 0.1;
  if (input.hasSchedule) score += 0.05;
  if (input.policies > 0) score += 0.05;
  if (contradictions.length) score -= 0.08 * Math.min(3, contradictions.length);

  const incomplete =
    missing.includes("assessments") ||
    (missing.includes("evaluation_table") && input.instances.length < 3) ||
    score < 0.45;

  return {
    score: Math.max(0, Math.min(1, score)),
    incomplete,
    missingCategories: missing.filter((m) =>
      MAJOR.some((x) => m.includes(x) || x.includes(m.split("_")[0]!)),
    ).length
      ? missing
      : missing,
    checks,
    contradictions,
    secondPassApplied: false,
  };
}

/** Second pass: drop duplicate instances, prefer richer rows, flag conflicts. */
export function secondPassBlueprint(bp: CourseBlueprint): CourseBlueprint {
  const byKey = new Map<string, CourseBlueprint["instances"][0]>();
  for (const inst of bp.instances) {
    const key = inst.title.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
    const prev = byKey.get(key);
    if (!prev) {
      byKey.set(key, inst);
      continue;
    }
    const richer =
      (inst.weightPercent != null && prev.weightPercent == null) ||
      (inst.due.iso && !prev.due.iso) ||
      (inst.confidence > prev.confidence);
    if (richer) byKey.set(key, { ...prev, ...inst, weightPercent: inst.weightPercent ?? prev.weightPercent });
  }
  const instances = [...byKey.values()];
  const quality = scoreExtraction({
    courseCode: bp.courseCode ?? null,
    instructors: bp.people.filter((p) => p.role === "instructor").length,
    instances,
    categories: bp.categories,
    tableCount: bp.layoutSummary.tableCount,
    hasSchedule: bp.scheduleEntities.length > 0,
    policies: bp.policies.length,
  });
  quality.secondPassApplied = true;
  return { ...bp, instances, quality };
}
