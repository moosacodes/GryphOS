import { useMemo, useState } from "react";
import type { AppData, AssessmentType, TaskStatus } from "@/domain/types";
import { classifyTaskStatus } from "@/engines/status";
import { AssessmentRow } from "../components/AssessmentRow";
import { EmptyState } from "../components/EmptyState";

const GROUPS: { id: string; title: string; match: (s: TaskStatus) => boolean }[] = [
  { id: "overdue", title: "Overdue", match: (s) => s === "overdue" },
  { id: "today", title: "Due today", match: (s) => s === "due_today" },
  { id: "soon", title: "Due soon", match: (s) => s === "due_soon" },
  { id: "upcoming", title: "Upcoming", match: (s) => s === "upcoming" },
  { id: "done", title: "Completed", match: (s) => s === "submitted" || s === "graded" },
  { id: "unknown", title: "Unknown date/status", match: (s) => s === "unknown" },
];

export function TasksPage({ data }: { data: AppData }) {
  const courses = data.courses.filter((c) =>
    (data.preferences.selectedCourseIds ?? []).includes(c.id),
  );
  const courseMap = new Map(data.courses.map((c) => [c.id, c]));
  const [courseFilter, setCourseFilter] = useState("all");
  const [typeFilter, setTypeFilter] = useState<AssessmentType | "all">("all");

  const items = useMemo(() => {
    return data.assessments.filter((a) => {
      if (!courses.some((c) => c.id === a.courseId)) return false;
      if (courseFilter !== "all" && a.courseId !== courseFilter) return false;
      if (typeFilter !== "all" && a.type !== typeFilter) return false;
      return true;
    });
  }, [data.assessments, courses, courseFilter, typeFilter]);

  if (courses.length === 0) {
    return (
      <div>
        <div className="page-header"><div><h1>Tasks</h1></div></div>
        <EmptyState title="No tasks yet" body="Sync and select courses to see your workload." />
      </div>
    );
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Tasks</h1>
          <p>Chronological workload across your courses</p>
        </div>
      </div>
      <div className="filters">
        <select value={courseFilter} onChange={(e) => setCourseFilter(e.target.value)} aria-label="Course filter">
          <option value="all">All courses</option>
          {courses.map((c) => <option key={c.id} value={c.id}>{c.code}</option>)}
        </select>
        <select
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value as AssessmentType | "all")}
          aria-label="Type filter"
        >
          <option value="all">All types</option>
          {["assignment","quiz","lab","project","midterm","final","participation","presentation","discussion","other"].map((t) => (
            <option key={t} value={t}>{t}</option>
          ))}
        </select>
      </div>

      {GROUPS.map((g) => {
        const list = items
          .filter((a) => g.match(classifyTaskStatus(a, new Date(), data.preferences.deadlineWarnHours)))
          .sort((a, b) => {
            const ta = a.due.iso ? Date.parse(a.due.iso) : Number.POSITIVE_INFINITY;
            const tb = b.due.iso ? Date.parse(b.due.iso) : Number.POSITIVE_INFINITY;
            return ta - tb;
          });
        if (list.length === 0) return null;
        return (
          <section key={g.id} className="card" style={{ marginBottom: "1rem" }}>
            <h2>{g.title} <span className="badge">{list.length}</span></h2>
            <div className="list">
              {list.map((a) => (
                <AssessmentRow key={a.id} assessment={a} course={courseMap.get(a.courseId)} />
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}
