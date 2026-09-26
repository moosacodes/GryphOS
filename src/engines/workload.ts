import { torontoDayKey } from "@/domain/dates";
import type { Assessment } from "@/domain/types";
import { classifyTaskStatus } from "./status";

export interface WeekBucket {
  weekStart: string; // YYYY-MM-DD (Monday)
  count: number;
  weightSum: number;
  assessmentIds: string[];
  busy: boolean;
}

export interface WorkloadSnapshot {
  dueToday: Assessment[];
  dueTomorrow: Assessment[];
  dueThisWeek: Assessment[];
  dueNextWeek: Assessment[];
  overdue: Assessment[];
  upcomingExams: Assessment[];
  overlappingDays: string[];
  weeks: WeekBucket[];
}

function hasExactDue(a: Assessment): a is Assessment & { due: { iso: string } } {
  return !!a.due.iso && a.due.certainty !== "unknown";
}

function mondayKey(d: Date): string {
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  const m = new Date(d);
  m.setHours(0, 0, 0, 0);
  m.setDate(m.getDate() + diff);
  return m.toISOString().slice(0, 10);
}

export function computeWorkload(
  assessments: Assessment[],
  now = new Date(),
  warnHours = 48,
): WorkloadSnapshot {
  const open = assessments.filter(
    (a) => a.submissionState !== "submitted" || a.pointsEarned == null,
  );

  const dueToday: Assessment[] = [];
  const dueTomorrow: Assessment[] = [];
  const dueThisWeek: Assessment[] = [];
  const dueNextWeek: Assessment[] = [];
  const overdue: Assessment[] = [];
  const upcomingExams: Assessment[] = [];

  const today = torontoDayKey(now.toISOString());
  const tomorrowDate = new Date(now);
  tomorrowDate.setDate(tomorrowDate.getDate() + 1);
  const tomorrow = torontoDayKey(tomorrowDate.toISOString());

  const weekStart = mondayKey(now);
  const nextWeekStartDate = new Date(weekStart + "T12:00:00");
  nextWeekStartDate.setDate(nextWeekStartDate.getDate() + 7);
  const nextWeekStart = nextWeekStartDate.toISOString().slice(0, 10);
  const weekAfter = new Date(nextWeekStartDate);
  weekAfter.setDate(weekAfter.getDate() + 7);
  const weekAfterKey = weekAfter.toISOString().slice(0, 10);

  const byDay = new Map<string, Assessment[]>();

  for (const a of assessments) {
    const status = classifyTaskStatus(a, now, warnHours);
    if (status === "overdue") overdue.push(a);
    if ((a.type === "midterm" || a.type === "final") && hasExactDue(a)) {
      if (Date.parse(a.due.iso) >= now.getTime()) upcomingExams.push(a);
    }
    if (!hasExactDue(a)) continue;
    const key = torontoDayKey(a.due.iso);
    byDay.set(key, [...(byDay.get(key) ?? []), a]);

    if (a.submissionState === "submitted" && a.pointsEarned != null) continue;
    if (key === today) dueToday.push(a);
    else if (key === tomorrow) dueTomorrow.push(a);

    if (key >= weekStart && key < nextWeekStart) dueThisWeek.push(a);
    else if (key >= nextWeekStart && key < weekAfterKey) dueNextWeek.push(a);
  }

  const overlappingDays = [...byDay.entries()]
    .filter(([, list]) => list.length >= 3)
    .map(([k]) => k);

  const weekMap = new Map<string, WeekBucket>();
  for (const a of assessments.filter(hasExactDue)) {
    const d = new Date(a.due.iso);
    const ws = mondayKey(d);
    const bucket = weekMap.get(ws) ?? {
      weekStart: ws,
      count: 0,
      weightSum: 0,
      assessmentIds: [],
      busy: false,
    };
    bucket.count += 1;
    bucket.weightSum += a.weightPercent ?? 0;
    bucket.assessmentIds.push(a.id);
    weekMap.set(ws, bucket);
  }

  const weeks = [...weekMap.values()].sort((a, b) => a.weekStart.localeCompare(b.weekStart));
  const avg = weeks.length ? weeks.reduce((s, w) => s + w.count, 0) / weeks.length : 0;
  for (const w of weeks) {
    w.busy = w.count >= Math.max(3, Math.ceil(avg * 1.5)) || w.weightSum >= 25;
  }

  void open;
  return {
    dueToday,
    dueTomorrow,
    dueThisWeek,
    dueNextWeek,
    overdue,
    upcomingExams: upcomingExams.sort(
      (a, b) => Date.parse(a.due.iso!) - Date.parse(b.due.iso!),
    ),
    overlappingDays,
    weeks,
  };
}
