import { useMemo, useState } from "react";
import {
  addMonths,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  isSameDay,
  isSameMonth,
  startOfMonth,
  startOfWeek,
} from "date-fns";
import type { AppData, Assessment } from "@/domain/types";
import { torontoDayKey } from "@/domain/dates";
import { buildIcs } from "@/engines/ics";
import { ConflictBanner } from "../components/ConflictBanner";
import { ProvenanceBadge } from "../components/ProvenanceBadge";

const WEEK = { weekStartsOn: 1 as const };

export function CalendarPage({ data }: { data: AppData }) {
  const [month, setMonth] = useState(() => startOfMonth(new Date()));
  const [filter, setFilter] = useState<string>("all");
  const [selected, setSelected] = useState<Assessment | null>(null);

  const courses = data.courses.filter((c) =>
    (data.preferences.selectedCourseIds ?? []).includes(c.id),
  );
  const courseMap = new Map(data.courses.map((c) => [c.id, c]));

  const assessments = data.assessments.filter((a) => {
    if (!courses.some((c) => c.id === a.courseId)) return false;
    if (filter !== "all" && a.courseId !== filter) return false;
    return !!a.due.iso;
  });

  const byDay = useMemo(() => {
    const map = new Map<string, Assessment[]>();
    for (const a of assessments) {
      const key = torontoDayKey(a.due.iso!);
      map.set(key, [...(map.get(key) ?? []), a]);
    }
    return map;
  }, [assessments]);

  const days = eachDayOfInterval({
    start: startOfWeek(startOfMonth(month), WEEK),
    end: endOfWeek(endOfMonth(month), WEEK),
  });

  const exportIcs = () => {
    const ics = buildIcs(assessments, courses, data.academicDates);
    const blob = new Blob([ics], { type: "text/calendar;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "gryphos.ics";
    a.click();
    URL.revokeObjectURL(url);
  };

  const conflicts = selected
    ? data.conflicts.filter((c) => c.entityId === selected.id && c.unresolved)
    : [];

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Calendar</h1>
          <p>{format(month, "MMMM yyyy")}</p>
        </div>
        <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
          <button type="button" className="btn" onClick={() => setMonth(addMonths(month, -1))}>Prev</button>
          <button type="button" className="btn" onClick={() => setMonth(startOfMonth(new Date()))}>Today</button>
          <button type="button" className="btn" onClick={() => setMonth(addMonths(month, 1))}>Next</button>
          <button type="button" className="btn" onClick={exportIcs}>Export .ics</button>
        </div>
      </div>

      <div className="filters">
        <select value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="Filter by course">
          <option value="all">All courses</option>
          {courses.map((c) => (
            <option key={c.id} value={c.id}>{c.code}</option>
          ))}
        </select>
      </div>

      <div className="cal-grid" role="grid" aria-label="Month calendar">
        {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => (
          <div key={d} className="cal-head">{d}</div>
        ))}
        {days.map((day) => {
          const key = format(day, "yyyy-MM-dd");
          const items = byDay.get(key) ?? [];
          return (
            <div
              key={key}
              className={`cal-cell${!isSameMonth(day, month) ? " outside" : ""}${isSameDay(day, new Date()) ? " today" : ""}`}
            >
              <div className="cal-daynum">{format(day, "d")}</div>
              {items.slice(0, 3).map((a) => (
                <button
                  key={a.id}
                  type="button"
                  className="cal-pill"
                  style={{ background: courseMap.get(a.courseId)?.color ?? "#666" }}
                  onClick={() => setSelected(a)}
                >
                  {a.title}
                </button>
              ))}
              {items.length > 3 && <div className="small muted">+{items.length - 3} more</div>}
            </div>
          );
        })}
      </div>

      {selected && (
        <div className="card" style={{ marginTop: "1rem" }} role="dialog" aria-label="Assessment details">
          <div style={{ display: "flex", justifyContent: "space-between", gap: "1rem" }}>
            <div>
              <h2 style={{ marginTop: 0 }}>{selected.title}</h2>
              <p className="muted small">
                {courseMap.get(selected.courseId)?.code} · {selected.type}
                {selected.weightPercent != null ? ` · ${selected.weightPercent}%` : ""}
              </p>
            </div>
            <button type="button" className="btn" onClick={() => setSelected(null)}>Close</button>
          </div>
          <p>
            Due:{" "}
            {selected.due.iso
              ? new Date(selected.due.iso).toLocaleString()
              : selected.due.label ?? "Unknown"}{" "}
            <span className="badge">{selected.due.certainty}</span>
          </p>
          <p className="small">
            Submission: {selected.submissionState}
            {selected.gradeDisplay ? ` · Grade: ${selected.gradeDisplay}` : ""}
          </p>
          {selected.fieldProvenance.due && (
            <p className="small">
              Provenance: <ProvenanceBadge source={selected.fieldProvenance.due.sourceType} />
            </p>
          )}
          {conflicts.map((c) => (
            <ConflictBanner key={c.id} conflict={c} />
          ))}
          {selected.url && (
            <p>
              <a href={selected.url} target="_blank" rel="noreferrer">
                Open in CourseLink
              </a>
            </p>
          )}
        </div>
      )}
    </div>
  );
}
