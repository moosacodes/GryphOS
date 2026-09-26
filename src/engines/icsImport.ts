/**
 * ICS import via ical.js (RFC5545) — America/Toronto, UID dedupe, EXDATE.
 * Category comes from import context first, then CATEGORIES, then SUMMARY prefix.
 */
import ICAL from "ical.js";
import type { CalendarEventItem, SourceType } from "@/domain/types";

export type IcsImportContext = {
  defaultCategory?: CalendarEventItem["category"];
  courseId?: string | null;
  sourceType?: SourceType;
};

type IcalTime = {
  isDate: boolean;
  year: number;
  month: number;
  day: number;
  toJSDate(): Date;
};

type IcalEventLike = {
  uid: string;
  summary: string | null;
  location: string | null;
  description: string | null;
  startDate: IcalTime | null;
  endDate: IcalTime | null;
  component: {
    getAllProperties(name: string): Array<{ getFirstValue(): unknown }>;
    getFirstProperty(name: string): { getValues(): unknown[] } | null;
  };
};

function categorize(
  summary: string,
  categories: string[],
  ctx?: IcsImportContext,
): CalendarEventItem["category"] {
  if (ctx?.defaultCategory) return ctx.defaultCategory;
  const fromCat = categories.map((c) => c.toUpperCase());
  if (fromCat.some((c) => c === "UNI" || c.includes("UNIVERSITY"))) return "UNI";
  if (fromCat.some((c) => c === "STUDY")) return "STUDY";
  if (fromCat.some((c) => c === "BUS")) return "BUS";
  if (summary.startsWith("[UNI]")) return "UNI";
  if (summary.startsWith("[STUDY]")) return "STUDY";
  if (summary.startsWith("[BUS]")) return "BUS";
  return "OTHER";
}

function timeFromIcal(t: IcalTime | null | undefined): { iso: string; allDay: boolean } | null {
  if (!t) return null;
  if (t.isDate) {
    const y = t.year;
    const m = String(t.month).padStart(2, "0");
    const d = String(t.day).padStart(2, "0");
    return { iso: `${y}-${m}-${d}T12:00:00`, allDay: true };
  }
  try {
    return { iso: t.toJSDate().toISOString(), allDay: false };
  } catch {
    return null;
  }
}

function exdatesFromEvent(event: IcalEventLike): string[] {
  const out: string[] = [];
  try {
    for (const p of event.component.getAllProperties("exdate")) {
      const v = p.getFirstValue() as IcalTime | null;
      if (v && typeof v.year === "number") {
        out.push(`${v.year}-${String(v.month).padStart(2, "0")}-${String(v.day).padStart(2, "0")}`);
      }
    }
  } catch {
    /* ignore */
  }
  return out;
}

export function parseIcs(raw: string, ctx?: IcsImportContext): CalendarEventItem[] {
  const events: CalendarEventItem[] = [];
  try {
    const jcal = ICAL.parse(raw);
    const comp = new ICAL.Component(jcal);
    const vevents = comp.getAllSubcomponents("vevent");
    for (const ve of vevents) {
      const event = new ICAL.Event(ve) as unknown as IcalEventLike;
      const uid = event.uid || `ics:${events.length}`;
      const summary = event.summary || "(untitled)";
      const start = timeFromIcal(event.startDate);
      if (!start) continue;
      const end = timeFromIcal(event.endDate);
      const catsProp = event.component.getFirstProperty("categories");
      const cats: string[] = [];
      if (catsProp) for (const v of catsProp.getValues()) cats.push(String(v));
      events.push({
        id: `ics:${uid}`,
        uid,
        title: summary.replace(/^\[(UNI|STUDY|BUS)\]\s*/i, ""),
        category: categorize(summary, cats, ctx),
        startIso: start.iso,
        endIso: end?.iso ?? null,
        allDay: start.allDay,
        location: event.location || null,
        description: event.description || null,
        exdates: exdatesFromEvent(event),
        courseId: ctx?.courseId ?? null,
        sourceType: ctx?.sourceType ?? "ics",
      });
    }
  } catch {
    return parseIcsFallback(raw, ctx);
  }
  for (const e of events) {
    const esc = e.uid.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp("UID:" + esc + "[\\s\\S]*?END:VEVENT", "i");
    const block = raw.match(re)?.[0] ?? "";
    for (const m of block.matchAll(/EXDATE[^:]*:(\d{8})/gi)) {
      const d = m[1];
      const ymd = `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`;
      if (!e.exdates.includes(ymd)) e.exdates.push(ymd);
    }
  }
  return events;
}

function parseIcsFallback(raw: string, ctx?: IcsImportContext): CalendarEventItem[] {
  const lines = raw.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  const unfolded: string[] = [];
  for (const line of lines) {
    if ((line.startsWith(" ") || line.startsWith("\t")) && unfolded.length) {
      unfolded[unfolded.length - 1] += line.slice(1);
    } else unfolded.push(line);
  }
  const events: CalendarEventItem[] = [];
  let cur: string[] | null = null;
  for (const line of unfolded) {
    if (line === "BEGIN:VEVENT") { cur = []; continue; }
    if (line === "END:VEVENT" && cur) {
      const props: Record<string, string> = {};
      for (const l of cur) {
        const idx = l.indexOf(":");
        if (idx < 0) continue;
        props[l.slice(0, idx).split(";")[0].toUpperCase()] = l.slice(idx + 1);
      }
      const uid = props.UID || `fb:${events.length}`;
      const summary = props.SUMMARY || "(untitled)";
      const dt = props.DTSTART || "";
      let iso = new Date().toISOString();
      let allDay = false;
      if (/^\d{8}$/.test(dt)) {
        iso = `${dt.slice(0, 4)}-${dt.slice(4, 6)}-${dt.slice(6, 8)}T12:00:00`;
        allDay = true;
      } else {
        const m = dt.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z)?$/);
        if (m) {
          iso = m[7] === "Z"
            ? new Date(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}Z`).toISOString()
            : new Date(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}`).toISOString();
        }
      }
      const ex: string[] = [];
      if (props.EXDATE) {
        const rawEx = props.EXDATE.split(",")[0];
        if (/^\d{8}/.test(rawEx)) ex.push(`${rawEx.slice(0, 4)}-${rawEx.slice(4, 6)}-${rawEx.slice(6, 8)}`);
      }
      events.push({
        id: `ics:${uid}`, uid,
        title: summary.replace(/^\[(UNI|STUDY|BUS)\]\s*/i, ""),
        category: categorize(summary, props.CATEGORIES ? [props.CATEGORIES] : [], ctx),
        startIso: iso, endIso: null, allDay,
        location: props.LOCATION || null, description: props.DESCRIPTION || null,
        exdates: ex, courseId: ctx?.courseId ?? null, sourceType: ctx?.sourceType ?? "ics",
      });
      cur = null; continue;
    }
    if (cur) cur.push(line);
  }
  return events;
}

export function mergeCalendarByUid(
  existing: CalendarEventItem[],
  incoming: CalendarEventItem[],
): CalendarEventItem[] {
  const map = new Map<string, CalendarEventItem>();
  for (const e of existing) map.set(e.uid, e);
  for (const e of incoming) map.set(e.uid, e);
  return [...map.values()];
}

export function eventOccursOn(event: CalendarEventItem, dayKey: string): boolean {
  if (event.exdates.includes(dayKey)) return false;
  const startKey = event.startIso.slice(0, 10);
  if (event.allDay) return startKey === dayKey;
  return startKey === dayKey || event.startIso.includes(dayKey);
}
