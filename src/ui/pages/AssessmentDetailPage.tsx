import { Link, useParams } from "react-router-dom";
import type { AppData, Assessment } from "@/domain/types";
import { DEFAULT_ITEM_STATE } from "@/domain/types";
import { deadlineSafetyFromAssessment } from "@/engines/deadlines";
import { formatInToronto } from "@/domain/dates";
import { summarizeCourseGrades } from "@/engines/grades";
import { ensureTypedRule } from "@/domain/rules";
import { classifyDocument } from "@/domain/content";
import { assessmentWorkspace } from "@/ingestion/entityLinking";

function personalLabel(a: Assessment): string {
  if (a.state?.missed) return "Missed";
  if (a.state?.dropped) return "Dropped / excused";
  if (a.submissionState === "submitted" || a.state?.work === "completed") return "Done";
  if (a.state?.work === "in_progress") return "In progress";
  if (a.state?.work === "not_started") return "Not started";
  if (a.pointsEarned != null || a.gradeDisplay) return "Graded";
  return "Unknown";
}

export function AssessmentDetailPage({
  data,
  update,
}: {
  data: AppData;
  update?: (patch: Partial<AppData> | ((prev: AppData) => AppData)) => Promise<AppData>;
}) {
  const { id } = useParams();
  const assessment = data.assessments.find((a) => a.id === decodeURIComponent(id ?? ""));
  if (!assessment) {
    return (
      <div>
        <p>Assessment not found.</p>
        <Link to="/">Back to My Day</Link>
      </div>
    );
  }

  const course = data.courses.find((c) => c.id === assessment.courseId);
  const safety = deadlineSafetyFromAssessment(assessment);
  const summary = course
    ? summarizeCourseGrades(
        course,
        data.assessments,
        data.gradeCategories,
        data.academicRules,
        data.whatIfOverrides,
      )
    : null;
  const row = summary?.rows.find((r) => r.assessment.id === assessment.id);

  const relatedContent = (data.contentItems ?? []).filter((ci) => {
    if (ci.courseId !== assessment.courseId) return false;
    const cls = ci.documentClass || classifyDocument(ci.title);
    const titleHit = ci.title.toLowerCase().includes(assessment.title.toLowerCase().slice(0, 12));
    return cls === "assignment_spec" || cls === "assignment_specification" || cls === "lab_handout" || cls === "lab_instructions" || cls === "grading_rubric" || titleHit;
  });

    const workspace = assessmentWorkspace(assessment.id, data.entityLinks ?? [], {
    contentItems: data.contentItems ?? [],
    library: data.libraryResources ?? [],
    announcements: data.announcements,
    announcementFacts: data.announcementFacts ?? [],
    feedback: data.feedbackRecords ?? [],
    gradeRecords: data.gradeRecords ?? [],
  });
  const quizAttempts = (data.quizAttempts ?? []).filter((q) => q.assessmentId === assessment.id);
  const relatedAnns = data.announcements.filter(
    (n) =>
      n.courseId === assessment.courseId &&
      (n.deadlineChangeSignal ||
        n.title.toLowerCase().includes(assessment.title.toLowerCase().slice(0, 10)) ||
        n.bodyText.toLowerCase().includes(assessment.title.toLowerCase().slice(0, 10))),
  );

  const rules = (data.academicRules ?? [])
    .map(ensureTypedRule)
    .filter((r) => r.courseId === assessment.courseId);

  const history = (data.changes ?? []).filter((c) => c.entityId === assessment.id);
  const conflicts = data.conflicts.filter((c) => c.entityId === assessment.id);
  const checklist = (data.userTasks ?? []).filter(
    (t) => t.courseId === assessment.courseId && t.title.toLowerCase().includes(assessment.title.toLowerCase().slice(0, 8)),
  );

  const setPersonal = async (mode: "not_started" | "in_progress" | "done" | "missed" | "excused") => {
    if (!update) return;
    await update((prev) => ({
      ...prev,
      assessments: prev.assessments.map((a) => {
        if (a.id !== assessment.id) return a;
        const state = { ...DEFAULT_ITEM_STATE, ...a.state, needsConfirmation: false, pastDueConfirmed: true };
        if (mode === "not_started") {
          state.work = "not_started";
          state.userCompleted = "unknown";
          state.missed = false;
        } else if (mode === "in_progress") {
          state.work = "in_progress";
          state.missed = false;
        } else if (mode === "done") {
          state.work = "completed";
          state.userCompleted = "confirmed";
          state.missed = false;
        } else if (mode === "missed") {
          state.missed = true;
          state.userCompleted = "denied";
          state.work = "not_started";
        } else {
          state.dropped = true;
          state.missed = false;
          state.userCompleted = "confirmed";
          state.work = "completed";
        }
        return { ...a, state };
      }),
    }));
  };

  const dueText = assessment.due.iso
    ? formatInToronto(assessment.due.iso)
    : assessment.due.label ?? "Unknown";

  return (
    <div className="workspace assessment-workspace">
      <div className="page-header">
        <div>
          <p className="small">
            <Link to={course ? `/courses/${course.id}` : "/"}>â† {course?.code ?? "Course"}</Link>
          </p>
          <h1>{assessment.title}</h1>
          <p>
            {course?.code} Â· {assessment.type}
            {assessment.weightPercent != null ? ` Â· ${assessment.weightPercent}% of course` : " Â· weight unknown"}
          </p>
        </div>
        <div className="workspace-actions">
          {assessment.url && (
            <a className="btn btn-primary" href={assessment.url} target="_blank" rel="noreferrer">
              Open in CourseLink
            </a>
          )}
        </div>
      </div>

      <div className="workspace-grid">
        <section className="card">
          <h2>Status</h2>
          <div className="stat-row">
            <div>
              <div className="stat-label">Due</div>
              <div className="stat-value">{dueText}</div>
              <div className="small muted">Timing: {safety === "EXACT_AUTHORITATIVE" ? "Confirmed" : safety === "DERIVED" ? "Derived from schedule" : safety === "APPROXIMATE" ? "Approximate" : "Unknown"}</div>
            </div>
            <div>
              <div className="stat-label">Submission</div>
              <div className="stat-value">{assessment.submissionState.replace(/_/g, " ")}</div>
              {assessment.submittedAt && (
                <div className="small muted">{formatInToronto(assessment.submittedAt)}</div>
              )}
            </div>
            <div>
              <div className="stat-label">Personal</div>
              <div className="stat-value">{personalLabel(assessment)}</div>
            </div>
          </div>
          {update && (
            <div className="filters" style={{ marginTop: "0.75rem" }}>
              {(
                [
                  ["not_started", "Not started"],
                  ["in_progress", "In progress"],
                  ["done", "Done"],
                  ["missed", "Missed"],
                  ["excused", "Excused"],
                ] as const
              ).map(([k, label]) => (
                <button key={k} type="button" className="btn btn-sm" onClick={() => void setPersonal(k)}>
                  {label}
                </button>
              ))}
            </div>
          )}
          {assessment.state?.missed && (
            <p className="callout callout-warn tight" style={{ marginTop: "0.75rem" }}>
              Missed work is retained. GryphOS does not invent a zero.
              {row?.provisionalDrop || row?.dropped
                ? " A drop/best-N rule may absorb this once enough items exist."
                : ""}
            </p>
          )}
        </section>

        <section className="card">
          <h2>Grade</h2>
          <ul className="clean-list">
            <li>
              Score:{" "}
              <strong>
                {row?.percent != null
                  ? `${row.percent.toFixed(1)}%`
                  : assessment.gradeDisplay ?? "Not graded yet"}
              </strong>
            </li>
            <li>
              Points:{" "}
              {assessment.pointsEarned != null && assessment.pointsPossible != null
                ? `${assessment.pointsEarned} / ${assessment.pointsPossible}`
                : "â€”"}
            </li>
            <li>Dropped: {row?.dropped ? "Yes" : row?.provisionalDrop ? "Provisional" : "No"}</li>
            <li>
              Course standing:{" "}
              {summary?.calculatedPercent != null ? `${summary.calculatedPercent.toFixed(1)}%` : "Unknown"}{" "}
              on {summary?.completedWeight.toFixed(0) ?? "0"}% graded
            </li>
          </ul>
          <Link to="/grades" className="small">
            What-if calculator â†’
          </Link>
        </section>

        <section className="card">
          <h2>Attached / related content</h2>
          {[...workspace.specs, ...relatedContent.filter((c) => !workspace.specs.some((s) => s.id === c.id))].length === 0 ? (
            <p className="muted small">No linked specs yet. Browse the course content tree after sync.</p>
          ) : (
            <ul className="clean-list">
              {[...workspace.specs, ...relatedContent.filter((c) => !workspace.specs.some((s) => s.id === c.id))].map((ci) => (
                <li key={ci.id}>
                  {ci.url ? (
                    <a href={ci.url} target="_blank" rel="noreferrer">
                      {ci.title}
                    </a>
                  ) : (
                    ci.title
                  )}{" "}
                  <span className="badge">{ci.documentClass}</span>
                </li>
              ))}
            </ul>
          )}
          {workspace.library.length > 0 && (
            <>
              <h3 className="small">Library text</h3>
              <ul className="clean-list">
                {workspace.library.map((lr) => (
                  <li key={lr.id}>
                    {lr.filename} <span className="badge">{lr.documentClass}</span>
                  </li>
                ))}
              </ul>
            </>
          )}
          {workspace.feedback.length > 0 && (
            <>
              <h3 className="small">Feedback</h3>
              <ul className="clean-list">
                {workspace.feedback.map((fb) => (
                  <li key={fb.id}>
                    {fb.score != null ? <strong>{fb.score} · </strong> : null}
                    {fb.text.slice(0, 240)}
                  </li>
                ))}
              </ul>
            </>
          )}
          {quizAttempts.length > 0 && (
            <>
              <h3 className="small">Quiz attempts</h3>
              <ul className="clean-list">
                {quizAttempts.map((qa) => (
                  <li key={qa.id}>
                    Attempt {qa.attemptNumber}
                    {qa.score != null ? ` · score ${qa.score}` : ""}
                    {qa.completedAt ? ` · ${qa.completedAt}` : " · incomplete"}
                  </li>
                ))}
              </ul>
            </>
          )}
          {workspace.grades.length > 0 && (
            <>
              <h3 className="small">Grade items</h3>
              <ul className="clean-list">
                {workspace.grades.map((g) => (
                  <li key={g.id}>
                    {g.displayedGrade ?? `${g.pointsEarned ?? "—"} / ${g.pointsPossible ?? "—"}`}
                    {g.unmatched ? " (unmatched)" : ""}
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>

        <section className="card">
          <h2>Announcements & clarifications</h2>
          {[...workspace.announcements, ...relatedAnns.filter((n) => !workspace.announcements.some((w) => w.id === n.id))].length === 0 &&
          workspace.facts.length === 0 ? (
            <p className="muted small">No matching announcements.</p>
          ) : (
            <ul className="clean-list">
              {workspace.facts.map((f) => (
                <li key={f.id}>
                  <strong>{f.kind}</strong>
                  <div className="small muted">{f.detail}</div>
                </li>
              ))}
              {[...workspace.announcements, ...relatedAnns.filter((n) => !workspace.announcements.some((w) => w.id === n.id))]
                .slice(0, 8)
                .map((n) => (
                  <li key={n.id}>
                    <strong>{n.title}</strong>
                    <div className="small muted">{n.bodyText.slice(0, 160)}</div>
                    {n.url && (
                      <a className="small" href={n.url} target="_blank" rel="noreferrer">
                        CourseLink
                      </a>
                    )}
                  </li>
                ))}
            </ul>
          )}
        </section>

        <section className="card">
          <h2>Checklist</h2>
          {checklist.length === 0 ? (
            <p className="muted small">No personal checklist items linked. Use Quick Capture (Ctrl+K â†’ add task).</p>
          ) : (
            <ul className="clean-list">
              {checklist.map((t) => (
                <li key={t.id}>
                  {t.done ? "âœ“" : "â—‹"} {t.title}
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="card">
          <h2>History</h2>
          {history.length === 0 && conflicts.length === 0 ? (
            <p className="muted small">No change events for this item yet.</p>
          ) : (
            <ul className="clean-list">
              {history.map((h) => (
                <li key={h.id}>
                  <strong>{h.title}</strong>
                  <div className="small">{h.detail}</div>
                </li>
              ))}
              {conflicts.map((c) => (
                <li key={c.id}>
                  Conflict on {c.field}: {c.resolutionRule}
                </li>
              ))}
            </ul>
          )}
        </section>

        {data.preferences.developerMode && (
          <section className="card" style={{ gridColumn: "1 / -1" }}>
            <h2>Developer</h2>
            <pre className="debug-pre">
              {JSON.stringify(
                {
                  id: assessment.id,
                  due: assessment.due,
                  provenance: assessment.fieldProvenance,
                  state: assessment.state,
                  rules: rules.map((r) => ({ kind: r.kind, label: r.label })),
                },
                null,
                2,
              )}
            </pre>
          </section>
        )}
      </div>
    </div>
  );
}

