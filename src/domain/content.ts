/** Course content module/item hierarchy + document classification. */
export type DocumentClass =
  | "outline"
  | "assignment_spec"
  | "lab_handout"
  | "lecture_notes"
  | "reading"
  | "syllabus_addendum"
  | "grade_scheme"
  | "other";

export interface CourseContentModule {
  id: string;
  courseId: string;
  title: string;
  sortOrder: number;
  parentModuleId: string | null;
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
}

export function classifyDocument(title: string, mimeHint?: string | null): DocumentClass {
  const t = `${title} ${mimeHint ?? ""}`.toLowerCase();
  if (/outline|syllabus/.test(t)) return "outline";
  if (/lab/.test(t)) return "lab_handout";
  if (/assignment|a\d+|homework/.test(t)) return "assignment_spec";
  if (/lecture|slides|notes/.test(t)) return "lecture_notes";
  if (/reading|chapter|textbook/.test(t)) return "reading";
  if (/grading|scheme|rubric/.test(t)) return "grade_scheme";
  if (/addendum|errata/.test(t)) return "syllabus_addendum";
  return "other";
}
