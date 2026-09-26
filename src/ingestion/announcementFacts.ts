/**
 * Deep announcement fact extraction — structured academic changes, not a boolean.
 */
import { parseDateLabel } from "@/adapters/outline/parse";
import { syncContentHash } from "@/domain/facts";
import type { Announcement, AnnouncementFact, Assessment } from "@/domain/types";
import { normalizeTitleKey } from "@/domain/ids";

function snippetAround(text: string, idx: number, len = 140): string {
  const start = Math.max(0, idx - 40);
  return text.slice(start, start + len).replace(/\s+/g, " ").trim();
}

function matchAssessment(hint: string, assessments: Assessment[]): string | null {
  const key = normalizeTitleKey(hint);
  if (!key) return null;
  let best: { id: string; score: number } | null = null;
  for (const a of assessments) {
    const ak = normalizeTitleKey(a.title);
    let score = 0;
    if (ak === key) score = 100;
    else if (ak.includes(key) || key.includes(ak)) score = 70;
    else {
      const tokens = key.split("-").filter((t) => t.length > 1);
      const hits = tokens.filter((t) => ak.includes(t)).length;
      if (hits >= 2 || (hits === 1 && tokens.length === 1)) score = 40 + hits * 10;
    }
    if (score > 0 && (!best || score > best.score)) best = { id: a.id, score };
  }
  return best && best.score >= 40 ? best.id : null;
}

const ASSESS_RE =
  /\b((?:assignment|quiz|lab|project|mid[- ]?term|final(?:\s+exam)?|homework|hw|test)\s*#?\s*\d*[a-z]?|a\s*\d+|q\s*\d+|lab\s*\d+)\b/gi;

export function extractAnnouncementFacts(
  ann: Announcement,
  assessments: Assessment[],
): AnnouncementFact[] {
  const text = `${ann.title}. ${ann.bodyText}`.replace(/\s+/g, " ").trim();
  const facts: AnnouncementFact[] = [];
  const baseId = `afact:${ann.id}`;
  let n = 0;

  const push = (partial: Omit<AnnouncementFact, "id" | "announcementId" | "courseId">) => {
    n += 1;
    facts.push({
      id: `${baseId}:${n}`,
      announcementId: ann.id,
      courseId: ann.courseId,
      ...partial,
    });
  };

  // Extension / deadline change
  const extRe =
    /\b((?:assignment|quiz|lab|project|homework|hw|a\s*\d+|q\s*\d+|lab\s*\d+)[^.]{0,40}?)\b(?:(?:due|deadline)\s+(?:date\s+)?(?:extended|postponed|moved|changed)|extended?\s+(?:to|until)|new\s+due\s+date)\b[:\s]+([^.!?]{3,80})/gi;
  let m: RegExpExecArray | null;
  while ((m = extRe.exec(text))) {
    const hint = m[1].trim();
    const dueRaw = m[2].trim();
    const parsed = parseDateLabel(dueRaw);
    push({
      kind: /extend|postpon/i.test(m[0]) ? "extension" : "deadline_change",
      assessmentHint: hint,
      assessmentId: matchAssessment(hint, assessments),
      dueIso: parsed.iso,
      dueLabel: parsed.label || dueRaw.slice(0, 80),
      location: null,
      detail: m[0].slice(0, 200),
      confidence: parsed.iso ? 0.75 : 0.55,
      snippet: snippetAround(text, m.index),
    });
  }

  // Cancel
  const cancelRe =
    /\b((?:assignment|quiz|lab|lecture|class|mid[- ]?term|tutorial)[^.]{0,40}?)\b(?:cancelled|canceled|will not (?:meet|be held)|no class)\b/gi;
  while ((m = cancelRe.exec(text))) {
    const hint = m[1].trim();
    push({
      kind: "cancel",
      assessmentHint: hint,
      assessmentId: matchAssessment(hint, assessments),
      dueIso: null,
      dueLabel: null,
      location: null,
      detail: m[0].slice(0, 200),
      confidence: 0.7,
      snippet: snippetAround(text, m.index),
    });
  }

  // Location / room
  const locRe =
    /\b((?:mid[- ]?term|final|exam|quiz|test|lecture)[^.]{0,30}?)\b(?:in|at|room|location)\s+([A-Z]{1,6}\s*\d{2,5}[A-Z]?|[A-Za-z]+\s+Hall\s+\d+)/g;
  while ((m = locRe.exec(text))) {
    push({
      kind: "location",
      assessmentHint: m[1].trim(),
      assessmentId: matchAssessment(m[1], assessments),
      dueIso: null,
      dueLabel: null,
      location: m[2].trim(),
      detail: m[0].slice(0, 200),
      confidence: 0.65,
      snippet: snippetAround(text, m.index),
    });
  }

  // Exam
  if (/\b(mid[- ]?term|final\s+exam|exam\s+date)\b/i.test(text)) {
    const dueM = text.match(
      /\b(?:mid[- ]?term|final(?:\s+exam)?)\b[^.!?]{0,40}?\b(?:on|due)?\s*([A-Z][a-z]{2,8}\s+\d{1,2}(?:,?\s*\d{4})?|\d{1,2}\/\d{1,2}(?:\/\d{2,4})?)/i,
    );
    const hint = text.match(/\b(mid[- ]?term|final(?:\s+exam)?)\b/i)?.[1] ?? "exam";
    const parsed = dueM ? parseDateLabel(dueM[1]) : { iso: null, label: null, certainty: "unknown" as const };
    push({
      kind: "exam",
      assessmentHint: hint,
      assessmentId: matchAssessment(hint, assessments),
      dueIso: parsed.iso,
      dueLabel: parsed.label,
      location: null,
      detail: dueM?.[0]?.slice(0, 200) ?? "Exam mentioned",
      confidence: parsed.iso ? 0.7 : 0.45,
      snippet: snippetAround(text, dueM?.index ?? 0),
    });
  }

  // Grade release
  if (/\b(grades?\s+(?:are|have been|posted|released)|feedback\s+(?:is|has been)\s+(?:posted|available))\b/i.test(text)) {
    const am = text.match(ASSESS_RE);
    const hint = am?.[0] ?? null;
    push({
      kind: "grade_release",
      assessmentHint: hint,
      assessmentId: hint ? matchAssessment(hint, assessments) : null,
      dueIso: null,
      dueLabel: null,
      location: null,
      detail: "Grade/feedback release signal",
      confidence: 0.6,
      snippet: text.slice(0, 140),
    });
  }

  // Resource / link
  if (/\b(posted|uploaded|attached|see\s+(?:the\s+)?(?:pdf|document|slides|handout))\b/i.test(text)) {
    const am = text.match(ASSESS_RE);
    push({
      kind: "resource",
      assessmentHint: am?.[0] ?? null,
      assessmentId: am?.[0] ? matchAssessment(am[0], assessments) : null,
      dueIso: null,
      dueLabel: null,
      location: null,
      detail: "Resource/material mentioned",
      confidence: 0.4,
      snippet: text.slice(0, 140),
    });
  }

  // Schedule
  if (/\b(schedule|week\s+\d+|moved\s+to|class\s+will)\b/i.test(text) && facts.every((f) => f.kind !== "cancel")) {
    push({
      kind: "schedule",
      assessmentHint: null,
      assessmentId: null,
      dueIso: null,
      dueLabel: null,
      location: null,
      detail: "Schedule-related announcement",
      confidence: 0.4,
      snippet: text.slice(0, 140),
    });
  }

  // Clarification fallback when staff announcement mentions an assessment
  if (facts.length === 0) {
    const am = text.match(ASSESS_RE);
    if (am) {
      push({
        kind: "clarification",
        assessmentHint: am[0],
        assessmentId: matchAssessment(am[0], assessments),
        dueIso: null,
        dueLabel: null,
        location: null,
        detail: "Possible clarification",
        confidence: 0.35,
        snippet: text.slice(0, 140),
      });
    }
  }

  return facts;
}

export function enrichAnnouncement(ann: Announcement, assessments: Assessment[]): Announcement {
  const facts = extractAnnouncementFacts(ann, assessments);
  const hash = syncContentHash(`${ann.title}\n${ann.bodyText}`);
  return {
    ...ann,
    bodyHash: hash,
    extractedFactIds: facts.map((f) => f.id),
    deadlineChangeSignal: facts.some(
      (f) => f.kind === "deadline_change" || f.kind === "extension",
    ),
  };
}

export { matchAssessment };
