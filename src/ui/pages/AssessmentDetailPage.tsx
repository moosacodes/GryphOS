import { Link, useParams } from "react-router-dom";
import type { AppData } from "@/domain/types";
import { deadlineSafetyFromAssessment } from "@/engines/deadlines";
import { formatInToronto } from "@/domain/dates";
import { summarizeCourseGrades } from "@/engines/grades";

export function AssessmentDetailPage({ data }: { data: AppData }) {
  const { id } = useParams();
  const assessment = data.assessments.find((a) => a.id === decodeURIComponent(id ?? ""));
  if (!assessment) {
    return (
      <div>
        <p>Assessment not found.</p>
        <Link to="/">Back</Link>
      </div>
    );
  }
  const course = data.courses.find((c) => c.id === assessment.courseId);
  const safety = deadlineSafetyFromAssessment(assessment);
  const dueProv = assessment.fieldProvenance.due;
  const occ = (data.meetingOccurrences ?? []).find((o) =>
    String((dueProv?.value as { occurrenceId?: string } | undefined)?.occurrenceId ?? "").includes(o.id),
  );
  const summary = course
    ? summarizeCourseGrades(
        course,
        data.assessments,
        data.gradeCategories,
        data.academicRules,
      )
    : null;
  const row = summary?.rows.find((r) => r.assessment.id === assessment.id);

  return (
    <div>
      <div className="page-header">
        <div>
          <p style={{ margin: 0 }}>
            <Link to={course ? `/courses/${course.id}` : "/"}>← {course?.code ?? "Course"}</Link>
          </p>
          <h1>{assessment.title}</h1>
          <p>
            {course?.code} · {assessment.type}
          </p>
        </div>
      </div>

      <section className="card" style={{ marginBottom: "1rem" }}>
        <h2>Why this deadline?</h2>
        <p>
          <strong>Safety:</strong> {safety}
        </p>
        <p>
          <strong>Due:</strong>{" "}
          {assessment.due.iso ? formatInToronto(assessment.due.iso) : assessment.due.label ?? "Unknown"}
        </p>
        <p>
          <strong>Provenance:</strong> {dueProv?.sourceType ?? "none"} / {dueProv?.sourceId ?? "—"}{" "}
          (confidence {dueProv?.confidence ?? "—"})
        </p>
        {assessment.notes ? <pre style={{ whiteSpace: "pre-wrap" }}>{assessment.notes}</pre> : null}
        {occ ? (
          <p>
            Linked occurrence: <code>{occ.id}</code> ({occ.date} {occ.startIso}–{occ.endIso})
          </p>
        ) : null}
        {assessment.manualOverrides?.due ? (
          <p>
            <strong>User override active</strong> — rules will not overwrite.
          </p>
        ) : null}
      </section>

      <section className="card" style={{ marginBottom: "1rem" }}>
        <h2>Grade / calculation state</h2>
        <ul>
          <li>Work: {assessment.state?.work}</li>
          <li>Submission: {assessment.submissionState}</li>
          <li>Missed: {String(assessment.state?.missed)} (missed ≠ auto zero)</li>
          <li>Dropped (official): {String(row?.dropped)}</li>
          <li>Provisional drop: {String(row?.provisionalDrop)}</li>
          <li>Drop certainty: {row?.dropCertainty ?? "none"}</li>
          <li>Score: {row?.percent ?? "unknown"}%</li>
          <li>Weight: {assessment.weightPercent ?? "unknown"}%</li>
        </ul>
      </section>

      <section className="card">
        <h2>Debug inspector</h2>
        <pre style={{ fontSize: "0.75rem", overflow: "auto", maxHeight: 320 }}>
          {JSON.stringify(
            {
              assessment,
              dueProvenance: dueProv,
              occurrence: occ ?? null,
              conflicts: data.conflicts.filter((c) => c.entityId === assessment.id),
            },
            null,
            2,
          )}
        </pre>
      </section>
    </div>
  );
}
