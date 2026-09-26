import { Link, useParams } from "react-router-dom";
import type { AppData } from "@/domain/types";
import { computeCourseHealth, healthStatusLabel } from "@/engines/health";
import { summarizeCourseGrades } from "@/engines/grades";
import { AssessmentRow } from "../components/AssessmentRow";
import { ConflictBanner } from "../components/ConflictBanner";

export function CourseDetailPage({ data }: { data: AppData }) {
  const { courseId = "" } = useParams();
  const id = decodeURIComponent(courseId);
  const course = data.courses.find((c) => c.id === id);
  if (!course) {
    return (
      <div>
        <p>Course not found.</p>
        <Link to="/courses">Back</Link>
      </div>
    );
  }

  const assessments = data.assessments.filter((a) => a.courseId === course.id);
  const health = computeCourseHealth(
    course, data.assessments, data.conflicts, data.documents, data.people, data.meetings,
  );
  const grades = summarizeCourseGrades(course, assessments, data.gradeCategories);
  const conflicts = data.conflicts.filter(
    (c) => c.unresolved && assessments.some((a) => a.id === c.entityId),
  );
  const people = data.people.filter((p) => p.courseId === course.id);
  const meetings = data.meetings.filter((m) => m.courseId === course.id);
  const resources = data.resources.filter((r) => r.courseId === course.id);
  const policies = data.policies.filter((p) => p.courseId === course.id);
  const outline = data.documents.find((d) => d.id === course.outlineDocumentId);

  return (
    <div>
      <div className="page-header">
        <div>
          <p className="small"><Link to="/courses">â† Courses</Link></p>
          <h1>
            <span className="dot" style={{ display: "inline-block", background: course.color, marginRight: 8 }} />
            {course.code}
          </h1>
          <p>{course.title}{course.semester ? ` Â· ${course.semester}` : ""}</p>
        </div>
        <a className="btn" href={course.url} target="_blank" rel="noreferrer">CourseLink</a>
      </div>

      <div className="grid grid-2">
        <div className="card">
          <h2>Overview</h2>
          <p className="small">Data health: <strong>{healthStatusLabel(health.status)}</strong> ({health.score}%)</p>
          <ul className="small">
            {health.checks.map((ch) => (
              <li key={ch.id}>{ch.ok ? "âœ“" : "âš "} {ch.label}</li>
            ))}
          </ul>
          <p className="small muted">
            Calculated grade:{" "}
            {grades.calculatedPercent != null ? `${grades.calculatedPercent.toFixed(1)}%` : "Not enough data"}
            {" Â· "}completed weight {grades.completedWeight.toFixed(0)}%
          </p>
        </div>

        <div className="card">
          <h2>People</h2>
          {course.instructorNames.length === 0 && people.length === 0 ? (
            <p className="muted small">No instructors detected yet. Import an outline to help.</p>
          ) : (
            <ul className="small">
              {course.instructorNames.map((n) => <li key={n}>{n} (instructor)</li>)}
              {people.map((p) => (
                <li key={p.id}>{p.name} ({p.role}){p.email ? ` Â· ${p.email}` : ""}</li>
              ))}
            </ul>
          )}
          <h3 style={{ marginTop: "1rem" }}>Schedule</h3>
          {meetings.length === 0 ? (
            <p className="muted small">No schedule detected.</p>
          ) : (
            <ul className="small">{meetings.map((m) => <li key={m.id}>{m.kind}: {m.notes ?? m.location ?? "â€”"}</li>)}</ul>
          )}
        </div>

        <div className="card" style={{ gridColumn: "1 / -1" }}>
          <h2>Assessments</h2>
          <div className="list">
            {assessments.map((a) => (
              <AssessmentRow key={a.id} assessment={a} course={course} />
            ))}
          </div>
        </div>

        {conflicts.length > 0 && (
          <div className="card" style={{ gridColumn: "1 / -1" }}>
            <h2>Conflicts</h2>
            {conflicts.map((c) => <ConflictBanner key={c.id} conflict={c} />)}
          </div>
        )}

        <div className="card">
          <h2>Resources & policies</h2>
          {resources.length === 0 && policies.length === 0 ? (
            <p className="muted small">None yet.</p>
          ) : (
            <>
              <ul className="small">{resources.map((r) => <li key={r.id}>{r.title}</li>)}</ul>
              <ul className="small">{policies.map((p) => <li key={p.id}><strong>{p.title}</strong>: {p.body.slice(0, 160)}â€¦</li>)}</ul>
            </>
          )}
        </div>

        <div className="card">
          <h2>Data sources</h2>
          <ul className="small">
            <li>CourseLink course unit {course.orgUnitId}</li>
            <li>Outline: {outline ? outline.filename : "not imported"}</li>
          </ul>
          <p className="small"><Link to="/documents">Manage documents â†’</Link></p>
        </div>
      </div>
    </div>
  );
}
