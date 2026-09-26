import { NavLink, Outlet } from "react-router-dom";
import type { AppData } from "@/domain/types";
import { openCourseLink } from "@/shared/actions";
import { effectiveStatus } from "@/storage/chromeStore";
import { SyncButton } from "./SyncButton";

const LINKS = [
  { to: "/", label: "Dashboard", end: true },
  { to: "/calendar", label: "Calendar" },
  { to: "/courses", label: "Courses" },
  { to: "/grades", label: "Grades" },
  { to: "/tasks", label: "Tasks" },
  { to: "/documents", label: "Documents" },
  { to: "/settings", label: "Settings" },
];

function syncLabel(status: ReturnType<typeof effectiveStatus>, lastSyncedAt: number | null): string {
  switch (status) {
    case "syncing":
      return "Syncing…";
    case "signed_out":
      return "Signed out";
    case "error":
      return "Error";
    default:
      return lastSyncedAt ? "OK" : "Never";
  }
}

export function Layout({ data }: { data: AppData }) {
  const status = effectiveStatus(data.sync);
  return (
    <div className="app-shell">
      <nav className="nav" aria-label="Primary">
        <div className="nav-brand">
          <strong>gryph<span>OS</span></strong>
        </div>
        {LINKS.map((l) => (
          <NavLink
            key={l.to}
            to={l.to}
            end={l.end}
            className={({ isActive }) => `nav-link${isActive ? " active" : ""}`}
          >
            {l.label}
          </NavLink>
        ))}
        <div style={{ marginTop: "auto", padding: "0.75rem 0.5rem", display: "grid", gap: "0.5rem" }}>
          <div className="small muted">
            Sync: <strong>{syncLabel(status, data.sync.lastSyncedAt)}</strong>
          </div>
          {status === "signed_out" && (
            <div className="conflict-banner" role="alert" style={{ margin: 0, padding: "0.5rem" }}>
              <div className="small" style={{ fontWeight: 600 }}>Signed out of CourseLink</div>
              <button type="button" className="btn" style={{ marginTop: 6, width: "100%" }} onClick={() => void openCourseLink(true)}>
                Sign in
              </button>
            </div>
          )}
          {status === "error" && data.sync.message && (
            <div className="small" style={{ color: "var(--danger)" }}>{data.sync.message}</div>
          )}
          <SyncButton />
          <p className="small muted" style={{ margin: 0 }}>
            Runs in Chrome only — no terminal needed.
          </p>
        </div>
      </nav>
      <main className="main">
        <Outlet />
      </main>
    </div>
  );
}
