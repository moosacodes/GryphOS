import { describe, expect, it } from "vitest";
import { requiredAverageOnRemaining, summarizeCourseGrades } from "@/engines/grades";
import type { Assessment, Course } from "@/domain/types";

const course: Course = {
  id: "course:1",
  orgUnitId: 1,
  code: "CIS*2520",
  title: "Data Structures",
  semester: "2026 Fall",
  startDate: null,
  endDate: null,
  color: "#C8102E",
  selected: true,
  instructorNames: [],
  url: "",
  outlineDocumentId: null, outlineStatus: "not_checked" as const, outlineStatusDetail: null,
  updatedAt: "",
};

function a(partial: Partial<Assessment> & Pick<Assessment, "id" | "title" | "weightPercent" | "pointsEarned" | "pointsPossible">): Assessment {
  return {
    courseId: course.id,
    type: "assignment",
    due: { certainty: "exact", iso: "2026-10-01T00:00:00.000Z", label: null },
    start: { certainty: "unknown", iso: null, label: null },
    end: { certainty: "unknown", iso: null, label: null },
    submissionState: "submitted",
    submittedAt: null,
    gradeDisplay: null,
    url: null,
    notes: null,
    categoryId: null,
    isBonus: false,
    sourceRecords: [],
    fieldProvenance: {},
    conflictIds: [],
    manualOverrides: {},
    updatedAt: "",
    ...partial,
  };
}

describe("grade engine", () => {
  it("computes weighted standing", () => {
    const items = [
      a({ id: "1", title: "A1", weightPercent: 20, pointsEarned: 18, pointsPossible: 20 }),
      a({ id: "2", title: "A2", weightPercent: 20, pointsEarned: 16, pointsPossible: 20 }),
      a({ id: "3", title: "Final", weightPercent: 60, pointsEarned: null, pointsPossible: 100, type: "final", submissionState: "unknown" }),
    ];
    const s = summarizeCourseGrades(course, items);
    expect(s.completedWeight).toBe(40);
    expect(s.remainingWeight).toBe(60);
    expect(s.calculatedPercent).toBeCloseTo(85, 5);
    const req = requiredAverageOnRemaining(s, 80);
    expect(req).not.toBeNull();
    expect(req!).toBeCloseTo(76.666, 1);
  });
});
