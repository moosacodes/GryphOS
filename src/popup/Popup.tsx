import { useEffect, useState } from "react";
import type { AppData } from "@/domain/types";
import { emptyAppData } from "@/storage/schema";
import { loadAppData, subscribe } from "@/storage/repository";
import { classifyTaskStatus } from "@/engines/status";
import { openApp, openCourseLink, requestSync, toggleCourseLinkPanel } from "@/shared/actions";
import { effectiveStatus } from "@/storage/chromeStore";
import { useTheme } from "@/ui/hooks/useTheme";
import "@/ui/styles/global.css";

function syncLabel(status: ReturnType<typeof effectiveStatus>, lastSyncedAt: number | null, message: string | null): string {
  switch (status) {
    case "syncing":
      return "Syncing…";
    case "signed_out":
      return "Signed out";
    case "error":
      return message ? `Error: ${message}` : "Sync error";
    default:
      return lastSyncedAt ? "Ready" : "Not synced";
  }
}

export function Popup() {
  const [data, setData] = useState<AppData>(emptyAppData());
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  useTheme(data.preferences.theme);

  useEffect(() => {
    void loadAppData().then((d) => {
      setData(d);
      setReady(true);
    });
    return subscribe(setData);
  }, []);

  if (!ready) {
    return (
      <div className="popup-shell">
        <div className="skeleton-line w40" />
        <div className="skeleton-card" />
      </div>
    );
  }

  const selected = new Set(data.preferences.selectedCourseIds ?? []);
  const assessments = data.assessments.filter((a) => selected.has(a.courseId));
  const courses = data.courses.filter((c) => selected.has(c.id));
  const courseMap = new Map(data.courses.map((c) => [c.id, c]));
  const overdue = assessments.filter((a) => classifyTaskStatus(a) === "overdue");
  const today = assessments.filter((a) => classifyTaskStatus(a) === "due_today");
  const soon = assessments.filter((a) => classifyTaskStatus(a) === "due_soon");
  const next = assessments
    .filter((a) => a.due.iso && Date.parse(a.due.iso) >= Date.now() && a.submissionState !== "submitted")
    .sort((a, b) => Date.parse(a.due.iso!) - Date.parse(b.due.iso!))[0];
  const status = effectiveStatus(data.sync);
  const firstRun = !data.sync.lastSyncedAt && data.courses.length === 0;
  const tone = status === "signed_out" || status === "error" ? "badge-warn" : status === "syncing" ? "badge-warn" : data.sync.lastSyncedAt ? "badge-ok" : "badge";

  return (
    <div className="popup-shell">
      <div className="popup-top">
        <strong className="panel-brand">gryph<span>OS</span></strong>
        <span className={`badge ${tone}`}>{syncLabel(status, data.sync.lastSyncedAt, data.sync.message)}</span>
      </div>

      {firstRun && (
        <div className="callout callout-info tight">
          <strong>Use on CourseLink</strong>
          <p className="small muted" style={{ margin: "4px 0 0" }}>
            Open the side panel for day-to-day work. No terminal needed after install.
          </p>
        </div>
      )}

      {status === "signed_out" && (
        <div className="callout callout-danger tight" role="alert">
          <strong>Signed out</strong>
          <p className="small" style={{ margin: "4px 0 6px" }}>Sign in to CourseLink, then Sync.</p>
          <button type="button" className="btn btn-sm" onClick={() => void openCourseLink(true)}>Open CourseLink</button>
        </div>
      )}

      {overdue.length > 0 && status !== "signed_out" && (
        <div className="callout callout-danger tight">⚠ {overdue.length} overdue item{overdue.length === 1 ? "" : "s"}</div>
      )}

      {courses.length > 0 && (
        <div className="chip-row compact">
          {courses.slice(0, 6).map((c) => (
            <span key={c.id} className="course-chip" style={{ ["--chip" as string]: c.color }}>
              <i style={{ background: c.color }} />
              {c.code}
            </span>
          ))}
        </div>
      )}

      <div className="card card-tight deadline-hero">
        <div className="small muted">Next deadline</div>
        {next ? (
          <div>
            <div className="deadline-title">
              <span className="dot" style={{ background: courseMap.get(next.courseId)?.color, display: "inline-block", marginRight: 6 }} />
              <strong>{courseMap.get(next.courseId)?.code}</strong> {next.title}
            </div>
            <div className="small muted">{new Date(next.due.iso!).toLocaleString()}</div>
          </div>
        ) : (
          <div className="small muted">{firstRun ? "Sync to discover deadlines." : "None upcoming with exact dates."}</div>
        )}
      </div>

      <div className="popup-metrics">
        <div><strong>{today.length}</strong><span>Today</span></div>
        <div><strong>{soon.length}</strong><span>Soon</span></div>
        <div className={overdue.length ? "danger" : ""}><strong>{overdue.length}</strong><span>Overdue</span></div>
      </div>

      <div className="popup-actions">
        <button
          type="button"
          className="btn btn-primary"
          disabled={busy}
          onClick={() => {
            setBusy(true);
            void toggleCourseLinkPanel().finally(() => setBusy(false));
          }}
        >
          Open panel
        </button>
        <button
          type="button"
          className="btn"
          disabled={busy || status === "syncing"}
          onClick={() => {
            setBusy(true);
            void requestSync().finally(() => setTimeout(() => setBusy(false), 600));
          }}
        >
          Sync
        </button>
      </div>
      <button type="button" className="btn btn-ghost" style={{ width: "100%", marginTop: 6 }} onClick={() => void openApp()}>
        Full app
      </button>
    </div>
  );
}
