import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  addWeeks,
  eachDayOfInterval,
  endOfWeek,
  format,
  isSameDay,
  startOfWeek,
} from "date-fns";
import type { AppData, Assessment } from "@/domain/types";
import { torontoDayKey } from "@/domain/dates";
import { buildIcs } from "@/engines/ics";

const WEEK = { weekStartsOn: 1 as const };

type CalItem = {
  id: string;
  title: string;
  courseCode: string;
  color: string;
  kind: string;
  href: string;
  weight: number | null;
  hard: boolean;
};

export function CalendarPage({ data }: { data: AppData }) {
  const [anchor, setAnchor] = useState(() => startOfWeek(new Date(), WEEK));
  const [filter, setFilter] = useState("all");
  const [view, setView] = useState<"week" | "semester">("week");

  const courses = data.courses.filter((c) =>
    (data.preferences.selectedCourseIds ?? []).includes(c.id),
  );
  const weekDays = eachDayOfInterval({
    start: anchor,
    end: endOfWeek(anchor, WEEK),
  });

  const itemsByDay = useMemo(() => {
    const courseMap = new Map(data.courses.map((c) => [c.id, c]));
    const courseIds = new Set(courses.map((c) => c.id));
    const map = new Map<string, CalItem[]>();
    const push = (key: string, item: CalItem) => {
      map.set(key, [...(map.get(key) ?? []), item]);
    };

    for (const a of data.assessments) {
      if (!courseIds.has(a.courseId)) continue;
      if (filter !== "all" && a.courseId !== filter) continue;
      if (!a.due.iso) continue;
      const c = courseMap.get(a.courseId);
      push(torontoDayKey(a.due.iso), {
        id: a.id,
        title: a.title,
        courseCode: c?.code ?? "?",
        color: c?.color ?? "#666",
        kind: a.type,
        href: `/assessment/${encodeURIComponent(a.id)}`,
        weight: a.weightPercent,
        hard: (a.weightPercent ?? 0) >= 10 || a.type === "midterm" || a.type === "final" || a.type === "quiz",
      });
    }

    for (const o of data.meetingOccurrences ?? []) {
      if (!courseIds.has(o.courseId) || o.cancelled) continue;
      if (filter !== "all" && o.courseId !== filter) continue;
      const c = courseMap.get(o.courseId);
      push(o.date, {
        id: o.id,
        title: o.kind,
        courseCode: c?.code ?? "?",
        color: c?.color ?? "#666",
        kind: o.kind,
        href: `/courses/${encodeURIComponent(o.courseId)}`,
        weight: null,
        hard: o.kind === "lab",
      });
    }

    for (const t of data.userTasks ?? []) {
      if (t.done || !t.dueIso) continue;
      if (t.courseId && !courseIds.has(t.courseId)) continue;
      const c = t.courseId ? courseMap.get(t.courseId) : undefined;
      push(torontoDayKey(t.dueIso), {
        id: t.id,
        title: t.title,
        courseCode: c?.code ?? "Task",
        color: c?.color ?? "#888",
        kind: "task",
        href: "/tasks",
        weight: null,
        hard: false,
      });
    }

    return map;
  }, [data, courses, filter]);

  const density = (key: string) => {
    const items = itemsByDay.get(key) ?? [];
    const score = items.reduce((s, i) => s + (i.hard ? 2 : 1) + (i.weight ?? 0) / 20, 0);
    return score;
  };

  const semesterDays = useMemo(() => {
    // Term window from academic dates or 16 weeks from now-ish
    const sem = data.academicDates.find((d) => d.kind === "semester");
    const start = sem?.start.iso ? new Date(sem.start.iso) : addWeeks(new Date(), -2);
    const end = sem?.end.iso ? new Date(sem.end.iso) : addWeeks(new Date(), 14);
    return eachDayOfInterval({ start, end });
  }, [data.academicDates]);

  const exportIcs = () => {
    const courseIds = new Set(courses.map((c) => c.id));
    const assessments = data.assessments.filter((a) => courseIds.has(a.courseId) && a.due.iso) as Assessment[];
    const ics = buildIcs(assessments, courses, data.academicDates);
    const blob = new Blob([ics], { type: "text/calendar;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "gryphos.ics";
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Calendar</h1>
          <p>
            {view === "week"
              ? `Week of ${format(anchor, "MMM d")}`
              : "Semester map — dense weeks from real scheduled work"}
          </p>
        </div>
        <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
          <button type="button" className={`btn${view === "week" ? " btn-primary" : ""}`} onClick={() => setView("week")}>
            Week
          </button>
          <button
            type="button"
            className={`btn${view === "semester" ? " btn-primary" : ""}`}
            onClick={() => setView("semester")}
          >
            Semester
          </button>
          {view === "week" && (
            <>
              <button type="button" className="btn" onClick={() => setAnchor(addWeeks(anchor, -1))}>
                Prev
              </button>
              <button type="button" className="btn" onClick={() => setAnchor(startOfWeek(new Date(), WEEK))}>
                This week
              </button>
              <button type="button" className="btn" onClick={() => setAnchor(addWeeks(anchor, 1))}>
                Next
              </button>
            </>
          )}
          <button type="button" className="btn" onClick={exportIcs}>
            Export .ics
          </button>
        </div>
      </div>

      <div className="filters">
        <select value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="Filter by course">
          <option value="all">All courses</option>
          {courses.map((c) => (
            <option key={c.id} value={c.id}>
              {c.code}
            </option>
          ))}
        </select>
      </div>

      {view === "week" ? (
        <div className="week-grid">
          {weekDays.map((day) => {
            const key = format(day, "yyyy-MM-dd");
            const items = itemsByDay.get(key) ?? [];
            const dens = density(key);
            return (
              <div
                key={key}
                className={`week-col${isSameDay(day, new Date()) ? " today" : ""}${dens >= 5 ? " dense" : dens >= 3 ? " busy" : ""}`}
              >
                <div className="week-col-head">
                  <strong>{format(day, "EEE")}</strong>
                  <span>{format(day, "MMM d")}</span>
                  {dens >= 3 && <span className="badge badge-warn">Heavy</span>}
                </div>
                <ul className="week-items">
                  {items.map((it) => (
                    <li key={it.id}>
                      <Link to={it.href} className="week-pill" style={{ borderLeftColor: it.color }}>
                        <span className="small muted">{it.courseCode}</span>
                        <strong>{it.title}</strong>
                        <span className="badge">{it.kind}</span>
                      </Link>
                    </li>
                  ))}
                  {items.length === 0 && <li className="muted small">—</li>}
                </ul>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="semester-map">
          {chunkWeeks(semesterDays).map((week, i) => {
            const score = week.reduce((s, d) => s + density(format(d, "yyyy-MM-dd")), 0);
            const label = `${format(week[0], "MMM d")}–${format(week[week.length - 1], "MMM d")}`;
            return (
              <button
                key={i}
                type="button"
                className={`sem-week dens-${Math.min(5, Math.floor(score / 2))}`}
                onClick={() => {
                  setAnchor(startOfWeek(week[0], WEEK));
                  setView("week");
                }}
                title={`${label}: workload score ${score.toFixed(0)}`}
              >
                <span>{label}</span>
                <strong>{score.toFixed(0)}</strong>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function chunkWeeks(days: Date[]): Date[][] {
  const out: Date[][] = [];
  for (let i = 0; i < days.length; i += 7) out.push(days.slice(i, i + 7));
  return out;
}

