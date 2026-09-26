import { NavLink, Outlet, Link } from "react-router-dom";
import type { AppData } from "@/domain/types";
import { openCourseLink } from "@/shared/actions";
import { effectiveStatus } from "@/storage/chromeStore";
import { SyncButton } from "./SyncButton";
import { CommandPalette } from "./CommandPalette";
import { useState } from "react";

const LINKS = [
  { to: "/", label: "Today", end: true },
  { to: "/inbox", label: "Inbox" },
  { to: "/calendar", label: "Calendar" },
  { to: "/tasks", label: "Tasks" },
  { to: "/grades", label: "Grades" },
  { to: "/courses", label: "Courses" },
  { to: "/search", label: "Search" },
  { to: "/coverage", label: "Coverage" },
  { to: "/settings", label: "Settings" },
];

function syncLabel(status: ReturnType<typeof effectiveStatus>, lastSyncedAt: number | null): string {
  switch (status) {
    case "syncing":
      return "Syncingâ€¦";
    case "signed_out":
      return "Signed out";
    case "error":
      return "Error";
    default:
      return lastSyncedAt ? "OK" : "Never";
  }
}

function courseStatusDot(data: AppData, courseId: string): string {
  const now = Date.now();
  const dueSoon = data.assessments.some((a) => {
    if (a.courseId !== courseId) return false;
    if (a.submissionState === "submitted" || a.state?.missed) return false;
    if (!a.due.iso) return false;
    const t = Date.parse(a.due.iso);
    return Number.isFinite(t) && t >= now && t <= now + 48 * 3600_000;
  });
  if (dueSoon) return "var(--warn)";
  const overdue = data.assessments.some((a) => {
    if (a.courseId !== courseId) return false;
    if (a.submissionState === "submitted" || a.state?.missed || a.state?.pastDueConfirmed) return false;
    if (!a.due.iso) return false;
    return Date.parse(a.due.iso) < now;
  });
  if (overdue) return "var(--danger)";
  return "var(--ok)";
}

export function Layout({
  data,
  update,
}: {
  data: AppData;
  update: (patch: Partial<AppData> | ((prev: AppData) => AppData)) => Promise<AppData>;
}) {
  const status = effectiveStatus(data.sync);
  const selected = data.courses.filter((c) =>
    (data.preferences.selectedCourseIds ?? []).includes(c.id),
  );
  const unread = (data.changes ?? []).filter((c) => !c.read).length;
  const [paletteOpen, setPaletteOpen] = useState(false);

  return (
    <div className="app-shell">
      <nav className="nav" aria-label="Primary">
        <div className="nav-brand">
          <strong>
            gryph<span>OS</span>
          </strong>
        </div>
        <button
          type="button"
          className="btn btn-sm nav-search-btn"
          onClick={() => setPaletteOpen(true)}
          title="Command palette (Ctrl+K)"
        >
          Search / commands
        </button>
        {LINKS.map((l) => (
          <NavLink
            key={l.to}
            to={l.to}
            end={l.end}
            className={({ isActive }) => `nav-link${isActive ? " active" : ""}`}
          >
            {l.label}
            {l.to === "/inbox" && unread > 0 ? (
              <span className="nav-badge">{unread}</span>
            ) : null}
          </NavLink>
        ))}

        {selected.length > 0 && (
          <div className="nav-course-list">
            <div className="nav-section-label">Courses</div>
            {selected.map((c) => (
              <Link key={c.id} to={`/courses/${encodeURIComponent(c.id)}`} className="nav-course-item">
                <span className="nav-status-dot" style={{ background: courseStatusDot(data, c.id) }} />
                <span className="nav-swatch" style={{ background: c.color }} />
                <span className="nav-course-code">{c.code}</span>
              </Link>
            ))}
          </div>
        )}

        <div className="nav-foot">
          <div className="small muted">
            Sync: <strong>{syncLabel(status, data.sync.lastSyncedAt)}</strong>
          </div>
          {status === "signed_out" && (
            <div className="callout callout-danger tight" role="alert">
              <div className="small" style={{ fontWeight: 650 }}>
                Signed out of CourseLink
              </div>
              <button
                type="button"
                className="btn btn-sm"
                style={{ marginTop: 6, width: "100%" }}
                onClick={() => void openCourseLink(true)}
              >
                Sign in
              </button>
            </div>
          )}
          {status === "error" && data.sync.message && (
            <div className="small" style={{ color: "var(--danger)" }}>
              {data.sync.message}
            </div>
          )}
          <SyncButton />
        </div>
      </nav>
      <main className="main">
        <Outlet />
      </main>
      <CommandPalette
        data={data}
        update={update}
        open={paletteOpen}
        onOpenChange={setPaletteOpen}
      />
    </div>
  );
}

