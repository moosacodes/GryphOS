import { useEffect, useState } from "react";
import type { AppData } from "@/domain/types";
import { emptyAppData } from "@/storage/schema";
import { loadAppData, subscribe } from "@/storage/repository";
import { classifyTaskStatus } from "@/engines/status";
import { computeWorkload } from "@/engines/workload";
import { effectiveStatus } from "@/storage/chromeStore";
import { useTheme } from "@/ui/hooks/useTheme";
import { openApp, openCourseLink, requestSync } from "@/shared/actions";
import { formatInToronto } from "@/domain/dates";

export function Panel() {
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

  if (!ready) {
    return <div className="panel-shell"><p className="muted small">Loading gryphOS…</p></div>;
  }

  const selected = new Set(data.preferences.selectedCourseIds ?? []);
  const courses = data.courses.filter((c) => selected.has(c.id));
  const courseMap = new Map(data.courses.map((c) => [c.id, c]));
  const assessments = data.assessments.filter((a) => selected.has(a.courseId));
  const workload = computeWorkload(assessments, new Date(), data.preferences.deadlineWarnHours);
  const status = effectiveStatus(data.sync);
  const next = assessments
    .filter((a) => a.due.iso && a.submissionState !== "submitted" && Date.parse(a.due.iso) >= Date.now())
    .sort((a, b) => Date.parse(a.due.iso!) - Date.parse(b.due.iso!))[0];

  const upcoming = assessments
    .filter((a) => {
      const s = classifyTaskStatus(a);
      return s === "due_today" || s === "due_soon" || s === "overdue" || s === "upcoming";
    })
    .sort((a, b) => {
      const ta = a.due.iso ? Date.parse(a.due.iso) : Number.POSITIVE_INFINITY;
      const tb = b.due.iso ? Date.parse(b.due.iso) : Number.POSITIVE_INFINITY;
      return ta - tb;
    })
    .slice(0, 8);

  return (
    <div className="panel-shell">
      <header className="panel-top">
        <div>
          <div className="panel-brand">gryph<span>OS</span></div>
          <div className="small muted">
            {status === "syncing"
              ? "Syncing…"
              : status === "signed_out"
                ? "Signed out"
                : data.sync.lastSyncedAt
                  ? `Synced ${new Date(data.sync.lastSyncedAt).toLocaleString()}`
                  : "Not synced yet"}
          </div>
        </div>
        <button type="button" className="btn btn-primary btn-sm" onClick={() => void requestSync()}>
          Sync
        </button>
      </header>

      {status === "signed_out" && (
        <div className="conflict-banner" role="alert">
          <strong>Signed out of CourseLink</strong>
          <div className="small" style={{ marginTop: 4 }}>Sign in on this page, then Sync.</div>
          <button type="button" className="btn btn-sm" style={{ marginTop: 6 }} onClick={() => void openCourseLink(true)}>
            Open home
          </button>
        </div>
      )}

      <div className="panel-stats">
        <div className="stat"><div className="stat-n">{workload.dueToday.length}</div><div className="stat-l">Today</div></div>
        <div className="stat"><div className="stat-n">{workload.dueThisWeek.length}</div><div className="stat-l">This week</div></div>
        <div className="stat danger"><div className="stat-n">{workload.overdue.length}</div><div className="stat-l">Overdue</div></div>
      </div>

      <section className="panel-section">
        <h2>Next</h2>
        {next ? (
          <div className="panel-item">
            <span className="dot" style={{ background: courseMap.get(next.courseId)?.color }} />
            <div>
              <div className="panel-item-title">{next.title}</div>
              <div className="small muted">
                {courseMap.get(next.courseId)?.code}
                {next.due.iso ? ` · ${formatInToronto(next.due.iso, "EEE MMM d, h:mm a")}` : ""}
              </div>
            </div>
          </div>
        ) : (
          <p className="muted small">No upcoming exact deadlines.</p>
        )}
      </section>

      <section className="panel-section">
        <h2>Upcoming</h2>
        <div className="panel-list">
          {upcoming.length === 0 ? (
            <p className="muted small">{courses.length ? "Nothing queued." : "Sync to load courses."}</p>
          ) : (
            upcoming.map((a) => (
              <div key={a.id} className="panel-item">
                <span className="dot" style={{ background: courseMap.get(a.courseId)?.color }} />
                <div>
                  <div className="panel-item-title">{a.title}</div>
                  <div className="small muted">
                    {courseMap.get(a.courseId)?.code}
                    {a.due.iso ? ` · ${formatInToronto(a.due.iso, "MMM d")}` : " · date unknown"}
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </section>

      <footer className="panel-foot">
        <button type="button" className="btn btn-sm" style={{ flex: 1 }} onClick={() => void openApp()}>
          Full app
        </button>
        <span className="small muted">{courses.length} courses</span>
      </footer>
    </div>
  );
}
