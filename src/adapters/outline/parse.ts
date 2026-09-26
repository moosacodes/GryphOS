/**
 * Multi-pass deterministic course outline parser (no LLM).
 * Accepts plain text and optional ExtractedLine[] from positional PDF extraction.
 */
import type {
  AssessmentType,
  DateCertainty,
  OutlineAssessmentParsed,
  OutlineGradingRule,
  OutlineParseDiagnostic,
  OutlineParseResult,
} from "@/domain/types";
import type { ExtractedLine } from "./pdf";

const MONTHS: Record<string, number> = {
  jan: 0, january: 0, feb: 1, february: 1, mar: 2, march: 2,
  apr: 3, april: 3, may: 4, jun: 5, june: 5, jul: 6, july: 6,
  aug: 7, august: 7, sep: 8, sept: 8, september: 8,
  oct: 9, october: 9, nov: 10, november: 10, dec: 11, december: 11,
};

const ASSESS_WORD =
  /\b(assignment|assign\.?|homework|hw|quiz|quizzes|lab|labs|project|mid[- ]?term|final|exam|test|tests|participation|attendance|presentation|discussion|essay|report|portfolio|workshop|practicum|tutorial)\b/i;

export function inferAssessmentType(title: string): AssessmentType {
  const t = title.toLowerCase();
  if (/\bfinal\b/.test(t)) return "final";
  if (/\bmid[- ]?term\b/.test(t)) return "midterm";
  if (/\blab\b/.test(t)) return "lab";
  if (/\bproject\b/.test(t)) return "project";
  if (/\bpresentation\b/.test(t)) return "presentation";
  if (/\bparticipation\b|\battendance\b/.test(t)) return "participation";
  if (/\bdiscussion\b/.test(t)) return "discussion";
  if (/\bquiz\b|\btest\b/.test(t)) return "quiz";
  if (/\bassign|\bhomework\b|\bhw\b|\bessay\b|\breport\b/.test(t)) return "assignment";
  return "other";
}

export function normalizeOutlineText(raw: string): string {
  return raw
    .normalize("NFKC")
    .replace(/\r\n/g, "\n")
    .replace(/\u00a0/g, " ")
    .replace(/\u2018|\u2019/g, "'")
    .replace(/\u201c|\u201d/g, '"')
    .replace(/\u2013|\u2014|\u2212/g, "-")
    .replace(/\u2022|\u2023|\u25e6|\u2043/g, "-")
    .replace(/\ufb01/g, "fi")
    .replace(/\ufb02/g, "fl")
    .replace(/\u200b|\u200c|\u200d|\ufeff/g, "")
    // Common OCR confusables in scanned academic PDFs
    .replace(/[¡]/g, "i")
    .replace(/ClS\*/g, "CIS*")
    .replace(/\bFaII\b/g, "Fall")
    .replace(/\blnstructor\b/gi, "Instructor")
    .replace(/\bEvaIuation\b/gi, "Evaluation")
    .replace(/\bEmaiI\b/gi, "Email")
    .replace(/\bWe¡ght\b/gi, "Weight")
    .replace(/\bM¡dterm\b/gi, "Midterm")
    .replace(/\bF¡nal\b/gi, "Final")
    .split("\0")
    .join("");
}

export function parseDateLabel(
  label: string,
  defaultYear?: number,
): { iso: string | null; certainty: DateCertainty; label: string } {
  const cleaned = label.trim();
  const week = cleaned.match(/\bweek\s*(\d+)\b/i);
  if (week) {
    return {
      iso: null,
      certainty: "approximate",
      label: `Week ${week[1]}`,
    };
  }

  if (/\b(exam\s*period|tbd|tba|see\s+(course\s+)?link|announced\s+later)\b/i.test(cleaned)) {
    return { iso: null, certainty: "approximate", label: cleaned.slice(0, 80) };
  }

  const mdy = cleaned.match(
    /\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\.?\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s*(\d{4}))?/i,
  );
  if (mdy) {
    const month = MONTHS[mdy[1].toLowerCase().replace(/\.$/, "")];
    const day = Number(mdy[2]);
    const year = mdy[3] ? Number(mdy[3]) : defaultYear ?? new Date().getFullYear();
    if (month != null && day >= 1 && day <= 31) {
      const iso = new Date(Date.UTC(year, month, day, 23, 59, 0)).toISOString();
      return { iso, certainty: "exact", label: cleaned.slice(0, 80) };
    }
  }

  const dmy = cleaned.match(
    /\b(\d{1,2})(?:st|nd|rd|th)?\s+(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\.?(?:,?\s*(\d{4}))?/i,
  );
  if (dmy) {
    const month = MONTHS[dmy[2].toLowerCase().replace(/\.$/, "")];
    const day = Number(dmy[1]);
    const year = dmy[3] ? Number(dmy[3]) : defaultYear ?? new Date().getFullYear();
    if (month != null && day >= 1 && day <= 31) {
      const iso = new Date(Date.UTC(year, month, day, 23, 59, 0)).toISOString();
      return { iso, certainty: "exact", label: cleaned.slice(0, 80) };
    }
  }

  const isoMatch = cleaned.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  if (isoMatch) {
    return {
      iso: new Date(`${isoMatch[0]}T23:59:00`).toISOString(),
      certainty: "exact",
      label: isoMatch[0],
    };
  }

  return { iso: null, certainty: "unknown", label: cleaned.slice(0, 80) };
}

function extractEmails(block: string): string | null {
  const m = block.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  return m ? m[0] : null;
}

function linesFromText(text: string): string[] {
  return text
    .split("\n")
    .map((l) => l.replace(/\s+$/g, "").trimEnd())
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && l !== "--- page break ---");
}

function sectionBody(lines: string[], ...headers: string[]): string {
  const headerRe = new RegExp(
    `^(?:\\d+[.)]\\s*)?(?:${headers.map((h) => h.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})\\b`,
    "i",
  );
  let start = -1;
  let headerRest = "";
  for (let i = 0; i < lines.length; i++) {
    if (headerRe.test(lines[i]) && lines[i].length < 120) {
      start = i + 1;
      headerRest = lines[i].replace(headerRe, "").replace(/^[:\-\s]+/, "").trim();
      break;
    }
  }
  if (start < 0) return "";
  const out: string[] = [];
  if (headerRest) out.push(headerRest);
  for (let i = start; i < lines.length; i++) {
    if (
      i > start &&
      /^[A-Z][A-Za-z ]{2,48}$/.test(lines[i]) &&
      !ASSESS_WORD.test(lines[i]) &&
      !/\d\s*%/.test(lines[i])
    ) {
      break;
    }
    out.push(lines[i]);
  }
  return out.join("\n").trim();
}

interface TableRow {
  cells: string[];
  raw: string;
}

function detectTableRows(lines: string[]): { header: string[]; rows: TableRow[] } | null {
  const headerIdx = lines.findIndex((l) => {
    const low = l.toLowerCase();
    const hasComp = /\b(assessment|component|item|activity|deliverable|evaluation)\b/.test(low);
    const hasWeight = /\b(weight|marks?|percent|%|value)\b/.test(low);
    const hasDue = /\b(due|date|deadline|when)\b/.test(low);
    return (hasComp && hasWeight) || (hasComp && hasDue) || (hasWeight && hasDue && hasComp);
  });
  if (headerIdx < 0) return null;

  const headerLine = lines[headerIdx];
  const splitCells = (line: string): string[] => {
    if (/\t/.test(line)) return line.split(/\t+/).map((c) => c.trim()).filter(Boolean);
    // Multi-space or pipe columns
    if (/\|/.test(line)) return line.split("|").map((c) => c.trim()).filter(Boolean);
    const parts = line.split(/\s{2,}/).map((c) => c.trim()).filter(Boolean);
    if (parts.length >= 2) return parts;
    // Fallback: title ... weight%
    const m = line.match(/^(.+?)\s+(\d{1,3}(?:\.\d+)?\s*%|due\b.*)$/i);
    if (m) return [m[1].trim(), m[2].trim()];
    return [line];
  };

  const header = splitCells(headerLine);
  const rows: TableRow[] = [];
  for (let i = headerIdx + 1; i < Math.min(lines.length, headerIdx + 40); i++) {
    const line = lines[i];
    if (/^total\b/i.test(line) && /\d\s*%/.test(line)) {
      rows.push({ cells: splitCells(line), raw: line });
      break;
    }
    if (
      /^[A-Z][A-Za-z ]{4,40}$/.test(line) &&
      !ASSESS_WORD.test(line) &&
      !/\d/.test(line) &&
      rows.length > 0
    ) {
      break;
    }
    const cells = splitCells(line);
    if (cells.length >= 2 || (ASSESS_WORD.test(line) && /\d/.test(line))) {
      rows.push({ cells, raw: line });
    } else if (rows.length && cells.length === 1 && line.length < 60) {
      // Wrapped continuation of previous title
      const prev = rows[rows.length - 1];
      prev.cells[0] = `${prev.cells[0]} ${cells[0]}`.trim();
      prev.raw = `${prev.raw} ${line}`;
    }
  }
  if (rows.length < 2) return null;
  return { header, rows };
}

function mapHeaderIndexes(header: string[]): {
  title: number;
  weight: number;
  due: number;
} {
  const low = header.map((h) => h.toLowerCase());
  const find = (...keys: string[]) =>
    low.findIndex((h) => keys.some((k) => h.includes(k)));
  let title = find("assessment", "component", "item", "activity", "deliverable", "evaluation", "description");
  let weight = find("weight", "mark", "percent", "%", "value");
  const due = find("due", "date", "deadline", "when");
  if (title < 0) title = 0;
  if (weight < 0 && header.length >= 2) weight = header.length - 1;
  return { title, weight, due };
}

function parseWeightCell(cell: string | undefined): number | null {
  if (!cell) return null;
  const m = cell.match(/(\d{1,3}(?:\.\d+)?)\s*%?/);
  if (!m) return null;
  const n = Number(m[1]);
  return n >= 0 && n <= 100 ? n : null;
}

function rowToAssessment(
  cells: string[],
  idx: { title: number; weight: number; due: number },
  raw: string,
  year?: number,
  category: string | null = null,
): OutlineAssessmentParsed | null {
  const titleRaw = (cells[idx.title] ?? cells[0] ?? "").replace(/^[-*\d.)\s]+/, "").trim();
  if (!titleRaw || /^total$/i.test(titleRaw)) return null;
  if (/^(assessment|component|weight|due|date)$/i.test(titleRaw)) return null;

  let weight = idx.weight >= 0 ? parseWeightCell(cells[idx.weight]) : null;
  if (weight == null) {
    const anywhere = raw.match(/(\d{1,3}(?:\.\d+)?)\s*%/);
    if (anywhere) weight = Number(anywhere[1]);
  }

  let dueLabel: string | null = idx.due >= 0 && cells[idx.due] ? cells[idx.due] : null;
  if (!dueLabel) {
    const dueM =
      raw.match(/\bdue\b[:\s-]*(.+)$/i) ??
      raw.match(/\b(week\s*\d+|jan\w*\s+\d{1,2}|feb\w*\s+\d{1,2}|mar\w*\s+\d{1,2}|apr\w*\s+\d{1,2}|may\s+\d{1,2}|jun\w*\s+\d{1,2}|jul\w*\s+\d{1,2}|aug\w*\s+\d{1,2}|sep\w*\s+\d{1,2}|oct\w*\s+\d{1,2}|nov\w*\s+\d{1,2}|dec\w*\s+\d{1,2}(?:\s*,?\s*\d{4})?)/i);
    dueLabel = dueM ? dueM[1] ?? dueM[0] : null;
  }

  const looksAssess =
    ASSESS_WORD.test(titleRaw) || weight != null || /\bexam\b/i.test(titleRaw);
  if (!looksAssess && weight == null) return null;

  const parsed = dueLabel
    ? parseDateLabel(dueLabel, year)
    : { iso: null, certainty: "unknown" as DateCertainty, label: "" };

  return {
    title: titleRaw.slice(0, 120),
    type: inferAssessmentType(titleRaw),
    weightPercent: weight,
    dueLabel: dueLabel ? parsed.label || dueLabel.slice(0, 80) : null,
    dueIso: parsed.iso,
    certainty: dueLabel ? parsed.certainty : "unknown",
    confidence: weight != null ? (dueLabel ? 0.85 : 0.8) : 0.55,
    category,
    sourceSnippet: raw.slice(0, 200),
  };
}

function extractWeightLines(lines: string[], year?: number): OutlineAssessmentParsed[] {
  const out: OutlineAssessmentParsed[] = [];
  const patterns = [
    /^(.{3,80}?)\s{2,}(\d{1,3}(?:\.\d+)?)\s*%(?:\s+(.*))?$/,
    /^(.{3,80}?)\s*[-|:]\s*(\d{1,3}(?:\.\d+)?)\s*%(?:\s+(.*))?$/,
    /^(.{3,80}?)\s+(\d{1,3}(?:\.\d+)?)\s*%(?:\s+[-–]?\s*(.*))?$/,
  ];

  for (let i = 0; i < lines.length; i++) {
    let line = lines[i];
    // Merge wrapped next line if current has title-like start and next is "10%" or date
    if (i + 1 < lines.length && ASSESS_WORD.test(line) && !/\d\s*%/.test(line)) {
      if (/^\d{1,3}(?:\.\d+)?\s*%/.test(lines[i + 1]) || /\b(week\s*\d+|due\b)/i.test(lines[i + 1])) {
        line = `${line}  ${lines[i + 1]}`;
        i += 1;
      }
    }

    let matched: RegExpMatchArray | null = null;
    for (const re of patterns) {
      matched = line.match(re);
      if (matched) break;
    }
    if (!matched) continue;
    const title = matched[1].replace(/^[-*\d.)\s]+/, "").trim();
    const weight = Number(matched[2]);
    if (!title || weight > 100 || /^total$/i.test(title)) continue;
    if (/^(weight|component|assessment|evaluation|marks?)$/i.test(title)) continue;

    const rest = (matched[3] ?? "").trim();
    const dueHint =
      rest ||
      line.match(/\bdue\b[:\s-]*(.+)$/i)?.[1] ||
      line.match(/\b(week\s*\d+|jan\w*\s+\d{1,2}[^,]*(?:,\s*\d{4})?|feb\w*\s+\d{1,2}[^,]*(?:,\s*\d{4})?|mar\w*\s+\d{1,2}|apr\w*\s+\d{1,2}|may\s+\d{1,2}|jun\w*\s+\d{1,2}|jul\w*\s+\d{1,2}|aug\w*\s+\d{1,2}|sep\w*\s+\d{1,2}|oct\w*\s+\d{1,2}|nov\w*\s+\d{1,2}|dec\w*\s+\d{1,2})/i)?.[0] ||
      null;
    const parsed = dueHint
      ? parseDateLabel(dueHint, year)
      : { iso: null, certainty: "unknown" as DateCertainty, label: "" };

    out.push({
      title: title.slice(0, 120),
      type: inferAssessmentType(title),
      weightPercent: weight,
      dueLabel: dueHint ? parsed.label || String(dueHint).slice(0, 80) : null,
      dueIso: parsed.iso,
      certainty: dueHint ? parsed.certainty : "unknown",
      confidence: dueHint ? 0.75 : 0.85,
      category: null,
      sourceSnippet: line.slice(0, 200),
    });
  }
  return out;
}

function extractGradingRules(text: string): {
  rules: OutlineGradingRule[];
  categories: OutlineParseResult["categories"];
} {
  const rules: OutlineGradingRule[] = [];
  const categories: OutlineParseResult["categories"] = [];

  const bestN = [
    ...text.matchAll(/\bbest\s*(?:of\s*)?(\d+)\s*(?:of\s*)?(\d+)?\s*(quizzes|labs|assignments|tests|midterms)?/gi),
  ];
  for (const m of bestN) {
    const n = Number(m[1]);
    const cat = m[3] ? m[3].replace(/s$/i, "") : null;
    rules.push({
      kind: "best_n",
      label: m[0].replace(/\s+/g, " ").trim(),
      n,
      category: cat,
    });
    if (cat) {
      categories.push({ name: cat, weightPercent: null, dropLowest: 0, bestN: n });
    }
  }

  const drop = [
    ...text.matchAll(/\bdrop(?:s|ping)?\s+(?:the\s+)?(?:lowest\s+)?(\d+)\s*(quizzes|labs|assignments|tests)?/gi),
  ];
  for (const m of drop) {
    const n = Number(m[1]);
    const cat = m[2] ? m[2].replace(/s$/i, "") : null;
    rules.push({
      kind: "drop_lowest",
      label: m[0].replace(/\s+/g, " ").trim(),
      n,
      category: cat,
    });
    const existing = categories.find((c) => c.name.toLowerCase() === (cat ?? "").toLowerCase());
    if (existing) existing.dropLowest = n;
    else if (cat) categories.push({ name: cat, weightPercent: null, dropLowest: n, bestN: null });
  }

  return { rules, categories };
}

function dedupeAssessments(items: OutlineAssessmentParsed[]): OutlineAssessmentParsed[] {
  const out: OutlineAssessmentParsed[] = [];
  for (const a of items) {
    const key = a.title.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
    const prev = out.find(
      (x) => x.title.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim() === key,
    );
    if (!prev) {
      out.push(a);
      continue;
    }
    // Prefer richer row
    if (prev.weightPercent == null && a.weightPercent != null) prev.weightPercent = a.weightPercent;
    if (!prev.dueLabel && a.dueLabel) {
      prev.dueLabel = a.dueLabel;
      prev.dueIso = a.dueIso;
      prev.certainty = a.certainty;
    }
    if (!prev.sourceSnippet && a.sourceSnippet) prev.sourceSnippet = a.sourceSnippet;
    if (a.confidence > prev.confidence) prev.confidence = a.confidence;
    if (prev.type === "other" && a.type !== "other") prev.type = a.type;
  }
  return out;
}

export interface ParseOutlineOptions {
  lines?: ExtractedLine[];
}

export function parseOutlineText(text: string, opts: ParseOutlineOptions = {}): OutlineParseResult {
  const diagnostics: OutlineParseDiagnostic[] = [];
  const cleaned = normalizeOutlineText(text);
  const lines = opts.lines?.length
    ? opts.lines.map((l) => l.text.trim()).filter(Boolean)
    : linesFromText(cleaned);

  diagnostics.push({
    pass: "normalize",
    message: `Normalized ${lines.length} lines` + (opts.lines ? " (positional PDF)" : " (plain text)"),
  });

  // --- metadata ---
  const codeMatch = cleaned.match(/\b([A-Z]{2,5})\s*[*\- ]\s*(\d{4})\b/);
  const courseCode = codeMatch ? `${codeMatch[1]}*${codeMatch[2]}` : null;

  let courseTitle: string | null = null;
  for (const line of lines.slice(0, 40)) {
    if (courseCode && new RegExp(courseCode.replace("*", "[*\\- ]?"), "i").test(line)) {
      courseTitle =
        line
          .replace(codeMatch?.[0] ?? "", "")
          .replace(/^[:\s-]+/, "")
          .trim() || null;
      if (courseTitle) break;
    }
  }
  if (!courseTitle) {
    for (const line of lines.slice(0, 25)) {
      if (
        /^[A-Z][A-Za-z0-9 ,:&()-]{8,90}$/.test(line) &&
        !/university|department|college|syllabus|outline|evaluation|grading/i.test(line)
      ) {
        courseTitle = line;
        break;
      }
    }
  }

  const termMatch = cleaned.match(
    /\b((?:Fall|Winter|Summer|F|W|S)\s*[-/]?\s*\d{4}|\d{4}\s*(?:Fall|Winter|Summer))\b/i,
  );
  let term = termMatch ? termMatch[1] : null;
  if (term && /^[FWS]\s*[-/]?\s*\d{4}$/i.test(term)) {
    const y = term.match(/\d{4}/)?.[0];
    const s = term[0].toUpperCase();
    term = `${s === "F" ? "Fall" : s === "W" ? "Winter" : "Summer"} ${y}`;
  }
  const yearMatch = term?.match(/(\d{4})/) ?? cleaned.match(/\b(20\d{2})\b/);
  const year = yearMatch ? Number(yearMatch[1]) : undefined;
  diagnostics.push({
    pass: "metadata",
    message: `code=${courseCode ?? "?"} term=${term ?? "?"} year=${year ?? "?"}`,
    snippet: lines[0]?.slice(0, 120),
  });

  // --- people ---
  const instructors: OutlineParseResult["instructors"] = [];
  // Prefer inline "Instructor: Name" / "Professor: Name"
  for (const line of lines.slice(0, 80)) {
    const m = line.match(
      /^(?:course\s+)?(?:instructor|professor)s?\s*[:-]\s*(?:dr\.?\s*)?(.+)$/i,
    );
    if (!m) continue;
    const name = m[1]
      .replace(/\b(email|office|phone)\b.*/i, "")
      .replace(/[,<(].*$/, "")
      .trim();
    if (name.length >= 3 && name.length < 70) {
      instructors.push({ name, email: extractEmails(line) ?? extractEmails(cleaned.slice(0, 2500)) });
      if (instructors.length >= 3) break;
    }
  }
  if (instructors.length === 0) {
    const instructorBlock = sectionBody(
      lines,
      "Instructor",
      "Course Instructor",
      "Professor",
      "Instructors",
    );
    for (const line of instructorBlock.split("\n").slice(0, 8)) {
      const name = line
        .replace(/^(?:dr\.?|prof\.?|professor)\s+/i, "")
        .replace(/\b(email|office|phone)\b.*/i, "")
        .replace(/[,<(].*$/, "")
        .trim();
      if (
        name.length >= 4 &&
        name.length < 70 &&
        /^[A-Z][a-z]/.test(name) &&
        !/university|department|lecture|schedule|office|hour/i.test(name)
      ) {
        instructors.push({
          name,
          email: extractEmails(line) ?? extractEmails(instructorBlock),
        });
        break;
      }
    }
  }

  const tas: OutlineParseResult["tas"] = [];
  const taBlock = sectionBody(
    lines,
    "Teaching Assistant",
    "Teaching Assistants",
    "TA",
    "TAs",
    "Graduate Teaching Assistants",
  );
  for (const line of taBlock.split("\n").slice(0, 15)) {
    const name = line
      .split(/[-:]/)[0]
      .replace(/\bTA\b/gi, "")
      .trim();
    if (
      name.length >= 3 &&
      name.length < 70 &&
      /^[A-Z]/.test(name) &&
      !/teaching assistant|email|office/i.test(name)
    ) {
      tas.push({ name, email: extractEmails(line) });
    }
  }
  diagnostics.push({
    pass: "people",
    message: `${instructors.length} instructor(s), ${tas.length} TA(s)`,
  });

  const officeHours = (sectionBody(lines, "Office Hours", "Office Hour") || "")
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 3)
    .slice(0, 8);

  const scheduleLines = (
    sectionBody(lines, "Lecture", "Schedule", "Class Schedule", "Meeting Times", "Lectures") || ""
  )
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => /(mon|tue|wed|thu|fri|sat|sun|lecture|lab|tutorial|\d{1,2}:\d{2})/i.test(l))
    .slice(0, 12);

  // --- assessments: table then lines ---
  let assessments: OutlineAssessmentParsed[] = [];
  const table = detectTableRows(lines);
  if (table) {
    const idx = mapHeaderIndexes(table.header);
    diagnostics.push({
      pass: "tables",
      message: `Detected table header with ${table.rows.length} row(s)`,
      snippet: table.header.join(" | "),
    });
    for (const row of table.rows) {
      const a = rowToAssessment(row.cells, idx, row.raw, year);
      if (a) assessments.push(a);
    }
  } else {
    diagnostics.push({ pass: "tables", message: "No assessment table header detected" });
  }

  const evalLines = (() => {
    const body = sectionBody(
      lines,
      "Evaluation",
      "Assessment",
      "Assessments",
      "Grading",
      "Grade Breakdown",
      "Marking Scheme",
      "Course Evaluation",
      "Methods of Evaluation",
      "Grading Scheme",
    );
    return body ? linesFromText(body) : lines;
  })();

  const fromLines = extractWeightLines(evalLines.length >= 3 ? evalLines : lines, year);
  diagnostics.push({
    pass: "weights",
    message: `Line heuristic found ${fromLines.length} weight row(s)`,
  });
  assessments = dedupeAssessments([...assessments, ...fromLines]);

  // Midterm/final first-class even without weights
  for (const line of lines) {
    if (!/\b(mid[- ]?term|final\s+exam|final\s+examination)\b/i.test(line)) continue;
    const type: AssessmentType = /\bfinal\b/i.test(line) ? "final" : "midterm";
    const title = type === "final" ? "Final Exam" : "Midterm";
    if (assessments.some((a) => a.type === type || a.title.toLowerCase() === title.toLowerCase())) {
      // Enrich existing
      const existing = assessments.find((a) => a.type === type);
      if (existing && !existing.dueLabel) {
        const parsed = parseDateLabel(line, year);
        if (parsed.certainty !== "unknown") {
          existing.dueLabel = parsed.label;
          existing.dueIso = parsed.iso;
          existing.certainty = parsed.certainty;
          existing.sourceSnippet = line.slice(0, 200);
        }
      }
      continue;
    }
    const parsed = parseDateLabel(line, year);
    const wm = line.match(/(\d{1,3}(?:\.\d+)?)\s*%/);
    assessments.push({
      title,
      type,
      weightPercent: wm ? Number(wm[1]) : null,
      dueLabel: parsed.certainty !== "unknown" ? parsed.label : line.slice(0, 80),
      dueIso: parsed.iso,
      certainty: parsed.certainty === "unknown" ? "approximate" : parsed.certainty,
      confidence: 0.65,
      category: null,
      sourceSnippet: line.slice(0, 200),
    });
  }
  diagnostics.push({
    pass: "dates",
    message: `${assessments.filter((a) => a.dueLabel).length} assessment(s) have due labels`,
  });

  const { rules: gradingRules, categories } = extractGradingRules(cleaned);
  diagnostics.push({
    pass: "grading_rules",
    message: `${gradingRules.length} rule(s), ${categories.length} categor(ies)`,
    snippet: gradingRules[0]?.label,
  });

  // Attach category weights from assessment titles like "Quizzes (best 5)"
  for (const a of assessments) {
    const best = a.title.match(/\bbest\s*(\d+)/i);
    const drop = a.title.match(/\bdrop\s*(\d+)/i);
    if (best || drop) {
      const name = a.title.replace(/[()]/g, " ").replace(/\bbest\s*\d+/i, "").replace(/\bdrop\s*\d+/i, "").trim();
      const catName = name.split(/\s+/)[0] ?? a.title;
      if (!categories.some((c) => c.name.toLowerCase() === catName.toLowerCase())) {
        categories.push({
          name: catName,
          weightPercent: a.weightPercent,
          dropLowest: drop ? Number(drop[1]) : 0,
          bestN: best ? Number(best[1]) : null,
        });
      }
      a.category = catName;
    }
  }

  const policies: OutlineParseResult["policies"] = [];
  const late = sectionBody(lines, "Late Policy", "Late Submission", "Late Assignments", "Late Work");
  if (late) policies.push({ kind: "late", title: "Late Policy", body: late.slice(0, 2000) });
  const att = sectionBody(lines, "Attendance", "Participation Policy");
  if (att) policies.push({ kind: "attendance", title: "Attendance / Participation", body: att.slice(0, 2000) });
  const integrity = sectionBody(
    lines,
    "Academic Integrity",
    "Academic Misconduct",
    "Academic Honesty",
  );
  if (integrity) {
    policies.push({
      kind: "academic_integrity",
      title: "Academic Integrity",
      body: integrity.slice(0, 2000),
    });
  }

  const textbooks = (
    sectionBody(lines, "Textbook", "Textbooks", "Required Texts", "Required Readings", "Resources") ||
    ""
  )
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 5 && !/^(textbook|resources|required)/i.test(l))
    .slice(0, 10);

  diagnostics.push({
    pass: "policies",
    message: `${policies.length} polic(ies), ${textbooks.length} textbook/resource line(s)`,
  });

  const weightTotal = assessments.reduce((s, a) => s + (a.weightPercent ?? 0), 0);
  let confidence = 0.35;
  if (courseCode) confidence += 0.12;
  if (assessments.length >= 2) confidence += 0.18;
  if (assessments.length >= 4) confidence += 0.05;
  if (Math.abs(weightTotal - 100) <= 5 && weightTotal > 0) confidence += 0.18;
  else if (weightTotal > 40 && weightTotal < 110) confidence += 0.08;
  if (instructors.length) confidence += 0.08;
  if (table) confidence += 0.06;
  if (assessments.some((a) => a.type === "midterm" || a.type === "final")) confidence += 0.04;

  diagnostics.push({
    pass: "confidence",
    message: `confidence=${confidence.toFixed(2)} assessments=${assessments.length} weightSum=${weightTotal}`,
  });

  return {
    courseCode,
    courseTitle,
    term,
    instructors,
    tas,
    officeHours,
    scheduleLines,
    assessments: dedupeAssessments(assessments),
    categories,
    gradingRules,
    policies,
    textbooks,
    diagnostics,
    confidence: Math.min(1, confidence),
  };
}