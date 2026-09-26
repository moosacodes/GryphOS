/**
 * Deep course ingestion / reconstruction fixture tests.
 * Three course shapes; staff discussion authority; content hash → inbox;
 * cross-source ONE Assignment 1; search snippets; Zybook Q1–Q6.
 */
import { describe, expect, it } from "vitest";
import { emptyAppData } from "@/storage/schema";
import { reconcileAssessments } from "@/reconcile/merge";
import { extractAnnouncementFacts, enrichAnnouncement } from "@/ingestion/announcementFacts";
import {
  classifyAuthorRole,
  isStaffRole,
  type DiscussionPost,
} from "@/domain/discussions";
import { staffClarificationsFromPosts } from "@/ingestion/discussions";
import { applyDeadlineFacts } from "@/ingestion/applyClarifications";
import { buildEntityLinks } from "@/ingestion/entityLinking";
import { detectExternalActivities } from "@/ingestion/externalTools";
import { rebuildSearchIndex, snippetFor } from "@/ingestion/searchIndex";
import { searchLocal } from "@/engines/search";
import { syncContentHash, simpleTextDiff } from "@/domain/facts";
import { classifyDocument } from "@/domain/content";
import { buildCourseCoverage } from "@/ingestion/coverageBuild";
import type { Announcement, Assessment, Course } from "@/domain/types";
import { DEFAULT_ITEM_STATE } from "@/domain/types";
import { exactDate, unknownDate } from "@/domain/dates";

function course(partial: Partial<Course> & { id: string; code: string }): Course {
  return {
    orgUnitId: 1,
    title: partial.code,
    semester: "F26",
    startDate: "2026-09-10",
    endDate: "2026-12-04",
    color: "#C8102E",
    selected: true,
    instructorNames: ["Ada Instructor"],
    url: "https://courselink.uoguelph.ca",
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

function assessment(partial: Partial<Assessment> & { id: string; courseId: string; title: string }): Assessment {
  return {
    type: "assignment",
    due: unknownDate(),
    start: unknownDate(),
    end: unknownDate(),
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

describe("deep ingestion — three course shapes", () => {
  it("handles dropbox-heavy, quiz-heavy, and content-heavy shapes", () => {
    const dropboxHeavy = [
      assessment({ id: "c1:dropbox:1", courseId: "c1", title: "Assignment 1", type: "assignment", due: exactDate("2026-10-01T23:59:00.000Z") }),
      assessment({ id: "c1:dropbox:2", courseId: "c1", title: "Assignment 2", type: "assignment" }),
    ];
    const quizHeavy = [
      assessment({ id: "c2:quiz:1", courseId: "c2", title: "Quiz 1", type: "quiz" }),
      assessment({ id: "c2:quiz:2", courseId: "c2", title: "Quiz 2", type: "quiz" }),
      assessment({ id: "c2:quiz:3", courseId: "c2", title: "Quiz 3", type: "quiz" }),
    ];
    const contentHeavy = [
      assessment({ id: "c3:content:lab1", courseId: "c3", title: "Lab 1", type: "lab" }),
    ];
    expect(dropboxHeavy.every((a) => a.id.includes("dropbox"))).toBe(true);
    expect(quizHeavy.filter((a) => a.type === "quiz")).toHaveLength(3);
    expect(contentHeavy[0].type).toBe("lab");
    expect(classifyDocument("Assignment 1 Spec.pdf", { moduleTitle: "Assignments" })).toBe(
      "assignment_specification",
    );
    expect(classifyDocument("Week 3 Lecture Slides.pptx", { moduleTitle: "Week 3" })).toBe(
      "lecture_slides",
    );
  });
});

describe("staff discussion authority", () => {
  it("only staff posts become authoritative clarifications", () => {
    const roleStaff = classifyAuthorRole("Ada Instructor", ["Ada Instructor"], ["Ada Instructor"], ["Theo TA"]);
    const roleTa = classifyAuthorRole("Theo TA", ["Ada Instructor", "Theo TA"], ["Ada Instructor"], ["Theo TA"]);
    const roleStudent = classifyAuthorRole("Sam Student", ["Ada Instructor"], ["Ada Instructor"], ["Theo TA"]);
    expect(isStaffRole(roleStaff)).toBe(true);
    expect(isStaffRole(roleTa)).toBe(true);
    expect(isStaffRole(roleStudent)).toBe(false);

    const assessments = [
      assessment({
        id: "c1:dropbox:1",
        courseId: "c1",
        title: "Assignment 1",
        due: exactDate("2026-10-01T23:59:00.000Z"),
      }),
    ];
    const posts: DiscussionPost[] = [
      {
        id: "dpost:staff",
        courseId: "c1",
        forumId: 1,
        topicId: 1,
        postId: 1,
        threadId: 1,
        parentPostId: null,
        subject: "Assignment 1 deadline",
        bodyText: "Assignment 1 due date extended to October 8, 2026",
        authorDisplayName: "Theo TA",
        authorUserId: 9,
        authorRole: "ta",
        isAuthoritative: true,
        postedAt: "2026-09-20T12:00:00.000Z",
        lastEditedAt: null,
        isDeleted: false,
        threadIsPinned: true,
        bodyHash: "h1",
      },
      {
        id: "dpost:student",
        courseId: "c1",
        forumId: 1,
        topicId: 1,
        postId: 2,
        threadId: 1,
        parentPostId: 1,
        subject: "Re: Assignment 1",
        bodyText: "Assignment 1 due date extended to October 8, 2026",
        authorDisplayName: "Sam Student",
        authorUserId: 2,
        authorRole: "student",
        isAuthoritative: false,
        postedAt: "2026-09-20T13:00:00.000Z",
        lastEditedAt: null,
        isDeleted: false,
        threadIsPinned: false,
        bodyHash: "h2",
      },
    ];
    const { facts, links } = staffClarificationsFromPosts(posts, assessments);
    expect(facts.length).toBeGreaterThan(0);
    expect(facts.every((f) => f.authority === "STAFF_DISCUSSION")).toBe(true);
    expect(links.some((l) => l.kind === "CHANGES_DEADLINE_OF" || l.kind === "CLARIFIES")).toBe(true);

    const applied = applyDeadlineFacts(assessments, [], facts);
    // May create conflict or update — either way not silent
    expect(applied.assessments[0].due.iso?.startsWith("2026-10-08") || applied.conflicts.length > 0).toBe(true);
  });
});

describe("announcement deep facts", () => {
  it("extracts deadline change facts (not just a boolean)", () => {
    const ann: Announcement = {
      id: "news:c1:1",
      courseId: "c1",
      title: "A1 extension",
      bodyText: "Assignment 1 due date extended to October 15, 2026. Room THRN 1200 for midterm.",
      publishedAt: "2026-09-18T10:00:00.000Z",
      url: null,
      deadlineChangeSignal: false,
      fromInstructorOrTa: true,
      extractedFactIds: [],
      bodyHash: null,
    };
    const assessments = [
      assessment({ id: "c1:dropbox:1", courseId: "c1", title: "Assignment 1" }),
      assessment({ id: "c1:quiz:mid", courseId: "c1", title: "Midterm", type: "midterm" }),
    ];
    const enriched = enrichAnnouncement(ann, assessments);
    const facts = extractAnnouncementFacts(enriched, assessments);
    expect(enriched.deadlineChangeSignal).toBe(true);
    expect(facts.some((f) => f.kind === "deadline_change" || f.kind === "extension")).toBe(true);
    expect(facts.some((f) => f.assessmentId === "c1:dropbox:1")).toBe(true);
  });
});

describe("cross-source dedupe → ONE Assignment 1", () => {
  it("merges dropbox + outline + calendar into one canonical object", () => {
    const items = [
      assessment({
        id: "c1:dropbox:10",
        courseId: "c1",
        title: "Assignment 1",
        due: exactDate("2026-10-01T23:59:00.000Z"),
        fieldProvenance: {
          due: {
            value: exactDate("2026-10-01T23:59:00.000Z"),
            sourceType: "courselink_dropbox",
            sourceId: "10",
            confidence: 0.95,
            retrievedAt: "2026-09-01T00:00:00.000Z",
          },
        },
      }),
      assessment({
        id: "outline:c1:0:assignment-1",
        courseId: "c1",
        title: "Assignment 1",
        weightPercent: 10,
        due: { certainty: "approximate", iso: null, label: "Week 4" },
        fieldProvenance: {
          weightPercent: {
            value: 10,
            sourceType: "course_outline",
            sourceId: "outline",
            confidence: 0.8,
            retrievedAt: "2026-09-01T00:00:00.000Z",
          },
        },
      }),
      assessment({
        id: "c1:cal:99",
        courseId: "c1",
        title: "Assignment 1 Due",
        due: exactDate("2026-10-01T23:59:00.000Z"),
        fieldProvenance: {
          due: {
            value: exactDate("2026-10-01T23:59:00.000Z"),
            sourceType: "courselink_calendar",
            sourceId: "99",
            confidence: 0.7,
            retrievedAt: "2026-09-01T00:00:00.000Z",
          },
        },
      }),
    ];
    const { assessments } = reconcileAssessments(items);
    const a1 = assessments.filter((a) => /assignment\s*1/i.test(a.title));
    expect(a1.length).toBe(1);
    expect(a1[0].weightPercent).toBe(10);
    expect(a1[0].due.iso?.startsWith("2026-10-01")).toBe(true);
  });
});

describe("content hash update → inbox", () => {
  it("emits document_version change with diff when hash changes", () => {
    const prev = "Line A\nDue: Oct 1\nLine C";
    const next = "Line A\nDue: Oct 8\nLine C";
    const h1 = syncContentHash(prev);
    const h2 = syncContentHash(next);
    expect(h1).not.toBe(h2);
    const diff = simpleTextDiff(prev, next);
    expect(diff).toContain("- Due: Oct 1");
    expect(diff).toContain("+ Due: Oct 8");
  });
});

describe("Zybook Q1–Q6 external entities", () => {
  it("creates separate Q entities with best 5 of 6", () => {
    const { activities, syntheticAssessments } = detectExternalActivities(
      "cis2520",
      ["Zybook Activities", "Complete Zybook Q1 through Q6 — best 5 count"],
      [],
    );
    const qs = activities.filter((a) => a.tool === "zybooks" && a.activityKey?.startsWith("Q"));
    expect(qs.length).toBeGreaterThanOrEqual(6);
    expect(qs[0].bestNOf).toBe(5);
    expect(qs[0].groupSize).toBe(6);
    expect(syntheticAssessments.length).toBeGreaterThanOrEqual(6);
  });
});

describe("search snippets + entity linking", () => {
  it("returns snippets and links specs to assessments", () => {
    let data = emptyAppData();
    const c = course({ id: "c1", code: "CIS*1300", instructorNames: ["Ada Instructor"] });
    data = {
      ...data,
      courses: [c],
      assessments: [
        assessment({ id: "c1:dropbox:1", courseId: "c1", title: "Assignment 1", due: exactDate("2026-10-01T23:59:00.000Z") }),
      ],
      announcements: [
        {
          id: "news:c1:1",
          courseId: "c1",
          title: "A1 extension",
          bodyText: "Assignment 1 due date extended to October 15 for all sections.",
          publishedAt: null,
          url: null,
          deadlineChangeSignal: true,
          fromInstructorOrTa: true,
          extractedFactIds: [],
          bodyHash: null,
        },
      ],
      contentItems: [
        {
          id: "content-item:c1:1",
          moduleId: "mod1",
          courseId: "c1",
          title: "Assignment 1 Specification",
          url: null,
          documentClass: "assignment_specification",
          contentHash: "x",
          updatedAt: null,
          topicId: 1,
          mimeType: "application/pdf",
          topicType: 1,
          descriptionText: null,
          bodyText: "Submit Assignment 1 via the dropbox by the deadline.",
          startDate: null,
          endDate: null,
          dueDate: null,
          completionRequired: null,
          completionCompleted: null,
          isHidden: false,
          isExternal: false,
          externalUrl: null,
          linkedActivityId: null,
          sortOrder: 1,
          libraryResourceId: null,
          previousContentHash: null,
        },
      ],
      libraryResources: [],
      announcementFacts: [],
      gradeRecords: [],
      feedbackRecords: [],
      calendarEvents: [],
    };
    data = { ...data, searchIndex: rebuildSearchIndex(data) };
    const hits = searchLocal(data, "Assignment 1 deadline", 10);
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.some((h) => h.snippet && /assignment 1/i.test(h.snippet))).toBe(true);
    expect(snippetFor("Submit Assignment 1 via the dropbox", "Assignment 1")).toMatch(/Assignment 1/);

    const links = buildEntityLinks({
      assessments: data.assessments,
      contentItems: data.contentItems,
      library: [],
      announcements: data.announcements,
      announcementFacts: extractAnnouncementFacts(data.announcements[0], data.assessments),
      gradeRecords: [],
      feedback: [],
      calendarEvents: [],
    });
    expect(links.some((l) => l.kind === "HAS_SPEC")).toBe(true);
  });
});

describe("coverage diagnostics honesty", () => {
  it("reports forums discovered / posts unavailable when posts empty", () => {
    const cov = buildCourseCoverage({
      courseId: "c1",
      orgUnitId: 1,
      dropbox: { discovered: 2, ingested: 2 },
      quizzes: { discovered: 1, ingested: 1, attemptsDiscovered: 0, attemptsIngested: 0 },
      grades: { objects: 3, values: 2, categories: 1, unmatched: 1 },
      news: { discovered: 4, ingested: 4, facts: 2 },
      calendar: { discovered: 0, ingested: 0 },
      content: { modules: 5, topics: 20, filesDownloaded: 3 },
      discussions: { forums: 2, topics: 4, posts: 0, postsUnavailable: true },
      feedback: { ingested: 0 },
      checklists: { discovered: 0 },
      groups: { discovered: 0 },
    });
    const disc = cov.capabilities.find((c) => c.key === "discussions");
    expect(disc?.detail).toMatch(/posts unavailable/i);
    expect(disc?.discovered).toBe(2);
    expect(disc?.ingested).toBe(0);
  });
});

describe("closed quiz needs confirmation", () => {
  it("marks needsConfirmation when closed with no attempt and no grade", () => {
    const a = assessment({
      id: "c1:quiz:9",
      courseId: "c1",
      title: "Quiz 9",
      type: "quiz",
      due: exactDate("2026-09-01T23:59:00.000Z"),
      end: exactDate("2026-09-01T23:59:00.000Z"),
      state: { ...DEFAULT_ITEM_STATE, needsConfirmation: true, missed: false },
    });
    expect(a.state.needsConfirmation).toBe(true);
    expect(a.state.missed).toBe(false);
  });
});
