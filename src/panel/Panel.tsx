import { useEffect, useMemo, useState } from "react";
import type { AppData, Assessment } from "@/domain/types";
import { emptyAppData } from "@/storage/schema";
import { loadAppData, subscribe } from "@/storage/repository";
import { classifyTaskStatus, statusLabel } from "@/engines/status";
import { computeWorkload } from "@/engines/workload";
import { computeCourseHealth, healthStatusLabel } from "@/engines/health";
import { effectiveStatus } from "@/storage/chromeStore";
import { useTheme } from "@/ui/hooks/useTheme";
import { openApp, openCourseLink, requestSync } from "@/shared/actions";
import { formatInToronto } from "@/domain/dates";

function syncCopy(data: AppData) {
  const status = effectiveStatus(data.sync);
  if (status === "syncing") return { label: "Syncing CourseLinkâ€¦", tone: "warn" as const };
  if (status === "signed_out") return { label: "Signed out â€” sign in on CourseLink", tone: "danger" as const };
  if (status === "error") return { label: data.sync.message ?? "Sync error", tone: "danger" as const };
  if (!data.sync.lastSyncedAt) return { label: "Not synced yet", tone: "muted" as const };
  const mins = Math.round((Date.now() - data.sync.lastSyncedAt) / 60000);
  const when = mins < 1 ? "just now" : mins < 60 ? `${mins}m ago` : `${Math.round(mins / 60)}h ago`;
  return { label: `Synced ${when}`, tone: "ok" as const };
}

function DeadlineCard({
  a,
  code,
  color,
}: {
  a: Assessment;
  code?: string;
  color?: string;
}) {
  const st = classifyTaskStatus(a);
  const sev =
    st === "overdue" ? "sev-overdue" : st === "due_today" || st === "due_soon" ? "sev-soon" : "";
  return (
    <div className={`deadline-card ${sev}`}>
      <span className="dot" style={{ background: color ?? "#888" }} />
      <div className="deadline-body">
        <div className="deadline-title-row">
          <span className="deadline-title">{a.title}</span>
          <span className={`badge ${st === "overdue" ? "badge-danger" : st === "due_today" || st === "due_soon" ? "badge-warn" : "badge"}`}>
            {statusLabel(st)}
          </span>
        </div>
        <div className="small muted">
          {code ?? "Course"}
          {a.weightPercent != null ? ` Â· ${a.weightPercent}%` : ""}
          {a.due.iso ? ` Â· ${formatInToronto(a.due.iso, "EEE MMM d, h:mm a")}` : a.due.label ? ` Â· ${a.due.label}` : " Â· date unknown"}
          {a.due.certainty === "conflicting" ? " Â· conflict" : a.due.certainty === "approximate" ? " Â· approx" : ""}
        </div>
        {a.fieldProvenance.due && (
          <div className="prov-line">Source: {a.fieldProvenance.due.sourceType.replace(/_/g, " ")}</div>
        )}
      </div>
    </div>
  );
}

export function Panel() {
  const [data, setData] = useState<AppData>(emptyAppData());
  const [ready, setReady] = useState(false);
  const [syncing, setSyncing] = useState(false);
  useTheme(data.preferences.theme);

  useEffect(() => {
    void loadAppData().then((d) => {
      setData(d);
      setReady(true);
    });
    return subscribe(setData);
  }, []);

  const selected = useMemo(
    () => new Set(data.preferences.selectedCourseIds ?? []),
    [data.preferences.selectedCourseIds],
  );
  const courses = useMemo(
    () => data.courses.filter((c) => selected.has(c.id)),
    [data.courses, selected],
  );
  const courseMap = useMemo(() => new Map(data.courses.map((c) => [c.id, c])), [data.courses]);
  const assessments = useMemo(
    () => data.assessments.filter((a) => selected.has(a.courseId)),
    [data.assessments, selected],
  );
  const workload = useMemo(
    () => computeWorkload(assessments, new Date(), data.preferences.deadlineWarnHours),
    [assessments, data.preferences.deadlineWarnHours],
  );
  const status = effectiveStatus(data.sync);
  const sync = syncCopy(data);

  const healthHints = useMemo(() => {
    return courses
      .map((c) =>
        computeCourseHealth(c, data.assessments, data.conflicts, data.documents, data.people, data.meetings),
      )
      .filter((h) => h.status === "needs_attention" || h.status === "missing_information")
      .slice(0, 3);
  }, [courses, data]);

  const next = useMemo(
    () =>
      assessments
        .filter((a) => a.due.iso && a.submissionState !== "submitted" && Date.parse(a.due.iso) >= Date.now())
        .sort((a, b) => Date.parse(a.due.iso!) - Date.parse(b.due.iso!))[0],
    [assessments],
  );

  const upcoming = useMemo(
    () =>
      assessments
        .filter((a) => {
          const s = classifyTaskStatus(a);
          return s === "due_today" || s === "due_soon" || s === "overdue" || s === "upcoming";
        })
        .sort((a, b) => {
          const ta = a.due.iso ? Date.parse(a.due.iso) : Number.POSITIVE_INFINITY;
          const tb = b.due.iso ? Date.parse(b.due.iso) : Number.POSITIVE_INFINITY;
          return ta - tb;
        })
        .slice(0, 10),
    [assessments],
  );

  const onSync = () => {
    setSyncing(true);
    void requestSync().finally(() => setTimeout(() => setSyncing(false), 900));
  };

  if (!ready) {
    return (
      <div className="panel-shell">
        <div className="state-block">
          <div className="skeleton-line w60" />
          <div className="skeleton-line w40" />
          <div className="skeleton-card" />
          <p className="muted small">Loading gryphOSâ€¦</p>
        </div>
      </div>
    );
  }

  return (
    <div className="panel-shell">
      <header className="panel-top">
        <div>
          <div className="panel-brand">gryph<span>OS</span></div>
          <div className={`sync-pill sync-${sync.tone}`}>{syncing || status === "syncing" ? "Syncingâ€¦" : sync.label}</div>
        </div>
        <button type="button" className="btn btn-primary btn-sm" disabled={syncing || status === "syncing"} onClick={onSync}>
          {syncing || status === "syncing" ? "â€¦" : "Sync"}
        </button>
      </header>

      {status === "signed_out" && (
        <div className="callout callout-danger" role="alert">
          <strong>Signed out of CourseLink</strong>
          <p className="small">Sign in on this page, then sync. Previously saved data stays local.</p>
          <button type="button" className="btn btn-sm" onClick={() => void openCourseLink(true)}>Open CourseLink home</button>
        </div>
      )}

      {status === "idle" && data.sync.message && (
        <div className="callout callout-info tight">
          <p className="small">{data.sync.message}</p>
        </div>
      )}

      {status === "error" && (
        <div className="callout callout-warn" role="alert">
          <strong>Sync issue</strong>
          <p className="small">{data.sync.message ?? "Something failed. Try again."}</p>
        </div>
      )}

      {!data.sync.lastSyncedAt && status !== "signed_out" && status !== "syncing" && (
        <div className="callout callout-info">
          <strong>Get started</strong>
          <p className="small">Sync while signed in to pull courses, deadlines, and course outlines. After Sync, each course shows Outline: parsed / found / none accessible / blocked.</p>
        </div>
      )}

      {courses.length > 0 && (
        <div className="chip-row" aria-label="Courses">
          {courses.map((c) => (
            <span key={c.id} className="course-chip" style={{ ["--chip" as string]: c.color }} title={c.outlineStatusDetail ?? c.outlineStatus}>
              <i style={{ background: c.color }} />
              {c.code}
              <em className="chip-outline">{c.outlineStatus === "parsed" ? "outline ok" : c.outlineStatus === "found" ? "outline" : c.outlineStatus === "blocked" ? "blocked" : c.outlineStatus === "none_accessible" ? "no outline" : ""}</em>
            </span>
          ))}
        </div>
      )}

      <div className="panel-stats">
        <div className="stat">
          <div className="stat-n">{workload.dueToday.length}</div>
          <div className="stat-l">Today</div>
        </div>
        <div className="stat">
          <div className="stat-n">{workload.dueThisWeek.length}</div>
          <div className="stat-l">This week</div>
        </div>
        <div className={`stat ${workload.overdue.length ? "danger" : ""}`}>
          <div className="stat-n">{workload.overdue.length}</div>
          <div className="stat-l">Overdue</div>
        </div>
      </div>

      {workload.overdue.length > 0 && (
        <div className="callout callout-danger tight">
          <strong>{workload.overdue.length} overdue</strong>
          <span className="small"> â€” unsubmitted past due</span>
        </div>
      )}

      <section className="panel-section">
        <h2>Next up</h2>
        {next ? (
          <DeadlineCard a={next} code={courseMap.get(next.courseId)?.code} color={courseMap.get(next.courseId)?.color} />
        ) : (
          <div className="empty-mini">No upcoming exact deadlines.</div>
        )}
      </section>

      <section className="panel-section grow">
        <h2>Queue</h2>
        <div className="panel-list">
          {upcoming.length === 0 ? (
            <div className="empty-mini">{courses.length ? "Clear queue â€” nothing due soon." : "Sync to load your semester."}</div>
          ) : (
            upcoming.map((a) => (
              <DeadlineCard
                key={a.id}
                a={a}
                code={courseMap.get(a.courseId)?.code}
                color={courseMap.get(a.courseId)?.color}
              />
            ))
          )}
        </div>
      </section>

      {healthHints.length > 0 && (
        <section className="panel-section">
          <h2>Data health</h2>
          <div className="health-list">
            {healthHints.map((h) => {
              const c = courseMap.get(h.courseId);
              const warn = h.checks.filter((x) => x.warn).slice(0, 2);
              return (
                <div key={h.courseId} className="health-row">
                  <span className="dot" style={{ background: c?.color }} />
                  <div>
                    <strong>{c?.code}</strong>{" "}
                    <span className="badge badge-warn">{healthStatusLabel(h.status)}</span>
                    <div className="small muted">{warn.map((w) => w.label).join(" Â· ") || `${h.score}% complete`}</div>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      <footer className="panel-foot">
        <button type="button" className="btn btn-sm" style={{ flex: 1 }} onClick={() => void openApp()}>
          Open full app
        </button>
        <span className="small muted">{courses.length} courses</span>
      </footer>
    </div>
  );
}
