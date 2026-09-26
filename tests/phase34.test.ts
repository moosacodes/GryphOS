import { describe, expect, it } from "vitest";
import { applyGradeRules } from "@/engines/rules";
import { summarizeCourseGrades } from "@/engines/grades";
import { parseIcs, mergeCalendarByUid } from "@/engines/icsImport";
import { DEFAULT_ITEM_STATE, type Assessment, type Course } from "@/domain/types";
import type { AcademicRule } from "@/domain/rules";
import { applyPersonalization } from "@/adapters/uofg/personalization";
import { fixture2430, fixture2030, fixture2520 } from "./fixtures/fall2026";

function course(partial: Partial<Course> & { id: string; code: string }): Course {
  return {
    orgUnitId: 1,
    title: partial.code,
    semester: "F26",
    startDate: "2026-09-08T00:00:00.000Z",
    endDate: null,
    color: "#000",
    selected: true,
    instructorNames: [],
    url: "",
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

function assessment(partial: Partial<Assessment> & { id: string; courseId: string; title: string }): Assessment {
  return {
    type: "quiz",
    due: { certainty: "unknown", iso: null, label: null },
    start: { certainty: "unknown", iso: null, label: null },
    end: { certainty: "unknown", iso: null, label: null },
    weightPercent: 2,
    pointsPossible: 10,
    pointsEarned: null,
    submissionState: "unknown",
    submittedAt: null,
    gradeDisplay: null,
    url: null,
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

describe("Fall 2026 fixtures (tests only)", () => {
  it("has corrected schedules for 2430/2030/2520", () => {
    const a = fixture2430();
    expect(a.meetings.find((m) => m.kind === "lab")?.startTime).toBe("14:30");
    expect(a.meetings.find((m) => m.kind === "lecture")?.location).toBe("RICH 2520");
    const b = fixture2030();
    expect(b.meetings.find((m) => m.kind === "lecture")?.startTime).toBe("08:30");
    expect(b.meetings.find((m) => m.kind === "lab")?.startTime).toBe("17:30");
    const c = fixture2520();
    expect(c.meetings.find((m) => m.kind === "lecture")?.startTime).toBe("15:30");
    expect(c.meetings.find((m) => m.kind === "lab")?.location).toBe("MCKN 311");
  });
});

describe("CIS*2520-like Zybook best 5/6", () => {
  it("drops lowest beyond best 5 when complete", () => {
    const fx = fixture2520();
    const items = fx.assessments.filter((a) => a.title.startsWith("Zybook"));
    const effect = applyGradeRules(items, [], fx.rules);
    expect(effect.droppedIds.size).toBe(1);
    expect(effect.droppedIds.has("a:2520:zy6")).toBe(true);
  });
});

describe("missed vs zero + completion", () => {
  it("missed quiz is not treated as zero", () => {
    const c = course({ id: "course:2030", code: "CIS*2030" });
    const quizzes = Array.from({ length: 11 }, (_, i) =>
      assessment({
        id: `q${i}`,
        courseId: c.id,
        title: `Quiz ${i + 1}`,
        type: "quiz",
        pointsEarned: i === 1 ? null : 8,
        pointsPossible: 10,
        weightPercent: 1,
        state: { ...DEFAULT_ITEM_STATE, missed: i === 1 },
      }),
    );
    const rules: AcademicRule[] = [
      {
        id: "best",
        courseId: c.id,
        kind: "BestN",
        label: "best 10 of 11",
        n: 10,
        of: 11,
        applyToTypes: ["quiz"],
        category: null,
        sourceType: "course_outline",
        confidence: 0.9,
      },
    ];
    const summary = summarizeCourseGrades(c, quizzes, [], rules);
    expect(summary.missedCount).toBe(1);
    expect(summary.rows.find((r) => r.assessment.id === "q1")?.percent).toBeNull();
  });

  it("completed-not-submitted stays distinct from submitted", () => {
    const a = assessment({
      id: "a1",
      courseId: "c",
      title: "A1",
      submissionState: "not_submitted",
      state: {
        ...DEFAULT_ITEM_STATE,
        work: "completed",
        userCompleted: "confirmed",
        submission: "not_submitted",
      },
    });
    expect(a.state.work).toBe("completed");
    expect(a.submissionState).toBe("not_submitted");
    expect(a.state.missed).toBe(false);
  });
});

describe("ICS import", () => {
  it("parses UID, categories, EXDATE and dedupes", () => {
    const raw = [
      "BEGIN:VCALENDAR",
      "BEGIN:VEVENT",
      "UID:abc-123",
      "DTSTART:20260926T143000",
      "SUMMARY:[UNI] Lecture",
      "CATEGORIES:UNI",
      "EXDATE:20261003",
      "END:VEVENT",
      "END:VCALENDAR",
    ].join("\r\n");
    const ev = parseIcs(raw);
    expect(ev).toHaveLength(1);
    expect(ev[0].uid).toBe("abc-123");
    expect(ev[0].category).toBe("UNI");
    expect(ev[0].exdates).toContain("2026-10-03");
    const merged = mergeCalendarByUid(ev, [{ ...ev[0], title: "Lecture updated" }]);
    expect(merged).toHaveLength(1);
    expect(merged[0].title).toBe("Lecture updated");
  });
});

describe("runtime personalization does not inject fixtures", () => {
  it("applyPersonalization is identity", () => {
    const courses = [course({ id: "course:0", code: "CIS*2430" })];
    const out = applyPersonalization(courses, [], [], []);
    expect(out.meetings).toHaveLength(0);
    expect(out.courses[0].lectureSection).toBeNull();
  });
});
