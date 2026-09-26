import { describe, expect, it } from "vitest";
import { buildCinematicBrief } from "@/engines/brief";
import { emptyAppData } from "@/storage/schema";
import type { Assessment, Course, MeetingOccurrence } from "@/domain/types";
import { DEFAULT_ITEM_STATE } from "@/domain/types";

function course(partial: Partial<Course> & Pick<Course, "id" | "code">): Course {
  return {
    orgUnitId: 1,
    title: partial.code,
    semester: "F26",
    startDate: "2026-09-10",
    endDate: "2026-12-04",
    color: "#5eead4",
    selected: true,
    instructorNames: [],
    url: "https://courselink.uoguelph.ca/d2l/home/1",
    outlineDocumentId: null,
    outlineStatus: "not_checked",
    outlineStatusDetail: null,
    lectureSection: null,
    labSection: null,
    tutorialSection: null,
    updatedAt: new Date().toISOString(),
    ...partial,
  };
}

function assessment(partial: Partial<Assessment> & Pick<Assessment, "id" | "courseId" | "title">): Assessment {
  return {
    type: "quiz",
    due: { certainty: "exact", iso: new Date(Date.now() + 3600_000).toISOString(), label: null },
    start: { certainty: "unknown", iso: null, label: null },
    end: { certainty: "unknown", iso: null, label: null },
    weightPercent: 1,
    pointsPossible: 10,
    pointsEarned: null,
    submissionState: "not_submitted",
    submittedAt: null,
    gradeDisplay: null,
    url: "https://courselink.uoguelph.ca/d2l/lms/quizzing",
    notes: null,
    categoryId: null,
    isBonus: false,
    attemptNumber: null,
    state: { ...DEFAULT_ITEM_STATE },
    sourceRecords: [],
    fieldProvenance: {},
    conflictIds: [],
    manualOverrides: {},
    updatedAt: new Date().toISOString(),
    ...partial,
  };
}

describe("cinematic brief", () => {
  it("greets by first name when board is clear", () => {
    const data = emptyAppData();
    data.courses = [course({ id: "c1", code: "CIS*2430" })];
    data.preferences.selectedCourseIds = ["c1"];
    data.user = { name: "Moosa Alam", id: "u1" };
    data.sync.lastSyncedAt = Date.now();
    const brief = buildCinematicBrief(data, new Date("2026-09-30T15:00:00-04:00"));
    expect(brief.greeting).toContain("Moosa");
    expect(brief.headline.toLowerCase()).toMatch(/clear|standing|board/);
    expect(brief.tone).toBe("clear");
    expect(brief.pulse.courses).toBe(1);
  });

  it("goes idle when never synced", () => {
    const data = emptyAppData();
    data.user = { name: "Moosa Alam", id: "u1" };
    const brief = buildCinematicBrief(data, new Date("2026-09-30T10:00:00-04:00"));
    expect(brief.tone).toBe("idle");
    expect(brief.headline).toMatch(/Standing/);
    expect(brief.systemNote).toBeTruthy();
  });

  it("includes beats for upcoming class and tonight deadline", () => {
    const data = emptyAppData();
    data.courses = [course({ id: "c1", code: "CIS*2430" })];
    data.preferences.selectedCourseIds = ["c1"];
    data.user = { name: "Moosa Alam", id: "u1" };
    data.sync.lastSyncedAt = Date.now();
    const now = new Date("2026-09-30T14:00:00-04:00");
    const occ: MeetingOccurrence = {
      id: "occ1",
      patternId: "p1",
      courseId: "c1",
      kind: "lecture",
      sectionCode: null,
      date: "2026-09-30",
      startIso: "2026-09-30T18:30:00.000Z", // 14:30 ET
      endIso: "2026-09-30T19:20:00.000Z",
      location: "RICH 2520",
      cancelled: false,
      rescheduledToId: null,
      indexInPattern: 0,
    };
    data.meetingOccurrences = [occ];
    data.assessments = [
      assessment({
        id: "a1",
        courseId: "c1",
        title: "Lab 2",
        type: "lab",
        due: { certainty: "exact", iso: "2026-10-01T03:59:00.000Z", label: null },
        weightPercent: 4,
      }),
    ];
    const brief = buildCinematicBrief(data, now);
    expect(brief.beats.length).toBeGreaterThan(0);
    expect(brief.greeting).toMatch(/afternoon|morning|evening|Still/i);
  });
});
