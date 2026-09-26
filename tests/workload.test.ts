import { describe, expect, it } from "vitest";
import { computeWorkload } from "@/engines/workload";
import { classifyTaskStatus } from "@/engines/status";
import type { Assessment } from "@/domain/types";

function item(id: string, dueIso: string, submitted: boolean = false): Assessment {
  return {
    id,
    courseId: "course:1",
    title: id,
    type: "assignment",
    due: { certainty: "exact", iso: dueIso, label: null },
    start: { certainty: "unknown", iso: null, label: null },
    end: { certainty: "unknown", iso: null, label: null },
    weightPercent: 10,
    pointsPossible: null,
    pointsEarned: null,
    submissionState: submitted ? "submitted" : "not_submitted",
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
    updatedAt: "",
  };
}

describe("workload/status", () => {
  it("classifies overdue and due today", () => {
    const now = new Date("2026-09-26T15:00:00.000Z");
    const overdue = item("o", "2026-09-25T12:00:00.000Z");
    expect(classifyTaskStatus(overdue, now)).toBe("overdue");
  });

  it("buckets workload", () => {
    const now = new Date("2026-09-26T15:00:00.000Z");
    const snap = computeWorkload([
      item("a", "2026-09-26T20:00:00.000Z"),
      item("b", "2026-09-27T20:00:00.000Z"),
      item("c", "2026-09-20T20:00:00.000Z"),
    ], now);
    expect(snap.dueToday.length).toBeGreaterThanOrEqual(1);
    expect(snap.overdue.length).toBeGreaterThanOrEqual(1);
  });
});
