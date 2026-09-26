import { formatInTimeZone, toZonedTime } from "date-fns-tz";
import { format, isValid, parseISO, startOfDay } from "date-fns";
import { UOFG_TIMEZONE } from "./constants";
import type { AcademicDateValue, DateCertainty } from "./types";

/** Parse Brightspace/ISO timestamps without shifting calendar days incorrectly. */
export function parseCourseLinkDate(raw: string | null | undefined): Date | null {
  if (!raw) return null;
  const d = parseISO(raw);
  if (!isValid(d)) return null;
  return d;
}

export function toIso(d: Date | null): string | null {
  return d ? d.toISOString() : null;
}

export function exactDate(iso: string | null): AcademicDateValue {
  if (!iso) return { certainty: "unknown", iso: null, label: null };
  return { certainty: "exact", iso, label: null };
}

export function approximateDate(label: string, iso: string | null = null): AcademicDateValue {
  return { certainty: "approximate", iso, label };
}

export function unknownDate(): AcademicDateValue {
  return { certainty: "unknown", iso: null, label: null };
}

export function conflictingDate(iso: string | null, label: string | null = null): AcademicDateValue {
  return { certainty: "conflicting", iso, label };
}

export function formatInToronto(iso: string, pattern = "yyyy-MM-dd HH:mm"): string {
  return formatInTimeZone(new Date(iso), UOFG_TIMEZONE, pattern);
}

export function torontoDayKey(iso: string): string {
  return formatInTimeZone(new Date(iso), UOFG_TIMEZONE, "yyyy-MM-dd");
}

export function localDayKey(d: Date): string {
  return format(d, "yyyy-MM-dd");
}

export function startOfLocalDay(d: Date): Date {
  return startOfDay(d);
}

export function asTorontoZoned(d: Date): Date {
  return toZonedTime(d, UOFG_TIMEZONE);
}

export function dateCertaintyRank(c: DateCertainty): number {
  switch (c) {
    case "exact": return 4;
    case "approximate": return 2;
    case "conflicting": return 1;
    case "unknown": return 0;
  }
}
