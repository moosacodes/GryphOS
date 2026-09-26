import type { AcademicDate } from "@/domain/types";
import { approximateDate, exactDate } from "@/domain/dates";

/**
 * Built-in University of Guelph academic date seeds for nearby terms.
 * These are static reference dates — update when UofG publishes new calendars.
 * Live scraping is intentionally not required for core operation.
 */
export function seedAcademicDates(termHint?: string | null): AcademicDate[] {
  const year = termHint?.match(/(\d{4})/)?.[1] ?? String(new Date().getFullYear());
  const y = Number(year);
  const hint = (termHint ?? "").toLowerCase();
  const includeFall = !termHint || hint.includes("fall") || /\bf\d/.test(hint) || hint.includes("f2");

  const dates: AcademicDate[] = [];

  if (includeFall) {
    dates.push(
      {
        id: `uofg:${y}:fall-start`,
        title: "Fall classes begin",
        start: exactDate(new Date(Date.UTC(y, 8, 4, 12, 0, 0)).toISOString()),
        end: exactDate(new Date(Date.UTC(y, 8, 4, 12, 0, 0)).toISOString()),
        kind: "semester",
        term: `${y} Fall`,
      },
      {
        id: `uofg:${y}:fall-reading`,
        title: "Fall reading week",
        start: approximateDate("Reading week", new Date(Date.UTC(y, 9, 13, 12, 0, 0)).toISOString()),
        end: approximateDate("Reading week", new Date(Date.UTC(y, 9, 17, 12, 0, 0)).toISOString()),
        kind: "reading_week",
        term: `${y} Fall`,
      },
      {
        id: `uofg:${y}:fall-exam`,
        title: "Fall exam period",
        start: approximateDate("Exam period", new Date(Date.UTC(y, 11, 5, 12, 0, 0)).toISOString()),
        end: approximateDate("Exam period", new Date(Date.UTC(y, 11, 16, 12, 0, 0)).toISOString()),
        kind: "exam_period",
        term: `${y} Fall`,
      },
    );
  }

  dates.push({
    id: `uofg:${y}:note`,
    title: "Verify dates on the UofG Academic Calendar",
    start: approximateDate("See calendar"),
    end: approximateDate("See calendar"),
    kind: "other",
    term: null,
  });

  return dates;
}
