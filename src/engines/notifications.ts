/**
 * Local notification candidates — useful, controllable, not spam for slides.
 */
import type { AppData, Assessment, ChangeEvent } from "@/domain/types";
import { formatInToronto } from "@/domain/dates";

export type NotifKind =
  | "due_tomorrow"
  | "quiz_closing"
  | "midterm_room"
  | "deadline_change"
  | "grade_posted";

export interface NotificationCandidate {
  id: string;
  kind: NotifKind;
  title: string;
  body: string;
  href: string | null;
  at: string;
}

export interface NotificationPrefs {
  enabled: boolean;
  dueTomorrow: boolean;
  quizClosing: boolean;
  midtermRoom: boolean;
  deadlineChange: boolean;
  gradePosted: boolean;
}

export const DEFAULT_NOTIFICATION_PREFS: NotificationPrefs = {
  enabled: true,
  dueTomorrow: true,
  quizClosing: true,
  midtermRoom: true,
  deadlineChange: true,
  gradePosted: true,
};

function selectedIds(data: AppData): Set<string> {
  const ids = data.preferences.selectedCourseIds;
  if (ids?.length) return new Set(ids);
  return new Set(data.courses.filter((c) => c.selected).map((c) => c.id));
}

function isOpen(a: Assessment): boolean {
  if (a.submissionState === "submitted") return false;
  if (a.state?.work === "completed" || a.state?.userCompleted === "confirmed") return false;
  if (a.state?.missed || a.state?.dropped) return false;
  if (a.pointsEarned != null || a.gradeDisplay) return false;
  return true;
}

export function collectNotificationCandidates(
  data: AppData,
  prefs: NotificationPrefs = data.preferences.notifications ?? DEFAULT_NOTIFICATION_PREFS,
  now = new Date(),
): NotificationCandidate[] {
  if (!prefs.enabled) return [];
  const sel = selectedIds(data);
  const courses = new Map(data.courses.map((c) => [c.id, c]));
  const out: NotificationCandidate[] = [];
  const start = now.getTime();
  const day = 864e5;

  for (const a of data.assessments) {
    if (!sel.has(a.courseId) || !isOpen(a) || !a.due.iso) continue;
    const due = Date.parse(a.due.iso);
    if (!Number.isFinite(due)) continue;
    const course = courses.get(a.courseId);
    const hours = (due - start) / 36e5;

    if (prefs.dueTomorrow && hours > 12 && hours <= 36 && a.submissionState !== "submitted") {
      out.push({
        id: `n:due:${a.id}:${torontoDay(due)}`,
        kind: "due_tomorrow",
        title: `Due tomorrow · ${course?.code ?? ""}`,
        body: `${a.title}${a.weightPercent != null ? ` (${a.weightPercent}%)` : ""} · ${formatInToronto(a.due.iso, "h:mm a")}`,
        href: `/assessment/${encodeURIComponent(a.id)}`,
        at: new Date(due - day).toISOString(),
      });
    }

    if (prefs.quizClosing && a.type === "quiz" && hours > 0 && hours <= 6) {
      out.push({
        id: `n:quiz:${a.id}`,
        kind: "quiz_closing",
        title: `Quiz closing soon · ${course?.code ?? ""}`,
        body: `${a.title} closes ${formatInToronto(a.due.iso, "h:mm a")}`,
        href: a.url ?? `/assessment/${encodeURIComponent(a.id)}`,
        at: now.toISOString(),
      });
    }

    if (prefs.midtermRoom && (a.type === "midterm" || a.type === "final") && hours > 0 && hours <= 48) {
      const room = a.notes?.match(/\b([A-Z]{2,}\s?\d{2,4})\b/)?.[1] ?? null;
      out.push({
        id: `n:exam:${a.id}`,
        kind: "midterm_room",
        title: `${a.type === "final" ? "Final" : "Midterm"} · ${course?.code ?? ""}`,
        body: room ? `${a.title} · Room ${room}` : `${a.title} · ${formatInToronto(a.due.iso)}`,
        href: `/assessment/${encodeURIComponent(a.id)}`,
        at: now.toISOString(),
      });
    }
  }

  if (prefs.deadlineChange || prefs.gradePosted) {
    for (const ch of data.changes ?? []) {
      if (ch.read) continue;
      if (ch.courseId && !sel.has(ch.courseId)) continue;
      if (prefs.deadlineChange && ch.kind === "deadline_changed") {
        out.push({
          id: `n:chg:${ch.id}`,
          kind: "deadline_change",
          title: ch.title,
          body: ch.detail,
          href: ch.entityId ? `/assessment/${encodeURIComponent(ch.entityId)}` : "/inbox",
          at: ch.createdAt,
        });
      }
      if (prefs.gradePosted && ch.kind === "grade_posted") {
        out.push({
          id: `n:gr:${ch.id}`,
          kind: "grade_posted",
          title: ch.title,
          body: ch.detail,
          href: ch.entityId ? `/assessment/${encodeURIComponent(ch.entityId)}` : "/grades",
          at: ch.createdAt,
        });
      }
    }
  }

  return out;
}

function torontoDay(ms: number): string {
  return formatInToronto(new Date(ms).toISOString(), "yyyy-MM-dd");
}

export function changeDiff(ch: ChangeEvent): { before: string; after: string } | null {
  if (ch.beforeValue != null || ch.afterValue != null) {
    return {
      before: formatDiffVal(ch.beforeValue),
      after: formatDiffVal(ch.afterValue),
    };
  }
  const m = ch.detail.match(/^(.*?)\s*→\s*(.*)$/);
  if (m) return { before: m[1].trim(), after: m[2].trim() };
  return null;
}

function formatDiffVal(v: unknown): string {
  if (v == null) return "?";
  if (typeof v === "string") return v;
  if (typeof v === "number") return String(v);
  if (typeof v === "object" && v && "iso" in (v as object)) {
    const o = v as { iso?: string | null; label?: string | null };
    return o.iso ?? o.label ?? "?";
  }
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}
