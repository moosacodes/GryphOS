import { describe, expect, it } from "vitest";
import { emptyAppData } from "@/storage/schema";
import type { AppData, Assessment, Course, ImportedDocument } from "@/domain/types";
import { DEFAULT_ITEM_STATE } from "@/domain/types";
import {
  makeScrubber,
  redactDeep,
  REDACTED_BODY,
  REDACTED_EMAIL,
  REDACTED_GRADE,
  REDACTED_ID,
  REDACTED_NAME,
} from "@/diagnostics/redact";
import { summarizeProblems, summarizeWeights } from "@/diagnostics/problems";
import { buildDiagnostics, diagnosticsFilename, OUTLINE_EXCERPT_CHARS } from "@/diagnostics/export";
import { endpointTemplate, orgUnitFromPath, sanitizeEndpoint, type SyncTraceEntry } from "@/diagnostics/trace";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Loose = Record<string, any>;

const NOW = new Date("2026-10-01T14:00:00Z");

function course(p: Partial<Course> & Pick<Course, "id" | "code" | "orgUnitId">): Course {
  return {
    title: `${p.code} Title`,
    semester: "F26",
    startDate: "2026-09-10",
    endDate: "2026-12-04",
    color: "#123456",
    selected: true,
    instructorNames: [],
    url: "https://courselink.uoguelph.ca/d2l/home/1",
    outlineDocumentId: null,
    outlineStatus: "parsed",
    outlineStatusDetail: null,
    lectureSection: null,
    labSection: null,
    tutorialSection: null,
    updatedAt: NOW.toISOString(),
    ...p,
  };
}

function assessment(p: Partial<Assessment> & Pick<Assessment, "id" | "courseId" | "title">): Assessment {
  return {
    type: "assignment",
    due: { certainty: "exact", iso: "2026-10-10T23:59:00-04:00", label: null },
    start: { certainty: "unknown", iso: null, label: null },
    end: { certainty: "unknown", iso: null, label: null },
    weightPercent: 10,
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
    updatedAt: NOW.toISOString(),
    ...p,
  };
}

function trace(p: Partial<SyncTraceEntry> & Pick<SyncTraceEntry, "endpoint">): SyncTraceEntry {
  return {
    at: NOW.toISOString(),
    kind: "api",
    orgUnitId: orgUnitFromPath(p.endpoint),
    status: 200,
    ok: true,
    itemCount: 1,
    bytes: null,
    ms: 5,
    error: null,
    note: null,
    ...p,
  };
}

function baseData(): AppData {
  const d = emptyAppData();
  d.user = { name: "Jordan Testperson", id: "9876543" };
  d.sync = { status: "idle", lastSyncedAt: NOW.getTime() - 3600_000, startedAt: null, message: null };
  return d;
}

describe("diagnostics redaction", () => {
  const scrub = makeScrubber({ includeGrades: false, userName: "Jordan Testperson", userId: "9876543" });

  it("redacts user name (full, reversed, tokens), user id, and emails in free text", () => {
    const out = scrub.text(
      "Hi Jordan Testperson (Testperson, Jordan) id 9876543 mail jordan.t@uoguelph.ca; prof prof@uoguelph.ca",
    );
    expect(out).not.toMatch(/Jordan|Testperson|9876543|@uoguelph/);
    expect(out).toContain(REDACTED_NAME);
    expect(out).toContain(REDACTED_ID);
    expect(out).toContain(REDACTED_EMAIL);
  });

  it("redacts labelled student numbers even when not the known id", () => {
    expect(scrub.text("Student ID: 1234567")).toBe(`Student ID: ${REDACTED_ID}`);
  });

  it("does not eat lowercase common words matching name tokens", () => {
    const s = makeScrubber({ includeGrades: false, userName: "Will Mark" });
    expect(s.text("you will be marked")).toBe("you will be marked");
    expect(s.text("Will Mark submitted")).toBe(`${REDACTED_NAME} submitted`);
  });

  it("redacts grade values by default and keeps them when includeGrades", () => {
    const obj = { pointsEarned: 8, gradeDisplay: "80 %", displayedGrade: "A", feedbackText: "Nice", pointsPossible: 10, weightPercent: 5 };
    const red = redactDeep(obj, { includeGrades: false });
    expect(red).toEqual({ pointsEarned: REDACTED_GRADE, gradeDisplay: REDACTED_GRADE, displayedGrade: REDACTED_GRADE, feedbackText: REDACTED_GRADE, pointsPossible: 10, weightPercent: 5 });
    const kept = redactDeep(obj, { includeGrades: true });
    expect(kept).toEqual(obj);
    // null grades stay null (no false "redacted" noise)
    expect(redactDeep({ pointsEarned: null }, { includeGrades: false })).toEqual({ pointsEarned: null });
  });

  it("always drops credential-looking keys and inline secrets", () => {
    const red = redactDeep(
      { cookie: "d2lSessionVal=abc", accessToken: "x", password: "p", nested: { Authorization: "Bearer y", ok: 1 }, url: "https://x?token=SECRET&a=1" },
      { includeGrades: true },
    ) as Record<string, unknown>;
    expect(Object.keys(red)).toEqual(["nested", "url"]);
    expect(red.nested).toEqual({ ok: 1 });
    expect(JSON.stringify(red)).not.toContain("SECRET");
  });

  it("always redacts discussion post bodies", () => {
    expect(redactDeep({ postBody: "my private answer" }, { includeGrades: true })).toEqual({ postBody: REDACTED_BODY });
  });
});

describe("diagnostics trace helpers", () => {
  it("strips origin + query values and templates user ids", () => {
    expect(sanitizeEndpoint("https://courselink.uoguelph.ca/d2l/api/le/1.74/555/quizzes/9/attempts/?userId=9876543")).toBe(
      "/d2l/api/le/1.74/555/quizzes/9/attempts/?userId=…",
    );
    expect(sanitizeEndpoint("/d2l/api/le/1.74/555/dropbox/folders/3/feedback/user/9876543")).toBe(
      "/d2l/api/le/1.74/555/dropbox/folders/3/feedback/user/{userId}",
    );
    expect(orgUnitFromPath("/d2l/api/le/1.74/555/grades/")).toBe(555);
    expect(endpointTemplate("/d2l/api/le/1.74/555/dropbox/folders/3/")).toBe("/d2l/api/le/{v}/{id}/dropbox/folders/{id}/");
  });
});

describe("diagnostics problems summary", () => {
  it("flags missing dates, weights not summing to 100, missing outline and blocked endpoints", () => {
    const d = baseData();
    d.courses = [
      course({ id: "c1", code: "CIS*1000", orgUnitId: 555, outlineStatus: "none_accessible", outlineStatusDetail: "No outline" }),
      course({ id: "c2", code: "MATH*2000", orgUnitId: 777 }),
    ];
    d.preferences.selectedCourseIds = ["c1", "c2"];
    d.assessments = [
      assessment({ id: "a1", courseId: "c1", title: "A1", weightPercent: 30 }),
      assessment({ id: "a2", courseId: "c1", title: "Midterm", weightPercent: 30, due: { certainty: "unknown", iso: null, label: null } }),
      assessment({ id: "b1", courseId: "c2", title: "Final", weightPercent: 100 }),
    ];
    d.meetingOccurrences = [];
    d.syncTrace = [
      trace({ endpoint: "/d2l/api/le/1.74/555/grades/values/myGradeValues/", status: 403, ok: false, error: "HTTP 403" }),
      trace({ endpoint: "/d2l/api/le/1.74/555/dropbox/folders/", itemCount: 2 }),
      trace({ endpoint: "/d2l/api/le/1.74/777/news/", status: 500, ok: false, error: "HTTP 500" }),
    ];

    const probs = summarizeProblems(d, NOW);
    const codes = (cid: string) => probs.filter((p) => p.courseId === cid).map((p) => p.code);

    expect(codes("c1")).toEqual(expect.arrayContaining(["outline_not_found", "assessments_without_dates", "weights_not_100", "blocked_endpoints", "no_class_times"]));
    const noDates = probs.find((p) => p.code === "assessments_without_dates")!;
    expect(noDates.details).toEqual(["Midterm"]);
    expect(probs.find((p) => p.code === "weights_not_100")!.message).toContain("60%");
    expect(probs.find((p) => p.code === "blocked_endpoints")!.details![0]).toContain("403 /d2l/api/le/{v}/{id}/grades/values/myGradeValues/");

    expect(codes("c2")).toContain("failed_endpoints");
    expect(codes("c2")).not.toContain("weights_not_100");
    expect(codes("c2")).not.toContain("outline_not_found");
    // errors sort first
    expect(probs[0].severity).toBe("error");
  });

  it("prefers category weights when present and reports never-synced / no trace", () => {
    const d = emptyAppData();
    d.courses = [course({ id: "c1", code: "X*1", orgUnitId: 1 })];
    d.preferences.selectedCourseIds = ["c1"];
    d.assessments = [assessment({ id: "a", courseId: "c1", title: "Lab 1", weightPercent: 2 })];
    d.gradeCategories = [
      { id: "g1", courseId: "c1", name: "Labs", weightPercent: 40, dropLowest: 0, bestN: null, gradeCapPercent: null, thresholdPercent: null, brightspaceCategoryId: null },
      { id: "g2", courseId: "c1", name: "Final", weightPercent: 60, dropLowest: 0, bestN: null, gradeCapPercent: null, thresholdPercent: null, brightspaceCategoryId: null },
    ];
    const w = summarizeWeights(d, "c1");
    expect(w.basis).toBe("categories");
    expect(w.total).toBe(100);
    const codes = summarizeProblems(d, NOW).map((p) => p.code);
    expect(codes).toContain("never_synced");
    expect(codes).toContain("no_sync_trace");
    expect(codes).not.toContain("weights_not_100");
  });

  it("flags outline parsed with zero assessments", () => {
    const d = baseData();
    const doc: ImportedDocument = {
      id: "auto:c1:topic:1",
      courseId: "c1",
      filename: "outline.pdf",
      mimeType: "application/pdf",
      importedAt: NOW.toISOString(),
      textContent: "x".repeat(1000),
      parseResult: {
        courseCode: null, courseTitle: null, term: null, instructors: [], tas: [], officeHours: [], scheduleLines: [],
        assessments: [], categories: [], gradingRules: [], policies: [], textbooks: [], diagnostics: [], confidence: 0.2,
      },
      parseError: null,
    };
    d.documents = [doc];
    d.courses = [course({ id: "c1", code: "X*1", orgUnitId: 1, outlineDocumentId: doc.id, outlineStatus: "found" })];
    d.preferences.selectedCourseIds = ["c1"];
    const codes = summarizeProblems(d, NOW).map((p) => p.code);
    expect(codes).toEqual(expect.arrayContaining(["outline_no_assessments", "outline_low_confidence", "no_assessments"]));
  });
});

describe("buildDiagnostics", () => {
  function richData(): AppData {
    const d = baseData();
    const text = `Course outline for Jordan Testperson (jordan.t@uoguelph.ca). ` + "Assignment 1 20% due Oct 3. ".repeat(300);
    d.documents = [
      {
        id: "auto:c1:topic:1",
        courseId: "c1",
        filename: "CIS1000 Outline.pdf",
        mimeType: "application/pdf",
        importedAt: NOW.toISOString(),
        textContent: text,
        parseResult: {
          courseCode: "CIS*1000", courseTitle: null, term: "F26", instructors: [], tas: [], officeHours: [], scheduleLines: [],
          assessments: [{ title: "Assignment 1", type: "assignment", weightPercent: 20, dueLabel: "Oct 3", dueIso: "2026-10-03", certainty: "exact", confidence: 0.9, category: null, sourceSnippet: "Assignment 1 20%" }],
          categories: [], gradingRules: [{ kind: "best_n", label: "Best 4 of 5", n: 4, category: "Quizzes" }], policies: [], textbooks: [],
          diagnostics: [{ pass: "table", message: "found table" }], confidence: 0.8,
        },
        parseError: null,
      },
    ];
    d.courses = [course({ id: "c1", code: "CIS*1000", orgUnitId: 555, outlineDocumentId: "auto:c1:topic:1" })];
    d.preferences.selectedCourseIds = ["c1"];
    d.assessments = [assessment({ id: "a1", courseId: "c1", title: "Assignment 1", weightPercent: 20, pointsEarned: 9, gradeDisplay: "90 %" })];
    d.discussionPosts = [{
      id: "p1", courseId: "c1", forumId: 1, topicId: 2, postId: 3, threadId: null, parentPostId: null, subject: "Q", bodyText: "secret answer text",
      authorDisplayName: "Jordan Testperson", authorUserId: 9876543, authorRole: "student", isAuthoritative: false, postedAt: null, lastEditedAt: null,
      isDeleted: false, threadIsPinned: false, bodyHash: "h",
    }];
    d.syncTrace = [trace({ endpoint: "/d2l/api/le/1.74/555/dropbox/folders/", itemCount: 3 })];
    return d;
  }

  it("produces a redacted export with per-course sections, excerpt and problems", () => {
    const out = buildDiagnostics(richData(), { includeGrades: false, includeOutlineText: true }, { extensionVersion: "2.3.0", now: NOW });
    const json = JSON.stringify(out);
    expect(out.extensionVersion).toBe("2.3.0");
    expect(json).not.toMatch(/Jordan|Testperson|9876543|jordan\.t@/);
    expect(json).not.toContain("secret answer text");
    expect(json).not.toContain("90 %");
    const c = (out.courses as Loose[])[0];
    expect(c.course.code).toBe("CIS*1000");
    expect(c.sync.endpoints[0]).toMatchObject({ endpoint: "/d2l/api/le/{v}/{id}/dropbox/folders/", calls: 1, items: 3 });
    expect(c.outlineParse.assessments[0]).toMatchObject({ name: "Assignment 1", weightPercent: 20 });
    expect(c.outlineParse.passesUsed).toEqual(["table"]);
    expect(c.outlineParse.rules[0].kind).toBe("best_n");
    expect(c.outlineParse.textExcerpt.length).toBeLessThanOrEqual(OUTLINE_EXCERPT_CHARS);
    expect(c.outlineParse.textExcerpt).toContain("[user-name]");
    expect(c.canonical.assessments[0].pointsEarned).toBe(REDACTED_GRADE);
    expect(c.canonical.discussions.posts[0].postBody).toBe(REDACTED_BODY);
    expect(Array.isArray((out.summary as { problems: unknown }).problems)).toBe(true);
    expect(out.brief).toBeTruthy();
    expect(out.myDay).toBeTruthy();
  });

  it("keeps grades when opted in and can exclude outline text", () => {
    const out = buildDiagnostics(richData(), { includeGrades: true, includeOutlineText: false }, { extensionVersion: "2.3.0", now: NOW });
    const c = (out.courses as Loose[])[0];
    expect(c.canonical.assessments[0].pointsEarned).toBe(9);
    expect(c.canonical.assessments[0].gradeDisplay).toBe("90 %");
    expect(c.outlineParse.textExcerpt).toBe("[excluded by option]");
    // still redacts identity + post bodies
    expect(JSON.stringify(out)).not.toMatch(/Testperson|secret answer text/);
  });

  it("names the file with version + local timestamp", () => {
    expect(diagnosticsFilename("2.3.0", new Date(2026, 8, 26, 17, 5))).toBe("gryphos-diagnostics-v2.3.0-2026-09-26_1705.json");
  });
});
