import { useEffect, useMemo } from "react";
import { Link, useNavigate } from "react-router-dom";
import type { AppData } from "@/domain/types";
import { formatInTimeZone } from "date-fns-tz";
import { UOFG_TIMEZONE } from "@/domain/constants";
import { buildCinematicBrief } from "@/engines/brief";
import { applyMyDayConfirm, type MyDayCta, type MyDayItem } from "@/engines/myday";
import { EmptyState } from "../components/EmptyState";
import { SyncButton } from "../components/SyncButton";
import { openCourseLink } from "@/shared/actions";
import { effectiveStatus } from "@/storage/chromeStore";

function CtaButtons({ item, onCta }: { item: MyDayItem; onCta: (cta: MyDayCta) => void }) {
  const primary = item.ctas.filter(
    (c) =>
      c.kind === "confirm_complete" ||
      c.kind === "confirm_missed" ||
      c.kind === "confirm_excused" ||
      c.kind === "mark_task_done",
  );
  if (!primary.length) return null;
  return (
    <div className="myday-ctas">
      {primary.map((c) => {
        const label =
          c.kind === "confirm_complete"
            ? "I completed it"
            : c.kind === "confirm_missed"
              ? "I missed it"
              : c.kind === "confirm_excused"
                ? "Excused"
                : "Done";
        const cls =
          c.kind === "confirm_missed" ? "btn btn-sm btn-danger-outline" : "btn btn-sm btn-primary";
        return (
          <button key={c.kind + label} type="button" className={cls} onClick={() => onCta(c)}>
            {label}
          </button>
        );
      })}
    </div>
  );
}

function TimelineRow({ item, onCta }: { item: MyDayItem; onCta: (cta: MyDayCta) => void }) {
  return (
    <li className={`myday-row kind-${item.kind}${item.actionable ? " actionable" : ""}`}>
      <div className="myday-rail" style={{ background: item.courseColor ?? "var(--border)" }} />
      <div className="myday-body">
        <div className="myday-top">
          <span className="myday-code">{item.courseCode}</span>
          <span className="badge">{item.statusLabel}</span>
          {item.weightPercent != null ? <span className="badge">{item.weightPercent}%</span> : null}
        </div>
        <div className="myday-title">
          {item.href?.startsWith("/") ? <Link to={item.href}>{item.title}</Link> : item.title}
        </div>
        <div className="myday-sub">{item.subtitle}</div>
        <CtaButtons item={item} onCta={onCta} />
        <div className="myday-links">
          {item.ctas
            .filter(
              (c) => c.kind === "open_url" || c.kind === "open_assessment" || c.kind === "open_course",
            )
            .slice(0, 2)
            .map((c, i) => {
              if (c.kind === "open_url") {
                return (
                  <a key={i} href={c.url} target="_blank" rel="noreferrer" className="small">
                    {c.label}
                  </a>
                );
              }
              if (c.kind === "open_assessment") {
                return (
                  <Link
                    key={i}
                    to={`/assessment/${encodeURIComponent(c.assessmentId)}`}
                    className="small"
                  >
                    Open workspace
                  </Link>
                );
              }
              return (
                <Link key={i} to={`/courses/${encodeURIComponent(c.courseId)}`} className="small">
                  Course
                </Link>
              );
            })}
        </div>
      </div>
    </li>
  );
}

export function TodayPage({
  data,
  update,
}: {
  data: AppData;
  update: (patch: Partial<AppData> | ((prev: AppData) => AppData)) => Promise<AppData>;
}) {
  const nav = useNavigate();
  const brief = useMemo(() => buildCinematicBrief(data), [data]);
  const status = effectiveStatus(data.sync);
  const selected = (data.preferences.selectedCourseIds ?? []).length;
  const clock = formatInTimeZone(new Date(), UOFG_TIMEZONE, "EEE · MMM d · h:mm a");

  const onCta = async (cta: MyDayCta) => {
    if (cta.kind === "confirm_complete") {
      await update((prev) => applyMyDayConfirm(prev, cta.assessmentId, "complete"));
      return;
    }
    if (cta.kind === "confirm_missed") {
      await update((prev) => applyMyDayConfirm(prev, cta.assessmentId, "missed"));
      return;
    }
    if (cta.kind === "confirm_excused") {
      await update((prev) => applyMyDayConfirm(prev, cta.assessmentId, "excused"));
      return;
    }
    if (cta.kind === "mark_task_done") {
      await update((prev) => ({
        ...prev,
        userTasks: (prev.userTasks ?? []).map((t) =>
          t.id === cta.taskId ? { ...t, done: true, updatedAt: new Date().toISOString() } : t,
        ),
      }));
      return;
    }
    if (cta.kind === "mark_change_read") {
      await update((prev) => ({
        ...prev,
        changes: (prev.changes ?? []).map((c) => (c.id === cta.changeId ? { ...c, read: true } : c)),
      }));
      return;
    }
    if (cta.kind === "open_assessment") {
      nav(`/assessment/${encodeURIComponent(cta.assessmentId)}`);
      return;
    }
    if (cta.kind === "open_course") {
      nav(`/courses/${encodeURIComponent(cta.courseId)}`);
      return;
    }
    if (cta.kind === "open_url") {
      window.open(cta.url, "_blank", "noopener,noreferrer");
    }
  };

  const openBeat = (item?: MyDayItem) => {
    if (!item) return;
    if (item.href?.startsWith("/")) {
      nav(item.href);
      return;
    }
    const open = item.ctas.find(
      (c) => c.kind === "open_assessment" || c.kind === "open_course" || c.kind === "open_url",
    );
    if (open) void onCta(open);
  };

  useEffect(() => {
    void update((prev) => {
      if (prev.preferences.lastCheckedAt && Date.now() - prev.preferences.lastCheckedAt < 60_000) {
        return prev;
      }
      return {
        ...prev,
        preferences: { ...prev.preferences, lastCheckedAt: Date.now() },
      };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!data.sync.lastSyncedAt && selected === 0) {
    return (
      <div className="brief">
        <div className={`brief-hero brief-tone-idle`}>
          <p className="brief-kicker">SYSTEM BRIEF</p>
          <h1 className="brief-greeting">{brief.greeting}</h1>
          <p className="brief-headline">Standing by.</p>
          <p className="brief-sub">Wake the semester with one sync from your CourseLink session.</p>
        </div>
        <EmptyState
          title="No signal yet"
          body="Sign in to CourseLink in this browser, open any CourseLink page, then Sync. Everything stays on this device — sync and document engines run in the background."
          action={
            <div
              style={{ display: "flex", gap: "0.5rem", justifyContent: "center", marginTop: "0.75rem" }}
            >
              <button type="button" className="btn btn-primary" onClick={() => void openCourseLink(true)}>
                Open CourseLink
              </button>
              <SyncButton />
            </div>
          }
        />
      </div>
    );
  }

  return (
    <div className={`brief brief-tone-${brief.tone}`}>
      <header className="brief-hero">
        <p className="brief-kicker">SYSTEM BRIEF</p>
        <h1 className="brief-greeting">{brief.greeting}</h1>
        <p className="brief-headline">{brief.headline}</p>
        <p className="brief-sub">{brief.subhead}</p>
      </header>

      {brief.systemNote && (
        <div
          className={`brief-system${status === "signed_out" || status === "error" ? " danger" : ""}`}
          role="status"
        >
          <strong>{brief.systemNote}</strong>
          <div style={{ display: "flex", gap: "0.4rem", marginTop: "0.55rem", flexWrap: "wrap" }}>
            {status === "signed_out" && (
              <button type="button" className="btn btn-sm" onClick={() => void openCourseLink(true)}>
                Sign in on CourseLink
              </button>
            )}
            <Link className="btn btn-sm" to="/setup">
              Setup
            </Link>
            <SyncButton />
          </div>
        </div>
      )}

      {brief.beats.length > 0 && (
        <section aria-label="Priority beats">
          <div className="brief-beats">
            {brief.beats.map((b) => (
              <button
                key={b.id}
                type="button"
                className={`beat-card sec-${b.section}`}
                onClick={() => openBeat(b.item)}
              >
                <div className="beat-kicker">{b.kicker}</div>
                <div className="beat-line">{b.line}</div>
                {b.detail ? <div className="beat-detail">{b.detail}</div> : null}
              </button>
            ))}
          </div>
        </section>
      )}

      {brief.model.standingLines.length > 0 && (
        <div className="standing-strip" aria-label="Standing snapshot">
          {brief.model.standingLines.map((l) => (
            <span key={l} className="standing-chip">
              {l}
            </span>
          ))}
          <Link to="/grades" className="standing-chip" style={{ color: "var(--hud)" }}>
            Grades →
          </Link>
        </div>
      )}

      <div className="living-day">
        <div className="living-day-head">
          <h2>Living My Day</h2>
          <div className="living-clock">{clock} · America/Toronto</div>
        </div>

        {brief.model.sections.map((sec) => (
          <section key={sec.id} className={`myday-section sec-${sec.id}`}>
            <h2>{sec.label}</h2>
            {sec.items.length === 0 ? (
              <p className="muted small">
                {sec.id === "right_now"
                  ? "Nothing in progress right now."
                  : sec.id === "needs_answer"
                    ? "Nothing waiting on your confirmation."
                    : "Nothing here right now."}
              </p>
            ) : (
              <ul className="myday-list">
                {sec.items.map((item) => (
                  <TimelineRow key={item.id} item={item} onCta={(c) => void onCta(c)} />
                ))}
              </ul>
            )}
          </section>
        ))}
      </div>
    </div>
  );
}
