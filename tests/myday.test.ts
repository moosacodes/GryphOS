import { describe, expect, it } from "vitest";
import { emptyAppData } from "@/storage/schema";
import { applyMyDayConfirm, buildMyDay } from "@/engines/myday";
import { searchLocal } from "@/engines/search";
import { parseCapture } from "@/engines/capture";
import { changeDiff, collectNotificationCandidates } from "@/engines/notifications";
import type { Assessment, Course } from "@/domain/types";
import { DEFAULT_ITEM_STATE } from "@/domain/types";

function course(partial: Partial<Course> & Pick<Course, "id" | "code">): Course {
  return {
    orgUnitId: 1,
    title: partial.code,
    semester: "F26",
    startDate: "2026-09-10",
    endDate: "2026-12-04",
    color: "#C8102E",
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

describe("My Day", () => {
  it("surfaces tonight deadlines and confirmation CTAs", () => {
    const data = emptyAppData();
    const c = course({ id: "c1", code: "CIS*2430", selected: true });
    data.courses = [c];
    data.preferences.selectedCourseIds = ["c1"];
    const tonight = new Date();
    tonight.setHours(23, 30, 0, 0);
    data.assessments = [
      assessment({
        id: "a1",
        courseId: "c1",
        title: "Lab 2",
        type: "lab",
        due: { certainty: "exact", iso: tonight.toISOString(), label: null },
        weightPercent: 4,
      }),
      assessment({
        id: "a2",
        courseId: "c1",
        title: "Quiz 2",
        due: { certainty: "exact", iso: new Date(Date.now() - 864e5).toISOString(), label: null },
        state: { ...DEFAULT_ITEM_STATE, needsConfirmation: true },
      }),
    ];
    const model = buildMyDay(data, new Date());
    const ids = model.sections.flatMap((s) => s.items.map((i) => i.id));
    expect(ids.some((id) => id.includes("a1"))).toBe(true);
    const needs = model.sections.find((s) => s.id === "needs_answer");
    expect(needs?.items.some((i) => i.title === "Quiz 2")).toBe(true);
  });

  it("stops nagging submitted work", () => {
    const data = emptyAppData();
    data.courses = [course({ id: "c1", code: "CIS*2520", selected: true })];
    data.preferences.selectedCourseIds = ["c1"];
    data.assessments = [
      assessment({
        id: "a1",
        courseId: "c1",
        title: "A1",
        submissionState: "submitted",
        submittedAt: new Date().toISOString(),
      }),
    ];
    const model = buildMyDay(data);
    const actionable = model.sections
      .filter((s) => s.id !== "history")
      .flatMap((s) => s.items)
      .filter((i) => i.title === "A1");
    expect(actionable.length).toBe(0);
  });

  it("applyMyDayConfirm marks missed without inventing grade", () => {
    const data = emptyAppData();
    data.assessments = [assessment({ id: "a1", courseId: "c1", title: "Q" })];
    const next = applyMyDayConfirm(data, "a1", "missed");
    expect(next.assessments[0].state.missed).toBe(true);
    expect(next.assessments[0].pointsEarned).toBeNull();
  });
});

describe("search + capture + notifications", () => {
  it("searches locally", () => {
    const data = emptyAppData();
    data.courses = [course({ id: "c1", code: "CIS*2030", title: "Structure and Application of Microcomputers" })];
    data.assessments = [assessment({ id: "a1", courseId: "c1", title: "Midterm Room RICH 2520", type: "midterm" })];
    const hits = searchLocal(data, "midterm rich");
    expect(hits.some((h) => h.kind === "assessment")).toBe(true);
  });

  it("parses quick capture", () => {
    const data = emptyAppData();
    data.courses = [course({ id: "c1", code: "CIS*2430" })];
    const task = parseCapture("2430 finish A2 testing tomorrow", data);
    expect(task.courseId).toBe("c1");
    expect(task.dueIso).toBeTruthy();
    expect(task.title.toLowerCase()).toContain("a2");
  });

  it("builds deadline change diffs", () => {
    const diff = changeDiff({
      id: "1",
      courseId: "c1",
      entityId: "a1",
      kind: "deadline_changed",
      title: "Deadline changed",
      detail: "old → new",
      createdAt: new Date().toISOString(),
      read: false,
      evidenceIds: [],
      beforeValue: "2026-10-01",
      afterValue: "2026-10-08",
    });
    expect(diff?.before).toBe("2026-10-01");
    expect(diff?.after).toBe("2026-10-08");
  });

  it("collects useful notification candidates only", () => {
    const data = emptyAppData();
    data.courses = [course({ id: "c1", code: "CIS*2430", selected: true })];
    data.preferences.selectedCourseIds = ["c1"];
    const due = new Date(Date.now() + 20 * 3600_000).toISOString();
    data.assessments = [
      assessment({
        id: "a1",
        courseId: "c1",
        title: "Lab due tomorrow-ish",
        due: { certainty: "exact", iso: due, label: null },
      }),
    ];
    const notes = collectNotificationCandidates(data);
    expect(notes.some((n) => n.kind === "due_tomorrow")).toBe(true);
  });
});
