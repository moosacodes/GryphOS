/**
 * Synchronization engine: CourseLink â†’ normalize â†’ reconcile â†’ local storage.
 * Adapted from dawhatnow/gryphCal sync patterns (MIT).
 */
import {
  HttpError,
  SignedOutError,
  getCalendarEvents,
  getContentToc,
  getCourses,
  getFolders,
  getGradeObjects,
  getMyGradeValues,
  getMySubmissions,
  getNews,
  getQuizzes,
  getVersions,
  getWhoAmI,
} from "@/adapters/courselink/api";
import { assessmentId } from "@/domain/ids";
import { exactDate, unknownDate } from "@/domain/dates";
import {
  discoverCourseOutline,
  flattenContentTopics,
  type OutlineDiscoveryHit,
} from "@/adapters/courselink/discoverOutlines";
import { seedAcademicDates } from "@/adapters/uofg/academicDates";
import { COURSE_COLORS, DEFAULT_CONCURRENCY, FUTURE_DAYS, PAST_DAYS } from "@/domain/constants";
import type {
  Announcement,
  AppData,
  Assessment,
  Course,
  OutlineDiscoveryStatus,
  SourceRecord,
} from "@/domain/types";
import {
  announcementFromNews,
  assessmentsFromAnnouncement,
  applyGrades,
  assessmentFromCalendarEvent,
  fromFolder,
  fromQuiz,
  withSubmissions,
} from "@/normalize/assessment";
import { currentSemester, isLikelyCurrent, toCourse, toUser } from "@/normalize/course";
import { reconcileAssessments } from "@/reconcile/merge";
import { loadAppData, saveAppData } from "@/storage/repository";
import { applySectionConfig } from "@/adapters/uofg/personalization";
import { applyOccurrenceDeadlines } from "@/engines/deadlines";
import { patternsFromLegacyMeetings, generateOccurrences, courseKeyFromCode } from "@/domain/meetings";
import { ensureTypedRule } from "@/domain/rules";
import { DEFAULT_ITEM_STATE } from "@/domain/types";
import { detectAssessmentChanges } from "./changes";
import { buildContentTree } from "./contentTree";
import type { CourseContentItem, CourseContentModule } from "@/domain/content";
import { getQuizAttempts, getDiscussionForums } from "@/adapters/courselink/api.extras";
import { applyOutlineDocument } from "./applyOutline";
import { mapLimit } from "./concurrency";

const DAY = 864e5;

async function safe<T>(p: Promise<T>, onError?: () => void): Promise<T | null> {
  try {
    return await p;
  } catch (e) {
    if (e instanceof SignedOutError) throw e;
    if (!(e instanceof HttpError && (e.status === 403 || e.status === 404))) onError?.();
    return null;
  }
}

function inWindow(a: Assessment, now = Date.now()): boolean {
  if (!a.due.iso) return true;
  const t = Date.parse(a.due.iso);
  if (!Number.isFinite(t)) return true;
  return t >= now - PAST_DAYS * DAY && t <= now + FUTURE_DAYS * DAY;
}

async function syncCourse(course: Course, le: string): Promise<{
  assessments: Assessment[];
  sources: SourceRecord[];
  announcements: Announcement[];
  outline: OutlineDiscoveryHit;
  failed: boolean;
  contentModules: CourseContentModule[];
  contentItems: CourseContentItem[];
  discussionNotes: string[];
}> {
  let failed = false;
  const markFailed = () => {
    failed = true;
  };

  const [folders, quizzes, gradeObjects, gradeValues, news, events, outlineHit] =
    await Promise.all([
      safe(getFolders(le, course.orgUnitId), markFailed),
      safe(getQuizzes(le, course.orgUnitId), markFailed),
      safe(getGradeObjects(le, course.orgUnitId)),
      safe(getMyGradeValues(le, course.orgUnitId)),
      safe(getNews(le, course.orgUnitId)),
      safe(getCalendarEvents(le, course.orgUnitId)),
      discoverCourseOutline(course, le).catch((e): OutlineDiscoveryHit => {
        if (e instanceof SignedOutError) throw e;
        return {
          document: null,
          parseResult: null,
          score: 0,
          status: "none_accessible",
          statusDetail: `Outline discovery error: ${String((e as Error).message ?? e)}`,
          candidatesTried: 0,
        };
      }),
    ]);

  const sources: SourceRecord[] = [];
  const rawAssessments: Assessment[] = [];

  for (const f of folders ?? []) {
    const r = fromFolder(f, course);
    if (r) {
      rawAssessments.push(r.assessment);
      sources.push(...r.sources);
    }
  }
  for (const q of quizzes ?? []) {
    const r = fromQuiz(q, course);
    if (r) {
      rawAssessments.push(r.assessment);
      sources.push(...r.sources);
    }
  }
  for (const e of events ?? []) {
    const a = assessmentFromCalendarEvent(e, course);
    if (a) rawAssessments.push(a);
  }


  for (const n of news ?? []) {
    rawAssessments.push(...assessmentsFromAnnouncement(n, course));
  }

  const tocModules = await safe(getContentToc(le, course.orgUnitId));
  if (tocModules?.length) {
    for (const t of flattenContentTopics(tocModules)) {
      if (!t.dueDate) continue;
      if (!/\b(assignment|quiz|lab|project|mid[- ]?term|final|exam|homework|hw|test)\b/i.test(t.title)) {
        continue;
      }
      const id = assessmentId(course.id, "content", String(t.id ?? t.title));
      const due = exactDate(t.dueDate);
      rawAssessments.push({
        id,
        courseId: course.id,
        title: t.title,
        type: /final/i.test(t.title)
          ? "final"
          : /mid[- ]?term/i.test(t.title)
            ? "midterm"
            : /quiz|test/i.test(t.title)
              ? "quiz"
              : /lab/i.test(t.title)
                ? "lab"
                : "assignment",
        due,
        start: unknownDate(),
        end: unknownDate(),
        weightPercent: null,
        pointsPossible: null,
        pointsEarned: null,
        submissionState: "unknown",
        submittedAt: null,
        gradeDisplay: null,
        url: t.url,
        notes: null,
        categoryId: null,
        isBonus: false,
        attemptNumber: null,
        state: { ...DEFAULT_ITEM_STATE },
        sourceRecords: [],
        fieldProvenance: {
          due: {
            value: due,
            sourceType: "courselink_content",
            sourceId: String(t.id ?? t.title),
            confidence: 0.7,
            retrievedAt: new Date().toISOString(),
          },
        },
        conflictIds: [],
        manualOverrides: {},
        updatedAt: new Date().toISOString(),
      });
    }
  }

  let items = rawAssessments.filter((a) => inWindow(a));
  items = await mapLimit(items, DEFAULT_CONCURRENCY, async (d) => {
    if (!d.id.includes(":dropbox:")) return d;
    const folderId = Number(d.id.split(":").pop());
    if (!Number.isFinite(folderId)) return d;
    return withSubmissions(
      d,
      await safe(getMySubmissions(le, course.orgUnitId, folderId)),
    );
  });

  items = applyGrades(items, gradeObjects ?? [], gradeValues ?? []);

  const announcements = (news ?? [])
    .map((n) => announcementFromNews(n, course))
    .filter((x): x is Announcement => x != null);

  const contentBuilt = tocModules?.length
    ? buildContentTree(course.id, course.orgUnitId, tocModules)
    : { modules: [] as CourseContentModule[], items: [] as CourseContentItem[] };

  // Explore quiz attempts when quizzes present (403 → empty; never fabricate).
  for (const q of quizzes ?? []) {
    const attempts = await safe(getQuizAttempts(le, course.orgUnitId, q.QuizId));
    if (attempts && attempts.length > 0) {
      const aid = items.find((a) => a.id.includes(`:quiz:${q.QuizId}`));
      if (aid) {
        const completed = attempts.filter((x) => x.Completed);
        if (completed.length) {
          aid.submissionState = "submitted";
          aid.submittedAt = completed[completed.length - 1].Completed;
          aid.attemptNumber = completed[completed.length - 1].AttemptNumber;
          aid.state = {
            ...aid.state,
            submission: "submitted",
            work: "completed",
            availability: "available",
          };
        }
      }
    }
  }

  const forums = await safe(getDiscussionForums(le, course.orgUnitId));
  const discussionNotes = (forums ?? []).slice(0, 20).map((f) => f.Name);

  return {
    assessments: items,
    sources,
    announcements,
    outline: outlineHit,
    failed,
    contentModules: contentBuilt.modules,
    contentItems: contentBuilt.items,
    discussionNotes,
  };
}

function mergeOutlineAssessments(
  course: Course,
  existing: Assessment[],
  data: AppData,
): Assessment[] {
  const doc = data.documents.find((d) => d.id === course.outlineDocumentId);
  if (!doc?.parseResult) return existing;
  const fromOutline: Assessment[] = doc.parseResult.assessments.map((oa, i) => ({
    id: `outline:${course.id}:${i}:${oa.title.toLowerCase().replace(/\s+/g, "-")}`,
    courseId: course.id,
    title: oa.title,
    type: oa.type,
    due: {
      certainty: oa.certainty,
      iso: oa.dueIso,
      label: oa.dueLabel,
    },
    start: { certainty: "unknown", iso: null, label: null },
    end: { certainty: "unknown", iso: null, label: null },
    weightPercent: oa.weightPercent,
    pointsPossible: null,
    pointsEarned: null,
    submissionState: "unknown" as const,
    submittedAt: null,
    gradeDisplay: null,
    url: null,
    notes: null,
    categoryId: null,
    isBonus: false,
    attemptNumber: null,
    state: { ...DEFAULT_ITEM_STATE },
    sourceRecords: [],
    fieldProvenance: {
      weightPercent: {
        value: oa.weightPercent,
        sourceType: "course_outline",
        sourceId: doc.id,
        confidence: oa.confidence,
        retrievedAt: doc.importedAt,
      },
      due: {
        value: { certainty: oa.certainty, iso: oa.dueIso, label: oa.dueLabel },
        sourceType: "course_outline",
        sourceId: doc.id,
        confidence: oa.confidence,
        retrievedAt: doc.importedAt,
      },
    },
    conflictIds: [],
    manualOverrides: {},
    updatedAt: new Date().toISOString(),
  }));
  return [...existing, ...fromOutline];
}

function setCourseOutlineStatus(
  data: AppData,
  courseId: string,
  status: OutlineDiscoveryStatus,
  detail: string | null,
): AppData {
  return {
    ...data,
    courses: data.courses.map((c) =>
      c.id === courseId
        ? { ...c, outlineStatus: status, outlineStatusDetail: detail }
        : c,
    ),
  };
}

export async function runSync(): Promise<void> {
  const before = await loadAppData();
  await saveAppData({
    ...before,
    pendingSync: false,
    sync: {
      ...before.sync,
      status: "syncing",
      startedAt: Date.now(),
      message: null,
    },
  });

  try {
    const { lp, le } = await getVersions();
    const who = await safe(getWhoAmI(lp));
    let data = await loadAppData();
    if (who) data = { ...data, user: toUser(who) };

    const rawCourses = (await getCourses()).filter(
      (c) => c.IsActive !== false && c.CanAccessCourse !== false,
    );

    const prevSelected = new Set(
      data.preferences.selectedCourseIds ??
        data.courses.filter((c) => c.selected).map((c) => c.id),
    );

    const courses = rawCourses
      .map((c, i) => {
        const mapped = toCourse(c, i);
        const prev = data.courses.find((p) => p.id === mapped.id);
        const color =
          data.preferences.courseColors[mapped.id] ??
          prev?.color ??
          COURSE_COLORS[i % COURSE_COLORS.length];
        const selected =
          prevSelected.size > 0 ? prevSelected.has(mapped.id) : isLikelyCurrent(mapped);
        return {
          ...mapped,
          color,
          selected,
          outlineDocumentId: prev?.outlineDocumentId ?? null,
          outlineStatus: prev?.outlineStatus ?? "not_checked",
          outlineStatusDetail: prev?.outlineStatusDetail ?? null,
          lectureSection: prev?.lectureSection ?? null,
          labSection: prev?.labSection ?? null,
          tutorialSection: prev?.tutorialSection ?? null,
          instructorNames: prev?.instructorNames ?? [],
        };
      })
      .sort((a, b) => a.code.localeCompare(b.code));

    if (data.preferences.selectedCourseIds == null) {
      data = {
        ...data,
        preferences: {
          ...data.preferences,
          selectedCourseIds: courses.filter((c) => c.selected).map((c) => c.id),
        },
      };
    }

    data = { ...data, courses };

    const selected = courses.filter((c) =>
      (data.preferences.selectedCourseIds ?? []).includes(c.id),
    );

    const results = await mapLimit(selected, DEFAULT_CONCURRENCY, (c) => syncCourse(c, le));

    const failedCodes: string[] = [];
    const assessments: Assessment[] = [];
    const sources: SourceRecord[] = [];
    const announcements: Announcement[] = [];
    const outlineSummaries: string[] = [];
    const contentModules: CourseContentModule[] = [];
    const contentItems: CourseContentItem[] = [];

    results.forEach((r, i) => {
      if (r.failed) failedCodes.push(selected[i].code);
      assessments.push(...r.assessments);
      sources.push(...r.sources);
      announcements.push(...r.announcements);
      contentModules.push(...(r.contentModules ?? []));
      contentItems.push(...(r.contentItems ?? []));

      const courseId = selected[i].id;
      const hit = r.outline;
      data = setCourseOutlineStatus(data, courseId, hit.status, hit.statusDetail);
      outlineSummaries.push(`${selected[i].code}: ${hit.status}`);

      if (hit.document) {
        const hasManual =
          !!data.documents.find(
            (d) => d.courseId === courseId && !d.id.startsWith("auto:") && !!d.parseResult,
          ) &&
          data.courses.find((c) => c.id === courseId)?.outlineDocumentId?.startsWith("auto:") ===
            false &&
          !!data.courses.find((c) => c.id === courseId)?.outlineDocumentId;
        data = applyOutlineDocument(data, courseId, hit.document, {
          preferExistingManual: hasManual,
        });
        // Re-apply status after applyOutline (which may not set it)
        data = setCourseOutlineStatus(data, courseId, hit.status, hit.statusDetail);
      }
    });

    let coursesAfter = data.courses;

    const preserved = before.assessments.filter(
      (a) => !selected.some((c) => c.id === a.courseId),
    );
    let combined = [...preserved];
    for (const c of selected) {
      const course = coursesAfter.find((x) => x.id === c.id) ?? c;
      const courseItems = assessments.filter((a) => a.courseId === c.id);
      const fromData = data.assessments.filter((a) => a.courseId === c.id);
      const hasOutlineItems = fromData.some((a) => a.id.startsWith("outline:"));
      if (hasOutlineItems) {
        const clOnly = courseItems.filter((a) => !a.id.startsWith("outline:"));
        const outlineOnly = fromData.filter((a) => a.id.startsWith("outline:"));
        combined.push(...reconcileAssessments([...clOnly, ...outlineOnly]).assessments);
      } else {
        combined.push(...mergeOutlineAssessments(course, courseItems, data));
      }
    }

    const prevById = new Map(before.assessments.map((a) => [a.id, a]));
    combined = combined.map((a) => {
      const prev = prevById.get(a.id);
      if (!prev) return a;
      return {
        ...a,
        manualOverrides: prev.manualOverrides,
        ...(Object.keys(prev.manualOverrides).length
          ? {
              title:
                typeof prev.manualOverrides.title === "string"
                  ? (prev.manualOverrides.title as string)
                  : a.title,
            }
          : {}),
      };
    });

    let reconciled = reconcileAssessments(combined);

    // Runtime personalization: user section config only â€” never inject CIS fixtures.
    const sectionConfigs = (data.preferences as { sectionConfigs?: Array<{
      courseId: string; lectureSection?: string | null; labSection?: string | null; tutorialSection?: string | null;
    }> }).sectionConfigs ?? [];
    coursesAfter = applySectionConfig(coursesAfter, sectionConfigs);
    data = { ...data, courses: coursesAfter, academicRules: (data.academicRules ?? []).map((r) => ensureTypedRule(r as never)) };

    // Build meeting patterns/occurrences from known meetings + semester window (not from "now").
    const patterns = [];
    const occurrences = [];
    for (const c of coursesAfter) {
      const rangeStart = (c.startDate ?? "2026-09-10").slice(0, 10);
      const rangeEnd = (c.endDate ?? "2026-12-04").slice(0, 10);
      const courseMeetings = data.meetings.filter((m) => m.courseId === c.id);
      const pats = patternsFromLegacyMeetings(courseMeetings, rangeStart, rangeEnd, "ics");
      patterns.push(...pats);
      const key = courseKeyFromCode(c.code);
      for (const pat of pats) {
        occurrences.push(...generateOccurrences(pat, [], key));
      }
    }
    data = {
      ...data,
      meetingPatterns: patterns,
      meetingOccurrences: occurrences,
    };

    const typedRules = data.academicRules;
    const { assessments: withDeadlines } = applyOccurrenceDeadlines(
      reconciled.assessments,
      occurrences,
      typedRules,
    );
    reconciled = { ...reconciled, assessments: withDeadlines };

    const newChanges = detectAssessmentChanges(before.assessments, reconciled.assessments);
    const changes = [...newChanges, ...(before.changes ?? []).filter((ch) => ch.read)].slice(0, 200);

    reconciled = {
      ...reconciled,
      assessments: reconciled.assessments.map((a) => {
        if (!a.due.iso || a.submissionState === "submitted") return a;
        if (Date.parse(a.due.iso) >= Date.now()) return a;
        if (a.state?.pastDueConfirmed) return a;
        return {
          ...a,
          state: {
            ...DEFAULT_ITEM_STATE,
            ...a.state,
            needsConfirmation: true,
            submission: a.submissionState,
          },
        };
      }),
    };

    const term = currentSemester(data.courses);
    const academicDates = seedAcademicDates(term);

    const outlineMsg =
      outlineSummaries.length > 0
        ? `Outlines ? ${outlineSummaries.join("; ")}`
        : null;

    // Preserve content for courses not in this sync selection
    const preservedMods = (before.contentModules ?? []).filter(
      (m) => !selected.some((c) => c.id === m.courseId),
    );
    const preservedItems = (before.contentItems ?? []).filter(
      (m) => !selected.some((c) => c.id === m.courseId),
    );

    data = {
      ...data,
      assessments: reconciled.assessments,
      conflicts: [
        ...before.conflicts.filter((c) => !c.unresolved),
        ...reconciled.conflicts,
      ],
      sourceRecords: sources,
      announcements,
      academicDates,
      changes,
      contentModules: [...preservedMods, ...contentModules],
      contentItems: [...preservedItems, ...contentItems],
      sync: failedCodes.length
        ? {
            status: "error",
            lastSyncedAt: before.sync.lastSyncedAt,
            startedAt: null,
            message: `couldn't load ${failedCodes.join(", ")}${outlineMsg ? ` Â· ${outlineMsg}` : ""}`,
          }
        : {
            status: "idle",
            lastSyncedAt: Date.now(),
            startedAt: null,
            message: outlineMsg,
          },
    };

    await saveAppData(data);
  } catch (e) {
    const signedOut = e instanceof SignedOutError;
    const current = await loadAppData();
    await saveAppData({
      ...current,
      sync: {
        status: signedOut ? "signed_out" : "error",
        lastSyncedAt: before.sync.lastSyncedAt,
        startedAt: null,
        message: signedOut ? null : String((e as Error).message ?? e),
      },
    });
  }
}

