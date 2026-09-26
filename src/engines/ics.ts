import type { AcademicDate, Assessment, Course } from "@/domain/types";

function fold(line: string): string {
  const parts: string[] = [];
  let rest = line;
  while (rest.length > 75) {
    parts.push(rest.slice(0, 75));
    rest = " " + rest.slice(75);
  }
  parts.push(rest);
  return parts.join("\r\n");
}

function esc(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\n/g, "\\n");
}

function utcStamp(iso: string): string {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, "0");
  return (
    d.getUTCFullYear() +
    p(d.getUTCMonth() + 1) +
    p(d.getUTCDate()) +
    "T" +
    p(d.getUTCHours()) +
    p(d.getUTCMinutes()) +
    p(d.getUTCSeconds()) +
    "Z"
  );
}

export function buildIcs(
  assessments: Assessment[],
  courses: Course[],
  academicDates: AcademicDate[] = [],
): string {
  const courseMap = new Map(courses.map((c) => [c.id, c]));
  const lines: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//gryphOS//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
  ];

  for (const a of assessments) {
    if (!a.due.iso || a.due.certainty === "unknown") continue;
    const course = courseMap.get(a.courseId);
    const uid = `${a.id}@gryphos`;
    const summary = course ? `[${course.code}] ${a.title}` : a.title;
    const descParts = [
      a.weightPercent != null ? `Weight: ${a.weightPercent}%` : null,
      a.submissionState !== "unknown" ? `Submission: ${a.submissionState}` : null,
      a.url ? `URL: ${a.url}` : null,
    ].filter(Boolean);
    lines.push("BEGIN:VEVENT");
    lines.push(fold(`UID:${uid}`));
    lines.push(fold(`DTSTAMP:${utcStamp(new Date().toISOString())}`));
    if (a.due.allDay) {
      lines.push(fold(`DTSTART;VALUE=DATE:${a.due.iso.slice(0, 10).replace(/-/g, "")}`));
    } else {
      lines.push(fold(`DTSTART:${utcStamp(a.due.iso)}`));
    }
    lines.push(fold(`SUMMARY:${esc(summary)}`));
    if (descParts.length) lines.push(fold(`DESCRIPTION:${esc(descParts.join("\n"))}`));
    if (a.url) lines.push(fold(`URL:${a.url}`));
    lines.push("END:VEVENT");
  }

  for (const d of academicDates) {
    if (!d.start.iso) continue;
    lines.push("BEGIN:VEVENT");
    lines.push(fold(`UID:${d.id}@gryphos`));
    lines.push(fold(`DTSTAMP:${utcStamp(new Date().toISOString())}`));
    lines.push(fold(`DTSTART;VALUE=DATE:${d.start.iso.slice(0, 10).replace(/-/g, "")}`));
    if (d.end.iso) {
      lines.push(fold(`DTEND;VALUE=DATE:${d.end.iso.slice(0, 10).replace(/-/g, "")}`));
    }
    lines.push(fold(`SUMMARY:${esc(d.title)}`));
    lines.push("END:VEVENT");
  }

  lines.push("END:VCALENDAR");
  return lines.join("\r\n");
}
