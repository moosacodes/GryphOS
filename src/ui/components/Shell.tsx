import { useEffect, useMemo, useState } from "react";
import { Link, Outlet, useLocation, useNavigate } from "react-router-dom";
import type { AppData } from "@/domain/types";
import { openCourseLink } from "@/shared/actions";
import { effectiveStatus } from "@/storage/chromeStore";
import { buildCinematicBrief } from "@/engines/brief";
import { SyncButton } from "./SyncButton";
import { CommandPalette } from "./CommandPalette";

const SYSTEMS = [
  { to: "/inbox", label: "Inbox" },
  { to: "/calendar", label: "Calendar" },
  { to: "/grades", label: "Grades" },
  { to: "/courses", label: "Courses" },
  { to: "/tasks", label: "Tasks" },
  { to: "/search", label: "Search" },
  { to: "/documents", label: "Documents" },
  { to: "/coverage", label: "Coverage" },
  { to: "/setup", label: "Setup" },
  { to: "/settings", label: "Settings" },
];

function syncTone(status: ReturnType<typeof effectiveStatus>): string {
  if (status === "syncing") return "warn";
  if (status === "signed_out" || status === "error") return "hot";
  return "live";
}

function syncLabel(status: ReturnType<typeof effectiveStatus>, last: number | null): string {
  if (status === "syncing") return "Syncing";
  if (status === "signed_out") return "Offline";
  if (status === "error") return "Error";
  if (!last) return "Cold";
  const mins = Math.round((Date.now() - last) / 60_000);
  if (mins < 1) return "Live";
  if (mins < 60) return `${mins}m`;
  return `${Math.round(mins / 60)}h`;
}

export function Shell({
  data,
  update,
}: {
  data: AppData;
  update: (patch: Partial<AppData> | ((prev: AppData) => AppData)) => Promise<AppData>;
}) {
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [systemsOpen, setSystemsOpen] = useState(false);
  const status = effectiveStatus(data.sync);
  const brief = useMemo(() => buildCinematicBrief(data), [data]);
  const loc = useLocation();
  const nav = useNavigate();
  const onHome = loc.pathname === "/" || loc.pathname === "";

  useEffect(() => {
    setSystemsOpen(false);
  }, [loc.pathname]);

  useEffect(() => {
    if (!systemsOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setSystemsOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [systemsOpen]);

  return (
    <div className="app-shell">
      <header className="jarvis-top">
        <Link to="/" className="jarvis-brand" aria-label="gryphOS home">
          <span className="jarvis-mark" aria-hidden />
          <strong>
            gryph<span>OS</span>
          </strong>
        </Link>

        <button
          type="button"
          className="jarvis-cmd-trigger"
          onClick={() => setPaletteOpen(true)}
          title="Command surface (Ctrl+K)"
        >
          <span aria-hidden>⌘</span>
          <span>Ask the semester — commands, search, capture…</span>
          <kbd>Ctrl K</kbd>
        </button>

        <div className="jarvis-top-actions">
          <div className="jarvis-pulse-pills" aria-label="Day pulse">
            {brief.pulse.needsAnswer > 0 && (
              <span className="pulse-pill hot">{brief.pulse.needsAnswer} need you</span>
            )}
            {brief.pulse.rightNow > 0 && (
              <span className="pulse-pill live">{brief.pulse.rightNow} live</span>
            )}
            {brief.pulse.tonight > 0 && (
              <span className="pulse-pill warn">{brief.pulse.tonight} tonight</span>
            )}
            {brief.pulse.unread > 0 && (
              <span className="pulse-pill">{brief.pulse.unread} inbox</span>
            )}
            <span className={`pulse-pill ${syncTone(status)}`}>
              {syncLabel(status, data.sync.lastSyncedAt)}
            </span>
          </div>
          <SyncButton />
          <div className="jarvis-systems">
            <button
              type="button"
              className="btn btn-sm"
              aria-expanded={systemsOpen}
              onClick={() => setSystemsOpen((v) => !v)}
            >
              Systems
            </button>
            {systemsOpen && (
              <div className="jarvis-systems-menu" role="menu">
                {SYSTEMS.map((s) => (
                  <Link
                    key={s.to}
                    to={s.to}
                    role="menuitem"
                    onClick={() => setSystemsOpen(false)}
                  >
                    {s.label}
                  </Link>
                ))}
                {status === "signed_out" && (
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setSystemsOpen(false);
                      void openCourseLink(true);
                    }}
                  >
                    Sign in CourseLink
                  </button>
                )}
                {!onHome && (
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setSystemsOpen(false);
                      nav("/");
                    }}
                  >
                    Back to Brief
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      </header>

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

/** @deprecated Use Shell — kept for any stray imports */
export { Shell as Layout };
