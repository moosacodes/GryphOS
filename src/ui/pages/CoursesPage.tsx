import { Link } from "react-router-dom";
import type { AppData } from "@/domain/types";
import { computeCourseHealth, healthStatusLabel } from "@/engines/health";
import { EmptyState } from "../components/EmptyState";

export function CoursesPage({ data }: { data: AppData }) {
  const selected = new Set(data.preferences.selectedCourseIds ?? []);
  const courses = data.courses.filter((c) => selected.has(c.id));

  if (courses.length === 0) {
    return (
      <div>
        <div className="page-header"><div><h1>Courses</h1><p>Your selected courses</p></div></div>
        <EmptyState title="No courses selected" body="Sync CourseLink, then pick courses in Settings." />
      </div>
    );
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Courses</h1>
          <p>{courses.length} selected</p>
        </div>
      </div>
      <div className="grid grid-2">
        {courses.map((c) => {
          const health = computeCourseHealth(
            c, data.assessments, data.conflicts, data.documents, data.people, data.meetings,
          );
          const count = data.assessments.filter((a) => a.courseId === c.id).length;
          return (
            <Link key={c.id} to={`/courses/${encodeURIComponent(c.id)}`} className="card" style={{ color: "inherit", textDecoration: "none" }}>
              <div style={{ display: "flex", gap: "0.65rem", alignItems: "center" }}>
                <span className="dot" style={{ background: c.color, width: 12, height: 12 }} />
                <div>
                  <h2 style={{ margin: 0 }}>{c.code}</h2>
                  <p className="small muted" style={{ margin: "0.2rem 0 0" }}>{c.title}</p>
                </div>
              </div>
              <p className="small" style={{ marginTop: "0.75rem" }}>
                {count} assessments · {healthStatusLabel(health.status)} ({health.score}%)
              </p>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
