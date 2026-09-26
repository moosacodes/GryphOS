/**
 * Cinematic brief — spoken-style day briefing derived from My Day.
 * No LLM. Deterministic copy from real Sync data only.
 */
import { formatInTimeZone } from "date-fns-tz";
import type { AppData } from "@/domain/types";
import { UOFG_TIMEZONE } from "@/domain/constants";
import { buildMyDay, type MyDayItem, type MyDayModel, type MyDaySection } from "./myday";
import { effectiveStatus } from "@/storage/chromeStore";

export type BriefTone = "idle" | "focus" | "urgent" | "clear" | "offline";

export interface BriefBeat {
  id: string;
  section: MyDaySection | "system";
  kicker: string;
  line: string;
  detail?: string;
  item?: MyDayItem;
  priority: number;
}

export interface CinematicBrief {
  generatedAt: string;
  greeting: string;
  headline: string;
  subhead: string;
  tone: BriefTone;
  beats: BriefBeat[];
  pulse: {
    rightNow: number;
    needsAnswer: number;
    tonight: number;
    unread: number;
    courses: number;
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

  const beats: BriefBeat[] = [];

  for (const item of rightNow.slice(0, 2)) {
    beats.push({
      id: `rn:${item.id}`,
      section: "right_now",
      kicker: "RIGHT NOW",
      line: `${item.courseCode} — ${item.title}`,
      detail: item.subtitle || item.statusLabel,
      item,
      priority: 100,
    });
  }
  for (const item of needs.slice(0, 3)) {
    beats.push({
      id: `na:${item.id}`,
      section: "needs_answer",
      kicker: "NEEDS YOU",
      line: `${item.courseCode} — ${item.title}`,
      detail: item.subtitle || "Confirm what happened",
      item,
      priority: 90,
    });
  }
  for (const item of next.slice(0, 2)) {
    const when = relativeWhen(item.startIso, now);
    beats.push({
      id: `nx:${item.id}`,
      section: "next",
      kicker: when ? `NEXT · ${when.toUpperCase()}` : "NEXT",
      line: `${item.courseCode} — ${item.title}`,
      detail: item.subtitle || item.statusLabel,
      item,
      priority: 80,
    });
  }
  for (const item of tonight.slice(0, 3)) {
    beats.push({
      id: `tn:${item.id}`,
      section: "tonight",
      kicker: "TONIGHT",
      line: `${item.courseCode} — ${item.title}`,
      detail: item.subtitle || item.statusLabel,
      item,
      priority: 70,
    });
  }
  for (const item of since.slice(0, 2)) {
    beats.push({
      id: `sl:${item.id}`,
      section: "since_last_checked",
      kicker: "SINCE LAST CHECK",
      line: item.title,
      detail: item.subtitle || item.courseCode,
      item,
      priority: 50,
    });
  }
  for (const item of coming.slice(0, 2)) {
    beats.push({
      id: `cu:${item.id}`,
      section: "coming_up",
      kicker: "COMING UP",
      line: `${item.courseCode} — ${item.title}`,
      detail: item.subtitle || item.statusLabel,
      item,
      priority: 40,
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
  } else if (needs.length > 0) {
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
  if (unread) bits.push(`${unread} unread change${unread === 1 ? "" : "s"}`);
  if (selected) bits.push(`${selected} course${selected === 1 ? "" : "s"} armed`);
  const subhead =
    bits.length > 0
      ? bits.join(" · ")
      : "Local academic OS — synced from your CourseLink session.";

  return {
    generatedAt: now.toISOString(),
    greeting: `${greetWord}, ${name}.`,
    headline,
    subhead,
    tone,
    beats: beats.slice(0, 10),
    pulse: {
      rightNow: rightNow.length,
      needsAnswer: needs.length,
      tonight: tonight.length,
      unread,
      courses: selected,
    },
    model,
    systemNote,
  };
}
