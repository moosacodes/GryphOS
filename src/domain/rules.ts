/**
 * Formal typed AcademicRule discriminated union.
 * No Record<string, unknown> for important rule payloads.
 */
import type { AssessmentType, SourceType } from "./types";

interface RuleBase {
  id: string;
  courseId: string | null;
  label: string;
  sourceType: SourceType;
  confidence: number;
  provenanceNote?: string | null;
}

export interface BestNRule extends RuleBase {
  kind: "BestN";
  n: number;
  of: number | null;
  applyToTypes: AssessmentType[];
  category: string | null;
}

export interface DropLowestRule extends RuleBase {
  kind: "DropLowest";
  n: number;
  applyToTypes: AssessmentType[];
  category: string | null;
}

export interface EqualWeightCategoryRule extends RuleBase {
  kind: "EqualWeightCategory";
  category: string;
  totalWeightPercent: number;
}

export interface ExplicitWeightRule extends RuleBase {
  kind: "ExplicitWeight";
  assessmentTitlePattern: string | null;
  assessmentType: AssessmentType | null;
  weightPercent: number;
}

export interface CategoryWeightRule extends RuleBase {
  kind: "CategoryWeight";
  category: string;
  weightPercent: number;
}

export interface RelativeDeadlineRule extends RuleBase {
  kind: "RelativeDeadline";
  fromMeetingKind: "lecture" | "lab" | "tutorial" | "seminar" | "other";
  dayOfWeek: number | null;
  offsetDays: number;
  dueTime: string;
  applyToTypes: AssessmentType[];
  occurrenceIndex: number | null;
}

export interface OccurrenceRelativeDeadlineRule extends RuleBase {
  kind: "OccurrenceRelativeDeadline";
  patternKey: string;
  introducedAtOccurrenceIndex: number;
  offsetDays: number;
  dueMode: "end_of_occurrence" | "time";
  dueTime: string | null;
  applyToTypes: AssessmentType[];
  assessmentTitlePattern: string | null;
}

export interface SectionOccurrenceRule extends RuleBase {
  kind: "SectionOccurrence";
  sectionKind: "lecture" | "lab" | "tutorial";
  sectionCode: string | null;
  applyToTypes: AssessmentType[];
}

export interface AttemptRule extends RuleBase {
  kind: "Attempt";
  maxAttempts: number;
  applyToTypes: AssessmentType[];
}

export interface HigherAttemptRule extends RuleBase {
  kind: "HigherAttempt";
  applyToTypes: AssessmentType[];
}

export interface ThresholdRule extends RuleBase {
  kind: "Threshold";
  applyToTypes: AssessmentType[];
  thresholdPercent: number;
  capPercent: number | null;
}

export interface CombinedComponentThresholdRule extends RuleBase {
  kind: "CombinedComponentThreshold";
  components: Array<{
    applyToTypes: AssessmentType[];
    titlePattern: string | null;
    weightPercent: number;
  }>;
  requiredCoursePoints: number;
  availableCoursePoints: number;
  capAt: number;
}

export interface GradeCapRule extends RuleBase {
  kind: "GradeCap";
  capPercent: number;
  conditionLabel: string;
}

export interface MinimumComponentPassRule extends RuleBase {
  kind: "MinimumComponentPass";
  componentCategory: string;
  minimumPercent: number;
  consequence: "fail_course" | "cap_grade";
  capPercent: number | null;
}

export interface ConditionalReplacementRule extends RuleBase {
  kind: "ConditionalReplacement";
  fromTypes: AssessmentType[];
  toTypes: AssessmentType[];
  condition: string;
}

export interface WeightTransferRule extends RuleBase {
  kind: "WeightTransfer";
  fromTypes: AssessmentType[];
  toTypes: AssessmentType[];
}

export interface RegistrarScheduledRule extends RuleBase {
  kind: "RegistrarScheduled";
  applyToTypes: AssessmentType[];
}

export interface LiveAssessmentRule extends RuleBase {
  kind: "LiveAssessment";
  applyToTypes: AssessmentType[];
  modality: "in_person" | "online_live" | "hybrid";
}

export interface ExternalActivityRule extends RuleBase {
  kind: "ExternalActivity";
  tool: string;
  applyToTypes: AssessmentType[];
  bestN: number | null;
  of: number | null;
}

export interface ManualOverrideRule extends RuleBase {
  kind: "ManualOverride";
  targetField: string;
  reason: string;
}

export type AcademicRule =
  | BestNRule
  | DropLowestRule
  | EqualWeightCategoryRule
  | ExplicitWeightRule
  | CategoryWeightRule
  | RelativeDeadlineRule
  | OccurrenceRelativeDeadlineRule
  | SectionOccurrenceRule
  | AttemptRule
  | HigherAttemptRule
  | ThresholdRule
  | CombinedComponentThresholdRule
  | GradeCapRule
  | MinimumComponentPassRule
  | ConditionalReplacementRule
  | WeightTransferRule
  | RegistrarScheduledRule
  | LiveAssessmentRule
  | ExternalActivityRule
  | ManualOverrideRule;

export interface LegacyAcademicRule {
  id: string;
  courseId: string | null;
  kind: string;
  label: string;
  params: Record<string, unknown>;
  sourceType: SourceType;
  confidence: number;
}

function asNum(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) return Number(v);
  return null;
}

function asStr(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v : null;
}

function asTypes(v: unknown): AssessmentType[] {
  if (!Array.isArray(v)) return [];
  return v.map(String) as AssessmentType[];
}

const TYPED_KINDS = new Set([
  "BestN", "DropLowest", "EqualWeightCategory", "ExplicitWeight", "CategoryWeight",
  "RelativeDeadline", "OccurrenceRelativeDeadline", "SectionOccurrence", "Attempt",
  "HigherAttempt", "Threshold", "CombinedComponentThreshold", "GradeCap",
  "MinimumComponentPass", "ConditionalReplacement", "WeightTransfer",
  "RegistrarScheduled", "LiveAssessment", "ExternalActivity", "ManualOverride",
]);

export function migrateLegacyRule(r: LegacyAcademicRule): AcademicRule {
  const base = {
    id: r.id,
    courseId: r.courseId,
    label: r.label,
    sourceType: r.sourceType,
    confidence: r.confidence,
  };
  const p = r.params ?? {};
  switch (r.kind) {
    case "best_n":
    case "BestN":
      return {
        ...base,
        kind: "BestN",
        n: asNum(p.n) ?? 0,
        of: asNum(p.of),
        applyToTypes: asTypes(p.applyToTypes),
        category: asStr(p.category),
      };
    case "drop_lowest":
    case "DropLowest":
      return {
        ...base,
        kind: "DropLowest",
        n: asNum(p.n) ?? 1,
        applyToTypes: asTypes(p.applyToTypes),
        category: asStr(p.category),
      };
    case "relative_deadline":
    case "RelativeDeadline":
      return {
        ...base,
        kind: "RelativeDeadline",
        fromMeetingKind: (asStr(p.fromMeetingKind) as RelativeDeadlineRule["fromMeetingKind"]) ?? "lab",
        dayOfWeek: asNum(p.dayOfWeek),
        offsetDays: asNum(p.offsetDays) ?? 0,
        dueTime: asStr(p.dueTime) ?? "23:59",
        applyToTypes: asTypes(p.applyToTypes),
        occurrenceIndex: asNum(p.occurrenceIndex),
      };
    case "section_relative":
    case "SectionOccurrence":
      return {
        ...base,
        kind: "SectionOccurrence",
        sectionKind: (asStr(p.sectionKind) as "lab") ?? "lab",
        sectionCode: asStr(p.sectionCode),
        applyToTypes: asTypes(p.applyToTypes),
      };
    case "threshold":
    case "Threshold":
      return {
        ...base,
        kind: "Threshold",
        applyToTypes: asTypes(p.applyToTypes).length ? asTypes(p.applyToTypes) : ["final"],
        thresholdPercent: asNum(p.thresholdPercent) ?? 50,
        capPercent: asNum(p.capPercent),
      };
    case "grade_cap":
    case "GradeCap":
      return {
        ...base,
        kind: "GradeCap",
        capPercent: asNum(p.capPercent) ?? 45,
        conditionLabel: asStr(p.conditionLabel) ?? r.label,
      };
    case "attempt":
    case "Attempt":
      return {
        ...base,
        kind: "Attempt",
        maxAttempts: asNum(p.maxAttempts) ?? 2,
        applyToTypes: asTypes(p.applyToTypes),
      };
    case "CombinedComponentThreshold":
      return {
        ...base,
        kind: "CombinedComponentThreshold",
        components: Array.isArray(p.components)
          ? (p.components as CombinedComponentThresholdRule["components"])
          : [
              { applyToTypes: ["midterm"], titlePattern: null, weightPercent: 25 },
              { applyToTypes: ["final"], titlePattern: null, weightPercent: 35 },
            ],
        requiredCoursePoints: asNum(p.requiredCoursePoints) ?? 30,
        availableCoursePoints: asNum(p.availableCoursePoints) ?? 60,
        capAt: asNum(p.capAt) ?? 45,
      };
    case "OccurrenceRelativeDeadline":
      return {
        ...base,
        kind: "OccurrenceRelativeDeadline",
        patternKey: asStr(p.patternKey) ?? "lab",
        introducedAtOccurrenceIndex: asNum(p.introducedAtOccurrenceIndex) ?? 1,
        offsetDays: asNum(p.offsetDays) ?? 0,
        dueMode: (asStr(p.dueMode) as "time" | "end_of_occurrence") ?? "time",
        dueTime: asStr(p.dueTime) ?? "23:59",
        applyToTypes: asTypes(p.applyToTypes),
        assessmentTitlePattern: asStr(p.assessmentTitlePattern),
      };
    case "ExternalActivity":
      return {
        ...base,
        kind: "ExternalActivity",
        tool: asStr(p.tool) ?? "unknown",
        applyToTypes: asTypes(p.applyToTypes),
        bestN: asNum(p.bestN),
        of: asNum(p.of),
      };
    case "MinimumComponentPass":
      return {
        ...base,
        kind: "MinimumComponentPass",
        componentCategory: asStr(p.componentCategory) ?? "assignments",
        minimumPercent: asNum(p.minimumPercent) ?? 50,
        consequence: (asStr(p.consequence) as "fail_course" | "cap_grade") ?? "fail_course",
        capPercent: asNum(p.capPercent),
      };
    default:
      if (TYPED_KINDS.has(r.kind) && !("params" in r)) return r as unknown as AcademicRule;
      return {
        ...base,
        kind: "ManualOverride",
        targetField: "unknown",
        reason: `migrated from legacy kind ${r.kind}`,
      };
  }
}

export function ensureTypedRule(r: AcademicRule | LegacyAcademicRule | Record<string, unknown>): AcademicRule {
  if (r && typeof r === "object" && "params" in r && (r as LegacyAcademicRule).params != null) {
    return migrateLegacyRule(r as LegacyAcademicRule);
  }
  if (r && typeof r === "object" && typeof (r as AcademicRule).kind === "string" && TYPED_KINDS.has((r as AcademicRule).kind)) {
    return r as AcademicRule;
  }
  if (r && typeof r === "object" && "kind" in r) {
    return migrateLegacyRule({
      id: String((r as LegacyAcademicRule).id ?? "rule:unknown"),
      courseId: ((r as LegacyAcademicRule).courseId as string | null) ?? null,
      kind: String((r as LegacyAcademicRule).kind),
      label: String((r as LegacyAcademicRule).label ?? (r as LegacyAcademicRule).kind),
      params: ((r as LegacyAcademicRule).params as Record<string, unknown>) ?? {},
      sourceType: ((r as LegacyAcademicRule).sourceType as SourceType) ?? "manual",
      confidence: Number((r as LegacyAcademicRule).confidence ?? 0.5),
    });
  }
  return {
    id: "rule:invalid",
    courseId: null,
    kind: "ManualOverride",
    label: "invalid rule",
    sourceType: "manual",
    confidence: 0,
    targetField: "unknown",
    reason: "unrecognized rule shape",
  };
}
