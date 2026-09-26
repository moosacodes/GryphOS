import { describe, expect, it } from "vitest";
import {
  isDeadlineCalendarEvent,
  isScheduleCalendarEvent,
  scheduleFromCalendarEvents,
} from "@/sync/scheduleFromCalendar";
import type { Course } from "@/domain/types";

function course(): Course {
  return {
    id: "c2430",
    orgUnitId: 2430,
    code: "CIS*2430",
    title: "OOP",
    semester: "F26",
    startDate: "2026-09-10",
    endDate: "2026-12-04",
    color: "#C8102E",
    selected: true,
    instructorNames: [],
    url: "https://courselink.uoguelph.ca/d2l/home/2430",
    outlineDocumentId: null,
    outlineStatus: "not_checked",
    outlineStatusDetail: null,
    lectureSection: null,
    labSection: null,
    tutorialSection: null,
    updatedAt: new Date().toISOString(),
  };
}

describe("calendar classify", () => {
  it("separates schedule vs deadline titles", () => {
    expect(isScheduleCalendarEvent("CIS*2430 Lecture")).toBe(true);
    expect(isScheduleCalendarEvent("Lab Section 0101")).toBe(true);
    expect(isDeadlineCalendarEvent("Assignment 1 Due")).toBe(true);
    expect(isDeadlineCalendarEvent("Quiz 2")).toBe(true);
    expect(isScheduleCalendarEvent("Assignment 1 Due")).toBe(false);
  });
});

describe("scheduleFromCalendarEvents", () => {
  it("builds recurring patterns and occurrences from lecture blocks", () => {
    const events = [
      {
        CalendarEventId: 1,
        Title: "CIS*2430 Lecture",
        Description: "RICH 2520",
        StartDateTime: "2026-09-14T18:30:00.000Z", // Mon 2:30pm EDT
        EndDateTime: "2026-09-14T19:20:00.000Z",
      },
      {
        CalendarEventId: 2,
        Title: "CIS*2430 Lecture",
        Description: "RICH 2520",
        StartDateTime: "2026-09-16T18:30:00.000Z",
        EndDateTime: "2026-09-16T19:20:00.000Z",
      },
      {
        CalendarEventId: 3,
        Title: "CIS*2430 Lecture",
        Description: "RICH 2520",
        StartDateTime: "2026-09-18T18:30:00.000Z",
        EndDateTime: "2026-09-18T19:20:00.000Z",
      },
      {
        CalendarEventId: 4,
        Title: "Assignment 2 Due",
        StartDateTime: "2026-09-20T03:59:00.000Z",
        EndDateTime: "2026-09-20T03:59:00.000Z",
      },
    ];
    const bundle = scheduleFromCalendarEvents(course(), events, "2026-09-10", "2026-12-04");
    expect(bundle.calendarItems.length).toBe(3);
    expect(bundle.meetings.length).toBeGreaterThanOrEqual(1);
    expect(bundle.occurrences.length).toBeGreaterThan(3);
    expect(bundle.occurrences.every((o) => o.kind === "lecture")).toBe(true);
  });
});
