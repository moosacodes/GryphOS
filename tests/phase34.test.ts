import { describe, expect, it } from "vitest";
import { applyGradeRules, applyRelativeDeadlines } from "@/engines/rules";
import { summarizeCourseGrades } from "@/engines/grades";
import { parseIcs, mergeCalendarByUid } from "@/engines/icsImport";
import { DEFAULT_ITEM_STATE, type Assessment, type Course, type Meeting, type AcademicRule } from "@/domain/types";
import { applyPersonalization, PERSONALIZATION_FIXTURES } from "@/adapters/uofg/personalization";

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

describe("CIS*2430-like relative deadline (+8 days after Tue lab)", () => {
  it("derives approximate lab due from Tuesday lab meeting", () => {
    const c = course({ id: "course:2430", code: "CIS*2430" });
    const meetings: Meeting[] = [
      {
        id: "m1",
        courseId: c.id,
        kind: "lab",
        dayOfWeek: 2,
        startTime: "14:30",
        endTime: "16:20",
        location: "SSC 1303",
        notes: null,
        sectionCode: "0101",
      },
    ];
    const rules: AcademicRule[] = [
      {
        id: "r1",
        courseId: c.id,
        kind: "relative_deadline",
        label: "Lab +8d",
        params: { fromMeetingKind: "lab", dayOfWeek: 2, offsetDays: 8, applyToTypes: ["lab"] },
        sourceType: "manual",
        confidence: 0.9,
      },
    ];
    const labs = [
      assessment({ id: "lab1", courseId: c.id, title: "Lab 1", type: "lab", weightPercent: 5 }),
    ];
    const out = applyRelativeDeadlines(labs, meetings, rules, c.startDate);
    expect(out[0].due.certainty).toBe("approximate");
    expect(out[0].due.iso).toBeTruthy();
    expect(out[0].fieldProvenance.due?.sourceType).toBe("rule_engine");
  });
});

describe("CIS*2520-like Zybook best 5/6", () => {
  it("drops lowest beyond best 5", () => {
    const c = course({ id: "course:2520", code: "CIS*2520" });
    const items = [9, 8, 7, 6, 5, 4].map((p, i) =>
      assessment({
        id: `z${i}`,
        courseId: c.id,
        title: `Zybook ${i + 1}`,
        type: "assignment",
        pointsEarned: p,
        pointsPossible: 10,
        weightPercent: 2,
      }),
    );
    const rules: AcademicRule[] = [
      {
        id: "r",
        courseId: c.id,
        kind: "best_n",
        label: "best 5 of 6",
        params: { n: 5, of: 6, applyToTypes: ["assignment"] },
        sourceType: "course_outline",
        confidence: 0.9,
      },
    ];
    const effect = applyGradeRules(items, [], rules);
    expect(effect.droppedIds.size).toBe(1);
    expect(effect.droppedIds.has("z5")).toBe(true);
  });
});

describe("CIS*2030-like best 10 of 11 + missed quiz + threshold", () => {
  it("missed quiz is not treated as zero; best-10 still works", () => {
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
        state: {
          ...DEFAULT_ITEM_STATE,
          missed: i === 1,
        },
      }),
    );
    const rules: AcademicRule[] = [
      {
        id: "best",
        courseId: c.id,
        kind: "best_n",
        label: "best 10 of 11",
        params: { n: 10, applyToTypes: ["quiz"] },
        sourceType: "course_outline",
        confidence: 0.9,
      },
      {
        id: "cap",
        courseId: c.id,
        kind: "threshold",
        label: "exam threshold",
        params: { applyToTypes: ["final"], thresholdPercent: 50, capPercent: 45 },
        sourceType: "course_outline",
        confidence: 0.8,
      },
    ];
    const final = assessment({
      id: "final",
      courseId: c.id,
      title: "Final Exam",
      type: "final",
      pointsEarned: 40,
      pointsPossible: 100,
      weightPercent: 40,
    });
    const effect = applyGradeRules([...quizzes, final], [], rules);
    expect(effect.droppedIds.has("q1")).toBe(false); // missed not in scored pool
    expect(effect.cappedCoursePercent).toBe(45);

    const summary = summarizeCourseGrades(c, [...quizzes, final], [], rules);
    expect(summary.missedCount).toBe(1);
    expect(summary.rows.find((r) => r.assessment.id === "q1")?.missed).toBe(true);
    expect(summary.rows.find((r) => r.assessment.id === "q1")?.percent).toBeNull();
    expect(summary.cappedPercent).toBe(45);
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

describe("personalization fixtures", () => {
  it("applies Fei Song / Randhawa / Yan Yan section schedules", () => {
    const courses = PERSONALIZATION_FIXTURES.map((f, i) =>
      course({ id: `course:${i}`, code: f.courseCode }),
    );
    const out = applyPersonalization(courses, [], [], []);
    expect(out.courses.find((c) => c.code === "CIS*2430")?.lectureSection).toBe("0101");
    expect(out.courses.find((c) => c.code === "CIS*2030")?.labSection).toBe("0105");
    expect(out.meetings.some((m) => m.location === "SSC 1303")).toBe(true);
    expect(out.meetings.some((m) => m.location === "MCKN 311")).toBe(true);
    expect(out.people.some((p) => p.name === "Fei Song")).toBe(true);
    expect(out.rules.some((r) => r.kind === "relative_deadline")).toBe(true);
  });
});
