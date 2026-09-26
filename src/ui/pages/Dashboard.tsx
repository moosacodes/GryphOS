import { Link } from "react-router-dom";
import type { AppData } from "@/domain/types";
import { currentSemester } from "@/normalize/course";
import { computeWorkload } from "@/engines/workload";
import { summarizeCourseGrades } from "@/engines/grades";
import { computeCourseHealth, healthStatusLabel } from "@/engines/health";
import { AssessmentRow } from "../components/AssessmentRow";
import { EmptyState } from "../components/EmptyState";
import { SyncButton } from "../components/SyncButton";
import { openCourseLink } from "@/shared/actions";

export function Dashboard({ data }: { data: AppData }) {
  const courses = data.courses.filter((c) =>
    (data.preferences.selectedCourseIds ?? []).includes(c.id),
  );
  const courseMap = new Map(data.courses.map((c) => [c.id, c]));
  const assessments = data.assessments.filter((a) => courses.some((c) => c.id === a.courseId));
  const workload = computeWorkload(assessments, new Date(), data.preferences.deadlineWarnHours);
  const term = currentSemester(data.courses);
  const name = data.user?.name?.split(" ")[0] ?? "there";

  const next = [...assessments]
    .filter((a) => a.due.iso && a.submissionState !== "submitted")
    .sort((a, b) => Date.parse(a.due.iso!) - Date.parse(b.due.iso!))
    .find((a) => Date.parse(a.due.iso!) >= Date.now());

  const recentGrades = assessments
    .filter((a) => a.pointsEarned != null || a.gradeDisplay)
    .slice(0, 5);

  const healthWarns = courses
    .map((c) =>
      computeCourseHealth(c, data.assessments, data.conflicts, data.documents, data.people, data.meetings),
    )
    .filter((h) => h.status === "needs_attention" || h.status === "missing_information");

  if (!data.sync.lastSyncedAt && courses.length === 0) {
    return (
      <div>
        <div className="page-header">
          <div>
            <h1>Welcome to gryphOS</h1>
            <p>Your local-first academic OS for CourseLink.</p>
          </div>
        </div>
        <EmptyState
          title="Not synced yet"
          body="Open CourseLink while signed in, then sync. gryphOS uses your existing browser session — no passwords. Once loaded from dist/, it runs entirely in Chrome with no terminal."
          action={
            <div style={{ display: "flex", gap: "0.5rem", justifyContent: "center", marginTop: "0.75rem" }}>
              <button type="button" className="btn btn-primary" onClick={() => void openCourseLink(true)}>
                Open CourseLink
              </button>
              <SyncButton />
            </div>
          }
        />
      </div>
    );
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Hi {name}</h1>
          <p>{term ? `${term} · ` : ""}What do you need to care about right now?</p>
        </div>
        <SyncButton />
      </div>

      {data.sync.status === "signed_out" && (
        <div className="conflict-banner" role="alert">
          Signed out of CourseLink. <button type="button" className="btn" onClick={() => void openCourseLink(true)}>Sign in</button>
        </div>
      )}

      <div className="grid grid-3" style={{ marginBottom: "1rem" }}>
        <div className="card">
          <h3>Next deadline</h3>
          {next ? (
            <AssessmentRow assessment={next} course={courseMap.get(next.courseId)} />
          ) : (
            <p className="muted small">No upcoming deadlines with exact dates.</p>
          )}
        </div>
        <div className="card">
          <h3>Due today</h3>
          <p style={{ fontSize: "1.8rem", margin: 0, fontWeight: 700 }}>{workload.dueToday.length}</p>
          <p className="muted small">Tomorrow: {workload.dueTomorrow.length}</p>
        </div>
        <div className="card">
          <h3>Overdue / unsubmitted</h3>
          <p style={{ fontSize: "1.8rem", margin: 0, fontWeight: 700, color: workload.overdue.length ? "var(--danger)" : undefined }}>
            {workload.overdue.length}
          </p>
        </div>
      </div>

      <div className="grid grid-2">
        <div className="card">
          <h2>This week</h2>
          <div className="list">
            {workload.dueThisWeek.length === 0 ? (
              <p className="muted small">Nothing with an exact due date this week.</p>
            ) : (
              workload.dueThisWeek.slice(0, 8).map((a) => (
                <AssessmentRow key={a.id} assessment={a} course={courseMap.get(a.courseId)} />
              ))
            )}
          </div>
          <p className="small" style={{ marginTop: "0.75rem" }}>
            <Link to="/tasks">Open tasks →</Link>
          </p>
        </div>

        <div className="card">
          <h2>Course standings</h2>
          <div className="list">
            {courses.map((c) => {
              const s = summarizeCourseGrades(c, assessments, data.gradeCategories);
              return (
                <div key={c.id} className="list-item" style={{ gridTemplateColumns: "auto 1fr auto" }}>
                  <span className="dot" style={{ background: c.color }} />
                  <div>
                    <strong>{c.code}</strong>
                    <div className="small muted">
                      Completed weight {s.completedWeight.toFixed(0)}% · remaining {s.remainingWeight.toFixed(0)}%
                    </div>
                  </div>
                  <strong>
                    {s.calculatedPercent != null ? `${s.calculatedPercent.toFixed(1)}%` : "—"}
                  </strong>
                </div>
              );
            })}
          </div>
          <p className="small muted" style={{ marginTop: "0.5rem" }}>
            Calculated by gryphOS from weighted graded work — not an official University grade.
          </p>
        </div>

        <div className="card">
          <h2>Recent grades</h2>
          {recentGrades.length === 0 ? (
            <p className="muted small">No released grades yet.</p>
          ) : (
            <div className="list">
              {recentGrades.map((a) => (
                <div key={a.id} className="list-item">
                  <span className="dot" style={{ background: courseMap.get(a.courseId)?.color }} />
                  <div>
                    <strong>{a.title}</strong>
                    <div className="small muted">{courseMap.get(a.courseId)?.code}</div>
                  </div>
                  <span className="badge badge-ok">
                    {a.gradeDisplay ??
                      (a.pointsEarned != null && a.pointsPossible
                        ? `${a.pointsEarned}/${a.pointsPossible}`
                        : "Graded")}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="card">
          <h2>Data health</h2>
          {healthWarns.length === 0 ? (
            <p className="muted small">Selected courses look healthy.</p>
          ) : (
            <div className="list">
              {healthWarns.map((h) => {
                const c = courseMap.get(h.courseId);
                return (
                  <div key={h.courseId} className="list-item">
                    <span className="dot" style={{ background: c?.color }} />
                    <div>
                      <strong>{c?.code}</strong>
                      <div className="small muted">{healthStatusLabel(h.status)} · {h.score}%</div>
                    </div>
                    <Link className="small" to={`/courses/${h.courseId}`}>
                      View
                    </Link>
                  </div>
                );
              })}
            </div>
          )}
          {workload.weeks.filter((w) => w.busy).length > 0 && (
            <p className="small" style={{ marginTop: "0.75rem" }}>
              Busy weeks ahead: {workload.weeks.filter((w) => w.busy).slice(0, 3).map((w) => w.weekStart).join(", ")}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
