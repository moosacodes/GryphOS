/** Canonical domain model for gryphOS. UI and engines consume only these types. */

export type SourceType =
  | "courselink_course"
  | "courselink_dropbox"
  | "courselink_quiz"
  | "courselink_grade"
  | "courselink_calendar"
  | "courselink_news"
  | "courselink_content"
  | "course_outline"
  | "uofg_academic_date"
  | "uofg_catalogue"
  | "manual"
  | "ics"
  | "user_task"
  | "rule_engine"
  | "external_activity"
  | "courselink_discussion";

export type AssessmentType =
  | "assignment"
  | "quiz"
  | "lab"
  | "project"
  | "midterm"
  | "final"
  | "participation"
  | "presentation"
  | "discussion"
  | "other";

export type DateCertainty = "exact" | "approximate" | "unknown" | "conflicting";

export type SubmissionState = "submitted" | "not_submitted" | "unknown";

export type AvailabilityState = "available" | "unavailable" | "unknown";
export type WorkState = "not_started" | "in_progress" | "completed" | "unknown";
export type GradingState = "ungraded" | "graded" | "returned" | "unknown";
export type UserConfirm = "confirmed" | "denied" | "unknown";

/** Multi-dimension academic item state ? not a single completed boolean. */
export interface AcademicItemState {
  availability: AvailabilityState;
  work: WorkState;
  submission: SubmissionState;
  grading: GradingState;
  /** Past-due stays unknown until user confirms */
  pastDueConfirmed: boolean;
  /** User claims work done (may still be not_submitted to CourseLink) */
  userCompleted: UserConfirm;
  /** Policy drop (best-N / drop-lowest) ? not the same as missed */
  dropped: boolean;
  /** Missed attempt ? never auto-fabricates a zero grade */
  missed: boolean;
  needsConfirmation: boolean;
}

export const DEFAULT_ITEM_STATE: AcademicItemState = {
  availability: "unknown",
  work: "unknown",
  submission: "unknown",
  grading: "unknown",
  pastDueConfirmed: false,
  userCompleted: "unknown",
  dropped: false,
  missed: false,
  needsConfirmation: false,
};

export type SyncStatus = "idle" | "syncing" | "error" | "signed_out";

/** Per-course outline auto-discovery result from the last sync. */
export type OutlineDiscoveryStatus =
  | "found"
  | "parsed"
  | "none_accessible"
  | "blocked"
  | "not_checked"
  | "parse_failed";

export type ThemePreference = "light" | "dark" | "system";

export type HealthStatus = "complete" | "good" | "missing_information" | "needs_attention";

export type TaskStatus =
  | "upcoming"
  | "due_soon"
  | "due_today"
  | "overdue"
  | "submitted"
  | "graded"
  | "unknown";

export interface ProvenancedValue<T> {
  value: T;
  sourceType: SourceType;
  sourceId: string;
  confidence: number;
  retrievedAt: string;
  sourceTimestamp?: string | null;
}

export interface SourceRecord {
  id: string;
  sourceType: SourceType;
  sourceIdentifier: string;
  entityId: string;
  field: string;
  originalValue: unknown;
  confidence: number;
  retrievedAt: string;
  sourceTimestamp: string | null;
}

export interface AcademicDateValue {
  certainty: DateCertainty;
  /** ISO timestamp when exact; date-only YYYY-MM-DD when approximate day; null when unknown */
  iso: string | null;
  /** Human label for approximate values e.g. "Week 6", "Exam period" */
  label: string | null;
  allDay?: boolean;
}

export interface Person {
  id: string;
  name: string;
  email: string | null;
  role: "instructor" | "ta" | "other";
  courseId: string | null;
}

export interface Meeting {
  id: string;
  courseId: string;
  kind: "lecture" | "lab" | "tutorial" | "seminar" | "office_hours" | "other";
  dayOfWeek: number | null; // 0=Sun..6=Sat
  startTime: string | null; // HH:mm
  endTime: string | null;
  location: string | null;
  notes: string | null;
  sectionCode: string | null;
}

export interface GradeCategory {
  id: string;
  courseId: string;
  name: string;
  weightPercent: number | null;
  dropLowest: number;
  bestN: number | null;
  /** Cap course grade unless this category meets threshold (e.g. exam) */
  gradeCapPercent: number | null;
  thresholdPercent: number | null;
}

export interface GradeRecord {
  id: string;
  assessmentId: string | null;
  courseId: string;
  pointsEarned: number | null;
  pointsPossible: number | null;
  displayedGrade: string | null;
  official: boolean;
  retrievedAt: string;
}

export interface Assessment {
  id: string;
  courseId: string;
  title: string;
  type: AssessmentType;
  due: AcademicDateValue;
  start: AcademicDateValue;
  end: AcademicDateValue;
  weightPercent: number | null;
  pointsPossible: number | null;
  pointsEarned: number | null;
  submissionState: SubmissionState;
  submittedAt: string | null;
  gradeDisplay: string | null;
  url: string | null;
  notes: string | null;
  categoryId: string | null;
  isBonus: boolean;
  attemptNumber: number | null;
  state: AcademicItemState;
  sourceRecords: string[];
  fieldProvenance: Partial<Record<string, ProvenancedValue<unknown>>>;
  conflictIds: string[];
  manualOverrides: Partial<Record<string, unknown>>;
  updatedAt: string;
}

export interface Announcement {
  id: string;
  courseId: string;
  title: string;
  bodyText: string;
  publishedAt: string | null;
  url: string | null;
  /** Heuristic: announcement appears to change a deadline */
  deadlineChangeSignal: boolean;
  fromInstructorOrTa: boolean;
}

export type ResourcePurpose =
  | "outline"
  | "lecture"
  | "lab"
  | "assignment"
  | "reading"
  | "external_tool"
  | "other";

export interface Resource {
  id: string;
  courseId: string;
  title: string;
  kind: "textbook" | "link" | "file" | "other";
  purpose: ResourcePurpose;
  url: string | null;
  notes: string | null;
}

export interface CoursePolicy {
  id: string;
  courseId: string;
  kind: "late" | "extension" | "attendance" | "academic_integrity" | "other";
  title: string;
  body: string;
}

export interface AcademicDate {
  id: string;
  title: string;
  start: AcademicDateValue;
  end: AcademicDateValue;
  kind: "holiday" | "reading_week" | "exam_period" | "add_drop" | "semester" | "other";
  term: string | null;
}

export interface Conflict {
  id: string;
  entityId: string;
  entityKind: "assessment" | "course" | "meeting" | "other";
  field: string;
  values: Array<{ sourceType: SourceType; value: unknown; label: string }>;
  resolvedValue: unknown;
  resolutionRule: string;
  unresolved: boolean;
  createdAt: string;
}

export interface Course {
  id: string;
  orgUnitId: number;
  code: string;
  title: string;
  semester: string | null;
  startDate: string | null;
  endDate: string | null;
  color: string;
  selected: boolean;
  instructorNames: string[];
  url: string;
  outlineDocumentId: string | null;
  /** Result of last auto outline discovery attempt */
  outlineStatus: OutlineDiscoveryStatus;
  outlineStatusDetail: string | null;
  lectureSection: string | null;
  labSection: string | null;
  tutorialSection: string | null;
  updatedAt: string;
}

export interface ImportedDocument {
  id: string;
  courseId: string | null;
  filename: string;
  mimeType: string;
  importedAt: string;
  textContent: string;
  parseResult: OutlineParseResult | null;
  parseError: string | null;
}

export interface OutlineAssessmentParsed {
  title: string;
  type: AssessmentType;
  weightPercent: number | null;
  dueLabel: string | null;
  dueIso: string | null;
  certainty: DateCertainty;
  confidence: number;
  category: string | null;
  sourceSnippet: string | null;
}

export interface OutlineGradingRule {
  kind: "best_n" | "drop_lowest" | "other";
  label: string;
  n: number | null;
  category: string | null;
}

export interface OutlineParseDiagnostic {
  pass: string;
  message: string;
  snippet?: string;
}

export interface OutlineParseResult {
  courseCode: string | null;
  courseTitle: string | null;
  term: string | null;
  instructors: Array<{ name: string; email: string | null }>;
  tas: Array<{ name: string; email: string | null }>;
  officeHours: string[];
  scheduleLines: string[];
  assessments: OutlineAssessmentParsed[];
  categories: Array<{
    name: string;
    weightPercent: number | null;
    dropLowest: number;
    bestN: number | null;
  }>;
  gradingRules: OutlineGradingRule[];
  policies: Array<{ kind: CoursePolicy["kind"]; title: string; body: string }>;
  textbooks: string[];
  diagnostics: OutlineParseDiagnostic[];
  confidence: number;
}

export interface SyncState {
  status: SyncStatus;
  lastSyncedAt: number | null;
  startedAt: number | null;
  message: string | null;
}

export interface UserProfile {
  name: string;
  id: string;
}

export interface Preferences {
  theme: ThemePreference;
  courseColors: Record<string, string>;
  deadlineWarnHours: number;
  selectedCourseIds: string[] | null;
}


export type AcademicRuleKind =
  | "best_n"
  | "drop_lowest"
  | "relative_deadline"
  | "section_relative"
  | "attempt"
  | "grade_cap"
  | "threshold";

export interface AcademicRule {
  id: string;
  courseId: string | null;
  kind: AcademicRuleKind;
  label: string;
  /** Generic params ? never hardcoded course IDs inside the engine */
  params: Record<string, unknown>;
  sourceType: SourceType;
  confidence: number;
}

export interface EvidenceFact {
  id: string;
  courseId: string | null;
  entityId: string | null;
  field: string;
  value: unknown;
  label: string;
  sourceType: SourceType;
  sourceId: string;
  retrievedAt: string;
  confidence: number;
}

export type ChangeEventKind =
  | "deadline_changed"
  | "weight_changed"
  | "new_assessment"
  | "removed_assessment"
  | "grade_posted"
  | "announcement"
  | "other";

export interface ChangeEvent {
  id: string;
  courseId: string | null;
  entityId: string | null;
  kind: ChangeEventKind;
  title: string;
  detail: string;
  createdAt: string;
  read: boolean;
  evidenceIds: string[];
}

export interface UserTask {
  id: string;
  courseId: string | null;
  title: string;
  notes: string | null;
  dueIso: string | null;
  done: boolean;
  checklist: Array<{ id: string; label: string; done: boolean }>;
  createdAt: string;
  updatedAt: string;
}

export interface CalendarEventItem {
  id: string;
  uid: string;
  title: string;
  category: "UNI" | "STUDY" | "BUS" | "OTHER";
  startIso: string;
  endIso: string | null;
  allDay: boolean;
  location: string | null;
  description: string | null;
  exdates: string[];
  courseId: string | null;
  sourceType: SourceType;
}

export interface ActionLogEntry {
  id: string;
  at: string;
  action: string;
  entityId: string | null;
  before: unknown;
  after: unknown;
  undone: boolean;
}

export interface ExternalActivity {
  id: string;
  courseId: string;
  title: string;
  tool: string;
  url: string | null;
  notes: string | null;
}

export interface WhatIfOverride {
  assessmentId: string;
  pointsEarned: number | null;
  pointsPossible: number | null;
  missed?: boolean;
  dropped?: boolean;
}

export interface AppData {
  schemaVersion: number;
  user: UserProfile | null;
  courses: Course[];
  assessments: Assessment[];
  gradeRecords: GradeRecord[];
  gradeCategories: GradeCategory[];
  announcements: Announcement[];
  resources: Resource[];
  policies: CoursePolicy[];
  meetings: Meeting[];
  people: Person[];
  academicDates: AcademicDate[];
  sourceRecords: SourceRecord[];
  conflicts: Conflict[];
  documents: ImportedDocument[];
  academicRules: AcademicRule[];
  evidence: EvidenceFact[];
  changes: ChangeEvent[];
  userTasks: UserTask[];
  calendarEvents: CalendarEventItem[];
  actionLog: ActionLogEntry[];
  externalActivities: ExternalActivity[];
  whatIfOverrides: WhatIfOverride[];
  sync: SyncState;
  preferences: Preferences;
  pendingSync: boolean;
}

export const DEFAULT_PREFERENCES: Preferences = {
  theme: "system",
  courseColors: {},
  deadlineWarnHours: 48,
  selectedCourseIds: null,
};

export const DEFAULT_SYNC: SyncState = {
  status: "idle",
  lastSyncedAt: null,
  startedAt: null,
  message: null,
};
