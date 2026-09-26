/** Shared calendar title classifiers — used by sync schedule + assessment normalize. */

const DEADLINE_RE =
  /\b(due|deadline|assignment|dropbox|submission|quiz|mid[- ]?term|final\s*exam|exam\b|test\b|homework|hw\b|a\d{1,2}\b)\b/i;
const SCHEDULE_RE =
  /\b(lecture|lab|tutorial|seminar|class|lec\b|office\s*hours|discussion)\b/i;

export function isScheduleCalendarEvent(title: string): boolean {
  const t = title.trim();
  if (!t) return false;
  if (SCHEDULE_RE.test(t) && !DEADLINE_RE.test(t)) return true;
  if (DEADLINE_RE.test(t) && !SCHEDULE_RE.test(t)) return false;
  if (SCHEDULE_RE.test(t)) return true;
  if (/\b(cis|engr|math|stat|phys|chem|biol|psyc|soc|hist|econ)\s*\*?\s*\d{3,4}\b/i.test(t)) {
    return !DEADLINE_RE.test(t);
  }
  return false;
}

export function isDeadlineCalendarEvent(title: string): boolean {
  const t = title.trim();
  if (!t) return false;
  if (isScheduleCalendarEvent(t)) return false;
  return DEADLINE_RE.test(t);
}
