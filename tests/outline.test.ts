import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { parseOutlineText, parseDateLabel, inferAssessmentType } from "@/adapters/outline/parse";
import { matchScore, MATCH_THRESHOLD } from "@/reconcile/match";
import type { Assessment } from "@/domain/types";
import { scoreOutlineCandidate } from "@/adapters/courselink/discoverOutlines";

const root = dirname(fileURLToPath(import.meta.url));
const fx = (name: string) => readFileSync(join(root, "../fixtures", name), "utf8");

function bareAssessment(title: string, courseId = "course:1"): Assessment {
  return {
    id: title,
    courseId,
    title,
    type: inferAssessmentType(title),
    due: { certainty: "unknown", iso: null, label: null },
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
    isBonus: false,
    sourceRecords: [],
    fieldProvenance: {},
    conflictIds: [],
    manualOverrides: {},
    updatedAt: new Date().toISOString(),
  };
}

describe("outline parser", () => {
  it("extracts code, weights, instructor from sample", () => {
    const r = parseOutlineText(fx("outline-sample.txt"));
    expect(r.courseCode).toBe("CIS*2520");
    expect(r.instructors[0]?.name).toMatch(/Jane/);
    expect(r.assessments.length).toBeGreaterThanOrEqual(4);
    const weights = r.assessments.map((a) => a.weightPercent).filter((w): w is number => w != null);
    expect(weights.reduce((s, w) => s + w, 0)).toBe(100);
    expect(r.confidence).toBeGreaterThan(0.5);
    expect(r.diagnostics.length).toBeGreaterThan(0);
  });

  it("does not invent exact dates for week labels", () => {
    const r = parseOutlineText("Evaluation\nProject 20% due Week 6\n");
    const project = r.assessments.find((a) => /project/i.test(a.title));
    expect(project).toBeTruthy();
    expect(project!.certainty).toBe("approximate");
    expect(project!.dueIso).toBeNull();
  });

  it("parses messy table with TAs, best-N, weeks, footer", () => {
    const r = parseOutlineText(fx("outline-messy-table.txt"));
    expect(r.courseCode).toBe("CIS*2520");
    expect(r.tas.length).toBeGreaterThanOrEqual(2);
    expect(r.assessments.length).toBeGreaterThanOrEqual(6);
    const mid = r.assessments.find((a) => a.type === "midterm");
    expect(mid?.weightPercent).toBe(20);
    expect(mid?.dueIso).toBeTruthy();
    const fin = r.assessments.find((a) => a.type === "final");
    expect(fin).toBeTruthy();
    expect(fin!.certainty).toBe("approximate");
    expect(fin!.dueIso).toBeNull();
    const a1 = r.assessments.find((a) => /assignment\s*1/i.test(a.title));
    expect(a1?.dueLabel).toMatch(/Week 3/i);
    expect(a1?.certainty).toBe("approximate");
    expect(a1?.sourceSnippet).toBeTruthy();
    expect(r.gradingRules.some((g) => g.kind === "best_n" || g.kind === "drop_lowest")).toBe(true);
    const sum = r.assessments.reduce((s, a) => s + (a.weightPercent ?? 0), 0);
    expect(sum).toBe(100);
  });

  it("handles wrapped weight on next line and header without % on every row", () => {
    const r = parseOutlineText(fx("outline-wrapped-weights.txt"));
    expect(r.assessments.length).toBeGreaterThanOrEqual(4);
    expect(r.assessments.some((a) => a.type === "midterm")).toBe(true);
    expect(r.assessments.some((a) => a.type === "final")).toBe(true);
    expect(r.gradingRules.some((g) => g.kind === "drop_lowest")).toBe(true);
  });

  it("parses pipe table with categories / best-N labs", () => {
    const r = parseOutlineText(fx("outline-categories.txt"));
    expect(r.courseCode).toBe("STAT*2040");
    const labs = r.assessments.find((a) => /lab/i.test(a.title));
    expect(labs?.weightPercent).toBe(15);
    expect(r.categories.length + r.gradingRules.length).toBeGreaterThan(0);
  });
});

describe("parseDateLabel", () => {
  it("marks week as approximate without iso", () => {
    const d = parseDateLabel("Week 6", 2026);
    expect(d.certainty).toBe("approximate");
    expect(d.iso).toBeNull();
  });
});

describe("title reconciliation variants", () => {
  it("matches Assignment 1 / A1 / Assignment #1", () => {
    const a = bareAssessment("Assignment 1");
    const b = bareAssessment("A1");
    const c = bareAssessment("Assignment #1");
    expect(matchScore(a, b)).toBeGreaterThanOrEqual(MATCH_THRESHOLD);
    expect(matchScore(a, c)).toBeGreaterThanOrEqual(MATCH_THRESHOLD);
  });
});

describe("discovery scoring course-code filenames", () => {
  it("scores CIS2520-F26.pdf highly", () => {
    expect(scoreOutlineCandidate("CIS2520-F26.pdf", "CIS2520-F26.pdf")).toBeGreaterThanOrEqual(30);
    expect(
      scoreOutlineCandidate("CIS*2520 Outline", "CIS2520_F26_CourseOutline.pdf", "Start Here"),
    ).toBeGreaterThan(scoreOutlineCandidate("Lecture 3", "lec3.pdf"));
  });
});