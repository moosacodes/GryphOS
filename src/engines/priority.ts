/**
 * Deterministic Command Centre priority engine — weight-aware, explainable.
 * Unknown weight ≠ zero; uncertainty is labeled.
 */
import type { Assessment, Course, ChangeEvent } from "@/domain/types";
import { deadlineSafetyFromAssessment } from "./deadlines";

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
}

function hoursUntil(iso: string | null, now: Date): number | null {
  if (!iso) return null;
  return (Date.parse(iso) - now.getTime()) / 3_600_000;
}

export function buildCommandCentre(
  courses: Course[],
  assessments: Assessment[],
  changes: ChangeEvent[],
  now = new Date(),
): PriorityItem[] {
  const courseMap = new Map(courses.map((c) => [c.id, c]));
  const items: PriorityItem[] = [];

  for (const a of assessments) {
    const course = courseMap.get(a.courseId);
    if (!course || !course.selected) continue;
    const explanations: string[] = [];
    let score = 0;
    let bucket: PriorityBucket = "WATCH";

    const weightKnown = a.weightPercent != null;
    const w = a.weightPercent;
    // Unknown weight gets neutral prior 5 (not zero)
    const weightFactor = weightKnown ? Math.max(1, w!) : 5;
    explanations.push(
      weightKnown ? `Weight ${w}%` : "Weight unknown — using neutral prior (not treated as 0)",
    );

    const safety = deadlineSafetyFromAssessment(a);
    explanations.push(`Deadline safety: ${safety}`);

    const hrs = hoursUntil(a.due.iso, now);
    const done =
      a.submissionState === "submitted" ||
      a.state?.userCompleted === "confirmed" ||
      a.state?.work === "completed";

    if (done) {
      bucket = "DONE";
      score = 0;
      explanations.push("Marked submitted/completed");
    } else if (a.state?.needsConfirmation) {
      bucket = "CONFIRMATION";
      score = 80 + weightFactor;
      explanations.push("Needs user confirmation (past due / uncertain completion)");
    } else if (hrs != null && hrs < 0) {
      bucket = "NEEDS_ACTION";
      score = 90 + weightFactor - Math.min(20, Math.abs(hrs) / 24);
      explanations.push(`Overdue by ${Math.abs(hrs).toFixed(1)}h`);
    } else if (hrs != null && hrs <= 24) {
      bucket = "NOW";
      score = 70 + weightFactor + (24 - hrs);
      explanations.push(`Due within 24h (${hrs.toFixed(1)}h)`);
    } else if (hrs != null && hrs <= 72) {
      bucket = "NEXT";
      score = 50 + weightFactor + (72 - hrs) / 10;
      explanations.push(`Due within 72h (${hrs.toFixed(1)}h)`);
    } else if (hrs != null) {
      bucket = "WATCH";
      score = 20 + weightFactor / 2;
      explanations.push(`Upcoming in ${(hrs / 24).toFixed(1)} days`);
    } else {
      bucket = "WATCH";
      score = 10 + weightFactor / 5;
      explanations.push("No due date — unknown timing");
    }

    if (safety === "DERIVED" || safety === "APPROXIMATE" || safety === "UNKNOWN") {
      explanations.push("Timing not fully authoritative — treat as guidance");
      score *= 0.95;
    }

    items.push({
      id: `pri:${a.id}`,
      bucket,
      score,
      title: a.title,
      courseCode: course.code,
      assessmentId: a.id,
      explanation: explanations,
      weightKnown,
      weightPercent: w,
    });
  }

  for (const ch of changes.filter((c) => !c.read)) {
    items.push({
      id: `pri:ch:${ch.id}`,
      bucket: "CHANGES",
      score: 60,
      title: ch.title,
      courseCode: courses.find((c) => c.id === ch.courseId)?.code ?? "?",
      assessmentId: ch.entityId,
      explanation: [ch.detail, "Unread change event"],
      weightKnown: false,
      weightPercent: null,
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
