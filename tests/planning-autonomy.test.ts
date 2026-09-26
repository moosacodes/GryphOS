import { describe, expect, it } from "vitest";
import { buildCinematicBrief } from "@/engines/brief";
import { buildCommandCentreFromData } from "@/engines/priority";
import {
  buildAutonomousRecoveryPlan,
  buildPlanningAutonomy,
  detectStaleModelGaps,
  evaluatePlanningGate,
  explainAssessment,
  explainIgnoreImpact,
  scoreAssessmentPriority,
  shouldReplanFromChanges,
} from "@/engines/planningKnowledge";
import { emptyAppData } from "@/storage/schema";
import type { Assessment, Course, MeetingOccurrence } from "@/domain/types";
import { DEFAULT_ITEM_STATE } from "@/domain/types";
import type { CourseBlueprint } from "@/documentIntelligence/types";
import { ensureTypedRule } from "@/domain/rules";

const now = new Date("2026-10-01T16:00:00.000Z");

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
    outlineDocumentId: "doc1",
    outlineStatus: "parsed",
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
    due: { certainty: "exact", iso: new Date(now.getTime() + 3600_000).toISOString(), label: null },
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

function richBlueprint(courseId: string): CourseBlueprint {
  return {
    id: `bp:${courseId}`,
    courseId,
    documentId: "doc1",
    courseCode: "TEST*1000",
    courseTitle: "Test Course",
    term: "F26",
    offeredSectionHint: null,
    studentSectionNeeded: false,
    people: [],
    categories: [
      {
        name: "Quizzes",
        weightPercent: 10,
        promisedCount: 11,
        bestN: 10,
        dropLowest: 0,
        instanceWeight: 1,
        citation: null,
      },
      {
        name: "Labs",
        weightPercent: 20,
        promisedCount: 5,
        bestN: null,
        dropLowest: 0,
        instanceWeight: 4,
        citation: null,
      },
      {
        name: "Assignments",
        weightPercent: 25,
        promisedCount: 2,
        bestN: null,
        dropLowest: 0,
        instanceWeight: 12.5,
        citation: null,
      },
    ],
    instances: [
      {
        title: "Quiz 3",
        type: "quiz",
        weightPercent: 1,
        index: 3,
        categoryName: "Quizzes",
        due: { kind: "exact", iso: null, endIso: null, label: null, weekNumber: null, relativeRuleId: null },
        certainty: "unknown",
        confidence: 0.8,
        citation: null,
        sourceSnippet: null,
      },
      {
        title: "Assignment 1",
        type: "assignment",
        weightPercent: 12.5,
        index: 1,
        categoryName: "Assignments",
        due: { kind: "exact", iso: null, endIso: null, label: null, weekNumber: null, relativeRuleId: null },
        certainty: "unknown",
        confidence: 0.9,
        citation: null,
        sourceSnippet: "Assignment 1 is worth 12.5% and due Week 5",
      },
      {
        title: "Lab 2",
        type: "lab",
        weightPercent: 4,
        index: 2,
        categoryName: "Labs",
        due: {
          kind: "relative",
          iso: null,
          endIso: null,
          label: "+8d from lab",
          weekNumber: null,
          relativeRuleId: "rule:rel:lab",
        },
        certainty: "approximate",
        confidence: 0.85,
        citation: null,
        sourceSnippet: null,
      },
    ],
    relativeDeadlines: [],
    scheduleEntities: [],
    officeHours: [],
    policies: [],
    textbooks: [],
    quality: {
      score: 0.9,
      incomplete: false,
      missingCategories: [],
      checks: [],
      contradictions: [],
      secondPassApplied: false,
    },
    outlineParse: {
      assessments: [],
      gradeCategories: [],
      policies: [],
      instructors: [],
      meetings: [],
      notes: [],
      warnings: [],
      confidence: 0.9,
    } as unknown as CourseBlueprint["outlineParse"],
    layoutSummary: {
      pageCount: 12,
      tableCount: 2,
      imageCount: 0,
      ocrPages: 0,
      extractionMethod: "pdfjs",
    },
    createdAt: now.toISOString(),
    contentHash: "abc",
  };
}

describe("planning autonomy", () => {
  it("ranks blueprint-backed heavy work over generic light quiz proximity", () => {
    const data = emptyAppData();
    data.courses = [course({ id: "c1", code: "TEST*1000" })];
    data.preferences.selectedCourseIds = ["c1"];
    data.sync.lastSyncedAt = Date.now();
    data.courseBlueprints = [richBlueprint("c1")];
    data.assessments = [
      assessment({
        id: "quiz-light",
        courseId: "c1",
        title: "Quiz 3",
        type: "quiz",
        weightPercent: 1,
        due: { certainty: "exact", iso: "2026-10-01T22:00:00.000Z", label: null },
        submissionState: "not_submitted",
      }),
      assessment({
        id: "asgn-heavy",
        courseId: "c1",
        title: "Assignment 1",
        type: "assignment",
        weightPercent: 12.5,
        due: { certainty: "exact", iso: "2026-10-02T22:00:00.000Z", label: null },
        submissionState: "not_submitted",
      }),
    ];

    const quizScore = scoreAssessmentPriority(data, data.assessments[0], now);
    const asgnScore = scoreAssessmentPriority(data, data.assessments[1], now);
    expect(asgnScore).toBeGreaterThan(quizScore);

    const autonomy = buildPlanningAutonomy(data, now);
    expect(autonomy.recommendations[0].assessmentId).toBe("asgn-heavy");
    expect(autonomy.recommendations[0].why).toMatch(/12\.5%/);

    const centre = buildCommandCentreFromData(data, now);
    expect(centre.find((p) => p.assessmentId === "asgn-heavy")!.score).toBeGreaterThan(
      centre.find((p) => p.assessmentId === "quiz-light")!.score,
    );
  });

  it("WHY evidence cites assessment/rule/deadline/material that caused the recommendation", () => {
    const data = emptyAppData();
    data.courses = [course({ id: "c1", code: "TEST*1000" })];
    data.preferences.selectedCourseIds = ["c1"];
    data.sync.lastSyncedAt = Date.now();
    data.courseBlueprints = [richBlueprint("c1")];
    data.academicRules = [
      ensureTypedRule({
        id: "rule:c1:BestN:Quizzes",
        courseId: "c1",
        kind: "BestN",
        label: "Quizzes: best 10 of 11",
        params: { n: 10, of: 11, applyToTypes: ["quiz"], category: "Quizzes" },
        sourceType: "course_outline",
        confidence: 0.9,
      }),
    ];
    data.contentItems = [
      {
        id: "ci-spec",
        courseId: "c1",
        moduleId: null,
        title: "Assignment 1 Specification",
        documentClass: "assignment_specification",
        url: null,
        contentHash: null,
        linkedActivityId: "asgn-heavy",
        toolName: null,
        updatedAt: now.toISOString(),
      } as never,
    ];
    data.assessments = [
      assessment({
        id: "asgn-heavy",
        courseId: "c1",
        title: "Assignment 1",
        type: "assignment",
        weightPercent: 12.5,
        due: { certainty: "exact", iso: "2026-10-01T22:00:00.000Z", label: null },
        submissionState: "not_submitted",
      }),
    ];

    const reasons = explainAssessment(data, data.assessments[0], now);
    expect(reasons.some((r) => r.code === "weight" && r.text.includes("12.5%"))).toBe(true);
    expect(reasons.some((r) => r.code === "not_submitted")).toBe(true);
    expect(reasons.some((r) => r.code === "due_soon")).toBe(true);
    expect(reasons.some((r) => r.code === "linked_material")).toBe(true);

    const brief = buildCinematicBrief(data, now);
    const beat = brief.beats.find((b) => b.assessmentId === "asgn-heavy");
    expect(beat?.detail).toMatch(/12\.5%|Not submitted|Material/i);
    expect(beat?.reasons?.length).toBeGreaterThan(0);
  });

  it("ignore impact explains grade risk and next focus if recommendation skipped", () => {
    const data = emptyAppData();
    data.courses = [course({ id: "c1", code: "TEST*1000" })];
    data.preferences.selectedCourseIds = ["c1"];
    data.sync.lastSyncedAt = Date.now();
    data.courseBlueprints = [richBlueprint("c1")];
    data.assessments = [
      assessment({
        id: "asgn-heavy",
        courseId: "c1",
        title: "Assignment 1",
        type: "assignment",
        weightPercent: 12.5,
        due: { certainty: "exact", iso: "2026-10-01T22:00:00.000Z", label: null },
        submissionState: "not_submitted",
      }),
      assessment({
        id: "lab2",
        courseId: "c1",
        title: "Lab 2",
        type: "lab",
        weightPercent: 4,
        due: { certainty: "exact", iso: "2026-10-05T22:00:00.000Z", label: null },
        submissionState: "not_submitted",
      }),
    ];

    const impact = explainIgnoreImpact(data, data.assessments[0], now);
    expect(impact.gradeRisk).toMatch(/12\.5%/);
    expect(impact.nextFocusId).toBe("lab2");
    expect(impact.summary.length).toBeGreaterThan(0);

    const brief = buildCinematicBrief(data, now);
    const beat = brief.beats.find((b) => b.assessmentId === "asgn-heavy");
    expect(beat?.ignoreImpact?.gradeRisk).toMatch(/12\.5%/);

    const centre = buildCommandCentreFromData(data, now);
    const pri = centre.find((p) => p.assessmentId === "asgn-heavy")!;
    expect(pri.ignoreImpact?.summary).toBeTruthy();
    expect(pri.explanation.join(" ")).toMatch(/If ignored/i);
  });

  it("stale gate blocks trusting plan when blueprint assessments missing from sync", () => {
    const data = emptyAppData();
    data.courses = [course({ id: "c1", code: "TEST*1000" })];
    data.preferences.selectedCourseIds = ["c1"];
    data.sync.lastSyncedAt = Date.now();
    data.courseBlueprints = [richBlueprint("c1")];
    // Only one light quiz present — missing Assignment 1 and Lab 2 from blueprint
    data.assessments = [
      assessment({
        id: "quiz-only",
        courseId: "c1",
        title: "Quiz 3",
        type: "quiz",
        weightPercent: 1,
        submissionState: "not_submitted",
      }),
    ];

    const gaps = detectStaleModelGaps(data);
    expect(gaps.some((g) => g.kind === "missing_assessment")).toBe(true);
    expect(gaps.some((g) => /Assignment 1/i.test(g.detail))).toBe(true);

    const gate = evaluatePlanningGate(data);
    expect(gate.needsRecheck).toBe(true);
    expect(gate.summary).toMatch(/re-check|Stale|Incomplete/i);

    const autonomy = buildPlanningAutonomy(data, now);
    expect(autonomy.requestRecheck).toBe(true);

    const brief = buildCinematicBrief(data, now);
    expect(brief.staleGaps.length).toBeGreaterThan(0);
    expect(brief.requestRecheck).toBe(true);
    expect(brief.staleSummary ?? brief.systemNote ?? "").toMatch(/re-check|Stale|Incomplete|gap/i);
  });

  it("recovery rebuild focuses still-actionable highest-impact work after a miss", () => {
    const data = emptyAppData();
    data.courses = [course({ id: "c1", code: "TEST*1000" })];
    data.preferences.selectedCourseIds = ["c1"];
    data.sync.lastSyncedAt = Date.now();
    data.courseBlueprints = [richBlueprint("c1")];
    data.academicRules = [
      ensureTypedRule({
        id: "rule:c1:BestN:Quizzes",
        courseId: "c1",
        kind: "BestN",
        label: "Quizzes: best 10 of 11",
        params: { n: 10, of: 11, applyToTypes: ["quiz"], category: "Quizzes" },
        sourceType: "course_outline",
        confidence: 0.9,
      }),
    ];
    data.assessments = [
      assessment({
        id: "quiz-missed",
        courseId: "c1",
        title: "Quiz 2",
        type: "quiz",
        weightPercent: 1,
        due: { certainty: "exact", iso: "2026-09-28T22:00:00.000Z", label: null },
        submissionState: "not_submitted",
        state: { ...DEFAULT_ITEM_STATE, missed: true, needsConfirmation: false },
      }),
      assessment({
        id: "asgn-heavy",
        courseId: "c1",
        title: "Assignment 1",
        type: "assignment",
        weightPercent: 12.5,
        due: { certainty: "exact", iso: "2026-10-03T22:00:00.000Z", label: null },
        submissionState: "not_submitted",
      }),
      assessment({
        id: "quiz-light",
        courseId: "c1",
        title: "Quiz 3",
        type: "quiz",
        weightPercent: 1,
        due: { certainty: "exact", iso: "2026-10-01T20:00:00.000Z", label: null },
        submissionState: "not_submitted",
      }),
    ];

    const plan = buildAutonomousRecoveryPlan(data, now);
    expect(plan.mode).toBe("recovery");
    expect(plan.trigger).toMatch(/missed/i);
    expect(plan.items[0]?.assessmentId).toBe("asgn-heavy");
    // Light absorbable quiz deferred when heavier work exists
    expect(plan.deferred.some((d) => d.assessmentId === "quiz-light") || plan.items.every((i) => i.assessmentId !== "quiz-light" || plan.items[0].assessmentId === "asgn-heavy")).toBe(true);

    const brief = buildCinematicBrief(data, now);
    expect(brief.recoveryPlan.mode).toBe("recovery");
    expect(brief.recoveryPlan.items[0]?.assessmentId).toBe("asgn-heavy");
  });

  it("continuous re-plan reacts to deadline/grade/announcement change events", () => {
    const data = emptyAppData();
    data.courses = [course({ id: "c1", code: "TEST*1000" })];
    data.preferences.selectedCourseIds = ["c1"];
    data.sync.lastSyncedAt = Date.now();
    data.courseBlueprints = [richBlueprint("c1")];
    data.assessments = [
      assessment({
        id: "asgn-heavy",
        courseId: "c1",
        title: "Assignment 1",
        type: "assignment",
        weightPercent: 12.5,
        due: { certainty: "exact", iso: "2026-10-01T18:00:00.000Z", label: null },
        submissionState: "not_submitted",
      }),
      assessment({
        id: "lab2",
        courseId: "c1",
        title: "Lab 2",
        type: "lab",
        weightPercent: 4,
        due: { certainty: "exact", iso: "2026-10-08T22:00:00.000Z", label: null },
        submissionState: "not_submitted",
      }),
    ];
    data.changes = [
      {
        id: "chg1",
        courseId: "c1",
        entityId: "asgn-heavy",
        kind: "deadline_changed",
        title: "Deadline changed: Assignment 1",
        detail: "moved earlier",
        createdAt: now.toISOString(),
        read: false,
        evidenceIds: [],
        beforeValue: "2026-10-05",
        afterValue: "2026-10-01T18:00:00.000Z",
      },
      {
        id: "chg2",
        courseId: "c1",
        entityId: null,
        kind: "announcement",
        title: "Clarification on Lab 2",
        detail: "submit to dropbox",
        createdAt: now.toISOString(),
        read: false,
        evidenceIds: [],
      },
    ];

    expect(shouldReplanFromChanges(data.changes)).toBe(true);

    const before = buildPlanningAutonomy(data, now);
    expect(before.replanFrom.length).toBeGreaterThan(0);
    expect(before.replanNote).toMatch(/re-plan|change/i);

    // Simulate submission completed → priorities shift
    data.assessments = data.assessments.map((a) =>
      a.id === "asgn-heavy"
        ? { ...a, submissionState: "submitted" as const, state: { ...a.state, work: "completed" as const } }
        : a,
    );
    data.changes = [
      ...data.changes,
      {
        id: "chg3",
        courseId: "c1",
        entityId: "asgn-heavy",
        kind: "grade_posted",
        title: "Grade posted: Assignment 1",
        detail: "12/12.5",
        createdAt: now.toISOString(),
        read: false,
        evidenceIds: [],
      },
    ];

    const after = buildPlanningAutonomy(data, now);
    expect(after.recommendations.find((r) => r.assessmentId === "asgn-heavy")?.score ?? 0).toBe(0);
    expect(after.recommendations[0]?.assessmentId).toBe("lab2");

    const brief = buildCinematicBrief(data, now);
    expect(brief.replanNote).toBeTruthy();
  });

  it("section-specific lab timing cites meeting occurrence in WHY", () => {
    const data = emptyAppData();
    data.courses = [course({ id: "c1", code: "TEST*1000", labSection: "0101" })];
    data.preferences.selectedCourseIds = ["c1"];
    data.preferences.sectionConfigs = [{ courseId: "c1", labSection: "0101" }];
    data.sync.lastSyncedAt = Date.now();
    data.courseBlueprints = [richBlueprint("c1")];
    const labOcc: MeetingOccurrence = {
      id: "occ-lab",
      patternId: "p-lab",
      courseId: "c1",
      kind: "lab",
      sectionCode: "0101",
      date: "2026-10-01",
      startIso: "2026-10-01T18:30:00.000Z",
      endIso: "2026-10-01T20:20:00.000Z",
      location: "SSC 1303",
      cancelled: false,
      rescheduledToId: null,
      indexInPattern: 2,
    };
    data.meetingOccurrences = [labOcc];
    data.assessments = [
      assessment({
        id: "lab2",
        courseId: "c1",
        title: "Lab 2",
        type: "lab",
        weightPercent: 4,
        due: { certainty: "exact", iso: "2026-10-07T22:00:00.000Z", label: null },
        submissionState: "not_submitted",
      }),
    ];

    const reasons = explainAssessment(data, data.assessments[0], now);
    expect(
      reasons.some((r) => r.code === "lab_tonight" || r.code === "section_timing"),
    ).toBe(true);
  });
});
