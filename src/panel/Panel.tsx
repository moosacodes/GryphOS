import { useEffect, useMemo, useState } from "react";
import type { AppData } from "@/domain/types";
import { emptyAppData } from "@/storage/schema";
import { loadAppData, subscribe } from "@/storage/repository";
import { buildMyDay, type MyDayItem } from "@/engines/myday";
import { effectiveStatus } from "@/storage/chromeStore";
import { useTheme } from "@/ui/hooks/useTheme";
import { openApp, openCourseLink, requestSync } from "@/shared/actions";

function syncCopy(data: AppData) {
  const status = effectiveStatus(data.sync);
  if (status === "syncing") return { label: "Syncing CourseLink...", tone: "warn" as const };
  if (status === "signed_out")
    return { label: "Signed out — sign in on CourseLink", tone: "danger" as const };
  if (status === "error") return { label: data.sync.message ?? "Sync error", tone: "danger" as const };
  if (!data.sync.lastSyncedAt) return { label: "Not synced yet", tone: "muted" as const };
  const mins = Math.round((Date.now() - data.sync.lastSyncedAt) / 60000);
  const when = mins < 1 ? "just now" : mins < 60 ? `${mins}m ago` : `${Math.round(mins / 60)}h ago`;
  return { label: `Synced ${when}`, tone: "ok" as const };
}

function MiniRow({ item }: { item: MyDayItem }) {
  return (
    <div className={`deadline-card ${item.actionable ? "sev-soon" : ""}`}>
      <span className="dot" style={{ background: item.courseColor ?? "#888" }} />
      <div className="deadline-body">
        <div className="deadline-title-row">
          <span className="deadline-title">{item.title}</span>
          <span className="badge">{item.statusLabel}</span>
        </div>
        <div className="small muted">
          {item.courseCode}
          {item.subtitle ? ` · ${item.subtitle}` : ""}
        </div>
      </div>
    </div>
  );
}

export function Panel() {
  const [data, setData] = useState<AppData>(emptyAppData());
  const [ready, setReady] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncErr, setSyncErr] = useState<string | null>(null);
  useTheme(data.preferences.theme);

  useEffect(() => {
    void loadAppData().then((d) => {
      setData(d);
      setReady(true);
    });
    return subscribe(setData);
  }, []);

  const status = effectiveStatus(data.sync);
  const sync = syncCopy(data);
  const model = useMemo(() => buildMyDay(data), [data]);
  const selected = useMemo(
    () => data.courses.filter((c) => (data.preferences.selectedCourseIds ?? []).includes(c.id)),
    [data.courses, data.preferences.selectedCourseIds],
  );

  const spotlight = useMemo(() => {
    const order = ["right_now", "needs_answer", "next", "tonight", "coming_up", "since_last_checked"] as const;
    const items: MyDayItem[] = [];
    for (const id of order) {
      const sec = model.sections.find((s) => s.id === id);
      if (sec) items.push(...sec.items);
    }
    return items.slice(0, 12);
  }, [model]);

  const onSync = () => {
    setSyncing(true);
    setSyncErr(null);
    void requestSync()
      .then((r) => {
        if (r && !r.ok) setSyncErr(r.error ?? "Sync failed");
      })
      .catch((e: unknown) => setSyncErr(String((e as Error).message ?? e)))
      .finally(() => setTimeout(() => setSyncing(false), 600));
  };

  if (!ready) {
    return (
      <div className="panel-shell">
        <div className="state-block">
          <div className="skeleton-line w60" />
          <div className="skeleton-line w40" />
          <div className="skeleton-card" />
          <p className="muted small">Loading gryphOS...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="panel-shell">
      <header className="panel-top">
        <div>
          <div className="panel-brand">
            gryph<span>OS</span>
          </div>
          <div className={`sync-pill sync-${sync.tone}`}>
            {syncing || status === "syncing" ? "Syncing..." : sync.label}
          </div>
        </div>
        <button
          type="button"
          className="btn btn-primary btn-sm"
          disabled={syncing || status === "syncing"}
          onClick={onSync}
        >
          {syncing || status === "syncing" ? "..." : "Sync"}
        </button>
      </header>

      {status === "signed_out" && (
        <div className="callout callout-danger" role="alert">
          <strong>Signed out of CourseLink</strong>
          <p className="small">Sign in on this page, then sync. Previously saved data stays local.</p>
          <button type="button" className="btn btn-sm" onClick={() => void openCourseLink(true)}>
            Open CourseLink home
          </button>
        </div>
      )}

      {(status === "error" || syncErr) && (
        <div className="callout callout-warn" role="alert">
          <strong>Sync issue</strong>
          <p className="small">{syncErr ?? data.sync.message ?? "Something failed. Try again."}</p>
        </div>
      )}

      {status === "idle" && data.sync.message && (
        <div className="callout callout-info tight">
          <p className="small">{data.sync.message}</p>
        </div>
      )}

      {!data.sync.lastSyncedAt && status !== "signed_out" && status !== "syncing" && (
        <div className="callout callout-info">
          <strong>Get started</strong>
          <p className="small">
            Sync while signed in to pull courses, class times, deadlines, announcements, and outlines.
          </p>
        </div>
      )}

      {selected.length > 0 && (
        <div className="chip-row" aria-label="Courses">
          {selected.map((c) => (
            <span
              key={c.id}
              className="course-chip"
              style={{ ["--chip" as string]: c.color }}
              title={c.outlineStatusDetail ?? c.outlineStatus}
            >
              <i style={{ background: c.color }} />
              {c.code}
              <em className="chip-outline">
                {c.outlineStatus === "parsed"
                  ? "outline ok"
                  : c.outlineStatus === "found"
                    ? "outline"
                    : c.outlineStatus === "blocked"
                      ? "blocked"
                      : c.outlineStatus === "none_accessible"
                        ? "no outline"
                        : ""}
              </em>
            </span>
          ))}
        </div>
      )}

      <section className="panel-section grow">
        <h2>My Day</h2>
        <div className="panel-list">
          {spotlight.length === 0 ? (
            <div className="empty-mini">
              {selected.length
                ? "Nothing on the timeline yet — Sync again, or check that CourseLink calendar has class events."
                : "Sync to load your semester."}
            </div>
          ) : (
            spotlight.map((item) => <MiniRow key={item.id} item={item} />)
          )}
        </div>
      </section>

      <footer className="panel-foot">
        <button type="button" className="btn btn-sm" style={{ flex: 1 }} onClick={() => void openApp()}>
          Open full app
        </button>
        <span className="small muted">{selected.length} courses</span>
      </footer>
    </div>
  );
}
