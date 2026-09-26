import { useEffect, useState } from "react";
import type { AppData } from "@/domain/types";
import { emptyAppData } from "@/storage/schema";
import { loadAppData, subscribe } from "@/storage/repository";
import { classifyTaskStatus } from "@/engines/status";
import { openApp, openCourseLink, requestSync, toggleCourseLinkPanel } from "@/shared/actions";
import { effectiveStatus } from "@/storage/chromeStore";
import { useTheme } from "@/ui/hooks/useTheme";
import "@/ui/styles/global.css";

function syncLabel(status: ReturnType<typeof effectiveStatus>, lastSyncedAt: number | null): string {
  switch (status) {
    case "syncing":
      return "Syncing…";
    case "signed_out":
      return "Signed out of CourseLink";
    case "error":
      return "Sync error";
    default:
      return lastSyncedAt ? "Synced" : "Not synced yet";
  }
}

export function Popup() {
  const [data, setData] = useState<AppData>(emptyAppData());
  const [ready, setReady] = useState(false);
  useTheme(data.preferences.theme);

  useEffect(() => {
    void loadAppData().then((d) => {
      setData(d);
      setReady(true);
    });
    return subscribe(setData);
  }, []);

  if (!ready) return <div style={{ padding: 12, width: 320 }}>Loading…</div>;

  const selected = new Set(data.preferences.selectedCourseIds ?? []);
  const assessments = data.assessments.filter((a) => selected.has(a.courseId));
  const courseMap = new Map(data.courses.map((c) => [c.id, c]));
  const overdue = assessments.filter((a) => classifyTaskStatus(a) === "overdue");
  const today = assessments.filter((a) => classifyTaskStatus(a) === "due_today");
  const soon = assessments.filter((a) => classifyTaskStatus(a) === "due_soon").slice(0, 5);
  const next = assessments
    .filter((a) => a.due.iso && Date.parse(a.due.iso) >= Date.now() && a.submissionState !== "submitted")
    .sort((a, b) => Date.parse(a.due.iso!) - Date.parse(b.due.iso!))[0];
  const status = effectiveStatus(data.sync);
  const firstRun = !data.sync.lastSyncedAt && data.courses.length === 0;

  return (
    <div className="popup-shell">
      <div className="popup-top">
        <strong className="panel-brand">gryph<span>OS</span></strong>
        <span className={status === "signed_out" || status === "error" ? "badge badge-warn" : "badge"}>
          {syncLabel(status, data.sync.lastSyncedAt)}
        </span>
      </div>

      {firstRun && (
        <div className="card card-tight muted-card">
          <div className="small" style={{ fontWeight: 600 }}>On CourseLink</div>
          <div className="small muted">
            Open the side panel on CourseLink for day-to-day use. No terminal needed.
          </div>
        </div>
      )}

      {status === "signed_out" && (
        <div className="conflict-banner" role="alert">
          <div style={{ fontWeight: 600 }}>Signed out of CourseLink</div>
          <div className="small" style={{ marginTop: 4 }}>
            Open CourseLink and sign in, then Sync again.
          </div>
          <button type="button" className="btn btn-sm" style={{ marginTop: 6 }} onClick={() => void openCourseLink(true)}>
            Open CourseLink
          </button>
        </div>
      )}

      {overdue.length > 0 && status !== "signed_out" && (
        <div className="conflict-banner">⚠ {overdue.length} overdue</div>
      )}

      <div className="card card-tight">
        <div className="small muted">Next deadline</div>
        {next ? (
          <div>
            <strong>{courseMap.get(next.courseId)?.code}</strong> {next.title}
            <div className="small muted">{new Date(next.due.iso!).toLocaleString()}</div>
          </div>
        ) : (
          <div className="small muted">None upcoming</div>
        )}
      </div>

      <div className="small popup-meta">
        Today: <strong>{today.length}</strong> · Soon: <strong>{soon.length}</strong>
      </div>

      <div className="popup-actions">
        <button type="button" className="btn btn-primary" onClick={() => void toggleCourseLinkPanel()}>
          Open panel
        </button>
        <button type="button" className="btn" onClick={() => void requestSync()}>
          Sync
        </button>
      </div>
      <button type="button" className="btn btn-ghost" style={{ width: "100%", marginTop: 6 }} onClick={() => void openApp()}>
        Full app (secondary)
      </button>
    </div>
  );
}
