/**
 * Synchronization engine: CourseLink → normalize → reconcile â†’ local storage.
 * Adapted from dawhatnow/gryphCal sync patterns (MIT).
 */
import {
  SignedOutError,
  getCourses,
  getVersions,
  getWhoAmI,
} from "@/adapters/courselink/api";
import { seedAcademicDates } from "@/adapters/uofg/academicDates";
import { COURSE_COLORS, DEFAULT_CONCURRENCY } from "@/domain/constants";
import type {
  Announcement,
  AnnouncementFact,
  AppData,
  Assessment,
  Course,
  OutlineDiscoveryStatus,
  SourceRecord,
} from "@/domain/types";
import { currentSemester, isLikelyCurrent, toCourse, toUser } from "@/normalize/course";
import { reconcileAssessments } from "@/reconcile/merge";
import { loadAppData, saveAppData } from "@/storage/repository";
import { applySectionConfig } from "@/adapters/uofg/personalization";
import { applyOccurrenceDeadlines } from "@/engines/deadlines";
import { patternsFromLegacyMeetings, generateOccurrences, courseKeyFromCode } from "@/domain/meetings";
import type { MeetingOccurrence, RecurringMeetingPattern } from "@/domain/meetings";
import type { Meeting, CalendarEventItem } from "@/domain/types";
import { ensureTypedRule } from "@/domain/rules";
import { DEFAULT_ITEM_STATE } from "@/domain/types";
import { detectAssessmentChanges } from "./changes";
import type { CourseContentItem, CourseContentModule } from "@/domain/content";
import { applyOutlineDocument } from "./applyOutline";
import { mapLimit } from "./concurrency";
import { syncCourseDeep } from "./courseDeep";
import { buildEntityLinks } from "@/ingestion/entityLinking";
import { applyDeadlineFacts } from "@/ingestion/applyClarifications";
import { rebuildSearchIndex } from "@/ingestion/searchIndex";
import type { LibraryResource } from "@/domain/content";
import type { DiscussionForum, DiscussionPost, DiscussionTopicLocal } from "@/domain/discussions";
import type { CourseSourceCoverage } from "@/domain/coverage";
import type {
  ApiExplorationEntry,
  ExternalActivity,
  FeedbackRecord,
  GradeCategory,
  GradeRecord,
  QuizAttemptRecord,
  ChangeEvent,
} from "@/domain/types";
import type { EntityLink, ExtractedFact } from "@/domain/facts";
import { HttpError } from "@/adapters/courselink/api";
import { resetSyncTrace, takeSyncTrace } from "@/diagnostics/trace";

async function safe<T>(p: Promise<T>): Promise<T | null> {
  try {
    return await p;
  } catch (err) {
    if (err instanceof SignedOutError) throw err;
    if (!(err instanceof HttpError && (err.status === 403 || err.status === 404))) {
      /* non-fatal */
    }
    return null;
  }
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


/** Prefer CourseLink grade categories; fill missing weights/bestN from outline blueprint cats. */
function mergeGradeCategoriesForSync(
  selectedIds: string[],
  fromCourseLink: GradeCategory[],
  fromData: GradeCategory[],
): GradeCategory[] {
  const out: GradeCategory[] = [];
  for (const courseId of selectedIds) {
    const cl = fromCourseLink.filter((g) => g.courseId === courseId);
    const outline = fromData.filter(
      (g) => g.courseId === courseId && g.id.startsWith("gcat:"),
    );
    if (cl.length === 0) {
      out.push(...outline);
      continue;
    }
    out.push(
      ...cl.map((c) => {
        const match = outline.find(
          (o) => o.name.toLowerCase() === c.name.toLowerCase(),
        );
        if (!match) return c;
        return {
          ...c,
          weightPercent: c.weightPercent ?? match.weightPercent,
          dropLowest: c.dropLowest || match.dropLowest,
          bestN: c.bestN ?? match.bestN,
          gradeCapPercent: c.gradeCapPercent ?? match.gradeCapPercent,
          thresholdPercent: c.thresholdPercent ?? match.thresholdPercent,
        };
      }),
    );
    // Outline-only categories (e.g. not mirrored in Brightspace gradebook yet)
    for (const o of outline) {
      if (!cl.some((c) => c.name.toLowerCase() === o.name.toLowerCase())) {
        out.push(o);
      }
    }
  }
  return out;
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
  resetSyncTrace();
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

    const results = await mapLimit(selected, DEFAULT_CONCURRENCY, (c) =>
      syncCourseDeep(c, le, {
        people: data.people ?? [],
        prevLibrary: (before.libraryResources ?? []).filter((l) => l.courseId === c.id),
        userId: data.user?.id ?? null,
      }),
    );

    const failedCodes: string[] = [];
    const assessments: Assessment[] = [];
    const sources: SourceRecord[] = [];
    const announcements: Announcement[] = [];
    const announcementFacts: AnnouncementFact[] = [];
    const outlineSummaries: string[] = [];
    const contentModules: CourseContentModule[] = [];
    const contentItems: CourseContentItem[] = [];
    const discussionForums: DiscussionForum[] = [];
    const discussionTopics: DiscussionTopicLocal[] = [];
    const discussionPosts: DiscussionPost[] = [];
    const quizAttempts: QuizAttemptRecord[] = [];
    const feedbackRecords: FeedbackRecord[] = [];
    const gradeCategories: GradeCategory[] = [];
    const gradeRecords: GradeRecord[] = [];
    const libraryResources: LibraryResource[] = [];
    const externalActivities: ExternalActivity[] = [];
    let entityLinks: EntityLink[] = [];
    const extractedFacts: ExtractedFact[] = [];
    const contentChanges: ChangeEvent[] = [];
    const sourceCoverage: CourseSourceCoverage[] = [];
    const apiExplorationLog: ApiExplorationEntry[] = [];
    const calMeetings: Meeting[] = [];
    const calPatterns: RecurringMeetingPattern[] = [];
    const calOccurrences: MeetingOccurrence[] = [];
    const calItems: CalendarEventItem[] = [];

    results.forEach((r, i) => {
      if (r.failed) failedCodes.push(selected[i].code);
      assessments.push(...r.assessments);
      sources.push(...r.sources);
      announcements.push(...r.announcements);
      announcementFacts.push(...r.announcementFacts);
      contentModules.push(...(r.contentModules ?? []));
      contentItems.push(...(r.contentItems ?? []));
      discussionForums.push(...r.discussionForums);
      discussionTopics.push(...r.discussionTopics);
      discussionPosts.push(...r.discussionPosts);
      quizAttempts.push(...r.quizAttempts);
      feedbackRecords.push(...r.feedbackRecords);
      gradeCategories.push(...r.gradeCategories);
      gradeRecords.push(...r.gradeRecords);
      libraryResources.push(...r.libraryResources);
      externalActivities.push(...r.externalActivities);
      entityLinks.push(...r.entityLinks);
      extractedFacts.push(...r.extractedFacts);
      contentChanges.push(...r.contentChanges);
      sourceCoverage.push(r.coverage);
      apiExplorationLog.push(...r.apiLog);
      calMeetings.push(...r.schedule.meetings);
      calPatterns.push(...r.schedule.patterns);
      calOccurrences.push(...r.schedule.occurrences);
      calItems.push(...r.schedule.calendarItems);

      const courseId = selected[i].id;
      const hit = r.outline;
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
          blueprint: hit.blueprint ?? null,
          memory: hit.memory ?? null,
        });
        // applyOutline owns outlineStatus/detail — do not clobber with discovery hit.
        // Surface blocked-download uncertainty only when preferExistingManual skipped apply.
        if (hasManual && hit.status === "blocked") {
          data = setCourseOutlineStatus(
            data,
            courseId,
            "blocked",
            hit.statusDetail ?? "Outline download blocked; using manual import",
          );
        }
      } else {
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

    // Runtime personalization: user section config only — never inject CIS fixtures.
    const sectionConfigs = (data.preferences as { sectionConfigs?: Array<{
      courseId: string; lectureSection?: string | null; labSection?: string | null; tutorialSection?: string | null;
    }> }).sectionConfigs ?? [];
    coursesAfter = applySectionConfig(coursesAfter, sectionConfigs);
    data = { ...data, courses: coursesAfter, academicRules: (data.academicRules ?? []).map((r) => ensureTypedRule(r as never)) };

    // Meetings: keep manual / ICS-derived rows; replace CourseLink-calendar rows for selected courses.
    const preservedMeetings = (before.meetings ?? []).filter(
      (m) =>
        !selected.some((c) => c.id === m.courseId) ||
        (!m.id.startsWith("meet:cal:") && m.notes !== "From CourseLink calendar"),
    );
    const meetingsMerged = [...preservedMeetings, ...calMeetings];

    // Build patterns/occurrences from meetings + calendar-derived patterns/discrete events
    const patterns: RecurringMeetingPattern[] = [...calPatterns];
    const occurrences: MeetingOccurrence[] = [];
    for (const c of coursesAfter) {
      const rangeStart = (c.startDate ?? "2026-09-10").slice(0, 10);
      const rangeEnd = (c.endDate ?? "2026-12-04").slice(0, 10);
      const courseMeetings = meetingsMerged.filter((m) => m.courseId === c.id);
      const pats = patternsFromLegacyMeetings(
        courseMeetings,
        rangeStart,
        rangeEnd,
        courseMeetings.some((m) => m.id.startsWith("meet:cal:")) ? "courselink_calendar" : "ics",
      );
      // Avoid duplicating patterns already produced by scheduleFromCalendar
      for (const pat of pats) {
        if (!patterns.some((p) => p.id === pat.id)) patterns.push(pat);
      }
      const key = courseKeyFromCode(c.code);
      for (const pat of pats) {
        if (calPatterns.some((p) => p.id === pat.id)) continue;
        occurrences.push(...generateOccurrences(pat, [], key));
      }
    }
    // Concrete CourseLink calendar occurrences (and pattern expansions from CL)
    occurrences.push(...calOccurrences);
    // Dedupe occurrences by id
    const occSeen = new Set<string>();
    const occDeduped = occurrences.filter((o) => {
      if (occSeen.has(o.id)) return false;
      occSeen.add(o.id);
      return true;
    });

    const preservedCal = (before.calendarEvents ?? []).filter(
      (e) =>
        e.sourceType !== "courselink_calendar" ||
        !e.courseId ||
        !selected.some((c) => c.id === e.courseId),
    );

    data = {
      ...data,
      meetings: meetingsMerged,
      meetingPatterns: patterns,
      meetingOccurrences: occDeduped,
      calendarEvents: [...preservedCal, ...calItems],
    };

    const typedRules = data.academicRules;
    const { assessments: withDeadlines } = applyOccurrenceDeadlines(
      reconciled.assessments,
      occurrences,
      typedRules,
    );
    reconciled = { ...reconciled, assessments: withDeadlines };

    // Apply staff/announcement deadline clarifications
    const clarified = applyDeadlineFacts(
      reconciled.assessments,
      announcementFacts,
      extractedFacts,
    );
    reconciled = {
      assessments: clarified.assessments,
      conflicts: [...reconciled.conflicts, ...clarified.conflicts],
    };

    // Entity linking across sources
    const linkBundle = buildEntityLinks({
      assessments: reconciled.assessments,
      contentItems,
      library: libraryResources,
      announcements,
      announcementFacts,
      gradeRecords,
      feedback: feedbackRecords,
      calendarEvents: data.calendarEvents ?? [],
    });
    entityLinks = [...entityLinks, ...linkBundle];

    const newChanges = detectAssessmentChanges(before.assessments, reconciled.assessments);
    // Inbox: real changes only — assessment diffs + content version updates (no sync churn)
    const changes = [
      ...contentChanges,
      ...newChanges,
      ...(before.changes ?? []).filter((ch) => ch.read),
    ].slice(0, 300);

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
        ? `Outlines — ${outlineSummaries.join("; ")}`
        : null;

    const preserve = <T extends { courseId: string }>(arr: T[] | undefined) =>
      (arr ?? []).filter((m) => !selected.some((c) => c.id === m.courseId));

    data = {
      ...data,
      assessments: reconciled.assessments,
      conflicts: [
        ...before.conflicts.filter((c) => !c.unresolved),
        ...reconciled.conflicts,
      ],
      sourceRecords: sources,
      announcements,
      announcementFacts: [...preserve(before.announcementFacts), ...announcementFacts],
      academicDates,
      changes,
      contentModules: [...preserve(before.contentModules), ...contentModules],
      contentItems: [...preserve(before.contentItems), ...contentItems],
      discussionForums: [...preserve(before.discussionForums), ...discussionForums],
      discussionTopics: [...preserve(before.discussionTopics), ...discussionTopics],
      discussionPosts: [...preserve(before.discussionPosts), ...discussionPosts],
      quizAttempts: [...preserve(before.quizAttempts), ...quizAttempts],
      feedbackRecords: [...preserve(before.feedbackRecords), ...feedbackRecords],
      gradeCategories: [...preserve(before.gradeCategories), ...mergeGradeCategoriesForSync(selected.map((c) => c.id), gradeCategories, data.gradeCategories ?? [])],
      gradeRecords: [...preserve(before.gradeRecords), ...gradeRecords],
      libraryResources: [...preserve(before.libraryResources), ...libraryResources],
      externalActivities: [...preserve(before.externalActivities), ...externalActivities],
      entityLinks: [
        ...(before.entityLinks ?? []).filter((l) => {
          const courseIds = new Set(selected.map((c) => c.id));
          const fromCourse =
            reconciled.assessments.find((a) => a.id === l.fromId)?.courseId ??
            contentItems.find((c) => c.id === l.fromId)?.courseId ??
            announcements.find((a) => a.id === l.fromId)?.courseId;
          return !fromCourse || !courseIds.has(fromCourse);
        }),
        ...entityLinks,
      ],
      extractedFacts: [
        ...(before.extractedFacts ?? []).filter(
          (f) => !f.courseId || !selected.some((c) => c.id === f.courseId),
        ),
        ...extractedFacts,
      ],
      sourceArtifacts: [
        ...(before.sourceArtifacts ?? []).filter(
          (s) => !s.courseId || !selected.some((c) => c.id === s.courseId),
        ),
      ],
      sourceCoverage: [
        ...(before.sourceCoverage ?? []).filter((s) => !selected.some((c) => c.id === s.courseId)),
        ...sourceCoverage,
      ],
      apiExplorationLog: [...apiExplorationLog].slice(-500),
      sync: failedCodes.length
        ? {
            status: "error",
            lastSyncedAt: before.sync.lastSyncedAt,
            startedAt: null,
            message: `couldn't load ${failedCodes.join(", ")}${outlineMsg ? ` · ${outlineMsg}` : ""}`,
          }
        : {
            status: "idle",
            lastSyncedAt: Date.now(),
            startedAt: null,
            message: [
              `${reconciled.assessments.filter((a) => selected.some((c) => c.id === a.courseId)).length} assessments`,
              `${occDeduped.filter((o) => selected.some((c) => c.id === o.courseId)).length} class times`,
              `${announcements.length} announcements`,
              outlineMsg,
            ]
              .filter(Boolean)
              .join(" · "),
          },
    };

    data = { ...data, searchIndex: rebuildSearchIndex(data), syncTrace: takeSyncTrace() };

    await saveAppData(data);
  } catch (e) {
    const signedOut = e instanceof SignedOutError;
    const current = await loadAppData();
    await saveAppData({
      ...current,
      syncTrace: takeSyncTrace(),
      sync: {
        status: signedOut ? "signed_out" : "error",
        lastSyncedAt: before.sync.lastSyncedAt,
        startedAt: null,
        message: signedOut ? null : String((e as Error).message ?? e),
      },
    });
  }
}

