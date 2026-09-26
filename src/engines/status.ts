import type { Assessment, TaskStatus } from "@/domain/types";

export function classifyTaskStatus(
  a: Assessment,
  now = new Date(),
  warnHours = 48,
): TaskStatus {
  if (a.pointsEarned != null || a.gradeDisplay) return "graded";
  if (a.submissionState === "submitted") return "submitted";

  if (!a.due.iso || a.due.certainty === "unknown") return "unknown";

  const due = Date.parse(a.due.iso);
  if (!Number.isFinite(due)) return "unknown";

  const ms = due - now.getTime();
  if (ms < 0) {
    if (a.submissionState === "not_submitted") return "overdue";
    if (a.submissionState === "unknown") return "unknown";
    return "overdue";
  }

  const hours = ms / 36e5;
  const startOfToday = new Date(now);
  startOfToday.setHours(0, 0, 0, 0);
  const endOfToday = new Date(startOfToday);
  endOfToday.setDate(endOfToday.getDate() + 1);

  if (due >= startOfToday.getTime() && due < endOfToday.getTime()) return "due_today";
  if (hours <= warnHours) return "due_soon";
  return "upcoming";
}

export function statusLabel(s: TaskStatus): string {
  switch (s) {
    case "upcoming": return "Upcoming";
    case "due_soon": return "Due soon";
    case "due_today": return "Due today";
    case "overdue": return "Overdue";
    case "submitted": return "Submitted";
    case "graded": return "Graded";
    case "unknown": return "Unknown";
  }
}
