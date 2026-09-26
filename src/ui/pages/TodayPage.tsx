import { useEffect } from "react";
import { Link, useNavigate } from "react-router-dom";
import type { AppData } from "@/domain/types";
import { applyMyDayConfirm, buildMyDay, type MyDayCta, type MyDayItem } from "@/engines/myday";
import { EmptyState } from "../components/EmptyState";
import { SyncButton } from "../components/SyncButton";
import { openCourseLink } from "@/shared/actions";

function CtaButtons({
  item,
  onCta,
}: {
  item: MyDayItem;
  onCta: (cta: MyDayCta) => void;
}) {
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

function TimelineRow({
  item,
  onCta,
}: {
  item: MyDayItem;
  onCta: (cta: MyDayCta) => void;
}) {
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
          {item.href?.startsWith("/") ? (
            <Link to={item.href}>{item.title}</Link>
          ) : (
            item.title
          )}
        </div>
        <div className="myday-sub">{item.subtitle}</div>
        <CtaButtons item={item} onCta={onCta} />
        <div className="myday-links">
          {item.ctas
            .filter((c) => c.kind === "open_url" || c.kind === "open_assessment" || c.kind === "open_course")
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
                  <Link key={i} to={`/assessment/${encodeURIComponent(c.assessmentId)}`} className="small">
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
  const model = buildMyDay(data);
  const name = data.user?.name?.split(" ")[0] ?? "there";
  const selected = (data.preferences.selectedCourseIds ?? []).length;

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
    // intentionally once on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!data.sync.lastSyncedAt && selected === 0) {
    return (
      <div>
        <div className="page-header">
          <div>
            <h1>My Day</h1>
            <p>Your university OS — local, private, CourseLink-backed.</p>
          </div>
        </div>
        <EmptyState
          title="Build your semester"
          body="Sign in to CourseLink in this browser, sync once, pick your courses. GryphOS keeps everything local."
          action={
            <div style={{ display: "flex", gap: "0.5rem", justifyContent: "center", marginTop: "0.75rem" }}>
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
    <div className="myday">
      <div className="page-header">
        <div>
          <h1>My Day</h1>
          <p>
            Hi {name}. After days away, this is the 30-second picture — classes, deadlines, changes,
            confirmations.
          </p>
        </div>
        <SyncButton />
      </div>

      {model.standingLines.length > 0 && (
        <div className="myday-standing card card-tight">
          <h2>Standing snapshot</h2>
          <ul className="myday-standing-list">
            {model.standingLines.map((l) => (
              <li key={l}>{l}</li>
            ))}
          </ul>
          <Link to="/grades" className="small">
            Grades & what-if →
          </Link>
        </div>
      )}

      {model.sections.map((sec) => (
        <section key={sec.id} className={`myday-section sec-${sec.id}`}>
          <h2>{sec.label}</h2>
          {sec.items.length === 0 ? (
            <p className="muted small">Nothing here right now.</p>
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
  );
}
