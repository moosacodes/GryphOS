/**
 * Turn CourseLink calendar events into meetings + occurrences for My Day.
 * Schedule-like events become the class timeline; deadline-like stay assessments.
 */
import type { RawCalendarEvent } from "@/adapters/courselink/raw";
import type { CalendarEventItem, Course, Meeting } from "@/domain/types";
import type { MeetingKind, MeetingOccurrence, RecurringMeetingPattern } from "@/domain/meetings";
import { courseKeyFromCode, generateOccurrences, occurrenceId } from "@/domain/meetings";
import { torontoDayKey } from "@/domain/dates";
import { UOFG_TIMEZONE } from "@/domain/constants";
import { formatInTimeZone } from "date-fns-tz";
import {
  isDeadlineCalendarEvent,
  isScheduleCalendarEvent,
} from "@/normalize/calendarClassify";

export { isDeadlineCalendarEvent, isScheduleCalendarEvent };

function inferKind(title: string): MeetingKind {
  const t = title.toLowerCase();
  if (/\boffice\s*hours\b/.test(t)) return "office_hours";
  if (/\blab\b/.test(t)) return "lab";
  if (/\btutorial|tut\b/.test(t)) return "tutorial";
  if (/\bseminar\b/.test(t)) return "seminar";
  if (/\blecture|lec\b|class\b/.test(t)) return "lecture";
  return "lecture";
}

function hmToronto(iso: string): string {
  return formatInTimeZone(new Date(iso), UOFG_TIMEZONE, "HH:mm");
}

function dowToronto(iso: string): number {
  const key = torontoDayKey(iso);
  const [y, m, d] = key.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

function locationFromDesc(desc: string | null | undefined): string | null {
  if (!desc) return null;
  const plain = desc.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  if (!plain) return null;
  const loc = plain.match(
    /\b((?:RICH|SSC|MACN|MACK|ROZH|THRN|ANNU|CRSC|SCI|WMEM|UC|LA)\s*\d{2,4}[A-Z]?)\b/i,
  );
  if (loc) return loc[1].toUpperCase().replace(/\s+/g, " ");
  if (plain.length <= 48) return plain;
  return plain.slice(0, 48).trim();
}

export interface CalendarScheduleBundle {
  meetings: Meeting[];
  patterns: RecurringMeetingPattern[];
  occurrences: MeetingOccurrence[];
  calendarItems: CalendarEventItem[];
}

/**
 * Build recurring patterns when the same weekday+time repeats (>=2),
 * plus concrete occurrences for every schedule event in-range.
 */
export function scheduleFromCalendarEvents(
  course: Course,
  events: RawCalendarEvent[],
  rangeStart: string,
  rangeEnd: string,
): CalendarScheduleBundle {
  const scheduleEvents = events.filter(
    (e) => e.Title?.trim() && e.StartDateTime && isScheduleCalendarEvent(e.Title),
  );

  const calendarItems: CalendarEventItem[] = [];
  const discrete: MeetingOccurrence[] = [];
  const clusterKey = (kind: MeetingKind, dow: number, start: string, end: string) =>
    `${kind}|${dow}|${start}|${end}`;
  const clusters = new Map<
    string,
    { kind: MeetingKind; dow: number; start: string; end: string; location: string | null; count: number }
  >();

  const key = courseKeyFromCode(course.code);

  for (const e of scheduleEvents) {
    const startIso = e.StartDateTime!;
    const endIso = e.EndDateTime ?? e.StartDateTime!;
    const startMs = Date.parse(startIso);
    const endMs = Date.parse(endIso);
    if (!Number.isFinite(startMs)) continue;
    if (e.IsAllDayEvent) continue;
    if (Number.isFinite(endMs) && endMs - startMs > 5 * 3600_000) continue;

    const date = torontoDayKey(startIso);
    if (date < rangeStart || date > rangeEnd) continue;

    const kind = inferKind(e.Title);
    const startTime = hmToronto(startIso);
    const endTime = hmToronto(endIso);
    const dow = dowToronto(startIso);
    const location = locationFromDesc(e.Description);
    const idNum = e.CalendarEventId ?? e.Id ?? `${date}-${startTime}`;

    calendarItems.push({
      id: `clcal:${course.id}:${idNum}`,
      uid: `courselink:${course.orgUnitId}:${idNum}`,
      title: e.Title.trim(),
      category: "UNI",
      startIso,
      endIso,
      allDay: false,
      location,
      description: e.Description ?? null,
      exdates: [],
      courseId: course.id,
      sourceType: "courselink_calendar",
    });

    discrete.push({
      id: `${occurrenceId(key, kind, null, date)}:cal:${idNum}`,
      patternId: `pattern:cal:${course.id}:${kind}:${dow}:${startTime}`,
      courseId: course.id,
      kind,
      sectionCode: null,
      date,
      startIso,
      endIso,
      location,
      cancelled: false,
      rescheduledToId: null,
      indexInPattern: 0,
    });

    const ck = clusterKey(kind, dow, startTime, endTime);
    const prev = clusters.get(ck);
    if (prev) {
      prev.count += 1;
      if (!prev.location && location) prev.location = location;
    } else {
      clusters.set(ck, { kind, dow, start: startTime, end: endTime, location, count: 1 });
    }
  }

  const meetings: Meeting[] = [];
  const patterns: RecurringMeetingPattern[] = [];

  for (const c of clusters.values()) {
    if (c.count < 1) continue;
    const mid = `meet:cal:${course.id}:${c.kind}:${c.dow}:${c.start.replace(":", "")}`;
    meetings.push({
      id: mid,
      courseId: course.id,
      kind: c.kind,
      dayOfWeek: c.dow,
      startTime: c.start,
      endTime: c.end,
      location: c.location,
      notes: "From CourseLink calendar",
      sectionCode: null,
    });
    patterns.push({
      id: `pattern:${mid}`,
      courseId: course.id,
      kind: c.kind,
      sectionCode: null,
      dayOfWeek: c.dow,
      startTime: c.start,
      endTime: c.end,
      location: c.location,
      notes: "From CourseLink calendar",
      rangeStart,
      rangeEnd,
      exdates: [],
      sourceType: "courselink_calendar",
    });
  }

  const fromPatterns: MeetingOccurrence[] = [];
  for (const pat of patterns) {
    fromPatterns.push(...generateOccurrences(pat, [], key));
  }

  const covered = new Set(
    fromPatterns.map(
      (o) =>
        `${o.kind}|${o.date}|${formatInTimeZone(new Date(o.startIso), UOFG_TIMEZONE, "HH:mm")}`,
    ),
  );
  const extras = discrete.filter((o) => {
    const slot = `${o.kind}|${o.date}|${formatInTimeZone(new Date(o.startIso), UOFG_TIMEZONE, "HH:mm")}`;
    return !covered.has(slot);
  });

  return {
    meetings,
    patterns,
    occurrences: [...fromPatterns, ...extras],
    calendarItems,
  };
}
