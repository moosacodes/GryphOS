import { Link } from "react-router-dom";
import type { AppData, Assessment } from "@/domain/types";
import { DEFAULT_ITEM_STATE } from "@/domain/types";
import { currentSemester } from "@/normalize/course";
import { computeWorkload } from "@/engines/workload";
import { summarizeCourseGrades } from "@/engines/grades";
import { AssessmentRow } from "../components/AssessmentRow";
import { EmptyState } from "../components/EmptyState";
import { SyncButton } from "../components/SyncButton";
import { openCourseLink } from "@/shared/actions";
import { eventOccursOn } from "@/engines/icsImport";
import { torontoDayKey } from "@/domain/dates";

export function Dashboard({
  data,
  update,
}: {
  data: AppData;
  update?: (patch: Partial<AppData> | ((prev: AppData) => AppData)) => Promise<AppData>;
}) {
  const courses = data.courses.filter((c) =>
    (data.preferences.selectedCourseIds ?? []).includes(c.id),
  );
  const courseMap = new Map(data.courses.map((c) => [c.id, c]));
  const assessments = data.assessments.filter((a) => courses.some((c) => c.id === a.courseId));
  const workload = computeWorkload(assessments, new Date(), data.preferences.deadlineWarnHours);
  const term = currentSemester(data.courses);
  const name = data.user?.name?.split(" ")[0] ?? "there";
  const todayKey = torontoDayKey(new Date().toISOString());
  const unreadChanges = (data.changes ?? []).filter((c) => !c.read);
  const needsConfirm = assessments.filter((a) => a.state?.needsConfirmation);
  const didI = assessments.filter(
    (a) =>
      a.state?.userCompleted === "unknown" &&
      a.submissionState !== "submitted" &&
      a.due.iso &&
      Date.parse(a.due.iso) < Date.now() + 864e5 * 2,
  );

  const confirm = async (a: Assessment, kind: "did" | "missed" | "submitted") => {
    if (!update) return;
    await update((prev) => ({
      ...prev,
      assessments: prev.assessments.map((x) => {
        if (x.id !== a.id) return x;
        const state = { ...DEFAULT_ITEM_STATE, ...x.state, needsConfirmation: false, pastDueConfirmed: true };
        if (kind === "did") {
          state.userCompleted = "confirmed";
          state.work = "completed";
        }
        if (kind === "missed") {
          state.missed = true;
          state.userCompleted = "denied";
        }
        if (kind === "submitted") {
          return {
            ...x,
            submissionState: "submitted" as const,
            state: { ...state, submission: "submitted", work: "completed", userCompleted: "confirmed" },
          };
        }
        return { ...x, state };
      }),
      actionLog: [
        {
          id: `act:${Date.now()}`,
          at: new Date().toISOString(),
          action: `confirm:${kind}`,
          entityId: a.id,
          before: a.state,
          after: kind,
          undone: false,
        },
        ...(prev.actionLog ?? []),
      ].slice(0, 100),
    }));
  };

  if (!data.sync.lastSyncedAt && courses.length === 0) {
    return (
      <div>
        <div className="page-header">
          <div>
            <h1>Today</h1>
            <p>Your local-first academic OS for CourseLink.</p>
          </div>
        </div>
        <EmptyState
          title="Not synced yet"
          body="Open CourseLink while signed in, then sync. No passwords. No chatbot."
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

  const icsToday = (data.calendarEvents ?? []).filter((e) => eventOccursOn(e, todayKey));

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Today</h1>
          <p>
            Hi {name}
            {term ? ` · ${term}` : ""} — home for deadlines, confirmation, and changes.
          </p>
        </div>
        <SyncButton />
      </div>

      {unreadChanges.length > 0 && (
        <div className="callout callout-info" style={{ marginBottom: "1rem" }}>
          <strong>{unreadChanges.length} change(s)</strong>
          <p className="small">{unreadChanges[0]?.title}</p>
          <Link to="/changes">Open Changes inbox →</Link>
        </div>
      )}

      <div className="grid grid-3" style={{ marginBottom: "1rem" }}>
        <div className="card">
          <h3>Due today</h3>
          <p style={{ fontSize: "1.8rem", margin: 0, fontWeight: 700 }}>{workload.dueToday.length}</p>
        </div>
        <div className="card">
          <h3>Needs confirmation</h3>
          <p style={{ fontSize: "1.8rem", margin: 0, fontWeight: 700 }}>{needsConfirm.length}</p>
          <p className="small muted">Past-due stays unknown until you confirm</p>
        </div>
        <div className="card">
          <h3>Overdue / unsubmitted</h3>
          <p
            style={{
              fontSize: "1.8rem",
              margin: 0,
              fontWeight: 700,
              color: workload.overdue.length ? "var(--danger)" : undefined,
            }}
          >
            {workload.overdue.length}
          </p>
        </div>
      </div>

      {(needsConfirm.length > 0 || didI.length > 0) && (
        <div className="card" style={{ marginBottom: "1rem" }}>
          <h2>Did I do this?</h2>
          <div className="list">
            {[...needsConfirm, ...didI.filter((a) => !needsConfirm.some((n) => n.id === a.id))]
              .slice(0, 8)
              .map((a) => (
                <div key={a.id} className="list-item" style={{ alignItems: "center" }}>
                  <span className="dot" style={{ background: courseMap.get(a.courseId)?.color }} />
                  <div>
                    <strong>{a.title}</strong>
                    <div className="small muted">{courseMap.get(a.courseId)?.code}</div>
                  </div>
                  <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                    <button type="button" className="btn btn-sm" onClick={() => void confirm(a, "did")}>
                      Done
                    </button>
                    <button type="button" className="btn btn-sm" onClick={() => void confirm(a, "submitted")}>
                      Submitted
                    </button>
                    <button type="button" className="btn btn-sm" onClick={() => void confirm(a, "missed")}>
                      Missed
                    </button>
                  </div>
                </div>
              ))}
          </div>
        </div>
      )}

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
            <Link to="/tasks">Tasks →</Link>
          </p>
        </div>

        <div className="card">
          <h2>Course standings</h2>
          <div className="list">
            {courses.map((c) => {
              const s = summarizeCourseGrades(
                c,
                assessments,
                data.gradeCategories,
                data.academicRules,
                data.whatIfOverrides,
              );
              return (
                <div key={c.id} className="list-item" style={{ gridTemplateColumns: "auto 1fr auto" }}>
                  <span className="dot" style={{ background: c.color }} />
                  <div>
                    <strong>{c.code}</strong>
                    <div className="small muted">
                      {c.lectureSection ? `Lec ${c.lectureSection}` : ""}
                      {c.labSection ? ` · Lab ${c.labSection}` : ""}
                      {s.capReason ? ` · capped` : ""}
                    </div>
                  </div>
                  <strong>
                    {s.calculatedPercent != null ? `${s.calculatedPercent.toFixed(1)}%` : "—"}
                  </strong>
                </div>
              );
            })}
          </div>
        </div>

        {icsToday.length > 0 && (
          <div className="card">
            <h2>Calendar today (ICS)</h2>
            <ul className="small">
              {icsToday.map((e) => (
                <li key={e.id}>
                  [{e.category}] {e.title}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}
