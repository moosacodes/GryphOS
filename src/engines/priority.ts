/**
 * Deterministic Command Centre priority engine — blueprint/rule-aware, explainable.
 * Unknown weight ≠ zero; uncertainty is labeled. Never hardcodes course IDs.
 */
import type { AppData, Assessment, Course, ChangeEvent } from "@/domain/types";
import { deadlineSafetyFromAssessment } from "./deadlines";
import {
  explainAssessment,
  explainIgnoreImpact,
  formatWhy,
  isAssessmentOpen,
  scoreAssessmentPriority,
  type IgnoreImpact,
} from "./planningKnowledge";

export type PriorityBucket =
  | "NOW"
  | "NEXT"
  | "NEEDS_ACTION"
  | "CONFIRMATION"
  | "CHANGES"
  | "WATCH"
  | "DONE";

export interface PriorityItem {
  id: string;
  bucket: PriorityBucket;
  score: number;
  title: string;
  courseCode: string;
  assessmentId: string | null;
  explanation: string[];
  weightKnown: boolean;
  weightPercent: number | null;
  ignoreImpact: IgnoreImpact | null;
}

function hoursUntil(iso: string | null, now: Date): number | null {
  if (!iso) return null;
  return (Date.parse(iso) - now.getTime()) / 3_600_000;
}

/** @deprecated Prefer buildCommandCentreFromData — kept for callers with raw lists. */
export function buildCommandCentre(
  courses: Course[],
  assessments: Assessment[],
  changes: ChangeEvent[],
  now = new Date(),
): PriorityItem[] {
  const data = {
    courses,
    assessments,
    changes,
    preferences: { selectedCourseIds: courses.filter((c) => c.selected).map((c) => c.id) },
    academicRules: [],
    gradeCategories: [],
    courseBlueprints: [],
    libraryResources: [],
    contentItems: [],
    entityLinks: [],
    documents: [],
    meetingOccurrences: [],
  } as unknown as AppData;
  return buildCommandCentreFromData(data, now);
}

export function buildCommandCentreFromData(data: AppData, now = new Date()): PriorityItem[] {
  const selected = data.preferences.selectedCourseIds;
  const courseMap = new Map(data.courses.map((c) => [c.id, c]));
  const items: PriorityItem[] = [];

  for (const a of data.assessments) {
    const course = courseMap.get(a.courseId);
    if (!course) continue;
    if (selected?.length ? !selected.includes(course.id) : !course.selected) continue;

    const reasons = explainAssessment(data, a, now);
    const knowledgeScore = scoreAssessmentPriority(data, a, now);
    const explanations = reasons.map((r) => r.text);
    const weightKnown = a.weightPercent != null;
    const w = a.weightPercent;
    const safety = deadlineSafetyFromAssessment(a);
    explanations.push(`Deadline safety: ${safety}`);

    const hrs = hoursUntil(a.due.iso, now);
    const done = !isAssessmentOpen(a) && !a.state?.needsConfirmation && !a.state?.missed;

    let bucket: PriorityBucket = "WATCH";
    // Knowledge score already encodes weight × urgency × rules; do not let a
    // light quiz's proximity override a heavy unsubmitted assignment.
    let score = knowledgeScore;

    if (done) {
      bucket = "DONE";
      score = 0;
      explanations.push("Marked submitted/completed");
    } else if (a.state?.needsConfirmation) {
      bucket = "CONFIRMATION";
      score += 8;
    } else if (hrs != null && hrs < 0) {
      bucket = "NEEDS_ACTION";
      score += 6;
    } else if (hrs != null && hrs <= 24) {
      bucket = "NOW";
      score += 4;
    } else if (hrs != null && hrs <= 72) {
      bucket = "NEXT";
      score += 2;
    } else if (hrs != null) {
      bucket = "WATCH";
    } else {
      bucket = "WATCH";
      explanations.push("No due date — unknown timing");
    }

    if (safety === "DERIVED" || safety === "APPROXIMATE" || safety === "UNKNOWN") {
      explanations.push("Timing not fully authoritative — treat as guidance");
    }

    const why = formatWhy(reasons, 5);
    if (why && !explanations.includes(why)) {
      explanations.unshift(why);
    }

    const impact = explainIgnoreImpact(data, a, now);
    if (impact.summary && !explanations.some((e) => e.includes("If ignored"))) {
      explanations.push(`If ignored: ${impact.summary}`);
    }

    items.push({
      id: `pri:${a.id}`,
      bucket,
      score,
      title: a.title,
      courseCode: course.code,
      assessmentId: a.id,
      explanation: [...new Set(explanations)],
      weightKnown,
      weightPercent: w,
      ignoreImpact: impact,
    });
  }

  for (const ch of (data.changes ?? []).filter((c) => !c.read)) {
    items.push({
      id: `pri:ch:${ch.id}`,
      bucket: "CHANGES",
      score: 60,
      title: ch.title,
      courseCode: data.courses.find((c) => c.id === ch.courseId)?.code ?? "?",
      assessmentId: ch.entityId,
      explanation: [ch.detail, "Unread change event"],
      weightKnown: false,
      weightPercent: null,
      ignoreImpact: null,
    });
  }

  const order: PriorityBucket[] = [
    "NOW",
    "NEEDS_ACTION",
    "CONFIRMATION",
    "CHANGES",
    "NEXT",
    "WATCH",
    "DONE",
  ];
  return items.sort((a, b) => {
    const bi = order.indexOf(a.bucket) - order.indexOf(b.bucket);
    if (bi !== 0) return bi;
    return b.score - a.score;
  });
}
