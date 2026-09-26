/**
 * Deterministic course outline parser â€” regex/heuristics only, no LLM.
 */
import type { AssessmentType, DateCertainty, OutlineParseResult } from "@/domain/types";

const MONTHS: Record<string, number> = {
  jan: 0, january: 0, feb: 1, february: 1, mar: 2, march: 2,
  apr: 3, april: 3, may: 4, jun: 5, june: 5, jul: 6, july: 6,
  aug: 7, august: 7, sep: 8, sept: 8, september: 8,
  oct: 9, october: 9, nov: 10, november: 10, dec: 11, december: 11,
};

function inferType(title: string): AssessmentType {
  const t = title.toLowerCase();
  if (/\bfinal\b/.test(t)) return "final";
  if (/\bmid[- ]?term\b/.test(t)) return "midterm";
  if (/\blab\b/.test(t)) return "lab";
  if (/\bproject\b/.test(t)) return "project";
  if (/\bpresentation\b/.test(t)) return "presentation";
  if (/\bparticipation\b|\battendance\b/.test(t)) return "participation";
  if (/\bdiscussion\b/.test(t)) return "discussion";
  if (/\bquiz\b|\btest\b/.test(t)) return "quiz";
  if (/\bassign|\bhomework\b|\bhw\b/.test(t)) return "assignment";
  return "other";
}

function parseDateLabel(label: string, defaultYear?: number): { iso: string | null; certainty: DateCertainty } {
  const week = label.match(/week\s*(\d+)/i);
  if (week) return { iso: null, certainty: "approximate" };

  const mdy = label.match(
    /\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\.?\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s*(\d{4}))?/i,
  );
  if (mdy) {
    const month = MONTHS[mdy[1].toLowerCase().replace(/\.$/, "")];
    const day = Number(mdy[2]);
    const year = mdy[3] ? Number(mdy[3]) : defaultYear ?? new Date().getFullYear();
    if (month != null && day >= 1 && day <= 31) {
      const iso = new Date(Date.UTC(year, month, day, 23, 59, 0)).toISOString();
      return { iso, certainty: "exact" };
    }
  }

  const isoMatch = label.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  if (isoMatch) {
    return { iso: new Date(`${isoMatch[0]}T23:59:00`).toISOString(), certainty: "exact" };
  }

  return { iso: null, certainty: /tbd|tba|see|exam period/i.test(label) ? "approximate" : "unknown" };
}

function extractEmails(block: string): string | null {
  const m = block.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  return m ? m[0] : null;
}

function section(text: string, ...headers: string[]): string {
  const lower = text.toLowerCase();
  for (const h of headers) {
    const idx = lower.indexOf(h.toLowerCase());
    if (idx < 0) continue;
    const after = text.slice(idx + h.length);
    const next = after.search(/\n\s*[A-Z][A-Za-z ]{2,40}\n/);
    return (next >= 0 ? after.slice(0, next) : after).trim();
  }
  return "";
}

export function parseOutlineText(text: string): OutlineParseResult {
  const cleaned = text.replace(/\r\n/g, "\n").split(String.fromCharCode(0)).join("");
  const lines = cleaned.split("\n").map((l) => l.trim()).filter(Boolean);

  const codeMatch = cleaned.match(/\b([A-Z]{2,5})\s*[*\- ]\s*(\d{4})\b/);
  const courseCode = codeMatch ? `${codeMatch[1]}*${codeMatch[2]}` : null;

  let courseTitle: string | null = null;
  for (const line of lines.slice(0, 30)) {
    if (courseCode && line.includes(courseCode.replace("*", ""))) {
      courseTitle = line.replace(codeMatch?.[0] ?? "", "").replace(/^[:\u2013\u2014\s-]+/, "").trim() || null;
      break;
    }
    if (/^[A-Z][A-Za-z0-9 ,:-]{8,80}$/.test(line) && !/university|department|syllabus|outline/i.test(line)) {
      courseTitle = line;
      break;
    }
  }

  const termMatch = cleaned.match(/\b((?:Fall|Winter|Summer)\s*\d{4}|\d{4}\s*(?:Fall|Winter|Summer))\b/i);
  const term = termMatch ? termMatch[1] : null;
  const yearMatch = term?.match(/(\d{4})/);
  const year = yearMatch ? Number(yearMatch[1]) : undefined;

  const instructorBlock = section(cleaned, "Instructor", "Course Instructor", "Professor");
  const instructors: OutlineParseResult["instructors"] = [];
  for (const line of instructorBlock.split("\n").slice(0, 8)) {
    const name = line.replace(/instructor|professor|dr\.?|email.*/i, "").replace(/[:-]/g, "").trim();
    if (name.length >= 3 && name.length < 80 && !/@/.test(name)) {
      instructors.push({ name, email: extractEmails(line) ?? extractEmails(instructorBlock) });
      break;
    }
  }
  if (instructors.length === 0) {
    const m = cleaned.match(/(?:Instructor|Professor)\s*[:-]\s*([^\n]+)/i);
    if (m) instructors.push({ name: m[1].trim(), email: extractEmails(m[1]) });
  }

  const taBlock = section(cleaned, "Teaching Assistant", "Teaching Assistants", "TA", "TAs");
  const tas: OutlineParseResult["tas"] = [];
  for (const line of taBlock.split("\n").slice(0, 10)) {
    if (/^[A-Z]/.test(line) && line.length < 80) {
      tas.push({ name: line.split(/[-â€“â€”:]/)[0].trim(), email: extractEmails(line) });
    }
  }

  const officeHours = (section(cleaned, "Office Hours", "Office Hour") || "")
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 3)
    .slice(0, 6);

  const scheduleLines = (section(cleaned, "Lecture", "Schedule", "Class Schedule", "Meeting Times") || "")
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => /(mon|tue|wed|thu|fri|sat|sun|lecture|lab|tutorial)/i.test(l))
    .slice(0, 12);

  const assessments: OutlineParseResult["assessments"] = [];
  const assessmentSection = section(
    cleaned,
    "Evaluation",
    "Assessment",
    "Assessments",
    "Grading",
    "Grade Breakdown",
    "Marking Scheme",
    "Course Evaluation",
  ) || cleaned;

  // Simpler line-based extraction
  const weightPatterns = [
    /^(.{3,70}?)\s{2,}(\d{1,3}(?:\.\d+)?)\s*%/,
    /^(.{3,70}?)\s*[â€”\-:|]\s*(\d{1,3}(?:\.\d+)?)\s*%/,
    /^(.{3,70}?)\s+(\d{1,3}(?:\.\d+)?)\s*%$/,
  ];

  for (const line of assessmentSection.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || /total|weight|component|evaluation/i.test(trimmed) && /%/.test(trimmed) === false) {
      // still try
    }
    let matched: RegExpMatchArray | null = null;
    for (const re of weightPatterns) {
      matched = trimmed.match(re);
      if (matched) break;
    }
    if (!matched) continue;
    const title = matched[1].replace(/^[â€¢\-*\d.)\s]+/, "").trim();
    const weight = Number(matched[2]);
    if (!title || weight > 100) continue;
    if (/^total$/i.test(title)) continue;

    const dateHint =
      trimmed.match(/due[^\dA-Za-z]{0,10}(.{0,40})/i)?.[1] ??
      trimmed.match(/\b(week\s*\d+|jan\w*\s+\d{1,2}|feb\w*\s+\d{1,2}|mar\w*\s+\d{1,2}|apr\w*\s+\d{1,2}|may\s+\d{1,2}|jun\w*\s+\d{1,2}|jul\w*\s+\d{1,2}|aug\w*\s+\d{1,2}|sep\w*\s+\d{1,2}|oct\w*\s+\d{1,2}|nov\w*\s+\d{1,2}|dec\w*\s+\d{1,2})/i)?.[0] ??
      null;
    const parsed = dateHint ? parseDateLabel(dateHint, year) : { iso: null, certainty: "unknown" as DateCertainty };

    assessments.push({
      title,
      type: inferType(title),
      weightPercent: weight,
      dueLabel: dateHint,
      dueIso: parsed.iso,
      certainty: parsed.certainty,
      confidence: dateHint ? 0.7 : 0.85,
    });
  }

  // Midterm/final lines without weights
  for (const line of lines) {
    if (!/mid[- ]?term|final exam|final examination/i.test(line)) continue;
    const title = line.replace(/\s+/g, " ").trim().slice(0, 80);
    if (assessments.some((a) => a.title.toLowerCase() === title.toLowerCase())) continue;
    const parsed = parseDateLabel(line, year);
    assessments.push({
      title: /final/i.test(line) ? "Final Exam" : "Midterm",
      type: /final/i.test(line) ? "final" : "midterm",
      weightPercent: null,
      dueLabel: line,
      dueIso: parsed.iso,
      certainty: parsed.certainty,
      confidence: 0.6,
    });
  }

  const policies: OutlineParseResult["policies"] = [];
  const late = section(cleaned, "Late Policy", "Late Submission", "Late Assignments");
  if (late) policies.push({ kind: "late", title: "Late Policy", body: late.slice(0, 2000) });
  const att = section(cleaned, "Attendance", "Participation");
  if (att) policies.push({ kind: "attendance", title: "Attendance / Participation", body: att.slice(0, 2000) });

  const textbooks = (section(cleaned, "Textbook", "Textbooks", "Required Texts", "Resources") || "")
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 5)
    .slice(0, 10);

  const weightTotal = assessments.reduce((s, a) => s + (a.weightPercent ?? 0), 0);
  let confidence = 0.4;
  if (courseCode) confidence += 0.15;
  if (assessments.length >= 2) confidence += 0.2;
  if (Math.abs(weightTotal - 100) <= 5) confidence += 0.15;
  if (instructors.length) confidence += 0.1;

  return {
    courseCode,
    courseTitle,
    term,
    instructors,
    tas,
    officeHours,
    scheduleLines,
    assessments,
    policies,
    textbooks,
    confidence: Math.min(1, confidence),
  };
}

