/**
 * Cinematic brief — spoken-style day briefing from CourseBlueprint + live sync.
 * No LLM. Deterministic copy cites WHY (weight, rules, submission, occurrences).
 */
import { formatInTimeZone } from "date-fns-tz";
import type { AppData, Assessment } from "@/domain/types";
import { UOFG_TIMEZONE } from "@/domain/constants";
import { buildMyDay, type MyDayItem, type MyDayModel, type MyDaySection } from "./myday";
import { effectiveStatus } from "@/storage/chromeStore";
import {
  buildRecoveryInsights,
  buildRiskInsights,
  explainAssessment,
  formatWhy,
  isAssessmentOpen,
  scoreAssessmentPriority,
  type KnowledgeInsight,
  type WhyReason,
} from "./planningKnowledge";

export type BriefTone = "idle" | "focus" | "urgent" | "clear" | "offline";

export interface BriefBeat {
  id: string;
  section: MyDaySection | "system" | "risk" | "recovery";
  kicker: string;
  line: string;
  detail?: string;
  item?: MyDayItem;
  priority: number;
  /** Explainable WHY citations from blueprint / rules / sync state */
  reasons?: WhyReason[];
  assessmentId?: string | null;
}

export interface CinematicBrief {
  generatedAt: string;
  greeting: string;
  headline: string;
  subhead: string;
  tone: BriefTone;
  beats: BriefBeat[];
  risks: KnowledgeInsight[];
  recovery: KnowledgeInsight[];
  pulse: {
    rightNow: number;
    needsAnswer: number;
    tonight: number;
    unread: number;
    courses: number;
    risks: number;
  };
  model: MyDayModel;
  systemNote: string | null;
}

function dayPart(now: Date): "morning" | "afternoon" | "evening" | "night" {
  const h = Number(formatInTimeZone(now, UOFG_TIMEZONE, "H"));
  if (h < 5) return "night";
  if (h < 12) return "morning";
  if (h < 17) return "afternoon";
  if (h < 21) return "evening";
  return "night";
}

function firstName(data: AppData): string {
  const n = data.user?.name?.trim();
  if (!n) return "Commander";
  return n.split(/\s+/)[0] ?? "Commander";
}

function sectionItems(model: MyDayModel, id: MyDaySection): MyDayItem[] {
  return model.sections.find((s) => s.id === id)?.items ?? [];
}

function relativeWhen(iso: string | null, now: Date): string | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  const mins = Math.round((t - now.getTime()) / 60_000);
  if (Math.abs(mins) < 1) return "now";
  if (mins > 0 && mins < 60) return `in ${mins} min`;
  if (mins >= 60 && mins < 24 * 60) {
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    return m ? `in ${h}h ${m}m` : `in ${h}h`;
  }
  if (mins < 0 && mins > -60) return `${Math.abs(mins)} min ago`;
  if (mins <= -60 && mins > -24 * 60) return `${Math.floor(Math.abs(mins) / 60)}h ago`;
  return formatInTimeZone(new Date(t), UOFG_TIMEZONE, "EEE h:mm a");
}

function assessmentFromItem(data: AppData, item: MyDayItem): Assessment | null {
  const open = item.ctas.find((c) => c.kind === "open_assessment");
  if (open && open.kind === "open_assessment") {
    return data.assessments.find((a) => a.id === open.assessmentId) ?? null;
  }
  const m = item.id.match(/^a:([^:]+)/);
  if (m) return data.assessments.find((a) => a.id === m[1]) ?? null;
  return null;
}

function enrichBeat(
  data: AppData,
  item: MyDayItem,
  base: Omit<BriefBeat, "detail" | "reasons" | "priority" | "assessmentId"> & {
    priority: number;
  },
  now: Date,
): BriefBeat {
  const a = assessmentFromItem(data, item);
  if (!a) {
    return {
      ...base,
      detail: item.subtitle || item.statusLabel,
      reasons: [],
      assessmentId: null,
    };
  }
  const reasons = explainAssessment(data, a, now);
  const knowledgeScore = scoreAssessmentPriority(data, a, now);
  const why = formatWhy(reasons, 4);
  return {
    ...base,
    priority: base.priority + knowledgeScore,
    detail: why || item.subtitle || item.statusLabel,
    reasons,
    assessmentId: a.id,
    item,
  };
}

/**
 * Knowledge-first assessment beats: rank by blueprint weights + rules + sync state,
 * not generic deadline proximity alone.
 */
function knowledgeAssessmentBeats(data: AppData, now: Date): BriefBeat[] {
  const ids = data.preferences.selectedCourseIds;
  const selected = ids?.length
    ? new Set(ids)
    : new Set(data.courses.filter((c) => c.selected).map((c) => c.id));
  const courses = new Map(data.courses.map((c) => [c.id, c]));
  const beats: BriefBeat[] = [];

  for (const a of data.assessments) {
    if (!selected.has(a.courseId)) continue;
    const course = courses.get(a.courseId);
    if (!course) continue;
    const open = isAssessmentOpen(a) || a.state?.needsConfirmation || a.state?.missed;
    if (!open) continue;

    const score = scoreAssessmentPriority(data, a, now);
    if (score < 8 && !a.state?.missed && !a.state?.needsConfirmation) continue;

    const reasons = explainAssessment(data, a, now);
    const hrs = a.due.iso ? (Date.parse(a.due.iso) - now.getTime()) / 3_600_000 : null;
    let section: BriefBeat["section"] = "coming_up";
    let kicker = "PLAN";
    if (a.state?.needsConfirmation) {
      section = "needs_answer";
      kicker = "NEEDS YOU";
    } else if (a.state?.missed) {
      section = "risk";
      kicker = "MISSED · RULE";
    } else if (hrs != null && hrs < 0) {
      section = "needs_answer";
      kicker = "OVERDUE";
    } else if (hrs != null && hrs <= 12) {
      section = "tonight";
      kicker = "TONIGHT";
    } else if (hrs != null && hrs <= 36) {
      section = "next";
      kicker = "NEXT";
    }

    beats.push({
      id: `kb:${a.id}`,
      section,
      kicker,
      line: `${course.code} — ${a.title}`,
      detail: formatWhy(reasons, 5),
      priority: 50 + score,
      reasons,
      assessmentId: a.id,
      item: {
        id: `a:${a.id}:kb`,
        section: section === "risk" ? "needs_answer" : (section as MyDaySection),
        kind: "assessment",
        courseId: course.id,
        courseCode: course.code,
        courseColor: course.color,
        title: a.title,
        subtitle: formatWhy(reasons, 3),
        startIso: a.due.iso,
        endIso: a.end.iso,
        weightPercent: a.weightPercent,
        statusLabel: a.submissionState,
        actionable: isAssessmentOpen(a) || !!a.state?.needsConfirmation,
        ctas: [{ kind: "open_assessment", assessmentId: a.id }],
        href: `/assessment/${encodeURIComponent(a.id)}`,
        sortKey: score,
      },
    });
  }

  return beats;
}

export function buildCinematicBrief(data: AppData, now = new Date()): CinematicBrief {
  const model = buildMyDay(data, now);
  const name = firstName(data);
  const part = dayPart(now);
  const greetWord =
    part === "morning"
      ? "Good morning"
      : part === "afternoon"
        ? "Good afternoon"
        : part === "evening"
          ? "Good evening"
          : "Still here";

  const rightNow = sectionItems(model, "right_now");
  const next = sectionItems(model, "next");
  const tonight = sectionItems(model, "tonight");
  const coming = sectionItems(model, "coming_up");
  const since = sectionItems(model, "since_last_checked");
  const needs = sectionItems(model, "needs_answer");
  const unread = (data.changes ?? []).filter((c) => !c.read).length;
  const selected = (data.preferences.selectedCourseIds ?? []).length;
  const status = effectiveStatus(data.sync);

  const risks = buildRiskInsights(data, now);
  const recovery = buildRecoveryInsights(data, now);

  const beats: BriefBeat[] = [];

  for (const item of rightNow.slice(0, 2)) {
    beats.push(
      enrichBeat(
        data,
        item,
        {
          id: `rn:${item.id}`,
          section: "right_now",
          kicker: "RIGHT NOW",
          line: `${item.courseCode} — ${item.title}`,
          item,
          priority: 100,
        },
        now,
      ),
    );
  }
  for (const item of needs.slice(0, 4)) {
    beats.push(
      enrichBeat(
        data,
        item,
        {
          id: `na:${item.id}`,
          section: "needs_answer",
          kicker: "NEEDS YOU",
          line: `${item.courseCode} — ${item.title}`,
          item,
          priority: 90,
        },
        now,
      ),
    );
  }
  for (const item of next.slice(0, 3)) {
    const when = relativeWhen(item.startIso, now);
    beats.push(
      enrichBeat(
        data,
        item,
        {
          id: `nx:${item.id}`,
          section: "next",
          kicker: when ? `NEXT · ${when.toUpperCase()}` : "NEXT",
          line: `${item.courseCode} — ${item.title}`,
          item,
          priority: 80,
        },
        now,
      ),
    );
  }
  for (const item of tonight.slice(0, 4)) {
    beats.push(
      enrichBeat(
        data,
        item,
        {
          id: `tn:${item.id}`,
          section: "tonight",
          kicker: "TONIGHT",
          line: `${item.courseCode} — ${item.title}`,
          item,
          priority: 70,
        },
        now,
      ),
    );
  }
  for (const item of since.slice(0, 2)) {
    beats.push(
      enrichBeat(
        data,
        item,
        {
          id: `sl:${item.id}`,
          section: "since_last_checked",
          kicker: "SINCE LAST CHECK",
          line: item.title,
          item,
          priority: 50,
        },
        now,
      ),
    );
  }
  for (const item of coming.slice(0, 3)) {
    beats.push(
      enrichBeat(
        data,
        item,
        {
          id: `cu:${item.id}`,
          section: "coming_up",
          kicker: "COMING UP",
          line: `${item.courseCode} — ${item.title}`,
          item,
          priority: 40,
        },
        now,
      ),
    );
  }

  // Merge knowledge-ranked assessment beats (dedupe by assessmentId)
  const seenAssess = new Set(
    beats.map((b) => b.assessmentId).filter((x): x is string => !!x),
  );
  for (const kb of knowledgeAssessmentBeats(data, now)) {
    if (kb.assessmentId && seenAssess.has(kb.assessmentId)) {
      // Boost existing beat priority with knowledge score delta already in kb
      const hit = beats.find((b) => b.assessmentId === kb.assessmentId);
      if (hit && kb.priority > hit.priority) {
        hit.priority = kb.priority;
        hit.detail = kb.detail;
        hit.reasons = kb.reasons;
        if (kb.kicker.includes("MISSED") || kb.kicker === "OVERDUE") hit.kicker = kb.kicker;
      }
      continue;
    }
    if (kb.assessmentId) seenAssess.add(kb.assessmentId);
    beats.push(kb);
  }

  for (const r of risks.slice(0, 3)) {
    if (r.assessmentId && seenAssess.has(r.assessmentId)) continue;
    beats.push({
      id: r.id,
      section: "risk",
      kicker: "RISK",
      line: `${r.courseCode} — ${r.title}`,
      detail: r.detail,
      priority: 60 + r.score / 10,
      reasons: r.reasons,
      assessmentId: r.assessmentId,
    });
  }
  for (const r of recovery.slice(0, 2)) {
    beats.push({
      id: r.id,
      section: "recovery",
      kicker: "RECOVERY",
      line: `${r.courseCode} — ${r.title}`,
      detail: r.detail,
      priority: 45 + r.score / 10,
      reasons: r.reasons,
      assessmentId: r.assessmentId,
    });
  }

  beats.sort((a, b) => b.priority - a.priority);

  let tone: BriefTone = "clear";
  let systemNote: string | null = null;
  if (status === "signed_out") {
    tone = "offline";
    systemNote = "CourseLink session offline. Sign in in this browser, then sync.";
  } else if (status === "error") {
    tone = "urgent";
    systemNote = data.sync.message ?? "Last sync failed.";
  } else if (!data.sync.lastSyncedAt) {
    tone = "idle";
    systemNote = "Systems cold. Open CourseLink signed in, then sync to wake the semester.";
  } else if (needs.length > 0 || risks.some((r) => r.score > 40)) {
    tone = "urgent";
  } else if (rightNow.length > 0 || next.length + tonight.length > 0) {
    tone = "focus";
  } else {
    tone = "clear";
  }

  let headline: string;
  if (tone === "offline" || tone === "idle") {
    headline = "Standing by.";
  } else if (rightNow[0]) {
    headline = `${rightNow[0].courseCode} is live.`;
  } else if (needs.length === 1) {
    headline = "One thing needs your answer.";
  } else if (needs.length > 1) {
    headline = `${needs.length} things need your answer.`;
  } else if (beats[0]?.assessmentId && beats[0].reasons?.some((r) => r.code === "weight")) {
    const top = beats[0];
    const w = top.reasons?.find((r) => r.code === "weight" || r.code === "blueprint");
    headline = w
      ? `${top.line.split(" — ")[0]}: prioritize ${top.line.split(" — ")[1] ?? "work"} (${w.text}).`
      : `${top.line} leads the board.`;
    if (headline.length > 90) {
      headline = next[0]
        ? (() => {
            const when = relativeWhen(next[0].startIso, now);
            return when ? `${next[0].courseCode} ${when}.` : `${next[0].courseCode} is next.`;
          })()
        : tonight.length > 0
          ? tonight.length === 1
            ? "One deadline tonight."
            : `${tonight.length} deadlines tonight.`
          : top.line.length < 80
            ? `${top.line}.`
            : "Focus the highest-weight open work.";
    }
  } else if (next[0]) {
    const when = relativeWhen(next[0].startIso, now);
    headline = when ? `${next[0].courseCode} ${when}.` : `${next[0].courseCode} is next.`;
  } else if (tonight.length > 0) {
    headline = tonight.length === 1 ? "One deadline tonight." : `${tonight.length} deadlines tonight.`;
  } else {
    headline = "Board is clear for now.";
  }

  const bits: string[] = [];
  if (tonight.length) bits.push(`${tonight.length} tonight`);
  if (coming.length) bits.push(`${coming.length} coming up`);
  if (risks.length) bits.push(`${risks.length} risk${risks.length === 1 ? "" : "s"}`);
  if (unread) bits.push(`${unread} unread change${unread === 1 ? "" : "s"}`);
  if (selected) bits.push(`${selected} course${selected === 1 ? "" : "s"} armed`);
  const bpCount = (data.courseBlueprints ?? []).filter((b) =>
    selected ? (data.preferences.selectedCourseIds ?? []).includes(b.courseId ?? "") : !!b.courseId,
  ).length;
  if (bpCount) bits.push(`${bpCount} blueprint${bpCount === 1 ? "" : "s"}`);
  const subhead =
    bits.length > 0
      ? bits.join(" · ")
      : "Local academic OS — planning from CourseLink sync + course blueprints.";

  return {
    generatedAt: now.toISOString(),
    greeting: `${greetWord}, ${name}.`,
    headline,
    subhead,
    tone,
    beats: beats.slice(0, 12),
    risks,
    recovery,
    pulse: {
      rightNow: rightNow.length,
      needsAnswer: needs.length,
      tonight: tonight.length,
      unread,
      courses: selected,
      risks: risks.length,
    },
    model,
    systemNote,
  };
}
