/**
 * Knowledge-driven planning context for JARVIS brief / priority / reminders.
 * Consumes CourseBlueprint + academicRules + live sync state — never hardcodes courses.
 */
import type {
  AppData,
  Assessment,
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
    | "blueprint";
  text: string;
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
  const w =
    a.weightPercent ??
    (data.courseBlueprints ?? [])
      .find((b) => b.courseId === a.courseId)
      ?.instances.find((i) => i.title.toLowerCase() === a.title.toLowerCase())?.weightPercent ??
    5;

  // Weight dominates: 20% assignment >> 1% quiz
  score += Math.max(0, w) * 3;

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
    score += w >= 10 ? 8 : 2;
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
