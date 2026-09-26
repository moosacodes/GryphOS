import { describe, expect, it } from "vitest";
import { scoreOutlineCandidate } from "@/adapters/courselink/discoverOutlines";

describe("outline discovery scoring", () => {
  it("scores syllabus/outline titles highly", () => {
    expect(scoreOutlineCandidate("Course Outline Fall 2026", "outline.pdf")).toBeGreaterThanOrEqual(50);
    expect(scoreOutlineCandidate("Syllabus", "CIS2520_Syllabus.pdf")).toBeGreaterThan(
      scoreOutlineCandidate("Lecture 3 slides", "lecture3.pdf"),
    );
  });

  it("penalizes lectures and assignments", () => {
    expect(scoreOutlineCandidate("Assignment 2", "a2.pdf")).toBeLessThan(40);
  });
});
