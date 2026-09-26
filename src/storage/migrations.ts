import { STORAGE_SCHEMA_VERSION } from "@/domain/constants";
import type { AppData, Assessment, Course, Meeting, AcademicItemState } from "@/domain/types";
import { DEFAULT_ITEM_STATE } from "@/domain/types";
import { emptyAppData } from "./schema";

type Migration = (data: AppData) => AppData;

function ensureState(s?: Partial<AcademicItemState> | null): AcademicItemState {
  return { ...DEFAULT_ITEM_STATE, ...(s ?? {}) };
}

const migrations: Record<number, Migration> = {
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
  return data;
}
