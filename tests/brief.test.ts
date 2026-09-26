import { describe, expect, it } from "vitest";
import { buildCinematicBrief } from "@/engines/brief";
import { buildCommandCentreFromData } from "@/engines/priority";
import { scoreAssessmentPriority, explainAssessment } from "@/engines/planningKnowledge";
import { emptyAppData } from "@/storage/schema";
import type { Assessment, Course, MeetingOccurrence } from "@/domain/types";
import { DEFAULT_ITEM_STATE } from "@/domain/types";
import type { CourseBlueprint } from "@/documentIntelligence/types";
import { ensureTypedRule } from "@/domain/rules";

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
    outlineDocumentId: null,
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

function minimalBlueprint(courseId: string): CourseBlueprint {
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
        confidence: 0.8,
        citation: null,
        sourceSnippet: null,
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
          label: "8 days after lab",
          weekNumber: null,
          relativeRuleId: "rd1",
        },
        certainty: "approximate",
        confidence: 0.7,
        citation: null,
        sourceSnippet: "Labs due 8 days after the lab in which they are introduced",
      },
    ],
    relativeDeadlines: [
      {
        id: "rd1",
        assessmentTitleHint: "Lab",
        offsetDays: 8,
        approx: false,
        anchorKind: "lab_introduced",
        anchorLabel: "lab meeting",
        raw: "due 8 days after the lab",
        citation: null,
        resolvedCandidateIso: null,
      },
    ],
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
      courseCode: "TEST*1000",
      courseTitle: "Test Course",
      term: "F26",
      instructors: [],
      tas: [],
      officeHours: [],
      scheduleLines: [],
      assessments: [],
      categories: [],
      gradingRules: [],
      policies: [],
      textbooks: [],
      diagnostics: [],
      confidence: 0.9,
    },
    layoutSummary: {
      pageCount: 1,
      tableCount: 1,
      imageCount: 0,
      ocrPages: 0,
      extractionMethod: "pdfjs",
    },
    createdAt: new Date().toISOString(),
    contentHash: "abc",
  };
}

describe("cinematic brief", () => {
  it("greets by first name when board is clear", () => {
    const data = emptyAppData();
    data.courses = [course({ id: "c1", code: "CIS*2430" })];
    data.preferences.selectedCourseIds = ["c1"];
    data.user = { name: "Moosa Alam", id: "u1" };
    data.sync.lastSyncedAt = Date.now();
    const brief = buildCinematicBrief(data, new Date("2026-09-30T15:00:00-04:00"));
    expect(brief.greeting).toContain("Moosa");
    expect(brief.headline.toLowerCase()).toMatch(/clear|standing|board/);
    expect(brief.tone).toBe("clear");
    expect(brief.pulse.courses).toBe(1);
    expect(brief.risks).toEqual([]);
  });

  it("goes idle when never synced", () => {
    const data = emptyAppData();
    data.user = { name: "Moosa Alam", id: "u1" };
    const brief = buildCinematicBrief(data, new Date("2026-09-30T10:00:00-04:00"));
    expect(brief.tone).toBe("idle");
    expect(brief.headline).toMatch(/Standing/);
    expect(brief.systemNote).toBeTruthy();
  });

  it("includes beats for upcoming class and tonight deadline", () => {
    const data = emptyAppData();
    data.courses = [course({ id: "c1", code: "CIS*2430" })];
    data.preferences.selectedCourseIds = ["c1"];
    data.user = { name: "Moosa Alam", id: "u1" };
    data.sync.lastSyncedAt = Date.now();
    const now = new Date("2026-09-30T14:00:00-04:00");
    const occ: MeetingOccurrence = {
      id: "occ1",
      patternId: "p1",
      courseId: "c1",
      kind: "lecture",
      sectionCode: null,
      date: "2026-09-30",
      startIso: "2026-09-30T18:30:00.000Z",
      endIso: "2026-09-30T19:20:00.000Z",
      location: "RICH 2520",
      cancelled: false,
      rescheduledToId: null,
      indexInPattern: 0,
    };
    data.meetingOccurrences = [occ];
    data.assessments = [
      assessment({
        id: "a1",
        courseId: "c1",
        title: "Lab 2",
        type: "lab",
        due: { certainty: "exact", iso: "2026-10-01T03:59:00.000Z", label: null },
        weightPercent: 4,
      }),
    ];
    const brief = buildCinematicBrief(data, now);
    expect(brief.beats.length).toBeGreaterThan(0);
    expect(brief.greeting).toMatch(/afternoon|morning|evening|Still/i);
  });
});

describe("blueprint-aware brief ranking", () => {
  const now = new Date("2026-10-01T12:00:00-04:00");

  it("ranks heavy unsubmitted assignment above light quiz due sooner", () => {
    const data = emptyAppData();
    data.courses = [course({ id: "c1", code: "TEST*1000" })];
    data.preferences.selectedCourseIds = ["c1"];
    data.user = { name: "Moosa Alam", id: "u1" };
    data.sync.lastSyncedAt = Date.now();
    data.courseBlueprints = [minimalBlueprint("c1")];
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
    // Quiz due in 6h (1%) vs Assignment due in 30h (12.5%) — heavy should win
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

    const brief = buildCinematicBrief(data, now);
    const asgnBeat = brief.beats.find((b) => b.assessmentId === "asgn-heavy");
    const quizBeat = brief.beats.find((b) => b.assessmentId === "quiz-light");
    expect(asgnBeat).toBeTruthy();
    expect(asgnBeat!.detail).toMatch(/12\.5%|Not submitted/i);
    expect(asgnBeat!.priority).toBeGreaterThan(quizBeat?.priority ?? 0);

    const centre = buildCommandCentreFromData(data, now);
    const asgnPri = centre.find((p) => p.assessmentId === "asgn-heavy")!;
    const quizPri = centre.find((p) => p.assessmentId === "quiz-light")!;
    expect(asgnPri.score).toBeGreaterThan(quizPri.score);
    expect(asgnPri.explanation.join(" ")).toMatch(/12\.5%/);
  });

  it("missed quiz cites best-N absorption (not panic zero)", () => {
    const data = emptyAppData();
    data.courses = [course({ id: "c1", code: "TEST*1000" })];
    data.preferences.selectedCourseIds = ["c1"];
    data.sync.lastSyncedAt = Date.now();
    data.courseBlueprints = [minimalBlueprint("c1")];
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
    ];

    const reasons = explainAssessment(data, data.assessments[0], now);
    expect(reasons.some((r) => r.code === "best_n")).toBe(true);
    expect(reasons.find((r) => r.code === "best_n")!.text).toMatch(/Best 10/i);

    const brief = buildCinematicBrief(data, now);
    const blob = [...brief.beats, ...brief.risks, ...brief.recovery]
      .map((x) => `${"detail" in x ? x.detail : ""} ${"line" in x ? (x as { line?: string }).line : ""}`)
      .join(" ");
    expect(blob).toMatch(/Best 10|absorb/i);
  });

  it("relative lab due from occurrence cites derived rule in brief WHY", () => {
    const data = emptyAppData();
    data.courses = [course({ id: "c1", code: "TEST*1000" })];
    data.preferences.selectedCourseIds = ["c1"];
    data.sync.lastSyncedAt = Date.now();
    data.courseBlueprints = [minimalBlueprint("c1")];
    data.academicRules = [
      ensureTypedRule({
        id: "rule:c1:rel:lab",
        courseId: "c1",
        kind: "RelativeDeadline",
        label: "Labs +8d from lab meeting",
        params: {
          fromMeetingKind: "lab",
          dayOfWeek: null,
          offsetDays: 8,
          dueTime: "23:59",
          applyToTypes: ["lab"],
          occurrenceIndex: 2,
        },
        sourceType: "course_outline",
        confidence: 0.85,
      }),
    ];
    const labOcc: MeetingOccurrence = {
      id: "occ-lab-2",
      patternId: "p-lab",
      courseId: "c1",
      kind: "lab",
      sectionCode: "0101",
      date: "2026-09-29",
      startIso: "2026-09-29T18:30:00.000Z",
      endIso: "2026-09-29T20:20:00.000Z",
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
        due: {
          certainty: "approximate",
          iso: "2026-10-07T03:59:00.000Z",
          label: "Labs +8d from lab meeting (+8d from 2026-09-29)",
        },
        submissionState: "not_submitted",
        fieldProvenance: {
          due: {
            value: { certainty: "approximate", iso: "2026-10-07T03:59:00.000Z", occurrenceId: "occ-lab-2" },
            sourceType: "rule_engine",
            sourceId: "rule:c1:rel:lab",
            confidence: 0.85,
            retrievedAt: new Date().toISOString(),
          },
        },
      }),
    ];

    const reasons = explainAssessment(data, data.assessments[0], now);
    expect(reasons.some((r) => r.code === "relative_deadline")).toBe(true);
    expect(reasons.some((r) => r.code === "weight" && r.text.includes("4%"))).toBe(true);

    const brief = buildCinematicBrief(data, now);
    const labBeat = brief.beats.find((b) => b.assessmentId === "lab2");
    expect(labBeat).toBeTruthy();
    expect(labBeat!.detail).toMatch(/Derived due|4%|Not submitted/i);
  });
});
