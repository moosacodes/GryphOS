/** RecurringMeetingPattern vs concrete MeetingOccurrence. */
import { UOFG_TIMEZONE } from "./constants";
import { formatInTimeZone, fromZonedTime } from "date-fns-tz";

export type MeetingKind = "lecture" | "lab" | "tutorial" | "seminar" | "office_hours" | "other";

export interface RecurringMeetingPattern {
  id: string;
  courseId: string;
  kind: MeetingKind;
  sectionCode: string | null;
  /** 0=Sun .. 6=Sat */
  dayOfWeek: number;
  startTime: string; // HH:mm Toronto
  endTime: string;
  location: string | null;
  notes: string | null;
  /** ISO date YYYY-MM-DD inclusive, Toronto */
  rangeStart: string;
  rangeEnd: string;
  /** YYYY-MM-DD dates to skip (holidays, EXDATE, cancelled) */
  exdates: string[];
  sourceType: string;
}

export interface MeetingOccurrence {
  id: string;
  patternId: string;
  courseId: string;
  kind: MeetingKind;
  sectionCode: string | null;
  /** YYYY-MM-DD in America/Toronto */
  date: string;
  startIso: string;
  endIso: string;
  location: string | null;
  cancelled: boolean;
  rescheduledToId: string | null;
  indexInPattern: number;
}

export interface HolidayWindow {
  start: string; // YYYY-MM-DD
  end: string;
  label: string;
}

function torontoWallToUtcIso(dateYmd: string, hm: string): string {
  const [hh, mm] = hm.split(":").map(Number);
  const local = `${dateYmd}T${String(hh).padStart(2, "0")}:${String(mm || 0).padStart(2, "0")}:00`;
  return fromZonedTime(local, UOFG_TIMEZONE).toISOString();
}

function ymdAddDays(ymd: string, days: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  const yy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(dt.getUTCDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}

function dayOfWeekYmd(ymd: string): number {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

function inHoliday(ymd: string, holidays: HolidayWindow[]): boolean {
  return holidays.some((h) => ymd >= h.start && ymd <= h.end);
}

/** Stable ID: meeting-pattern:{courseKey}:{kind}:{section}:{date} */
export function occurrenceId(
  courseKey: string,
  kind: string,
  section: string | null,
  date: string,
): string {
  const sec = section ?? "na";
  return `meeting-pattern:${courseKey}:${kind}:${sec}:${date}`;
}

export function courseKeyFromCode(code: string): string {
  const m = code.replace(/\s/g, "").match(/([A-Za-z]+)\*?(\d{4})/);
  if (!m) return code.replace(/[^A-Za-z0-9]/g, "").toLowerCase().slice(0, 12);
  return `c${m[2]}`;
}

/**
 * Expand a recurring pattern into concrete occurrences within semester,
 * skipping holidays/EXDATE. Never derives from "now".
 */
export function generateOccurrences(
  pattern: RecurringMeetingPattern,
  holidays: HolidayWindow[] = [],
  courseKey?: string,
): MeetingOccurrence[] {
  const key = courseKey ?? pattern.courseId.replace(/[^a-z0-9]/gi, "").toLowerCase().slice(0, 12);
  const out: MeetingOccurrence[] = [];
  let ymd = pattern.rangeStart;
  let index = 0;
  while (ymd <= pattern.rangeEnd) {
    if (
      dayOfWeekYmd(ymd) === pattern.dayOfWeek &&
      !pattern.exdates.includes(ymd) &&
      !inHoliday(ymd, holidays)
    ) {
      index += 1;
      out.push({
        id: occurrenceId(key, pattern.kind, pattern.sectionCode, ymd),
        patternId: pattern.id,
        courseId: pattern.courseId,
        kind: pattern.kind,
        sectionCode: pattern.sectionCode,
        date: ymd,
        startIso: torontoWallToUtcIso(ymd, pattern.startTime),
        endIso: torontoWallToUtcIso(ymd, pattern.endTime),
        location: pattern.location,
        cancelled: false,
        rescheduledToId: null,
        indexInPattern: index,
      });
    }
    ymd = ymdAddDays(ymd, 1);
  }
  return out;
}

export function addTorontoDays(ymd: string, days: number): string {
  return ymdAddDays(ymd, days);
}

export function torontoDateTimeIso(ymd: string, hm: string): string {
  return torontoWallToUtcIso(ymd, hm);
}

export function formatOccurrenceLabel(o: MeetingOccurrence): string {
  const start = formatInTimeZone(new Date(o.startIso), UOFG_TIMEZONE, "EEE MMM d HH:mm");
  const end = formatInTimeZone(new Date(o.endIso), UOFG_TIMEZONE, "HH:mm");
  return `${o.kind} ${start}-${end}${o.location ? " @ " + o.location : ""}`;
}

/** Convert legacy Meeting rows into patterns for a known term window. */
export function patternsFromLegacyMeetings(
  meetings: Array<{
    id: string;
    courseId: string;
    kind: MeetingKind;
    dayOfWeek: number | null;
    startTime: string | null;
    endTime: string | null;
    location: string | null;
    notes: string | null;
    sectionCode: string | null;
  }>,
  rangeStart: string,
  rangeEnd: string,
  sourceType = "manual",
): RecurringMeetingPattern[] {
  return meetings
    .filter((m) => m.dayOfWeek != null && m.startTime && m.endTime)
    .map((m) => ({
      id: `pattern:${m.id}`,
      courseId: m.courseId,
      kind: m.kind,
      sectionCode: m.sectionCode,
      dayOfWeek: m.dayOfWeek!,
      startTime: m.startTime!,
      endTime: m.endTime!,
      location: m.location,
      notes: m.notes,
      rangeStart,
      rangeEnd,
      exdates: [],
      sourceType,
    }));
}
