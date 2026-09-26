import { NavLink, Outlet } from "react-router-dom";
import type { AppData } from "@/domain/types";
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
            Sync:{" "}
            <strong>
              {status === "syncing"
                ? "Syncing…"
                : status === "signed_out"
                  ? "Signed out"
                  : status === "error"
                    ? "Error"
                    : data.sync.lastSyncedAt
                      ? "OK"
                      : "Never"}
            </strong>
          </div>
          <SyncButton />
        </div>
      </nav>
      <main className="main">
        <Outlet />
      </main>
    </div>
  );
}
