import { useEffect, useState } from "react";
import type { AppData } from "@/domain/types";
import { emptyAppData } from "@/storage/schema";
import { loadAppData, subscribe } from "@/storage/repository";
import { classifyTaskStatus } from "@/engines/status";
import { openApp, openCourseLink, requestSync } from "@/shared/actions";
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
  const tomorrow = assessments.filter((a) => classifyTaskStatus(a) === "due_soon").slice(0, 5);
  const next = assessments
    .filter((a) => a.due.iso && Date.parse(a.due.iso) >= Date.now() && a.submissionState !== "submitted")
    .sort((a, b) => Date.parse(a.due.iso!) - Date.parse(b.due.iso!))[0];
  const status = effectiveStatus(data.sync);
  const firstRun = !data.sync.lastSyncedAt && data.courses.length === 0;

  return (
    <div style={{ width: 340, padding: 12 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
        <strong>gryph<span style={{ color: "var(--accent)" }}>OS</span></strong>
        <span className={status === "signed_out" || status === "error" ? "badge badge-warn" : "badge"}>
          {syncLabel(status, data.sync.lastSyncedAt)}
        </span>
      </div>

      {firstRun && (
        <div className="card" style={{ marginBottom: 8, padding: "0.65rem", background: "var(--bg-muted)" }}>
          <div className="small" style={{ fontWeight: 600 }}>Runs entirely in Chrome</div>
          <div className="small muted">
            No terminal or local server needed. Works in Brave and Opera GX. Sign in to CourseLink, then Sync.
          </div>
        </div>
      )}

      {status === "signed_out" && (
        <div className="conflict-banner" style={{ marginBottom: 8 }} role="alert">
          <div style={{ fontWeight: 600 }}>Signed out of CourseLink</div>
          <div className="small" style={{ marginTop: 4 }}>
            Open CourseLink and sign in, then Sync again.
          </div>
          <button
            type="button"
            className="btn"
            style={{ marginTop: 6 }}
            onClick={() => void openCourseLink(true)}
          >
            Open CourseLink
          </button>
        </div>
      )}

      {overdue.length > 0 && status !== "signed_out" && (
        <div className="conflict-banner" style={{ marginBottom: 8 }}>
          ⚠ {overdue.length} overdue
        </div>
      )}

      <div className="card" style={{ marginBottom: 8, padding: "0.7rem" }}>
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

      <div className="small" style={{ marginBottom: 8 }}>
        Today: <strong>{today.length}</strong> · Soon: <strong>{tomorrow.length}</strong>
      </div>

      <div style={{ display: "flex", gap: 6 }}>
        <button type="button" className="btn btn-primary" style={{ flex: 1 }} onClick={() => void requestSync()}>
          Sync
        </button>
        <button type="button" className="btn" style={{ flex: 1 }} onClick={() => void openApp()}>
          Open gryphOS
        </button>
      </div>
    </div>
  );
}
