import { STORAGE_SCHEMA_VERSION } from "@/domain/constants";
import {
  DEFAULT_PREFERENCES,
  DEFAULT_SYNC,
  type AppData,
} from "@/domain/types";

export function emptyAppData(): AppData {
  return {
    schemaVersion: STORAGE_SCHEMA_VERSION,
    user: null,
    courses: [],
    assessments: [],
    gradeRecords: [],
    gradeCategories: [],
    announcements: [],
    resources: [],
    policies: [],
    meetings: [],
    people: [],
    academicDates: [],
    sourceRecords: [],
    conflicts: [],
    documents: [],
    academicRules: [],
    evidence: [],
    changes: [],
    sourceArtifacts: [],
    extractedFacts: [],
    entityLinks: [],
    meetingPatterns: [],
    meetingOccurrences: [],
    contentModules: [],
    contentItems: [],
    calculationStates: [],
    userTasks: [],
    calendarEvents: [],
    actionLog: [],
    externalActivities: [],
    whatIfOverrides: [],
    discussionForums: [],
    discussionTopics: [],
    discussionPosts: [],
    announcementFacts: [],
    quizAttempts: [],
    feedbackRecords: [],
    libraryResources: [],
    sourceCoverage: [],
    apiExplorationLog: [],
    searchIndex: [],
    sync: { ...DEFAULT_SYNC },
    preferences: { ...DEFAULT_PREFERENCES, courseColors: {} },
    pendingSync: false,
  };
}

export const IDB_NAME = "gryphos";
export const IDB_STORE = "app";
export const IDB_KEY = "state";
export const CHROME_META_KEYS = ["preferences", "sync", "pendingSync", "schemaVersion"] as const;
