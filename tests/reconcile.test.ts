import { describe, expect, it } from "vitest";
import { reconcileAssessments } from "@/reconcile/merge";
import { matchScore } from "@/reconcile/match";
import type { Assessment } from "@/domain/types";
import conflicting from "../fixtures/conflicting-sources.json";

function base(partial: Partial<Assessment> & Pick<Assessment, "id" | "title">): Assessment {
  return {
    courseId: "course:1001",
    type: "midterm",
    due: { certainty: "exact", iso: "2026-10-20T23:59:00.000Z", label: null },
    start: { certainty: "unknown", iso: null, label: null },
    end: { certainty: "unknown", iso: null, label: null },
    weightPercent: null,
    pointsPossible: null,
    pointsEarned: null,
    submissionState: "unknown",
    submittedAt: null,
    gradeDisplay: null,
    url: null,
    notes: null,
    categoryId: null,
    isBonus: false, attemptNumber: null, state: { availability: "unknown", work: "unknown", submission: "unknown", grading: "unknown", pastDueConfirmed: false, userCompleted: "unknown", dropped: false, missed: false, needsConfirmation: false },
    sourceRecords: [],
    fieldProvenance: {},
    conflictIds: [],
    manualOverrides: {},
    updatedAt: new Date().toISOString(),
    ...partial,
  };
}

describe("reconcile", () => {
  it("matches similar titles in the same course", () => {
    const a = base({ id: "a1", title: "Midterm", due: { certainty: "exact", iso: conflicting.outlineDue, label: null }, weightPercent: 25, fieldProvenance: { due: { value: conflicting.outlineDue, sourceType: "course_outline", sourceId: "o", confidence: 0.8, retrievedAt: "" }, weightPercent: { value: 25, sourceType: "course_outline", sourceId: "o", confidence: 0.9, retrievedAt: "" } } });
    const b = base({ id: "a2", title: "Midterm", due: { certainty: "exact", iso: conflicting.courselinkDue, label: null }, fieldProvenance: { due: { value: conflicting.courselinkDue, sourceType: "courselink_quiz", sourceId: "q", confidence: 0.95, retrievedAt: "" } } });
    expect(matchScore(a, b)).toBeGreaterThan(0.7);
    const { assessments, conflicts } = reconcileAssessments([a, b]);
    expect(assessments).toHaveLength(1);
    expect(assessments[0].weightPercent).toBe(25);
    expect(conflicts.some((c) => c.field === "due")).toBe(true);
    expect(assessments[0].due.certainty).toBe("conflicting");
  });

  it("does not merge unrelated items", () => {
    const a = base({ id: "a1", title: "Assignment 1", type: "assignment" });
    const b = base({ id: "a2", title: "Final Exam", type: "final" });
    expect(matchScore(a, b)).toBeLessThan(0.72);
    expect(reconcileAssessments([a, b]).assessments).toHaveLength(2);
  });
});
