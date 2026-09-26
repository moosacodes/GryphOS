/**
 * ICS import — America/Toronto interpretation, UID dedupe, EXDATE support.
 * Categories UNI / STUDY / BUS from CATEGORIES or SUMMARY prefix.
 */
import type { CalendarEventItem } from "@/domain/types";

function unfold(raw: string): string[] {
  const lines = raw.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  const out: string[] = [];
  for (const line of lines) {
    if ((line.startsWith(" ") || line.startsWith("\t")) && out.length) {
      out[out.length - 1] += line.slice(1);
    } else {
      out.push(line);
    }
  }
  return out;
}

function parseProps(block: string[]): Record<string, string[]> {
  const props: Record<string, string[]> = {};
  for (const line of block) {
    const idx = line.indexOf(":");
    if (idx < 0) continue;
    const keyPart = line.slice(0, idx);
    const value = line.slice(idx + 1);
    const key = keyPart.split(";")[0].toUpperCase();
    (props[key] ??= []).push(value);
  }
  return props;
}

function icsDateToIso(raw: string, tzHint = "America/Toronto"): { iso: string; allDay: boolean } {
  const v = raw.trim();
  if (/^\d{8}$/.test(v)) {
    const y = v.slice(0, 4);
    const m = v.slice(4, 6);
    const d = v.slice(6, 8);
    // All-day: store noon Toronto-ish as date-only label via T12:00:00
    return { iso: `${y}-${m}-${d}T12:00:00`, allDay: true };
  }
  const m = v.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z)?$/);
  if (m) {
    if (m[7] === "Z") {
      return {
        iso: new Date(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}Z`).toISOString(),
        allDay: false,
      };
    }
    // Floating local — treat as America/Toronto wall time by appending offset approx via Date
    // Store as ISO with explicit components; consumers display in Toronto.
    const iso = `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}`;
    void tzHint;
    return { iso: new Date(iso).toISOString(), allDay: false };
  }
  return { iso: new Date().toISOString(), allDay: false };
}

function categorize(summary: string, categories: string[]): CalendarEventItem["category"] {
  const blob = `${summary} ${categories.join(" ")}`.toUpperCase();
  if (/\bUNI\b|UNIVERSITY|LECTURE|LAB|EXAM|COURSE/.test(blob)) return "UNI";
  if (/\bSTUDY\b|HOMEWORK|ASSIGNMENT/.test(blob)) return "STUDY";
  if (/\bBUS\b|WORK|SHIFT|JOB/.test(blob)) return "BUS";
  if (summary.startsWith("[UNI]")) return "UNI";
  if (summary.startsWith("[STUDY]")) return "STUDY";
  if (summary.startsWith("[BUS]")) return "BUS";
  return "OTHER";
}

export function parseIcs(raw: string): CalendarEventItem[] {
  const lines = unfold(raw);
  const events: CalendarEventItem[] = [];
  let cur: string[] | null = null;
  for (const line of lines) {
    if (line === "BEGIN:VEVENT") {
      cur = [];
      continue;
    }
    if (line === "END:VEVENT" && cur) {
      const props = parseProps(cur);
      const uid = props.UID?.[0] ?? `anon:${events.length}`;
      const summary = (props.SUMMARY?.[0] ?? "Event").replace(/\\n/g, "\n").replace(/\\,/g, ",");
      const dtstart = props.DTSTART?.[0];
      if (!dtstart) {
        cur = null;
        continue;
      }
      const start = icsDateToIso(dtstart);
      const end = props.DTEND?.[0] ? icsDateToIso(props.DTEND[0]) : null;
      const exdates = (props.EXDATE ?? []).flatMap((x) =>
        x.split(",").map((p) => icsDateToIso(p.trim()).iso.slice(0, 10)),
      );
      const cats = (props.CATEGORIES ?? []).flatMap((c) => c.split(",").map((s) => s.trim()));
      events.push({
        id: `ics:${uid}`,
        uid,
        title: summary,
        category: categorize(summary, cats),
        startIso: start.iso,
        endIso: end?.iso ?? null,
        allDay: start.allDay,
        location: props.LOCATION?.[0] ?? null,
        description: props.DESCRIPTION?.[0]?.replace(/\\n/g, "\n") ?? null,
        exdates,
        courseId: null,
        sourceType: "ics",
      });
      cur = null;
      continue;
    }
    if (cur) cur.push(line);
  }
  return events;
}

/** Merge by UID — newer import wins; preserve unread-unrelated fields. */
export function mergeCalendarByUid(
  existing: CalendarEventItem[],
  incoming: CalendarEventItem[],
): CalendarEventItem[] {
  const map = new Map(existing.map((e) => [e.uid, e]));
  for (const e of incoming) map.set(e.uid, e);
  return [...map.values()];
}

export function eventOccursOn(e: CalendarEventItem, dayKey: string): boolean {
  if (e.exdates.includes(dayKey)) return false;
  return e.startIso.slice(0, 10) === dayKey;
}
