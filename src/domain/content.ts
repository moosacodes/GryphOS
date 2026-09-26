/** Course content module/item hierarchy + document classification. */
export type DocumentClass =
  | "course_outline"
  | "assignment_specification"
  | "lab_instructions"
  | "lecture_slides"
  | "lecture_notes"
  | "tutorial"
  | "exam_information"
  | "grading_rubric"
  | "grading_scheme"
  | "course_schedule"
  | "reading"
  | "reference"
  | "starter_code_metadata"
  | "faq"
  | "policy"
  | "unknown"
  /** legacy aliases kept for migration */
  | "outline"
  | "assignment_spec"
  | "lab_handout"
  | "grade_scheme"
  | "syllabus_addendum"
  | "other";

export interface CourseContentModule {
  id: string;
  courseId: string;
  title: string;
  sortOrder: number;
  parentModuleId: string | null;
  descriptionText: string | null;
  startDate: string | null;
  endDate: string | null;
  isHidden: boolean;
  rawModuleId: number | null;
}

export interface CourseContentItem {
  id: string;
  moduleId: string;
  courseId: string;
  title: string;
  url: string | null;
  documentClass: DocumentClass;
  contentHash: string | null;
  updatedAt: string | null;
  /** Brightspace topic id */
  topicId: number | null;
  mimeType: string | null;
  topicType: number | null;
  descriptionText: string | null;
  bodyText: string | null;
  startDate: string | null;
  endDate: string | null;
  dueDate: string | null;
  completionRequired: boolean | null;
  completionCompleted: boolean | null;
  isHidden: boolean;
  isExternal: boolean;
  externalUrl: string | null;
  linkedActivityId: string | null;
  sortOrder: number;
  /** Associated extracted text artifact id */
  libraryResourceId: string | null;
  previousContentHash: string | null;
}

export interface LibraryResource {
  id: string;
  courseId: string;
  contentItemId: string | null;
  assessmentId: string | null;
  filename: string;
  mimeType: string;
  documentClass: DocumentClass;
  textContent: string;
  contentHash: string;
  byteLength: number;
  moduleTitle: string | null;
  weekHint: string | null;
  retrievedAt: string;
  url: string | null;
}

export function classifyDocument(
  title: string,
  opts?: {
    mimeHint?: string | null;
    moduleTitle?: string | null;
    headings?: string | null;
    assessmentNames?: string[];
    bodySnippet?: string | null;
  },
): DocumentClass {
  const mime = (opts?.mimeHint ?? "").toLowerCase();
  const ctx = [
    title,
    opts?.moduleTitle ?? "",
    opts?.headings ?? "",
    opts?.bodySnippet?.slice(0, 400) ?? "",
    ...(opts?.assessmentNames ?? []),
  ]
    .join(" ")
    .toLowerCase();

  if (/outline|syllabus|course\s*outline/.test(ctx)) return "course_outline";
  if (/rubric/.test(ctx)) return "grading_rubric";
  if (/grading\s*scheme|grade\s*scheme|weighting/.test(ctx)) return "grading_scheme";
  if (/late\s*policy|academic\s*integrity|policy|accommodation/.test(ctx)) return "policy";
  if (/\bfaq\b|frequently\s+asked/.test(ctx)) return "faq";
  if (/exam|mid[- ]?term|final\s+exam|test\s+info/.test(ctx) && !/practice/.test(ctx))
    return "exam_information";
  if (/schedule|weekly\s+schedule|course\s+calendar/.test(ctx)) return "course_schedule";
  if (/starter|skeleton|template\s*code|\.zip|\.tar/.test(ctx) || /application\/zip/.test(mime))
    return "starter_code_metadata";
  if (/\blab\b|laboratory/.test(ctx)) return "lab_instructions";
  if (/tutorial|tut\s*\d/.test(ctx)) return "tutorial";
  if (/assignment|a\s*\d+|homework|\bhw\b|specification|spec\b/.test(ctx))
    return "assignment_specification";
  if (/slides|powerpoint|\.pptx|\.ppt/.test(ctx) || /presentation/.test(mime)) return "lecture_slides";
  if (/lecture|notes|handout/.test(ctx)) return "lecture_notes";
  if (/reading|chapter|textbook|article/.test(ctx)) return "reading";
  if (/reference|cheatsheet|cheat\s*sheet|appendix/.test(ctx)) return "reference";
  if (/addendum|errata/.test(ctx)) return "syllabus_addendum";
  return "unknown";
}

/** Map legacy class names to current taxonomy. */
export function normalizeDocumentClass(c: DocumentClass | string): DocumentClass {
  switch (c) {
    case "outline":
      return "course_outline";
    case "assignment_spec":
      return "assignment_specification";
    case "lab_handout":
      return "lab_instructions";
    case "grade_scheme":
      return "grading_scheme";
    case "other":
      return "unknown";
    default:
      return c as DocumentClass;
  }
}
