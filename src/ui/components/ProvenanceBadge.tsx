import type { SourceType } from "@/domain/types";

const LABELS: Partial<Record<SourceType, string>> = {
  courselink_dropbox: "CourseLink Assignment",
  courselink_quiz: "CourseLink Quiz",
  courselink_calendar: "CourseLink Calendar",
  courselink_grade: "CourseLink Gradebook",
  courselink_news: "CourseLink News",
  course_outline: "Course Outline",
  manual: "Manual",
  uofg_academic_date: "UofG Calendar",
};

export function ProvenanceBadge({ source }: { source: SourceType }) {
  return <span className="badge">{LABELS[source] ?? source}</span>;
}
