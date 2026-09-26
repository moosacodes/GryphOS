import { STORAGE_SCHEMA_VERSION } from "@/domain/constants";
import type { AppData, Assessment, Course, Meeting, AcademicItemState } from "@/domain/types";
import { DEFAULT_ITEM_STATE } from "@/domain/types";
import { ensureTypedRule } from "@/domain/rules";
import { emptyAppData } from "./schema";

type Migration = (data: AppData) => AppData;

function ensureState(s?: Partial<AcademicItemState> | null): AcademicItemState {
  return { ...DEFAULT_ITEM_STATE, ...(s ?? {}) };
}

const migrations: Record<number, Migration> = {
  4: (data) => ({
    ...data,
    discussionForums: data.discussionForums ?? [],
    discussionTopics: data.discussionTopics ?? [],
    discussionPosts: data.discussionPosts ?? [],
    announcementFacts: data.announcementFacts ?? [],
    quizAttempts: data.quizAttempts ?? [],
    feedbackRecords: data.feedbackRecords ?? [],
    libraryResources: data.libraryResources ?? [],
    sourceCoverage: data.sourceCoverage ?? [],
    apiExplorationLog: data.apiExplorationLog ?? [],
    searchIndex: data.searchIndex ?? [],
    people: (data.people ?? []).map((p) => ({
      ...p,
      aliases: p.aliases ?? [],
      role: p.role === "other" || p.role === "instructor" || p.role === "ta" || p.role === "staff" ? p.role : "other",
    })),
    gradeCategories: (data.gradeCategories ?? []).map((g) => ({
      ...g,
      brightspaceCategoryId: g.brightspaceCategoryId ?? null,
    })),
    gradeRecords: (data.gradeRecords ?? []).map((g) => ({
      ...g,
      gradeObjectId: g.gradeObjectId ?? null,
      categoryId: g.categoryId ?? null,
      feedbackText: g.feedbackText ?? null,
      maxPoints: g.maxPoints ?? null,
      weightPercent: g.weightPercent ?? null,
      unmatched: g.unmatched ?? false,
    })),
    externalActivities: (data.externalActivities ?? []).map((e) => ({
      ...e,
      activityKey: e.activityKey ?? null,
      parentGroupId: e.parentGroupId ?? null,
      bestNOf: e.bestNOf ?? null,
      groupSize: e.groupSize ?? null,
      assessmentId: e.assessmentId ?? null,
    })),
    contentItems: (data.contentItems ?? []).map((ci) => ({
      ...ci,
      topicId: ci.topicId ?? null,
      mimeType: ci.mimeType ?? null,
      topicType: ci.topicType ?? null,
      descriptionText: ci.descriptionText ?? null,
      bodyText: ci.bodyText ?? null,
      startDate: ci.startDate ?? null,
      endDate: ci.endDate ?? null,
      dueDate: ci.dueDate ?? null,
      completionRequired: ci.completionRequired ?? null,
      completionCompleted: ci.completionCompleted ?? null,
      isHidden: ci.isHidden ?? false,
      isExternal: ci.isExternal ?? false,
      externalUrl: ci.externalUrl ?? null,
      linkedActivityId: ci.linkedActivityId ?? null,
      sortOrder: ci.sortOrder ?? 0,
      libraryResourceId: ci.libraryResourceId ?? null,
      previousContentHash: ci.previousContentHash ?? null,
    })),
    contentModules: (data.contentModules ?? []).map((cm) => ({
      ...cm,
      descriptionText: cm.descriptionText ?? null,
      startDate: cm.startDate ?? null,
      endDate: cm.endDate ?? null,
      isHidden: cm.isHidden ?? false,
      rawModuleId: cm.rawModuleId ?? null,
    })),
  }),
  3: (data) => ({
    ...data,
    sourceArtifacts: data.sourceArtifacts ?? [],
    extractedFacts: data.extractedFacts ?? [],
    entityLinks: data.entityLinks ?? [],
    meetingPatterns: data.meetingPatterns ?? [],
    meetingOccurrences: data.meetingOccurrences ?? [],
    contentModules: data.contentModules ?? [],
    contentItems: data.contentItems ?? [],
    calculationStates: data.calculationStates ?? [],
    academicRules: (data.academicRules ?? []).map((r) => ensureTypedRule(r as never)),
    announcements: (data.announcements ?? []).map((n) => ({
      ...n,
      extractedFactIds: n.extractedFactIds ?? [],
      bodyHash: n.bodyHash ?? null,
    })),
  }),
  2: (data) => ({
    ...data,
    academicRules: data.academicRules ?? [],
    evidence: data.evidence ?? [],
    changes: data.changes ?? [],
    userTasks: data.userTasks ?? [],
    calendarEvents: data.calendarEvents ?? [],
    actionLog: data.actionLog ?? [],
    externalActivities: data.externalActivities ?? [],
    whatIfOverrides: data.whatIfOverrides ?? [],
    courses: (data.courses ?? []).map((c) => ({
      ...c,
      lectureSection: c.lectureSection ?? null,
      labSection: c.labSection ?? null,
      tutorialSection: c.tutorialSection ?? null,
      outlineStatus: c.outlineStatus ?? "not_checked",
      outlineStatusDetail: c.outlineStatusDetail ?? null,
    })),
    assessments: (data.assessments ?? []).map((a) => ({
      ...a,
      attemptNumber: a.attemptNumber ?? null,
      state: ensureState(a.state),
    })),
    meetings: (data.meetings ?? []).map((m) => ({
      ...m,
      sectionCode: m.sectionCode ?? null,
    })),
    announcements: (data.announcements ?? []).map((n) => ({
      ...n,
      deadlineChangeSignal: n.deadlineChangeSignal ?? false,
      fromInstructorOrTa: n.fromInstructorOrTa ?? false,
    })),
    resources: (data.resources ?? []).map((r) => ({
      ...r,
      purpose: r.purpose ?? "other",
    })),
    gradeCategories: (data.gradeCategories ?? []).map((g) => ({
      ...g,
      gradeCapPercent: g.gradeCapPercent ?? null,
      thresholdPercent: g.thresholdPercent ?? null,
    })),
  }),
};

function ensureCourseFields(c: Course): Course {
  return {
    ...c,
    outlineStatus: c.outlineStatus ?? "not_checked",
    outlineStatusDetail: c.outlineStatusDetail ?? null,
    lectureSection: c.lectureSection ?? null,
    labSection: c.labSection ?? null,
    tutorialSection: c.tutorialSection ?? null,
  };
}

function ensureAssessment(a: Assessment): Assessment {
  return {
    ...a,
    attemptNumber: a.attemptNumber ?? null,
    state: ensureState(a.state),
  };
}

function ensureMeeting(m: Meeting): Meeting {
  return { ...m, sectionCode: m.sectionCode ?? null };
}

export function migrate(raw: unknown): AppData {
  const base = emptyAppData();
  if (!raw || typeof raw !== "object") return base;
  let data = { ...base, ...(raw as Partial<AppData>) } as AppData;
  if (typeof data.schemaVersion !== "number") data.schemaVersion = 0;
  while (data.schemaVersion < STORAGE_SCHEMA_VERSION) {
    const next = data.schemaVersion + 1;
    const fn = migrations[next];
    if (fn) data = fn(data);
    data.schemaVersion = next;
  }
  data.preferences = { ...base.preferences, ...data.preferences, courseColors: { ...data.preferences?.courseColors } };
  data.sync = { ...base.sync, ...data.sync };
  data.courses = (data.courses ?? []).map(ensureCourseFields);
  data.assessments = (data.assessments ?? []).map(ensureAssessment);
  data.meetings = (data.meetings ?? []).map(ensureMeeting);
  data.academicRules = data.academicRules ?? [];
  data.evidence = data.evidence ?? [];
  data.changes = data.changes ?? [];
  data.userTasks = data.userTasks ?? [];
  data.calendarEvents = data.calendarEvents ?? [];
  data.actionLog = data.actionLog ?? [];
  data.externalActivities = data.externalActivities ?? [];
  data.whatIfOverrides = data.whatIfOverrides ?? [];
  data.sourceArtifacts = data.sourceArtifacts ?? [];
  data.extractedFacts = data.extractedFacts ?? [];
  data.entityLinks = data.entityLinks ?? [];
  data.meetingPatterns = data.meetingPatterns ?? [];
  data.meetingOccurrences = data.meetingOccurrences ?? [];
  data.contentModules = data.contentModules ?? [];
  data.contentItems = data.contentItems ?? [];
  data.preferences = {
    ...data.preferences,
    lastCheckedAt: data.preferences?.lastCheckedAt ?? null,
    developerMode: data.preferences?.developerMode ?? false,
    notifications: data.preferences?.notifications ?? {
      enabled: true,
      dueTomorrow: true,
      quizClosing: true,
      midtermRoom: true,
      deadlineChange: true,
      gradePosted: true,
    },
  };
  data.changes = (data.changes ?? []).map((c) => ({
    ...c,
    beforeValue: c.beforeValue,
    afterValue: c.afterValue,
  }));
  data.contentItems = data.contentItems ?? [];
  data.calculationStates = data.calculationStates ?? [];
  data.discussionForums = data.discussionForums ?? [];
  data.discussionTopics = data.discussionTopics ?? [];
  data.discussionPosts = data.discussionPosts ?? [];
  data.announcementFacts = data.announcementFacts ?? [];
  data.quizAttempts = data.quizAttempts ?? [];
  data.feedbackRecords = data.feedbackRecords ?? [];
  data.libraryResources = data.libraryResources ?? [];
  data.sourceCoverage = data.sourceCoverage ?? [];
  data.apiExplorationLog = data.apiExplorationLog ?? [];
  data.searchIndex = data.searchIndex ?? [];
  data.academicRules = (data.academicRules ?? []).map((r) => ensureTypedRule(r as never));
  data.announcements = (data.announcements ?? []).map((n) => ({
    ...n,
    extractedFactIds: (n as { extractedFactIds?: string[] }).extractedFactIds ?? [],
    bodyHash: (n as { bodyHash?: string | null }).bodyHash ?? null,
  }));
  return data;
}
