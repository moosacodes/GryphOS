/**
 * Extraction quality score + self-check + contradiction second-pass.
 * Incomplete if major outline categories missing; never claims success on 4 regex hits.
 * Second pass re-expands when promisedCount != found (e.g. 11 quizzes, 9 found).
 */
import { expandInstances } from "./instances";
import { inferAssessmentType } from "@/adapters/outline/parse";
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
          `Category "${cat.name}" promised ${cat.promisedCount} instance(s), found ${found}`,
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

  void MAJOR;
  return {
    score: Math.max(0, Math.min(1, score)),
    incomplete,
    missingCategories: missing,
    checks,
    contradictions,
    secondPassApplied: false,
  };
}

function dedupeInstances(instances: BlueprintAssessmentInstance[]): BlueprintAssessmentInstance[] {
  const byKey = new Map<string, BlueprintAssessmentInstance>();
  for (const inst of instances) {
    const key = inst.title.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
    const prev = byKey.get(key);
    if (!prev) {
      byKey.set(key, inst);
      continue;
    }
    const richer =
      (inst.weightPercent != null && prev.weightPercent == null) ||
      (inst.due.iso && !prev.due.iso) ||
      inst.confidence > prev.confidence;
    if (richer) {
      byKey.set(key, {
        ...prev,
        ...inst,
        weightPercent: inst.weightPercent ?? prev.weightPercent,
      });
    }
  }
  return [...byKey.values()];
}

function instanceIndex(title: string): number | null {
  const m = title.match(/\b(?:quiz|lab|assignment|project|homework|test|a)\s*#?\s*(\d+)\b/i);
  return m ? Number(m[1]) : null;
}

/**
 * Second pass: dedupe, then repair promisedCount gaps by synthesizing missing
 * numbered instances from the category (e.g. 11 quizzes promised, 9 found).
 * Never invents weights/dates beyond category-level facts already extracted.
 */
export function secondPassBlueprint(bp: CourseBlueprint): CourseBlueprint {
  let instances = dedupeInstances(bp.instances);
  const categories = bp.categories.map((c) => ({ ...c }));
  const repairNotes: string[] = [];

  for (const cat of categories) {
    if (cat.promisedCount == null || cat.promisedCount < 2) continue;
    const belonging = instances.filter(
      (i) => i.categoryName?.toLowerCase() === cat.name.toLowerCase(),
    );
    const found = belonging.length;
    if (found === cat.promisedCount) continue;

    if (found === 0) {
      const type = inferAssessmentType(cat.name);
      const titleHint =
        cat.bestN != null
          ? `${cat.name} (best ${cat.bestN} of ${cat.promisedCount})`
          : `${cat.name} (${cat.promisedCount})`;
      const expanded = expandInstances({
        title: titleHint,
        type,
        weightPercent: cat.weightPercent,
        dueLabel: null,
        dueIso: null,
        certainty: "unknown",
        confidence: 0.55,
        citation: cat.citation,
        sourceSnippet: `second-pass expand ${cat.name}`,
      });
      if (expanded.instances.length) {
        instances = [
          ...instances.filter((i) => i.categoryName?.toLowerCase() !== cat.name.toLowerCase()),
          ...expanded.instances.map((inst) => ({
            ...inst,
            categoryName: cat.name,
            weightPercent: inst.weightPercent ?? cat.instanceWeight,
          })),
        ];
        repairNotes.push(`Expanded ${cat.name} → ${expanded.instances.length} instances`);
      }
      continue;
    }

    if (found < cat.promisedCount) {
      const type = belonging[0]?.type ?? inferAssessmentType(cat.name);
      const base =
        belonging[0]?.title.replace(/\s*\d+\s*$/, "").trim() ||
        cat.name.replace(/s\b/i, "").trim() ||
        "Item";
      const haveIdx = new Set(
        belonging
          .map((i) => i.index ?? instanceIndex(i.title))
          .filter((n): n is number => n != null),
      );
      const per =
        cat.instanceWeight ??
        belonging.find((i) => i.weightPercent != null)?.weightPercent ??
        (cat.weightPercent != null
          ? Math.round((cat.weightPercent / cat.promisedCount) * 1000) / 1000
          : null);
      for (let n = 1; n <= cat.promisedCount; n++) {
        if (haveIdx.has(n)) continue;
        instances.push({
          title: `${base} ${n}`,
          type,
          weightPercent: per,
          index: n,
          categoryName: cat.name,
          due: {
            kind: "unknown",
            iso: null,
            endIso: null,
            label: null,
            weekNumber: null,
            relativeRuleId: null,
          },
          certainty: "unknown",
          confidence: 0.5,
          citation: cat.citation,
          sourceSnippet: `second-pass pad: promised ${cat.promisedCount}, had ${found}`,
        });
        haveIdx.add(n);
      }
      repairNotes.push(`Padded ${cat.name}: promised ${cat.promisedCount}, had ${found}`);
    } else if (found > cat.promisedCount) {
      const sorted = [...belonging].sort((a, b) => {
        const ai = a.index ?? instanceIndex(a.title) ?? 999;
        const bi = b.index ?? instanceIndex(b.title) ?? 999;
        return ai - bi;
      });
      const keep = new Set(sorted.slice(0, cat.promisedCount).map((i) => i.title.toLowerCase()));
      instances = instances.filter(
        (i) =>
          i.categoryName?.toLowerCase() !== cat.name.toLowerCase() ||
          keep.has(i.title.toLowerCase()),
      );
      repairNotes.push(`Trimmed ${cat.name}: promised ${cat.promisedCount}, had ${found}`);
    }
  }

  instances = dedupeInstances(instances);

  const quality = scoreExtraction({
    courseCode: bp.courseCode ?? null,
    instructors: bp.people.filter((p) => p.role === "instructor").length,
    instances,
    categories,
    tableCount: bp.layoutSummary.tableCount,
    hasSchedule: bp.scheduleEntities.length > 0,
    policies: bp.policies.length,
  });
  quality.secondPassApplied = true;
  if (repairNotes.length) {
    quality.checks.push({
      id: "second_pass_repair",
      ok: quality.contradictions.length === 0,
      detail: repairNotes.join("; "),
    });
  }

  return { ...bp, instances, categories, quality };
}
