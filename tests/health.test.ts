import { describe, expect, it } from "vitest";
import { computeCourseHealth } from "@/engines/health";
import type { Assessment, Course } from "@/domain/types";

describe("data health", () => {
  it("flags missing outline and weights", () => {
    const course: Course = {
      id: "course:1", orgUnitId: 1, code: "CIS*2520", title: "DS", semester: null,
      startDate: null, endDate: null, color: "#000", selected: true, instructorNames: [],
      url: "", outlineDocumentId: null, outlineStatus: "not_checked" as const, outlineStatusDetail: null, lectureSection: null, labSection: null, tutorialSection: null, updatedAt: "",
    };
    const assessments: Assessment[] = [{
      id: "a", courseId: course.id, title: "A1", type: "assignment",
      due: { certainty: "unknown", iso: null, label: null },
      start: { certainty: "unknown", iso: null, label: null },
      end: { certainty: "unknown", iso: null, label: null },
      weightPercent: null, pointsPossible: null, pointsEarned: null,
      submissionState: "unknown", submittedAt: null, gradeDisplay: null, url: null, notes: null,
      categoryId: null, isBonus: false, attemptNumber: null, state: { availability: "unknown", work: "unknown", submission: "unknown", grading: "unknown", pastDueConfirmed: false, userCompleted: "unknown", dropped: false, missed: false, needsConfirmation: false }, sourceRecords: [], fieldProvenance: {}, conflictIds: [],
      manualOverrides: {}, updatedAt: "",
    }];
    const h = computeCourseHealth(course, assessments, [], [], [], []);
    expect(h.checks.some((c) => c.id === "outline" && !c.ok)).toBe(true);
    expect(h.status === "missing_information" || h.status === "needs_attention").toBe(true);
  });
});
