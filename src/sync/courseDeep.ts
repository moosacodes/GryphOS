/**
 * Per-course deep reconstruction against authenticated Brightspace session.
 */
import {
  getCalendarEvents,
  getContentToc,
  getFolders,
  getGradeObjects,
  getMyGradeValues,
  getMySubmissions,
  getNews,
  getQuizzes,
} from "@/adapters/courselink/api";
import {
  getChecklists,
  getDiscussionForums,
  getDiscussionPosts,
  getDiscussionTopics,
  getGradeCategories,
  getGroups,
  getMyDropboxFeedback,
  getQuizAttempts,
  type ExploreLog,
} from "@/adapters/courselink/api.extras";
import {
  discoverCourseOutline,
  flattenContentTopics,
  type OutlineDiscoveryHit,
} from "@/adapters/courselink/discoverOutlines";
import { assessmentId } from "@/domain/ids";
import { exactDate, unknownDate } from "@/domain/dates";
import type {
  Announcement,
  AnnouncementFact,
  ApiExplorationEntry,
  Assessment,
  Course,
  FeedbackRecord,
  GradeCategory,
  GradeRecord,
  QuizAttemptRecord,
  SourceRecord,
} from "@/domain/types";
import { DEFAULT_ITEM_STATE } from "@/domain/types";
import {
  announcementFromNews,
  assessmentsFromAnnouncement,
  applyGrades,
  assessmentFromCalendarEvent,
  fromFolder,
  fromQuiz,
  withSubmissions,
} from "@/normalize/assessment";
import { enrichAnnouncement, extractAnnouncementFacts } from "@/ingestion/announcementFacts";
import {
  mapForum,
  mapPost,
  mapTopic,
  staffClarificationsFromPosts,
  staffNamesFromCourse,
} from "@/ingestion/discussions";
import { buildDeepContentTree, ingestContentFiles } from "@/ingestion/contentIngest";
import { mapGradebook, mapGradeCategories } from "@/ingestion/gradebook";
import { detectExternalActivities } from "@/ingestion/externalTools";
import { buildCourseCoverage } from "@/ingestion/coverageBuild";
import type { CourseSourceCoverage } from "@/domain/coverage";
import type { DiscussionForum, DiscussionPost, DiscussionTopicLocal } from "@/domain/discussions";
import type { CourseContentItem, CourseContentModule, LibraryResource } from "@/domain/content";
import type { EntityLink, ExtractedFact } from "@/domain/facts";
import type { ChangeEvent, ExternalActivity, Person } from "@/domain/types";
import { mapLimit } from "@/sync/concurrency";
import { DEFAULT_CONCURRENCY, PAST_DAYS, FUTURE_DAYS } from "@/domain/constants";
import { SignedOutError, HttpError } from "@/adapters/courselink/api";
import { scheduleFromCalendarEvents, type CalendarScheduleBundle } from "@/sync/scheduleFromCalendar";

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

export interface CourseSyncResult {
  assessments: Assessment[];
  sources: SourceRecord[];
  announcements: Announcement[];
  announcementFacts: AnnouncementFact[];
  outline: OutlineDiscoveryHit;
  failed: boolean;
  contentModules: CourseContentModule[];
  contentItems: CourseContentItem[];
  discussionForums: DiscussionForum[];
  discussionTopics: DiscussionTopicLocal[];
  discussionPosts: DiscussionPost[];
  quizAttempts: QuizAttemptRecord[];
  feedbackRecords: FeedbackRecord[];
  gradeCategories: GradeCategory[];
  gradeRecords: GradeRecord[];
  libraryResources: LibraryResource[];
  externalActivities: ExternalActivity[];
  entityLinks: EntityLink[];
  extractedFacts: ExtractedFact[];
  contentChanges: ChangeEvent[];
  coverage: CourseSourceCoverage;
  apiLog: ApiExplorationEntry[];
  schedule: CalendarScheduleBundle;
}

export async function syncCourseDeep(
  course: Course,
  le: string,
  opts: {
    people: Person[];
    prevLibrary: LibraryResource[];
    userId: string | null;
  },
): Promise<CourseSyncResult> {
  let failed = false;
  const markFailed = () => {
    failed = true;
  };
  const explore: ExploreLog = { entries: [], courseId: course.id };

  const [folders, quizzes, gradeObjects, gradeValues, news, events, outlineHit, gradeCats] =
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
      getGradeCategories(le, course.orgUnitId, explore),
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
    return withSubmissions(d, await safe(getMySubmissions(le, course.orgUnitId, folderId)));
  });

  items = applyGrades(items, gradeObjects ?? [], gradeValues ?? []);

  // Feedback
  const feedbackRecords: FeedbackRecord[] = [];
  if (opts.userId) {
    for (const d of items.filter((a) => a.id.includes(":dropbox:"))) {
      const folderId = Number(d.id.split(":").pop());
      if (!Number.isFinite(folderId)) continue;
      const fb = await getMyDropboxFeedback(le, course.orgUnitId, folderId, opts.userId, explore);
      if (fb?.Feedback) {
        const text =
          fb.Feedback.Text ?? fb.Feedback.Html?.replace(/<[^>]+>/g, " ") ?? "";
        const cleaned = text.replace(/\s+/g, " ").trim();
        if (cleaned) {
          feedbackRecords.push({
            id: `fb:${course.id}:${folderId}`,
            courseId: course.id,
            assessmentId: d.id,
            folderId,
            text: cleaned,
            score: fb.Score ?? null,
            retrievedAt: new Date().toISOString(),
            source: "dropbox",
          });
        }
      }
    }
  }

  // Quiz attempts
  const quizAttempts: QuizAttemptRecord[] = [];
  let attemptsDiscovered = 0;
  for (const q of quizzes ?? []) {
    const attempts = await getQuizAttempts(
      le,
      course.orgUnitId,
      q.QuizId,
      opts.userId ?? undefined,
      explore,
    );
    attemptsDiscovered += attempts.length;
    const aid = items.find((a) => a.id.includes(`:quiz:${q.QuizId}`));
    for (const at of attempts) {
      quizAttempts.push({
        id: `qattempt:${course.id}:${q.QuizId}:${at.AttemptId}`,
        courseId: course.id,
        assessmentId: aid?.id ?? null,
        quizId: q.QuizId,
        attemptId: at.AttemptId,
        attemptNumber: at.AttemptNumber,
        score: at.Score,
        startedAt: at.Started,
        completedAt: at.Completed,
        isPublished: !!at.IsPublished,
      });
    }
    if (aid && attempts.length) {
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

  // Closed quiz + no attempt + no grade → needs confirmation (not auto-missed)
  for (const a of items) {
    if (a.type !== "quiz") continue;
    const closed =
      (a.end.iso && Date.parse(a.end.iso) < Date.now()) ||
      (a.due.iso && Date.parse(a.due.iso) < Date.now());
    const hasAttempt = quizAttempts.some((q) => q.assessmentId === a.id);
    const hasGrade = a.pointsEarned != null || !!a.gradeDisplay;
    if (closed && !hasAttempt && !hasGrade && a.submissionState !== "submitted") {
      a.state = {
        ...DEFAULT_ITEM_STATE,
        ...a.state,
        needsConfirmation: true,
        missed: false,
        submission: a.submissionState,
      };
    }
  }

  // Content tree
  const contentBuilt = tocModules?.length
    ? buildDeepContentTree(
        course.id,
        course.orgUnitId,
        tocModules,
        items.map((a) => a.title),
      )
    : { modules: [] as CourseContentModule[], items: [] as CourseContentItem[] };

  const ingested = await ingestContentFiles(
    le,
    course.orgUnitId,
    course.id,
    contentBuilt.items,
    contentBuilt.modules,
    opts.prevLibrary,
    items,
    35,
  );

  // Link downloaded specs/labs into assessment notes (outline remains primary blueprint).
  for (const lib of ingested.library) {
    if (!lib.assessmentId || !lib.textContent || lib.textContent.length < 80) continue;
    const idx = items.findIndex((a) => a.id === lib.assessmentId);
    if (idx < 0) continue;
    const a = items[idx]!;
    if (a.notes && a.notes.length > 40) continue;
    const snippet = lib.textContent.replace(/\s+/g, " ").trim().slice(0, 280);
    items[idx] = {
      ...a,
      notes: `Material: ${lib.filename} — ${snippet}`,
    };
  }

  // Discussions (forums → topics → posts)
  const forumsRaw = await getDiscussionForums(le, course.orgUnitId, explore);
  const discussionForums = forumsRaw.filter((f) => !f.IsHidden).map((f) => mapForum(course.id, f));
  const discussionTopics: DiscussionTopicLocal[] = [];
  const discussionPosts: DiscussionPost[] = [];
  let postsUnavailable = false;
  const staff = staffNamesFromCourse(course, opts.people);

  for (const forum of discussionForums.slice(0, 25)) {
    const topics = await getDiscussionTopics(le, course.orgUnitId, forum.forumId, explore);
    for (const t of topics) {
      if (t.IsHidden) continue;
      const topic = mapTopic(course.id, forum.forumId, t);
      discussionTopics.push(topic);
      const posts = await getDiscussionPosts(
        le,
        course.orgUnitId,
        forum.forumId,
        topic.topicId,
        explore,
      );
      if (
        posts.length === 0 &&
        explore.entries.some(
          (e) =>
            e.endpoint.includes(`/topics/${topic.topicId}/posts`) &&
            (e.status === 403 || e.status === 404),
        )
      ) {
        postsUnavailable = true;
      }
      for (const p of posts) {
        if (p.IsDeleted) continue;
        discussionPosts.push(mapPost(course, p, staff));
      }
    }
  }

  const staffPack = staffClarificationsFromPosts(
    discussionPosts,
    items,
  );

  // Announcements deep parse
  let announcements = (news ?? [])
    .map((n) => announcementFromNews(n, course))
    .filter((x): x is Announcement => x != null)
    .map((n) => enrichAnnouncement(n, items));

  const announcementFacts: AnnouncementFact[] = [];
  for (const n of announcements) {
    announcementFacts.push(...extractAnnouncementFacts(n, items));
  }
  // re-attach fact ids
  announcements = announcements.map((n) => ({
    ...n,
    extractedFactIds: announcementFacts.filter((f) => f.announcementId === n.id).map((f) => f.id),
  }));

  // Gradebook
  const gradeCategories = mapGradeCategories(course.id, gradeCats);
  const { records: gradeRecords } = mapGradebook(
    course.id,
    gradeObjects ?? [],
    gradeValues ?? [],
    items,
    gradeCategories,
  );

  // External tools
  const ext = detectExternalActivities(
    course.id,
    [...contentBuilt.items.map((i) => i.title), ...ingested.library.map((l) => l.filename)],
    items,
  );
  items = [...items, ...ext.syntheticAssessments.filter((s) => inWindow(s))];

  // Checklists / groups (diagnostic)
  const checklists = await getChecklists(le, course.orgUnitId, explore);
  const groups = await getGroups(le, course.orgUnitId, explore);

  const rangeStart = (course.startDate ?? "2026-09-10").slice(0, 10);
  const rangeEnd = (course.endDate ?? "2026-12-04").slice(0, 10);
  const schedule = scheduleFromCalendarEvents(course, events ?? [], rangeStart, rangeEnd);

  const coverage = buildCourseCoverage({
    courseId: course.id,
    orgUnitId: course.orgUnitId,
    dropbox: { discovered: folders?.length ?? 0, ingested: items.filter((a) => a.id.includes(":dropbox:")).length },
    quizzes: {
      discovered: quizzes?.length ?? 0,
      ingested: items.filter((a) => a.id.includes(":quiz:")).length,
      attemptsDiscovered,
      attemptsIngested: quizAttempts.length,
    },
    grades: {
      objects: gradeObjects?.length ?? 0,
      values: gradeValues?.length ?? 0,
      categories: gradeCategories.length,
      unmatched: gradeRecords.filter((g) => g.unmatched).length,
    },
    news: {
      discovered: news?.length ?? 0,
      ingested: announcements.length,
      facts: announcementFacts.length,
    },
    calendar: {
      discovered: events?.length ?? 0,
      ingested: items.filter((a) => a.id.includes(":cal:")).length,
    },
    content: {
      modules: contentBuilt.modules.length,
      topics: contentBuilt.items.length,
      filesDownloaded: ingested.library.length,
    },
    discussions: {
      forums: discussionForums.length,
      topics: discussionTopics.length,
      posts: discussionPosts.length,
      postsUnavailable: postsUnavailable && discussionPosts.length === 0 && discussionForums.length > 0,
    },
    feedback: { ingested: feedbackRecords.length },
    checklists: { discovered: checklists.length },
    groups: { discovered: groups.length },
  });

  return {
    assessments: items,
    sources,
    announcements,
    announcementFacts,
    outline: outlineHit,
    failed,
    contentModules: contentBuilt.modules,
    contentItems: ingested.items,
    discussionForums,
    discussionTopics,
    discussionPosts,
    quizAttempts,
    feedbackRecords,
    gradeCategories,
    gradeRecords,
    libraryResources: ingested.library,
    externalActivities: ext.activities,
    entityLinks: staffPack.links,
    extractedFacts: staffPack.facts,
    contentChanges: ingested.changes,
    coverage,
    apiLog: explore.entries,
    schedule,
  };
}

