/**
 * Knowledge-driven planning context for JARVIS brief / priority / reminders.
 * Consumes CourseBlueprint + academicRules + live sync state — never hardcodes courses.
 */
import type {
  AppData,
  Assessment,
  ChangeEvent,
  ChangeEventKind,
  Course,
  MeetingOccurrence,
} from "@/domain/types";
import { ensureTypedRule } from "@/domain/rules";
import type { AcademicRule, BestNRule, DropLowestRule } from "@/domain/rules";
import { deadlineSafetyFromAssessment } from "./deadlines";
import { applyGradeRules } from "./rules";

export interface WhyReason {
  code:
    | "weight"
    | "not_submitted"
    | "submitted"
    | "overdue"
    | "due_soon"
    | "best_n"
    | "drop_lowest"
    | "relative_deadline"
    | "lab_tonight"
    | "meeting_soon"
    | "linked_material"
    | "grade_rule"
    | "needs_confirmation"
    | "blueprint"
    | "dependency"
    | "section_timing"
    | "stale_model"
    | "replan"
    | "ignore_impact";
  text: string;
}

export interface IgnoreImpact {
  summary: string;
  gradeRisk: string | null;
  scheduleShift: string | null;
  nextFocusId: string | null;
  nextFocusTitle: string | null;
  details: string[];
}

export type StaleGapKind =
  | "missing_assessment"
  | "missing_weight"
  | "missing_date"
  | "missing_material"
  | "incomplete_blueprint"
  | "promised_count_shortfall"
  | "quality_incomplete"
  | "section_unresolved";

export interface StaleModelGap {
  id: string;
  courseId: string;
  courseCode: string;
  kind: StaleGapKind;
  severity: "block" | "warn";
  detail: string;
  expected?: string;
  observed?: string;
}

export interface PlanningGate {
  ok: boolean;
  gaps: StaleModelGap[];
  needsRecheck: boolean;
  summary: string | null;
}

export interface RecoveryPlanItem {
  assessmentId: string;
  courseCode: string;
  title: string;
  score: number;
  why: string;
  ignoreImpact: string;
}

export interface RecoveryPlan {
  mode: "steady" | "recovery";
  trigger: string | null;
  items: RecoveryPlanItem[];
  deferred: Array<{ assessmentId: string; title: string; reason: string }>;
  summary: string;
}

export interface PlanningRecommendation {
  assessmentId: string;
  courseCode: string;
  title: string;
  score: number;
  reasons: WhyReason[];
  why: string;
  ignoreImpact: IgnoreImpact;
}

export interface PlanningAutonomy {
  gate: PlanningGate;
  recommendations: PlanningRecommendation[];
  recovery: RecoveryPlan;
  replanFrom: import("@/domain/types").ChangeEvent[];
  replanNote: string | null;
  requestRecheck: boolean;
}

export interface KnowledgeInsight {
  id: string;
  kind: "risk" | "recovery";
  courseCode: string;
  title: string;
  detail: string;
  score: number;
  assessmentId: string | null;
  reasons: WhyReason[];
}

function selectedCourses(data: AppData): Course[] {
  const ids = data.preferences.selectedCourseIds;
  if (ids?.length) return data.courses.filter((c) => ids.includes(c.id));
  return data.courses.filter((c) => c.selected);
}

export function isAssessmentOpen(a: Assessment): boolean {
  if (a.submissionState === "submitted") return false;
  if (a.state?.work === "completed" || a.state?.userCompleted === "confirmed") return false;
  if (a.state?.missed || a.state?.dropped) return false;
  if (a.pointsEarned != null || a.gradeDisplay) return false;
  return true;
}

function hoursUntil(iso: string | null, now: Date): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  return (t - now.getTime()) / 3_600_000;
}

function courseRules(data: AppData, courseId: string): AcademicRule[] {
  return (data.academicRules ?? []).map(ensureTypedRule).filter((r) => r.courseId === courseId);
}

function matchingBestN(data: AppData, a: Assessment): BestNRule | DropLowestRule | null {
  for (const r of courseRules(data, a.courseId)) {
    if (r.kind === "BestN" || r.kind === "DropLowest") {
      if (r.applyToTypes.length && !r.applyToTypes.includes(a.type)) continue;
      if (r.category) {
        const cat = data.gradeCategories.find((c) => c.id === a.categoryId);
        const blob = `${a.title} ${cat?.name ?? ""}`.toLowerCase();
        if (!blob.includes(r.category.toLowerCase()) && !(cat?.name === r.category)) continue;
      }
      return r;
    }
  }
  const cats = data.gradeCategories.filter((c) => c.courseId === a.courseId);
  for (const c of cats) {
    if (a.categoryId && c.id !== a.categoryId) continue;
    if (c.bestN != null) {
      return {
        id: `synth:bestn:${c.id}`,
        courseId: a.courseId,
        kind: "BestN",
        label: `${c.name}: best ${c.bestN}`,
        n: c.bestN,
        of: null,
        applyToTypes: [a.type],
        category: c.name,
        sourceType: "course_outline",
        confidence: 0.7,
      };
    }
    if (c.dropLowest > 0) {
      return {
        id: `synth:drop:${c.id}`,
        courseId: a.courseId,
        kind: "DropLowest",
        label: `${c.name}: drop lowest ${c.dropLowest}`,
        n: c.dropLowest,
        applyToTypes: [a.type],
        category: c.name,
        sourceType: "course_outline",
        confidence: 0.7,
      };
    }
  }
  // Blueprint categories when live categories missing
  const bp = (data.courseBlueprints ?? []).find((b) => b.courseId === a.courseId);
  if (bp) {
    for (const cat of bp.categories) {
      const low = cat.name.toLowerCase();
      const typeHit =
        (a.type === "quiz" && low.includes("quiz")) ||
        (a.type === "lab" && low.includes("lab")) ||
        (a.type === "assignment" && (low.includes("assign") || low.includes("project"))) ||
        low.includes(a.type);
      if (!typeHit && a.categoryId == null) continue;
      if (cat.bestN != null) {
        return {
          id: `synth:bp:bestn:${bp.id}:${cat.name}`,
          courseId: a.courseId,
          kind: "BestN",
          label: `${cat.name}: best ${cat.bestN}${cat.promisedCount != null ? ` of ${cat.promisedCount}` : ""}`,
          n: cat.bestN,
          of: cat.promisedCount,
          applyToTypes: [a.type],
          category: cat.name,
          sourceType: "course_outline",
          confidence: 0.75,
        };
      }
      if (cat.dropLowest > 0) {
        return {
          id: `synth:bp:drop:${bp.id}:${cat.name}`,
          courseId: a.courseId,
          kind: "DropLowest",
          label: `${cat.name}: drop lowest ${cat.dropLowest}`,
          n: cat.dropLowest,
          applyToTypes: [a.type],
          category: cat.name,
          sourceType: "course_outline",
          confidence: 0.75,
        };
      }
    }
  }
  return null;
}

function formatBestN(rule: BestNRule | DropLowestRule): string {
  if (rule.kind === "BestN") {
    const of = rule.of != null ? ` of ${rule.of}` : "";
    return `Best ${rule.n}${of}${rule.category ? ` (${rule.category})` : ""} may absorb a miss`;
  }
  return `Drop lowest ${rule.n}${rule.category ? ` (${rule.category})` : ""} may absorb a miss`;
}

function linkedMaterials(data: AppData, a: Assessment): string[] {
  const out: string[] = [];
  const titleKey = a.title.toLowerCase().replace(/\s+/g, " ");

  for (const lr of data.libraryResources ?? []) {
    if (lr.assessmentId === a.id) {
      out.push(`${lr.documentClass.replace(/_/g, " ")}: ${lr.filename}`);
    } else if (
      lr.courseId === a.courseId &&
      /assignment_specification|lab_instructions|lab_handout|grading_rubric/.test(lr.documentClass) &&
      lr.filename.toLowerCase().includes(titleKey.slice(0, 12).replace(/\s/g, ""))
    ) {
      out.push(`${lr.documentClass.replace(/_/g, " ")}: ${lr.filename}`);
    }
  }

  for (const item of data.contentItems ?? []) {
    if (item.courseId !== a.courseId) continue;
    if (item.linkedActivityId === a.id) {
      out.push(`${item.documentClass.replace(/_/g, " ")}: ${item.title}`);
      continue;
    }
    const t = item.title.toLowerCase();
    if (
      /assignment_specification|lab_instructions|lab_handout|grading_rubric|exam_information/.test(
        item.documentClass,
      ) &&
      (t.includes(titleKey) || titleKey.split(/\s+/).every((w) => w.length < 2 || t.includes(w)))
    ) {
      out.push(`${item.documentClass.replace(/_/g, " ")}: ${item.title}`);
    }
  }

  for (const link of data.entityLinks ?? []) {
    if (link.kind !== "HAS_SPEC" && link.kind !== "HAS_RUBRIC" && link.kind !== "HAS_STARTER") continue;
    if (link.fromId !== a.id && link.toId !== a.id) continue;
    const other = link.fromId === a.id ? link.toId : link.fromId;
    const doc = (data.documents ?? []).find((d) => d.id === other);
    const ci = (data.contentItems ?? []).find((c) => c.id === other);
    const label = doc?.filename ?? ci?.title ?? other;
    out.push(`${link.kind.replace(/_/g, " ").toLowerCase()}: ${label}`);
  }

  // Blueprint instance citation / schedule entity
  const bp = (data.courseBlueprints ?? []).find((b) => b.courseId === a.courseId);
  if (bp) {
    const inst = bp.instances.find(
      (i) => i.title.toLowerCase() === titleKey || titleKey.includes(i.title.toLowerCase()),
    );
    if (inst?.sourceSnippet) {
      out.push(`outline: ${inst.sourceSnippet.slice(0, 80)}`);
    }
  }

  return [...new Set(out)].slice(0, 3);
}

function tonightLabOccurrence(
  data: AppData,
  courseId: string,
  now: Date,
): MeetingOccurrence | null {
  const day = now.toLocaleDateString("en-CA", { timeZone: "America/Toronto" });
  const occs = (data.meetingOccurrences ?? []).filter(
    (o) => o.courseId === courseId && !o.cancelled && o.kind === "lab" && o.date === day,
  );
  if (!occs.length) return null;
  // Prefer one that hasn't ended long ago
  const sorted = [...occs].sort((a, b) => a.startIso.localeCompare(b.startIso));
  return sorted[0] ?? null;
}

/**
 * Explainable reasons for prioritizing / briefing an assessment.
 */
export function explainAssessment(data: AppData, a: Assessment, now = new Date()): WhyReason[] {
  const reasons: WhyReason[] = [];
  const w = a.weightPercent;
  if (w != null) {
    reasons.push({ code: "weight", text: `${w}% of course` });
  } else {
    const bp = (data.courseBlueprints ?? []).find((b) => b.courseId === a.courseId);
    const inst = bp?.instances.find(
      (i) => i.title.toLowerCase() === a.title.toLowerCase() && i.weightPercent != null,
    );
    if (inst?.weightPercent != null) {
      reasons.push({
        code: "blueprint",
        text: `${inst.weightPercent}% (from outline blueprint)`,
      });
    } else {
      reasons.push({ code: "weight", text: "Weight unknown" });
    }
  }

  if (a.submissionState === "not_submitted") {
    reasons.push({ code: "not_submitted", text: "Not submitted" });
  } else if (a.submissionState === "submitted") {
    reasons.push({ code: "submitted", text: "Submitted" });
  } else if (a.submissionState === "unknown") {
    reasons.push({ code: "needs_confirmation", text: "Submission unknown" });
  }

  const hrs = hoursUntil(a.due.iso, now);
  if (hrs != null && hrs < 0) {
    reasons.push({
      code: "overdue",
      text: `Overdue by ${Math.abs(hrs) < 24 ? `${Math.abs(hrs).toFixed(0)}h` : `${(Math.abs(hrs) / 24).toFixed(1)}d`}`,
    });
  } else if (hrs != null && hrs <= 24) {
    reasons.push({
      code: "due_soon",
      text: `Due in ${hrs < 1 ? `${Math.round(hrs * 60)} min` : `${hrs.toFixed(1)}h`}`,
    });
  } else if (hrs != null && hrs <= 72) {
    reasons.push({ code: "due_soon", text: `Due in ${(hrs / 24).toFixed(1)}d` });
  }

  const safety = deadlineSafetyFromAssessment(a);
  if (safety === "DERIVED" || a.fieldProvenance.due?.sourceType === "rule_engine") {
    const label = a.due.label ?? "relative deadline from meeting occurrence";
    reasons.push({ code: "relative_deadline", text: `Derived due: ${label}` });
  }

  const best = matchingBestN(data, a);
  if (best && (a.state?.missed || (hrs != null && hrs < 0 && isAssessmentOpen(a)))) {
    reasons.push({ code: best.kind === "BestN" ? "best_n" : "drop_lowest", text: formatBestN(best) });
  } else if (best && a.type === "quiz") {
    // Surface policy even for open quizzes so brief can cite grade rules
    reasons.push({
      code: best.kind === "BestN" ? "best_n" : "drop_lowest",
      text: formatBestN(best),
    });
  }

  if (a.state?.needsConfirmation) {
    reasons.push({ code: "needs_confirmation", text: "Needs your confirmation" });
  }

  const lab = tonightLabOccurrence(data, a.courseId, now);
  if (lab && (a.type === "lab" || /lab/i.test(a.title))) {
    reasons.push({
      code: "lab_tonight",
      text: `Lab meeting tonight ${lab.date} (${lab.startIso.slice(11, 16)}–${lab.endIso.slice(11, 16)} ET)`,
    });
  }

  for (const mat of linkedMaterials(data, a)) {
    reasons.push({ code: "linked_material", text: `Material: ${mat}` });
  }

  // Caps / thresholds that mention this assessment type
  for (const r of courseRules(data, a.courseId)) {
    if (r.kind === "CombinedComponentThreshold") {
      const hit = r.components.some(
        (c) =>
          (!c.applyToTypes.length || c.applyToTypes.includes(a.type)) &&
          (!c.titlePattern || new RegExp(c.titlePattern, "i").test(a.title)),
      );
      if (hit) {
        reasons.push({
          code: "grade_rule",
          text: `Combined threshold: need ${r.requiredCoursePoints}/${r.availableCoursePoints} pts (cap ${r.capAt}%)`,
        });
      }
    }
    if (r.kind === "MinimumComponentPass" && a.type !== "quiz") {
      reasons.push({
        code: "grade_rule",
        text: `Minimum ${r.minimumPercent}% in ${r.componentCategory}`,
      });
    }
    if (r.kind === "GradeCap") {
      reasons.push({ code: "grade_rule", text: `Grade cap ${r.capPercent}% — ${r.conditionLabel}` });
    }
  }

  // Dependencies / clarifications from entity graph (no invented links)
  for (const link of data.entityLinks ?? []) {
    if (link.fromId !== a.id && link.toId !== a.id) continue;
    if (
      link.kind === "CHANGES_DEADLINE_OF" ||
      link.kind === "EXTENDS_DEADLINE_OF" ||
      link.kind === "CLARIFIES" ||
      link.kind === "ABOUT"
    ) {
      const other = link.fromId === a.id ? link.toId : link.fromId;
      const ann = (data.announcements ?? []).find((x) => x.id === other);
      const fact = (data.extractedFacts ?? []).find((x) => x.id === other);
      const label = ann?.title ?? fact?.label ?? link.kind.replace(/_/g, " ").toLowerCase();
      reasons.push({
        code: "dependency",
        text: `${link.kind === "CLARIFIES" ? "Staff clarification" : "Linked change"}: ${label}`.slice(0, 120),
      });
    }
  }

  // Section-specific timing from user section config + tonight/soon meetings
  const sec = (data.preferences.sectionConfigs ?? []).find((s) => s.courseId === a.courseId);
  if (sec) {
    const day = now.toLocaleDateString("en-CA", { timeZone: "America/Toronto" });
    const soon = (data.meetingOccurrences ?? []).filter((o) => {
      if (o.courseId !== a.courseId || o.cancelled) return false;
      if (sec.labSection && o.kind === "lab" && o.sectionCode && o.sectionCode !== sec.labSection) return false;
      if (sec.lectureSection && o.kind === "lecture" && o.sectionCode && o.sectionCode !== sec.lectureSection)
        return false;
      const hrs = hoursUntil(o.startIso, now);
      return hrs != null && hrs >= -1 && hrs <= 36;
    });
    const hit = soon.find((o) => o.date === day) ?? soon[0];
    if (hit && (a.type === hit.kind || /lab|lecture|tutorial/i.test(a.title) || a.type === "assignment")) {
      reasons.push({
        code: "section_timing",
        text: `Section ${hit.sectionCode ?? "meeting"} ${hit.kind} ${hit.date} ${hit.startIso.slice(11, 16)} ET`,
      });
    }
  }

  return reasons;
}

export function formatWhy(reasons: WhyReason[], limit = 4): string {
  return reasons
    .slice(0, limit)
    .map((r) => r.text)
    .join(" · ");
}

/**
 * Higher = more urgent for brief ranking.
 * Heavy unsubmitted work outranks light quizzes even if the quiz is slightly sooner.
 */
export function scoreAssessmentPriority(data: AppData, a: Assessment, now = new Date()): number {
  if (!isAssessmentOpen(a) && !a.state?.needsConfirmation && !a.state?.missed) {
    return 0;
  }

  let score = 0;
  const bp = (data.courseBlueprints ?? []).find((b) => b.courseId === a.courseId);
  const bpInst = bp?.instances.find((i) => i.title.toLowerCase() === a.title.toLowerCase());
  const w = a.weightPercent ?? bpInst?.weightPercent ?? null;
  // Prefer real blueprint/live weight; generic fallback only when no course knowledge exists
  const weightForScore = w ?? (bp ? 3 : 5);

  // Weight dominates: 20% assignment >> 1% quiz — blueprint-backed gets a small certainty boost
  score += Math.max(0, weightForScore) * 3;
  if (w != null && bp) score += 4;
  if (bpInst?.due?.relativeRuleId) score += 2;

  const hrs = hoursUntil(a.due.iso, now);
  if (hrs != null && hrs < 0) {
    score += 40 + Math.min(20, Math.abs(hrs) / 6);
  } else if (hrs != null && hrs <= 6) {
    score += 35 + (6 - hrs);
  } else if (hrs != null && hrs <= 24) {
    score += 25 + (24 - hrs) / 2;
  } else if (hrs != null && hrs <= 72) {
    score += 12 + (72 - hrs) / 10;
  } else if (hrs == null) {
    score += weightForScore >= 10 ? 8 : 2;
  }

  if (a.submissionState === "not_submitted") score += 8;
  if (a.state?.needsConfirmation) score += 15;
  if (a.type === "midterm" || a.type === "final") score += 20;
  if (a.type === "lab" || a.type === "assignment" || a.type === "project") score += 6;

  const best = matchingBestN(data, a);
  if (best && (a.state?.missed || (hrs != null && hrs < 0))) {
    // Missed quiz under best-N is lower risk than an unsubmitted heavy lab
    score -= best.kind === "BestN" ? 12 : 8;
  }

  const lab = tonightLabOccurrence(data, a.courseId, now);
  if (lab && (a.type === "lab" || /lab/i.test(a.title))) score += 10;

  if (linkedMaterials(data, a).length) score += 3;

  const safety = deadlineSafetyFromAssessment(a);
  if (safety === "DERIVED" || safety === "APPROXIMATE" || safety === "UNKNOWN") {
    score *= 0.97;
  }

  return score;
}

export function buildRiskInsights(data: AppData, now = new Date()): KnowledgeInsight[] {
  const courses = selectedCourses(data);
  const cmap = new Map(courses.map((c) => [c.id, c]));
  const insights: KnowledgeInsight[] = [];

  for (const a of data.assessments) {
    const course = cmap.get(a.courseId);
    if (!course) continue;
    const reasons = explainAssessment(data, a, now);
    const score = scoreAssessmentPriority(data, a, now);
    const hrs = hoursUntil(a.due.iso, now);
    const heavy = (a.weightPercent ?? 0) >= 8;
    const open = isAssessmentOpen(a);

    if (open && hrs != null && hrs < 0 && heavy) {
      insights.push({
        id: `risk:overdue:${a.id}`,
        kind: "risk",
        courseCode: course.code,
        title: a.title,
        detail: formatWhy(reasons),
        score: score + 20,
        assessmentId: a.id,
        reasons,
      });
    } else if (open && hrs != null && hrs <= 36 && heavy) {
      insights.push({
        id: `risk:due:${a.id}`,
        kind: "risk",
        courseCode: course.code,
        title: a.title,
        detail: formatWhy(reasons),
        score,
        assessmentId: a.id,
        reasons,
      });
    } else if (a.state?.missed) {
      const best = matchingBestN(data, a);
      insights.push({
        id: `risk:missed:${a.id}`,
        kind: "risk",
        courseCode: course.code,
        title: a.title,
        detail: best
          ? `Missed — ${formatBestN(best)}`
          : formatWhy(reasons.filter((r) => r.code === "best_n" || r.code === "drop_lowest" || r.code === "weight")),
        score: best ? score * 0.5 : score,
        assessmentId: a.id,
        reasons,
      });
    } else if (a.state?.needsConfirmation) {
      insights.push({
        id: `risk:confirm:${a.id}`,
        kind: "risk",
        courseCode: course.code,
        title: a.title,
        detail: formatWhy(reasons),
        score: score + 5,
        assessmentId: a.id,
        reasons,
      });
    }
  }

  // Threshold / cap risks from rules once grades exist
  for (const c of courses) {
    const effect = applyGradeRules(
      data.assessments.filter((a) => a.courseId === c.id),
      data.gradeCategories.filter((g) => g.courseId === c.id),
      courseRules(data, c.id),
    );
    for (const calc of effect.calcStates) {
      if (calc.workCalc === "provisional_drop") {
        const a = data.assessments.find((x) => x.id === calc.assessmentId);
        if (!a) continue;
        insights.push({
          id: `risk:provdrop:${calc.assessmentId}`,
          kind: "risk",
          courseCode: c.code,
          title: a.title,
          detail: calc.reason ?? "Provisional drop under incomplete best-N data",
          score: 25,
          assessmentId: calc.assessmentId,
          reasons: [{ code: "best_n", text: calc.reason ?? "Provisional best-N drop" }],
        });
      }
    }
    for (const note of [effect.thresholdDetail, effect.capReason].filter(Boolean) as string[]) {
      if (/fail|cap|threshold|below|need/i.test(note)) {
        insights.push({
          id: `risk:rule:${c.id}:${note.slice(0, 24)}`,
          kind: "risk",
          courseCode: c.code,
          title: "Grade rule pressure",
          detail: note,
          score: 30,
          assessmentId: null,
          reasons: [{ code: "grade_rule", text: note }],
        });
      }
    }
  }

  return insights.sort((a, b) => b.score - a.score).slice(0, 8);
}

export function buildRecoveryInsights(data: AppData, now = new Date()): KnowledgeInsight[] {
  const courses = selectedCourses(data);
  const cmap = new Map(courses.map((c) => [c.id, c]));
  const insights: KnowledgeInsight[] = [];

  for (const a of data.assessments) {
    const course = cmap.get(a.courseId);
    if (!course || !isAssessmentOpen(a)) continue;
    const reasons = explainAssessment(data, a, now);
    const score = scoreAssessmentPriority(data, a, now);
    const hrs = hoursUntil(a.due.iso, now);
    const mats = linkedMaterials(data, a);

    // Recoverable: still-open work with materials or relative due still ahead
    if (hrs != null && hrs > 0 && hrs <= 168 && (a.weightPercent ?? 0) >= 5) {
      insights.push({
        id: `rec:work:${a.id}`,
        kind: "recovery",
        courseCode: course.code,
        title: a.title,
        detail: [
          formatWhy(
            reasons.filter((r) =>
              ["weight", "not_submitted", "due_soon", "relative_deadline", "linked_material", "lab_tonight"].includes(
                r.code,
              ),
            ),
          ),
          mats[0] ? `Start with ${mats[0]}` : null,
        ]
          .filter(Boolean)
          .join(" · "),
        score,
        assessmentId: a.id,
        reasons,
      });
    }
  }

  // Missed quiz under best-N → recovery framing
  for (const a of data.assessments) {
    const course = cmap.get(a.courseId);
    if (!course || !a.state?.missed) continue;
    const best = matchingBestN(data, a);
    if (!best) continue;
    insights.push({
      id: `rec:bestn:${a.id}`,
      kind: "recovery",
      courseCode: course.code,
      title: a.title,
      detail: `Missed quiz retained — ${formatBestN(best)}. Focus remaining open work, not panic-zero.`,
      score: 18,
      assessmentId: a.id,
      reasons: [{ code: best.kind === "BestN" ? "best_n" : "drop_lowest", text: formatBestN(best) }],
    });
  }

  for (const a of data.assessments) {
    const course = cmap.get(a.courseId);
    if (!course || !a.state?.needsConfirmation) continue;
    insights.push({
      id: `rec:confirm:${a.id}`,
      kind: "recovery",
      courseCode: course.code,
      title: a.title,
      detail: "Confirm complete/missed/excused to clear the board",
      score: 22,
      assessmentId: a.id,
      reasons: [{ code: "needs_confirmation", text: "Needs your confirmation" }],
    });
  }

  return insights.sort((a, b) => b.score - a.score).slice(0, 8);
}

/** Effective weight for ranking, preferring live assessment then blueprint instance. */
export function effectiveWeight(data: AppData, a: Assessment): number | null {
  if (a.weightPercent != null) return a.weightPercent;
  const bp = (data.courseBlueprints ?? []).find((b) => b.courseId === a.courseId);
  const inst = bp?.instances.find((i) => i.title.toLowerCase() === a.title.toLowerCase());
  return inst?.weightPercent ?? null;
}


/** Change kinds that invalidate the current plan and force continuous re-plan. */
export const REPLAN_CHANGE_KINDS: ChangeEventKind[] = [
  "deadline_changed",
  "weight_changed",
  "new_assessment",
  "removed_assessment",
  "grade_posted",
  "announcement",
  "announcement_superseded",
  "document_version",
  "rule_changed",
  "section_changed",
  "occurrence_cancelled",
];

export function shouldReplanFromChanges(changes: ChangeEvent[]): boolean {
  return changes.some((c) => REPLAN_CHANGE_KINDS.includes(c.kind));
}

/** Unread (or recent) change events that should rebuild priorities / schedule / risk. */
export function replanTriggers(data: AppData, sinceIso?: string | null): ChangeEvent[] {
  const since = sinceIso ? Date.parse(sinceIso) : 0;
  return (data.changes ?? []).filter((c) => {
    if (!REPLAN_CHANGE_KINDS.includes(c.kind)) return false;
    if (!c.read) return true;
    if (!sinceIso) return false;
    const t = Date.parse(c.createdAt);
    return Number.isFinite(t) && t >= since;
  });
}

function normalizeTitle(t: string): string {
  return t.toLowerCase().replace(/\s+/g, " ").trim();
}

function assessmentsForCourse(data: AppData, courseId: string): Assessment[] {
  return data.assessments.filter((a) => a.courseId === courseId);
}

function matchAssessment(data: AppData, courseId: string, title: string): Assessment | undefined {
  const key = normalizeTitle(title);
  return assessmentsForCourse(data, courseId).find((a) => {
    const t = normalizeTitle(a.title);
    return t === key || t.includes(key) || key.includes(t);
  });
}

/**
 * Detect incomplete / stale course model vs CourseBlueprint expectations.
 * Callers should re-check CourseLink/docs (pendingSync) before trusting rankings.
 */
export function detectStaleModelGaps(data: AppData): StaleModelGap[] {
  const gaps: StaleModelGap[] = [];
  const courses = selectedCourses(data);

  for (const course of courses) {
    const bp = (data.courseBlueprints ?? []).find((b) => b.courseId === course.id);
    const items = assessmentsForCourse(data, course.id);

    if (!bp) {
      if (course.outlineStatus === "parsed" || course.outlineStatus === "found") {
        // Outline claimed but no blueprint — model incomplete for knowledge planning
        gaps.push({
          id: `stale:nobp:${course.id}`,
          courseId: course.id,
          courseCode: course.code,
          kind: "incomplete_blueprint",
          severity: "warn",
          detail: "Outline present but CourseBlueprint missing — re-parse outline before knowledge planning",
        });
      }
      continue;
    }

    if (bp.quality?.incomplete || (bp.quality?.score != null && bp.quality.score < 0.55)) {
      gaps.push({
        id: `stale:quality:${course.id}`,
        courseId: course.id,
        courseCode: course.code,
        kind: "quality_incomplete",
        severity: bp.quality?.incomplete ? "block" : "warn",
        detail: `Blueprint quality incomplete (score ${bp.quality?.score ?? "?"}) — re-check outline/docs`,
        expected: "complete extraction",
        observed: bp.quality?.missingCategories?.join(", ") || "incomplete",
      });
    }

    if (bp.studentSectionNeeded) {
      const sec = (data.preferences.sectionConfigs ?? []).find((s) => s.courseId === course.id);
      if (!sec?.labSection && !sec?.lectureSection) {
        gaps.push({
          id: `stale:section:${course.id}`,
          courseId: course.id,
          courseCode: course.code,
          kind: "section_unresolved",
          severity: "warn",
          detail: "Blueprint needs student section for accurate relative deadlines",
        });
      }
    }

    for (const cat of bp.categories) {
      if (cat.promisedCount == null || cat.promisedCount <= 0) continue;
      const typeGuess = cat.name.toLowerCase().includes("quiz")
        ? "quiz"
        : cat.name.toLowerCase().includes("lab")
          ? "lab"
          : cat.name.toLowerCase().includes("assign") || cat.name.toLowerCase().includes("project")
            ? "assignment"
            : null;
      const live = typeGuess
        ? items.filter((a) => a.type === typeGuess || normalizeTitle(a.title).includes(typeGuess))
        : items.filter((a) => normalizeTitle(a.title).includes(normalizeTitle(cat.name).split(/\s+/)[0] ?? ""));
      const instCount = bp.instances.filter(
        (i) => (i.categoryName && normalizeTitle(i.categoryName) === normalizeTitle(cat.name)) || i.type === typeGuess,
      ).length;
      const expected = Math.max(cat.promisedCount, instCount);
      if (live.length < Math.min(expected, Math.max(1, expected - 1)) && expected >= 2) {
        gaps.push({
          id: `stale:count:${course.id}:${cat.name}`,
          courseId: course.id,
          courseCode: course.code,
          kind: "promised_count_shortfall",
          severity: live.length === 0 ? "block" : "warn",
          detail: `${cat.name}: blueprint promises ${cat.promisedCount}, live sync has ${live.length} — re-check CourseLink`,
          expected: String(cat.promisedCount),
          observed: String(live.length),
        });
      }
    }

    for (const inst of bp.instances) {
      if (!inst.title) continue;
      const hit = matchAssessment(data, course.id, inst.title);
      if (!hit) {
        // Only flag near-term / weighted instances as blocking gaps
        const heavy = (inst.weightPercent ?? 0) >= 5 || inst.type === "midterm" || inst.type === "final";
        gaps.push({
          id: `stale:miss:${course.id}:${normalizeTitle(inst.title).slice(0, 40)}`,
          courseId: course.id,
          courseCode: course.code,
          kind: "missing_assessment",
          severity: heavy ? "block" : "warn",
          detail: `Blueprint lists "${inst.title}" but no matching CourseLink assessment — re-check quizzes/dropbox/content`,
          expected: inst.title,
          observed: "missing",
        });
      } else {
        if (hit.weightPercent == null && inst.weightPercent == null) {
          gaps.push({
            id: `stale:wt:${hit.id}`,
            courseId: course.id,
            courseCode: course.code,
            kind: "missing_weight",
            severity: "warn",
            detail: `${hit.title}: weight missing in sync and blueprint`,
          });
        }
        if ((!hit.due.iso || hit.due.certainty === "unknown") && (inst.due.kind === "unknown" || !inst.due.iso)) {
          if (hit.type === "midterm" || hit.type === "final" || (inst.weightPercent ?? hit.weightPercent ?? 0) >= 8) {
            gaps.push({
              id: `stale:date:${hit.id}`,
              courseId: course.id,
              courseCode: course.code,
              kind: "missing_date",
              severity: "warn",
              detail: `${hit.title}: due date unknown — re-check calendar/outline`,
            });
          }
        }
        if (
          isAssessmentOpen(hit) &&
          (hit.type === "lab" || hit.type === "assignment" || hit.type === "project") &&
          (hit.weightPercent ?? inst.weightPercent ?? 0) >= 5 &&
          linkedMaterials(data, hit).length === 0
        ) {
          gaps.push({
            id: `stale:mat:${hit.id}`,
            courseId: course.id,
            courseCode: course.code,
            kind: "missing_material",
            severity: "warn",
            detail: `${hit.title}: no linked spec/handout/rubric — re-check Content/Library`,
          });
        }
      }
    }
  }

  return gaps;
}

export function evaluatePlanningGate(data: AppData): PlanningGate {
  const gaps = detectStaleModelGaps(data);
  const blocks = gaps.filter((g) => g.severity === "block");
  // Material gaps alone never force a re-sync (Content may legitimately lack specs)
  const structuralWarns = gaps.filter((g) => g.severity === "warn" && g.kind !== "missing_material");
  const needsRecheck = blocks.length > 0 || structuralWarns.length >= 3;
  const ok = blocks.length === 0;
  let summary: string | null = null;
  if (blocks.length) {
    summary = `Stale course model: ${blocks.length} blocking gap(s) — re-check CourseLink/docs before trusting plan`;
  } else if (needsRecheck) {
    summary = `Incomplete course model: ${gaps.length} warning(s) — plan is provisional until sync refreshes`;
  } else if (gaps.length) {
    summary = `${gaps.length} model warning(s) — rankings still blueprint-led`;
  }
  return { ok, gaps, needsRecheck, summary };
}

/**
 * What changes if this recommendation is ignored — grade risk, schedule shift, next focus.
 */
export function explainIgnoreImpact(data: AppData, a: Assessment, now = new Date()): IgnoreImpact {
  const details: string[] = [];
  const w = effectiveWeight(data, a);
  const best = matchingBestN(data, a);
  const open = isAssessmentOpen(a);
  const hrs = hoursUntil(a.due.iso, now);

  let gradeRisk: string | null = null;
  if (!open && !a.state?.needsConfirmation) {
    gradeRisk = "Already closed — ignore has no further grade effect";
  } else if (best && (a.type === "quiz" || a.state?.missed)) {
    gradeRisk = `${formatBestN(best)} — a miss may be absorbed; remaining ${best.kind === "BestN" ? "counted" : "kept"} attempts matter more`;
    details.push(gradeRisk);
  } else if (w != null && w >= 1) {
    gradeRisk = `Ignoring risks ${w}% of course${hrs != null && hrs < 0 ? " (already overdue)" : ""}`;
    details.push(gradeRisk);
  } else {
    gradeRisk = "Weight unknown — ignore impact uncertain until outline/sync fills weight";
    details.push(gradeRisk);
  }

  let scheduleShift: string | null = null;
  if (hrs != null && hrs >= 0 && hrs <= 48) {
    scheduleShift = `Due within ${(hrs / 24).toFixed(1)}d — skipping compresses tonight/tomorrow around remaining open work`;
    details.push(scheduleShift);
  } else if (hrs != null && hrs < 0) {
    scheduleShift = "Already overdue — recovery should pivot to still-actionable higher-impact items";
    details.push(scheduleShift);
  }

  const lab = tonightLabOccurrence(data, a.courseId, now);
  if (lab && (a.type === "lab" || /lab/i.test(a.title))) {
    details.push(`Lab meeting tonight — skipping prep leaves section ${lab.sectionCode ?? ""} cold`.trim());
  }

  // Next focus = highest-scoring other open assessment
  let nextFocusId: string | null = null;
  let nextFocusTitle: string | null = null;
  let bestScore = -1;
  for (const other of data.assessments) {
    if (other.id === a.id) continue;
    if (!isAssessmentOpen(other) && !other.state?.needsConfirmation) continue;
    const courseOk = selectedCourses(data).some((c) => c.id === other.courseId);
    if (!courseOk) continue;
    const s = scoreAssessmentPriority(data, other, now);
    if (s > bestScore) {
      bestScore = s;
      nextFocusId = other.id;
      nextFocusTitle = other.title;
    }
  }
  if (nextFocusTitle) {
    details.push(`If ignored, next focus becomes: ${nextFocusTitle}`);
  }

  const summary = details[0] ?? "No material ignore impact detected from current evidence";
  return {
    summary,
    gradeRisk,
    scheduleShift,
    nextFocusId,
    nextFocusTitle,
    details: details.slice(0, 5),
  };
}

/**
 * Autonomous recovery: rebuild around still-actionable highest-impact work
 * when misses, skips, or deadline shifts invalidate the prior plan.
 */
export function buildAutonomousRecoveryPlan(data: AppData, now = new Date()): RecoveryPlan {
  const courses = selectedCourses(data);
  const cmap = new Map(courses.map((c) => [c.id, c]));
  const triggers: string[] = [];

  const missed = data.assessments.filter((a) => cmap.has(a.courseId) && a.state?.missed);
  const overdueHeavy = data.assessments.filter((a) => {
    if (!cmap.has(a.courseId) || !isAssessmentOpen(a)) return false;
    const hrs = hoursUntil(a.due.iso, now);
    const w = effectiveWeight(data, a) ?? 0;
    return hrs != null && hrs < 0 && w >= 5;
  });
  const recent = replanTriggers(data).filter((c) =>
    ["deadline_changed", "occurrence_cancelled", "grade_posted", "rule_changed"].includes(c.kind),
  );

  if (missed.length) triggers.push(`${missed.length} missed`);
  if (overdueHeavy.length) triggers.push(`${overdueHeavy.length} overdue heavy`);
  if (recent.length) triggers.push(`${recent.length} plan-shifting change(s)`);

  const mode: RecoveryPlan["mode"] = triggers.length ? "recovery" : "steady";

  const ranked = data.assessments
    .filter((a) => cmap.has(a.courseId) && (isAssessmentOpen(a) || a.state?.needsConfirmation))
    .map((a) => ({
      a,
      score: scoreAssessmentPriority(data, a, now),
      reasons: explainAssessment(data, a, now),
      impact: explainIgnoreImpact(data, a, now),
    }))
    .sort((x, y) => y.score - x.score);

  const items: RecoveryPlanItem[] = [];
  const deferred: RecoveryPlan["deferred"] = [];

  for (const row of ranked) {
    const course = cmap.get(row.a.courseId)!;
    const best = matchingBestN(data, row.a);
    const w = effectiveWeight(data, row.a) ?? 0;
    // Defer light absorbable quizzes when in recovery mode and heavier work exists
    if (
      mode === "recovery" &&
      best &&
      row.a.type === "quiz" &&
      w <= 2 &&
      ranked.some((r) => r.score > row.score && (effectiveWeight(data, r.a) ?? 0) >= 5)
    ) {
      deferred.push({
        assessmentId: row.a.id,
        title: row.a.title,
        reason: `${formatBestN(best)} — defer while recovering higher-impact work`,
      });
      continue;
    }
    if (items.length >= 5) {
      if (row.score > 0) {
        deferred.push({
          assessmentId: row.a.id,
          title: row.a.title,
          reason: "Below top recovery slate",
        });
      }
      continue;
    }
    items.push({
      assessmentId: row.a.id,
      courseCode: course.code,
      title: row.a.title,
      score: row.score,
      why: formatWhy(row.reasons, 4),
      ignoreImpact: row.impact.summary,
    });
  }

  const trigger = triggers.length ? triggers.join(" · ") : null;
  const summary =
    mode === "recovery"
      ? `Recovery rebuild: focus ${items.length} still-actionable item(s)${trigger ? ` after ${trigger}` : ""}`
      : items[0]
        ? `Steady plan: lead with ${items[0].courseCode} — ${items[0].title}`
        : "No open actionable work in selected courses";

  return { mode, trigger, items, deferred: deferred.slice(0, 8), summary };
}

export function buildPlanningAutonomy(data: AppData, now = new Date()): PlanningAutonomy {
  const gate = evaluatePlanningGate(data);
  const courses = selectedCourses(data);
  const cmap = new Map(courses.map((c) => [c.id, c]));
  const triggers = replanTriggers(data);

  const recommendations: PlanningRecommendation[] = data.assessments
    .filter((a) => cmap.has(a.courseId) && (isAssessmentOpen(a) || a.state?.needsConfirmation || a.state?.missed))
    .map((a) => {
      const reasons = explainAssessment(data, a, now);
      if (gate.needsRecheck) {
        reasons.push({
          code: "stale_model",
          text: gate.summary ?? "Course model may be incomplete — re-check before hard commitments",
        });
      }
      if (triggers.length) {
        reasons.push({
          code: "replan",
          text: `Re-planned from ${triggers.length} change event(s)`,
        });
      }
      const impact = explainIgnoreImpact(data, a, now);
      reasons.push({ code: "ignore_impact", text: `If ignored: ${impact.summary}` });
      return {
        assessmentId: a.id,
        courseCode: cmap.get(a.courseId)!.code,
        title: a.title,
        score: scoreAssessmentPriority(data, a, now),
        reasons,
        why: formatWhy(
          reasons.filter((r) => r.code !== "ignore_impact" && r.code !== "replan" && r.code !== "stale_model"),
          5,
        ),
        ignoreImpact: impact,
      };
    })
    .sort((a, b) => b.score - a.score);

  const recovery = buildAutonomousRecoveryPlan(data, now);
  const replanNote = triggers.length
    ? `Continuous re-plan: ${triggers
        .slice(0, 3)
        .map((c) => c.kind.replace(/_/g, " "))
        .join(", ")}${triggers.length > 3 ? "…" : ""}`
    : recovery.mode === "recovery"
      ? recovery.summary
      : null;

  return {
    gate,
    recommendations,
    recovery,
    replanFrom: triggers,
    replanNote,
    requestRecheck: gate.needsRecheck,
  };
}
