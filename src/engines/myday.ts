/**
 * My Day — chronological academic timeline for the home surface.
 * Combines classes/labs, assessments, tasks, commute (ICS), and changes.
 * Unknown stays unknown; submitted items stop nagging; unverifiable items ask.
 */
import type {
  Announcement,
  AppData,
  Assessment,
  CalendarEventItem,
  ChangeEvent,
  Course,
  MeetingOccurrence,
  UserTask,
} from "@/domain/types";
import { formatInToronto, torontoDayKey } from "@/domain/dates";
import { summarizeCourseGrades } from "./grades";
import { ensureTypedRule } from "@/domain/rules";

export type MyDaySection =
  | "right_now"
  | "next"
  | "tonight"
  | "coming_up"
  | "since_last_checked"
  | "needs_answer"
  | "history";

export type MyDayKind =
  | "class"
  | "lab"
  | "tutorial"
  | "assessment"
  | "deadline"
  | "task"
  | "commute"
  | "study"
  | "change"
  | "announcement"
  | "personal";

export type MyDayCta =
  | { kind: "confirm_complete"; assessmentId: string }
  | { kind: "confirm_missed"; assessmentId: string }
  | { kind: "confirm_excused"; assessmentId: string }
  | { kind: "open_assessment"; assessmentId: string }
  | { kind: "open_course"; courseId: string }
  | { kind: "open_url"; url: string; label: string }
  | { kind: "mark_task_done"; taskId: string }
  | { kind: "mark_change_read"; changeId: string };

export interface MyDayItem {
  id: string;
  section: MyDaySection;
  kind: MyDayKind;
  courseId: string | null;
  courseCode: string;
  courseColor: string | null;
  title: string;
  subtitle: string;
  startIso: string | null;
  endIso: string | null;
  weightPercent: number | null;
  statusLabel: string;
  actionable: boolean;
  ctas: MyDayCta[];
  href: string | null;
  sortKey: number;
}

function selectedCourses(data: AppData): Course[] {
  const ids = data.preferences.selectedCourseIds;
  if (ids?.length) return data.courses.filter((c) => ids.includes(c.id));
  return data.courses.filter((c) => c.selected);
}

function courseMap(courses: Course[]): Map<string, Course> {
  return new Map(courses.map((c) => [c.id, c]));
}

function isDone(a: Assessment): boolean {
  if (a.submissionState === "submitted") return true;
  if (a.state?.work === "completed") return true;
  if (a.state?.userCompleted === "confirmed") return true;
  if (a.pointsEarned != null || a.gradeDisplay) return true;
  return false;
}

function isClosedUnactionable(a: Assessment, now: Date): boolean {
  if (isDone(a)) return true;
  if (a.state?.missed || a.state?.dropped) return true;
  const end = a.end.iso ? Date.parse(a.end.iso) : a.due.iso ? Date.parse(a.due.iso) : NaN;
  if (!Number.isFinite(end)) return false;
  // Closed quizzes/dropboxes with unknown submission → needs answer, not history,
  // unless user already confirmed.
  if (a.state?.pastDueConfirmed) return true;
  if (end < now.getTime() - 7 * 864e5 && a.submissionState === "not_submitted" && a.state?.needsConfirmation) {
    return false;
  }
  return false;
}

function bestNConsequence(data: AppData, a: Assessment): string | null {
  const rules = (data.academicRules ?? []).map(ensureTypedRule).filter((r) => r.courseId === a.courseId);
  for (const r of rules) {
    if (r.kind === "BestN") {
      const of = r.of != null ? ` of ${r.of}` : "";
      return `Miss retained — best ${r.n}${of} may absorb this`;
    }
    if (r.kind === "DropLowest") {
      return `Miss retained — drop lowest ${r.n} may absorb this`;
    }
  }
  const cats = data.gradeCategories.filter((c) => c.courseId === a.courseId);
  for (const c of cats) {
    if (c.bestN != null) return `Miss retained — best ${c.bestN} rule may absorb this`;
    if (c.dropLowest > 0) return `Miss retained — drop lowest ${c.dropLowest} may absorb this`;
  }
  return null;
}

function formatWhen(iso: string | null, label?: string | null): string {
  if (iso) return formatInToronto(iso, "EEE MMM d · h:mm a");
  return label ?? "Time unknown";
}

function tonightWindow(now: Date): { start: number; end: number } {
  const start = new Date(now);
  start.setHours(17, 0, 0, 0);
  const end = new Date(now);
  end.setHours(23, 59, 59, 999);
  return { start: start.getTime(), end: end.getTime() };
}

function dayEnd(now: Date): number {
  const d = new Date(now);
  d.setHours(23, 59, 59, 999);
  return d.getTime();
}

function dayStart(now: Date): number {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function occurrenceItems(
  occs: MeetingOccurrence[],
  courses: Map<string, Course>,
  now: Date,
): MyDayItem[] {
  const items: MyDayItem[] = [];
  const todayKey = torontoDayKey(now.toISOString());
  for (const o of occs) {
    if (o.cancelled) continue;
    const course = courses.get(o.courseId);
    if (!course) continue;
    const start = Date.parse(o.startIso);
    const end = Date.parse(o.endIso);
    if (!Number.isFinite(start) || !Number.isFinite(end)) continue;
    // Only today ± a bit for right_now/next; coming_up for next few days
    const daysOut = (Date.parse(o.date + "T12:00:00") - Date.parse(todayKey + "T12:00:00")) / 864e5;
    if (daysOut < -0.5 || daysOut > 7) continue;

    let section: MyDaySection = "coming_up";
    let statusLabel: string = o.kind;
    const ctas: MyDayCta[] = [{ kind: "open_course", courseId: course.id }];
    if (o.date === todayKey) {
      if (now.getTime() >= start && now.getTime() <= end) {
        section = "right_now";
        statusLabel = "In progress";
      } else if (now.getTime() < start && start - now.getTime() <= 3 * 3600_000) {
        section = "next";
        statusLabel = `Starts ${formatInToronto(o.startIso, "h:mm a")}`;
      } else if (now.getTime() > end && now.getTime() - end <= 45 * 60_000) {
        section = "needs_answer";
        statusLabel = `Finished ${Math.round((now.getTime() - end) / 60000)} min ago`;
        if (o.kind === "lab" || o.kind === "tutorial") {
          ctas.unshift(
            { kind: "confirm_complete", assessmentId: `occ:${o.id}` },
            { kind: "confirm_missed", assessmentId: `occ:${o.id}` },
          );
        }
      } else if (start >= tonightWindow(now).start) {
        section = "tonight";
      } else if (start > now.getTime()) {
        section = "next";
      } else {
        section = "history";
      }
    }

    const kind: MyDayKind =
      o.kind === "lab" ? "lab" : o.kind === "tutorial" ? "tutorial" : o.kind === "lecture" ? "class" : "class";

    items.push({
      id: `occ:${o.id}`,
      section,
      kind,
      courseId: course.id,
      courseCode: course.code,
      courseColor: course.color,
      title: `${course.code} ${o.kind === "lecture" ? "Lecture" : o.kind === "lab" ? "Lab" : o.kind}`,
      subtitle: [o.location, `${formatInToronto(o.startIso, "h:mm a")}–${formatInToronto(o.endIso, "h:mm a")}`]
        .filter(Boolean)
        .join(" · "),
      startIso: o.startIso,
      endIso: o.endIso,
      weightPercent: null,
      statusLabel,
      actionable: section === "needs_answer",
      ctas,
      href: `/courses/${encodeURIComponent(course.id)}`,
      sortKey: start,
    });
  }
  return items;
}

function assessmentItems(data: AppData, courses: Map<string, Course>, now: Date): MyDayItem[] {
  const items: MyDayItem[] = [];
  const tonight = tonightWindow(now);
  const endToday = dayEnd(now);
  const startToday = dayStart(now);

  for (const a of data.assessments) {
    const course = courses.get(a.courseId);
    if (!course) continue;
    const dueMs = a.due.iso ? Date.parse(a.due.iso) : NaN;
    const done = isDone(a);

    if (done) {
      // Stop nagging — only show in history if recently completed
      if (a.submittedAt) {
        const sub = Date.parse(a.submittedAt);
        if (Number.isFinite(sub) && now.getTime() - sub < 2 * 864e5) {
          items.push({
            id: `a:${a.id}:done`,
            section: "history",
            kind: "assessment",
            courseId: course.id,
            courseCode: course.code,
            courseColor: course.color,
            title: a.title,
            subtitle: "Submitted — no longer nagging",
            startIso: a.due.iso,
            endIso: a.end.iso,
            weightPercent: a.weightPercent,
            statusLabel: "Submitted",
            actionable: false,
            ctas: [{ kind: "open_assessment", assessmentId: a.id }],
            href: `/assessment/${encodeURIComponent(a.id)}`,
            sortKey: dueMs || 0,
          });
        }
      }
      continue;
    }

    // Needs confirmation (past due / unverifiable)
    const needsAsk =
      a.state?.needsConfirmation ||
      (Number.isFinite(dueMs) &&
        dueMs < now.getTime() &&
        a.submissionState !== "submitted" &&
        !a.state?.pastDueConfirmed &&
        (a.submissionState === "unknown" || a.type === "lab" || a.type === "quiz"));

    if (needsAsk && !a.state?.missed) {
      const consequence = bestNConsequence(data, a);
      const ctas: MyDayCta[] = [
        { kind: "confirm_complete", assessmentId: a.id },
        { kind: "confirm_missed", assessmentId: a.id },
      ];
      if (a.url) ctas.push({ kind: "open_url", url: a.url, label: "Open in CourseLink" });
      ctas.push({ kind: "open_assessment", assessmentId: a.id });
      items.push({
        id: `a:${a.id}:ask`,
        section: "needs_answer",
        kind: "assessment",
        courseId: course.id,
        courseCode: course.code,
        courseColor: course.color,
        title: a.title,
        subtitle: [
          formatWhen(a.due.iso, a.due.label),
          a.submissionState === "not_submitted" ? "Not submitted" : "Submission unknown",
          consequence,
        ]
          .filter(Boolean)
          .join(" · "),
        startIso: a.due.iso,
        endIso: a.end.iso,
        weightPercent: a.weightPercent,
        statusLabel: a.state?.missed ? "Missed" : "Needs your answer",
        actionable: true,
        ctas,
        href: `/assessment/${encodeURIComponent(a.id)}`,
        sortKey: dueMs || now.getTime(),
      });
      continue;
    }

    if (a.state?.missed) {
      const consequence = bestNConsequence(data, a);
      items.push({
        id: `a:${a.id}:missed`,
        section: "history",
        kind: "assessment",
        courseId: course.id,
        courseCode: course.code,
        courseColor: course.color,
        title: a.title,
        subtitle: consequence ?? "Missed — retained in history (not screaming OVERDUE)",
        startIso: a.due.iso,
        endIso: a.end.iso,
        weightPercent: a.weightPercent,
        statusLabel: "Missed",
        actionable: false,
        ctas: [{ kind: "open_assessment", assessmentId: a.id }],
        href: `/assessment/${encodeURIComponent(a.id)}`,
        sortKey: dueMs || 0,
      });
      continue;
    }

    if (isClosedUnactionable(a, now)) continue;

    if (!Number.isFinite(dueMs)) {
      // Unknown due — only surface if weighty or type important
      if ((a.weightPercent ?? 0) >= 10 || a.type === "midterm" || a.type === "final") {
        items.push({
          id: `a:${a.id}:unk`,
          section: "coming_up",
          kind: "assessment",
          courseId: course.id,
          courseCode: course.code,
          courseColor: course.color,
          title: a.title,
          subtitle: a.due.label ?? "Due date unknown",
          startIso: null,
          endIso: null,
          weightPercent: a.weightPercent,
          statusLabel: "Date unknown",
          actionable: false,
          ctas: [{ kind: "open_assessment", assessmentId: a.id }],
          href: `/assessment/${encodeURIComponent(a.id)}`,
          sortKey: now.getTime() + 30 * 864e5,
        });
      }
      continue;
    }

    let section: MyDaySection = "coming_up";
    let statusLabel = a.submissionState === "not_submitted" ? "Not submitted" : "Upcoming";
    if (dueMs < now.getTime()) {
      section = "needs_answer";
      statusLabel = "Past due — confirm";
    } else if (dueMs <= now.getTime() + 3 * 3600_000) {
      section = "right_now";
      statusLabel = "Due soon";
    } else if (dueMs >= tonight.start && dueMs <= tonight.end) {
      section = "tonight";
      statusLabel = `Due ${formatInToronto(a.due.iso!, "h:mm a")}`;
    } else if (dueMs >= startToday && dueMs <= endToday) {
      section = "next";
      statusLabel = `Due today ${formatInToronto(a.due.iso!, "h:mm a")}`;
    } else if (dueMs <= now.getTime() + 7 * 864e5) {
      section = "coming_up";
      statusLabel = formatWhen(a.due.iso);
    } else if (dueMs <= now.getTime() + 21 * 864e5) {
      section = "coming_up";
      statusLabel = formatWhen(a.due.iso);
    } else {
      continue; // too far out for My Day
    }

    const ctas: MyDayCta[] = [{ kind: "open_assessment", assessmentId: a.id }];
    if (a.url) ctas.push({ kind: "open_url", url: a.url, label: "Open in CourseLink" });

    items.push({
      id: `a:${a.id}`,
      section,
      kind: a.type === "lab" ? "lab" : "assessment",
      courseId: course.id,
      courseCode: course.code,
      courseColor: course.color,
      title: a.title,
      subtitle: [
        formatWhen(a.due.iso, a.due.label),
        a.weightPercent != null ? `${a.weightPercent}%` : null,
        statusLabel,
      ]
        .filter(Boolean)
        .join(" · "),
      startIso: a.due.iso,
      endIso: a.end.iso,
      weightPercent: a.weightPercent,
      statusLabel,
      actionable: section === "needs_answer" || section === "tonight" || section === "right_now",
      ctas,
      href: `/assessment/${encodeURIComponent(a.id)}`,
      sortKey: dueMs,
    });
  }
  return items;
}

function changeItems(
  changes: ChangeEvent[],
  courses: Map<string, Course>,
  lastCheckedAt: number | null,
  now: Date,
): MyDayItem[] {
  const cutoff = lastCheckedAt ?? now.getTime() - 4 * 864e5;
  return changes
    .filter((c) => Date.parse(c.createdAt) >= cutoff || !c.read)
    .slice(0, 40)
    .map((c) => {
      const course = c.courseId ? courses.get(c.courseId) : undefined;
      return {
        id: `ch:${c.id}`,
        section: "since_last_checked" as const,
        kind: "change" as const,
        courseId: c.courseId,
        courseCode: course?.code ?? "Update",
        courseColor: course?.color ?? null,
        title: c.title,
        subtitle: c.detail,
        startIso: c.createdAt,
        endIso: null,
        weightPercent: null,
        statusLabel: c.kind.replace(/_/g, " "),
        actionable: !c.read,
        ctas: [
          { kind: "mark_change_read" as const, changeId: c.id },
          ...(c.entityId
            ? [{ kind: "open_assessment" as const, assessmentId: c.entityId }]
            : c.courseId
              ? [{ kind: "open_course" as const, courseId: c.courseId }]
              : []),
        ],
        href: c.entityId
          ? `/assessment/${encodeURIComponent(c.entityId)}`
          : c.courseId
            ? `/courses/${encodeURIComponent(c.courseId)}`
            : "/inbox",
        sortKey: Date.parse(c.createdAt),
      };
    });
}

function announcementItems(
  anns: Announcement[],
  courses: Map<string, Course>,
  lastCheckedAt: number | null,
  now: Date,
): MyDayItem[] {
  const cutoff = lastCheckedAt ?? now.getTime() - 4 * 864e5;
  return anns
    .filter((a) => a.publishedAt && Date.parse(a.publishedAt) >= cutoff)
    .slice(0, 20)
    .map((a) => {
      const course = courses.get(a.courseId);
      return {
        id: `ann:${a.id}`,
        section: "since_last_checked" as const,
        kind: "announcement" as const,
        courseId: a.courseId,
        courseCode: course?.code ?? "?",
        courseColor: course?.color ?? null,
        title: a.title,
        subtitle: a.deadlineChangeSignal ? "Possible deadline change" : "Announcement",
        startIso: a.publishedAt,
        endIso: null,
        weightPercent: null,
        statusLabel: "Posted",
        actionable: true,
        ctas: [
          ...(a.url ? [{ kind: "open_url" as const, url: a.url, label: "Open" }] : []),
          { kind: "open_course" as const, courseId: a.courseId },
        ],
        href: `/courses/${encodeURIComponent(a.courseId)}`,
        sortKey: a.publishedAt ? Date.parse(a.publishedAt) : 0,
      };
    });
}

function taskItems(tasks: UserTask[], courses: Map<string, Course>, now: Date): MyDayItem[] {
  return tasks
    .filter((t) => !t.done)
    .map((t) => {
      const course = t.courseId ? courses.get(t.courseId) : undefined;
      const dueMs = t.dueIso ? Date.parse(t.dueIso) : NaN;
      let section: MyDaySection = "coming_up";
      if (Number.isFinite(dueMs)) {
        if (dueMs < now.getTime()) section = "needs_answer";
        else if (dueMs <= dayEnd(now) && dueMs >= tonightWindow(now).start) section = "tonight";
        else if (dueMs <= dayEnd(now)) section = "next";
        else if (dueMs <= now.getTime() + 7 * 864e5) section = "coming_up";
      }
      return {
        id: `task:${t.id}`,
        section,
        kind: "task" as const,
        courseId: t.courseId,
        courseCode: course?.code ?? "Personal",
        courseColor: course?.color ?? null,
        title: t.title,
        subtitle: t.dueIso ? formatWhen(t.dueIso) : "No due date",
        startIso: t.dueIso,
        endIso: null,
        weightPercent: null,
        statusLabel: "Task",
        actionable: true,
        ctas: [{ kind: "mark_task_done" as const, taskId: t.id }],
        href: "/tasks",
        sortKey: Number.isFinite(dueMs) ? dueMs : now.getTime() + 14 * 864e5,
      };
    });
}

function calendarItems(
  events: CalendarEventItem[],
  courses: Map<string, Course>,
  now: Date,
): MyDayItem[] {
  return events
    .filter((e) => {
      const s = Date.parse(e.startIso);
      return Number.isFinite(s) && s >= dayStart(now) && s <= now.getTime() + 7 * 864e5;
    })
    .map((e) => {
      const course = e.courseId ? courses.get(e.courseId) : undefined;
      const start = Date.parse(e.startIso);
      const kind: MyDayKind =
        e.category === "BUS" ? "commute" : e.category === "STUDY" ? "study" : "personal";
      let section: MyDaySection = "coming_up";
      if (start <= now.getTime() + 3600_000 && start >= now.getTime() - 30 * 60_000) section = "right_now";
      else if (start <= dayEnd(now) && start >= tonightWindow(now).start) section = "tonight";
      else if (start <= dayEnd(now)) section = "next";
      return {
        id: `cal:${e.id}`,
        section,
        kind,
        courseId: e.courseId,
        courseCode: course?.code ?? e.category,
        courseColor: course?.color ?? null,
        title: e.title,
        subtitle: [e.location, formatWhen(e.startIso)].filter(Boolean).join(" · "),
        startIso: e.startIso,
        endIso: e.endIso,
        weightPercent: null,
        statusLabel: e.category,
        actionable: false,
        ctas: [],
        href: "/calendar",
        sortKey: start,
      };
    });
}

export interface MyDayModel {
  generatedAt: string;
  lastCheckedAt: number | null;
  sections: Array<{ id: MyDaySection; label: string; items: MyDayItem[] }>;
  standingLines: string[];
}

const SECTION_META: Array<{ id: MyDaySection; label: string }> = [
  { id: "right_now", label: "Right now" },
  { id: "next", label: "Next" },
  { id: "tonight", label: "Tonight" },
  { id: "coming_up", label: "Coming up" },
  { id: "since_last_checked", label: "Since you last checked" },
  { id: "needs_answer", label: "Needs your answer" },
  { id: "history", label: "Recently settled" },
];

export function buildMyDay(data: AppData, now = new Date()): MyDayModel {
  const courses = selectedCourses(data);
  const cmap = courseMap(courses);
  const courseIds = new Set(courses.map((c) => c.id));

  const occs = (data.meetingOccurrences ?? []).filter((o) => courseIds.has(o.courseId));
  const assessments = data.assessments.filter((a) => courseIds.has(a.courseId));
  const anns = data.announcements.filter((a) => courseIds.has(a.courseId));
  const changes = (data.changes ?? []).filter((c) => !c.courseId || courseIds.has(c.courseId));
  const lastChecked = data.preferences.lastCheckedAt ?? data.sync.lastSyncedAt;

  const scoped: AppData = { ...data, assessments };

  const all = [
    ...occurrenceItems(occs, cmap, now),
    ...assessmentItems(scoped, cmap, now),
    ...changeItems(changes, cmap, lastChecked, now),
    ...announcementItems(anns, cmap, lastChecked, now),
    ...taskItems(data.userTasks ?? [], cmap, now),
    ...calendarItems(data.calendarEvents ?? [], cmap, now),
  ];

  // Dedupe by id
  const seen = new Set<string>();
  const deduped = all.filter((i) => {
    if (seen.has(i.id)) return false;
    seen.add(i.id);
    return true;
  });

  const sections = SECTION_META.map((s) => ({
    id: s.id,
    label: s.label,
    items: deduped
      .filter((i) => i.section === s.id)
      .sort((a, b) => a.sortKey - b.sortKey)
      .slice(0, s.id === "coming_up" ? 16 : s.id === "since_last_checked" ? 20 : 12),
  })).filter((s) => s.items.length > 0 || s.id === "right_now" || s.id === "needs_answer");

  const standingLines: string[] = [];
  for (const c of courses.slice(0, 6)) {
    const summary = summarizeCourseGrades(
      c,
      data.assessments,
      data.gradeCategories,
      data.academicRules,
      data.whatIfOverrides,
    );
    if (summary.calculatedPercent != null) {
      standingLines.push(
        `${c.code}: ${summary.calculatedPercent.toFixed(1)}% on ${summary.completedWeight.toFixed(0)}% graded`,
      );
    } else {
      standingLines.push(`${c.code}: standing unknown (${summary.gradedCount} graded)`);
    }
  }

  return {
    generatedAt: now.toISOString(),
    lastCheckedAt: lastChecked,
    sections,
    standingLines,
  };
}

export function applyMyDayConfirm(
  data: AppData,
  assessmentId: string,
  kind: "complete" | "missed" | "excused",
): AppData {
  // Occurrence confirmations are stored as lightweight user tasks / action log only
  if (assessmentId.startsWith("occ:")) {
    return {
      ...data,
      actionLog: [
        {
          id: `act:occ:${assessmentId}:${Date.now()}`,
          at: new Date().toISOString(),
          action: kind === "complete" ? "occ_completed" : kind === "missed" ? "occ_missed" : "occ_excused",
          entityId: assessmentId,
          before: null,
          after: kind,
          undone: false,
        },
        ...(data.actionLog ?? []),
      ].slice(0, 200),
    };
  }

  return {
    ...data,
    assessments: data.assessments.map((a) => {
      if (a.id !== assessmentId) return a;
      const state = { ...a.state, needsConfirmation: false, pastDueConfirmed: true };
      if (kind === "complete") {
        state.userCompleted = "confirmed";
        state.work = "completed";
        state.missed = false;
      } else if (kind === "missed") {
        state.missed = true;
        state.userCompleted = "denied";
        state.work = "not_started";
      } else {
        state.missed = false;
        state.userCompleted = "confirmed";
        state.work = "completed";
        state.dropped = true;
      }
      return { ...a, state };
    }),
  };
}
