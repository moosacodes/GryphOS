/**
 * Typed academic RULE ENGINE — never hardcodes course IDs.
 * Best-N under incomplete data is provisional/projection, not definitive.
 * CombinedComponentThreshold: need required of available course points.
 */
import type { Assessment, AssessmentType, GradeCategory } from "@/domain/types";
import type { AcademicRule, BestNRule, CombinedComponentThresholdRule } from "@/domain/rules";
import { ensureTypedRule } from "@/domain/rules";
import type { CalculationState } from "@/domain/facts";

function matchesType(a: Assessment, types: AssessmentType[]): boolean {
  if (!types.length) return true;
  return types.includes(a.type);
}

function categoryMatch(a: Assessment, category: string | null): boolean {
  if (!category) return true;
  return a.title.toLowerCase().includes(category.toLowerCase());
}

function assessmentPercent(a: Assessment): number | null {
  if (a.state?.missed && a.pointsEarned == null) return null; // missed ≠ zero
  if (a.pointsEarned != null && a.pointsPossible && a.pointsPossible > 0) {
    return (a.pointsEarned / a.pointsPossible) * 100;
  }
  if (a.gradeDisplay) {
    const m = a.gradeDisplay.match(/(\d+(?:\.\d+)?)\s*%/);
    if (m) return Number(m[1]);
  }
  return null;
}

export type DropCertainty = "official" | "provisional" | "projection";

export interface RuleGradeEffect {
  droppedIds: Set<string>;
  /** Ids dropped only as projection/provisional — not definitive */
  provisionalDroppedIds: Set<string>;
  dropCertainty: Map<string, DropCertainty>;
  calcStates: CalculationState[];
  cappedCoursePercent: number | null;
  capReason: string | null;
  thresholdDetail: string | null;
}

function applyBestN(
  pool: Assessment[],
  rule: BestNRule,
  effect: RuleGradeEffect,
): void {
  const n = rule.n;
  const of = rule.of;
  const expected = of ?? n;
  const scored = pool
    .map((a) => ({ a, p: assessmentPercent(a) }))
    .filter((x) => x.p != null);
  const unknownFutures = pool.filter((a) => assessmentPercent(a) == null && !a.state?.missed);
  const missedUngraded = pool.filter((a) => a.state?.missed && a.pointsEarned == null);

  // Incomplete: not all expected items graded → provisional/projection only
  const gradedOrMissed = scored.length + missedUngraded.length;
  const incomplete = gradedOrMissed < expected || unknownFutures.length > 0;

  if (scored.length === 0) return;

  const sorted = [...scored].sort((x, y) => y.p! - x.p!);
  const keep = new Set(sorted.slice(0, n).map((x) => x.a.id));
  const dropCandidates = scored.filter((x) => !keep.has(x.a.id));

  for (const { a } of dropCandidates) {
    if (incomplete) {
      effect.provisionalDroppedIds.add(a.id);
      effect.dropCertainty.set(a.id, unknownFutures.length > 0 ? "projection" : "provisional");
      effect.calcStates.push({
        assessmentId: a.id,
        workCalc: "provisional_drop",
        dropMode: unknownFutures.length > 0 ? "projection" : "provisional",
        reason: `${rule.label}: Best ${n} of ${expected} with incomplete data (${unknownFutures.length} ungraded future(s), ${missedUngraded.length} missed without grade)`,
      });
    } else {
      effect.droppedIds.add(a.id);
      effect.dropCertainty.set(a.id, "official");
      effect.calcStates.push({
        assessmentId: a.id,
        workCalc: "dropped",
        dropMode: "official",
        reason: `${rule.label}: official Best ${n} of ${expected}`,
      });
    }
  }

  // Missed without grade: stay pending — never silently removed as the drop
  for (const a of missedUngraded) {
    effect.calcStates.push({
      assessmentId: a.id,
      workCalc: "pending",
      dropMode: "none",
      reason: "Missed without official grade — not treated as zero; not auto-dropped",
    });
  }
}

/**
 * Combined midterm+final threshold:
 * Earn requiredCoursePoints of availableCoursePoints (e.g. 30 of 60).
 * If fail: raw > capAt → capAt; else stay raw.
 */
export function evaluateCombinedComponentThreshold(
  assessments: Assessment[],
  rule: CombinedComponentThresholdRule,
  rawCoursePercent: number | null,
): { applies: boolean; earned: number | null; detail: string; cappedTo: number | null } {
  let earnedPoints = 0;
  let knownWeight = 0;
  const parts: string[] = [];

  for (const comp of rule.components) {
    const hit = assessments.find((a) => {
      if (!matchesType(a, comp.applyToTypes)) return false;
      if (comp.titlePattern) {
        try {
          return new RegExp(comp.titlePattern, "i").test(a.title);
        } catch {
          return a.title.toLowerCase().includes(comp.titlePattern.toLowerCase());
        }
      }
      return true;
    });
    const p = hit ? assessmentPercent(hit) : null;
    if (p == null || !hit) {
      parts.push(`${comp.applyToTypes.join("/")}: unknown`);
      continue;
    }
    const coursePoints = (p / 100) * comp.weightPercent;
    earnedPoints += coursePoints;
    knownWeight += comp.weightPercent;
    parts.push(
      `${hit.title}: ${p.toFixed(1)}% of ${comp.weightPercent}% weight = ${coursePoints.toFixed(2)} course pts`,
    );
  }

  if (knownWeight < rule.availableCoursePoints) {
    return {
      applies: false,
      earned: knownWeight > 0 ? earnedPoints : null,
      detail: `Combined threshold incomplete (${knownWeight}/${rule.availableCoursePoints} weight known). ${parts.join("; ")}`,
      cappedTo: null,
    };
  }

  const met = earnedPoints >= rule.requiredCoursePoints;
  const detail =
    `Combined components earned ${earnedPoints.toFixed(2)} of ${rule.availableCoursePoints} ` +
    `course points (need ${rule.requiredCoursePoints}). ${parts.join("; ")}. ` +
    (met ? "Threshold MET." : `Threshold FAILED → cap at ${rule.capAt} if raw > ${rule.capAt}, else keep raw.`);

  if (met) {
    return { applies: false, earned: earnedPoints, detail, cappedTo: null };
  }

  let cappedTo: number | null = null;
  if (rawCoursePercent != null) {
    cappedTo = rawCoursePercent > rule.capAt ? rule.capAt : rawCoursePercent;
  } else {
    cappedTo = rule.capAt;
  }
  return { applies: true, earned: earnedPoints, detail, cappedTo };
}

export function applyGradeRules(
  assessments: Assessment[],
  categories: GradeCategory[],
  rules: AcademicRule[],
  rawCoursePercent: number | null = null,
): RuleGradeEffect {
  const effect: RuleGradeEffect = {
    droppedIds: new Set(),
    provisionalDroppedIds: new Set(),
    dropCertainty: new Map(),
    calcStates: [],
    cappedCoursePercent: null,
    capReason: null,
    thresholdDetail: null,
  };

  const courseId = assessments[0]?.courseId;
  const typed = rules.map(ensureTypedRule);

  // Category-level bestN / dropLowest (legacy category fields)
  for (const cat of categories.filter((c) => !courseId || c.courseId === courseId)) {
    const members = assessments.filter(
      (a) =>
        a.categoryId === cat.id ||
        (cat.name && a.title.toLowerCase().includes(cat.name.toLowerCase())),
    );
    if (cat.dropLowest > 0) {
      const scored = members
        .map((a) => ({ a, p: assessmentPercent(a) }))
        .filter((x) => x.p != null)
        .sort((x, y) => x.p! - y.p!);
      const incomplete = members.some((a) => assessmentPercent(a) == null && !a.state?.missed);
      for (let i = 0; i < cat.dropLowest && i < scored.length; i++) {
        const id = scored[i].a.id;
        if (incomplete) {
          effect.provisionalDroppedIds.add(id);
          effect.dropCertainty.set(id, "provisional");
        } else {
          effect.droppedIds.add(id);
          effect.dropCertainty.set(id, "official");
        }
      }
    }
    if (cat.bestN != null && cat.bestN > 0) {
      applyBestN(
        members,
        {
          id: `cat:${cat.id}:bestn`,
          courseId: cat.courseId,
          kind: "BestN",
          label: `${cat.name} best ${cat.bestN}`,
          n: cat.bestN,
          of: members.length,
          applyToTypes: [],
          category: cat.name,
          sourceType: "rule_engine",
          confidence: 0.8,
        },
        effect,
      );
    }
  }

  for (const rule of typed) {
    if (courseId && rule.courseId && rule.courseId !== courseId) continue;

    if (rule.kind === "BestN") {
      const pool = assessments.filter(
        (a) => matchesType(a, rule.applyToTypes) && categoryMatch(a, rule.category),
      );
      applyBestN(pool, rule, effect);
    }

    if (rule.kind === "DropLowest") {
      const pool = assessments.filter(
        (a) => matchesType(a, rule.applyToTypes) && categoryMatch(a, rule.category),
      );
      const scored = pool
        .map((a) => ({ a, p: assessmentPercent(a) }))
        .filter((x) => x.p != null)
        .sort((x, y) => x.p! - y.p!);
      const incomplete = pool.some((a) => assessmentPercent(a) == null && !a.state?.missed);
      for (let i = 0; i < rule.n && i < scored.length; i++) {
        const id = scored[i].a.id;
        if (incomplete) {
          effect.provisionalDroppedIds.add(id);
          effect.dropCertainty.set(id, "provisional");
        } else {
          effect.droppedIds.add(id);
          effect.dropCertainty.set(id, "official");
        }
      }
    }

    if (rule.kind === "ExternalActivity" && rule.bestN != null) {
      const pool = assessments.filter((a) => matchesType(a, rule.applyToTypes));
      applyBestN(
        pool,
        {
          id: rule.id,
          courseId: rule.courseId,
          kind: "BestN",
          label: rule.label,
          n: rule.bestN,
          of: rule.of,
          applyToTypes: rule.applyToTypes,
          category: rule.tool,
          sourceType: rule.sourceType,
          confidence: rule.confidence,
        },
        effect,
      );
    }

    if (rule.kind === "Threshold") {
      const target = assessments.find(
        (a) => matchesType(a, rule.applyToTypes) && assessmentPercent(a) != null,
      );
      if (target) {
        const p = assessmentPercent(target)!;
        if (p < rule.thresholdPercent && rule.capPercent != null) {
          effect.cappedCoursePercent = rule.capPercent;
          effect.capReason = rule.label;
          effect.thresholdDetail = `${target.title} at ${p}% < ${rule.thresholdPercent}% → cap ${rule.capPercent}`;
        }
      }
    }

    if (rule.kind === "CombinedComponentThreshold") {
      const result = evaluateCombinedComponentThreshold(assessments, rule, rawCoursePercent);
      effect.thresholdDetail = result.detail;
      if (result.applies && result.cappedTo != null) {
        effect.cappedCoursePercent = result.cappedTo;
        effect.capReason = rule.label;
      }
    }

    if (rule.kind === "GradeCap") {
      effect.cappedCoursePercent = rule.capPercent;
      effect.capReason = rule.conditionLabel;
    }
  }

  return effect;
}

/** @deprecated Use applyOccurrenceDeadlines — kept as thin wrapper returning assessments only. */
export function applyRelativeDeadlines(
  assessments: Assessment[],
  _meetings: unknown[],
  _rules: AcademicRule[],
  _termStartIso?: string | null,
): Assessment[] {
  // Intentionally no-op for Date.now()/term-start derivation.
  // Callers must use applyOccurrenceDeadlines with MeetingOccurrence[].
  void _meetings;
  void _rules;
  void _termStartIso;
  return assessments;
}

/** @deprecated */
export function applySectionRelativeDeadlines(
  assessments: Assessment[],
  _meetings: unknown[],
  _rules: AcademicRule[],
  _labSection: string | null,
): Assessment[] {
  void _meetings;
  void _rules;
  void _labSection;
  return assessments;
}

export function rulesFromOutlineHints(
  courseId: string,
  gradingRules: Array<{ kind: string; label: string; n: number | null; category: string | null }>,
): AcademicRule[] {
  return gradingRules.map((g, i) =>
    ensureTypedRule({
      id: `rule:${courseId}:${g.kind}:${i}`,
      courseId,
      kind: g.kind === "drop_lowest" ? "drop_lowest" : "best_n",
      label: g.label,
      params: {
        n: g.n,
        applyToTypes: g.category
          ? g.category.toLowerCase().includes("quiz")
            ? ["quiz"]
            : g.category.toLowerCase().includes("lab")
              ? ["lab"]
              : ["assignment"]
          : ["quiz"],
        category: g.category,
      },
      sourceType: "course_outline",
      confidence: 0.8,
    }),
  );
}
