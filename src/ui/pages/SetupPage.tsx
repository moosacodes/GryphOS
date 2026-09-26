import { useState } from "react";
import { useNavigate } from "react-router-dom";
import type { AppData } from "@/domain/types";
import { SyncButton } from "../components/SyncButton";
import { openCourseLink } from "@/shared/actions";
import { mergeCalendarByUid, parseIcs } from "@/engines/icsImport";

export function SetupPage({
  data,
  update,
}: {
  data: AppData;
  update: (patch: Partial<AppData> | ((prev: AppData) => AppData)) => Promise<AppData>;
}) {
  const nav = useNavigate();
  const [step, setStep] = useState<"sync" | "courses" | "sections" | "ics">(
    data.courses.length ? "courses" : "sync",
  );
  const selected = new Set(data.preferences.selectedCourseIds ?? []);

  const toggle = (id: string) => {
    void update((prev) => {
      const set = new Set(prev.preferences.selectedCourseIds ?? []);
      if (set.has(id)) set.delete(id);
      else set.add(id);
      return {
        ...prev,
        preferences: { ...prev.preferences, selectedCourseIds: [...set] },
        courses: prev.courses.map((c) => ({ ...c, selected: set.has(c.id) })),
      };
    });
  };

  const setSection = (courseId: string, field: "lectureSection" | "labSection", value: string) => {
    void update((prev) => {
      const configs = [...(prev.preferences.sectionConfigs ?? [])];
      const idx = configs.findIndex((c) => c.courseId === courseId);
      const next = { courseId, ...(idx >= 0 ? configs[idx] : {}), [field]: value || null };
      if (idx >= 0) configs[idx] = next;
      else configs.push(next);
      return {
        ...prev,
        preferences: { ...prev.preferences, sectionConfigs: configs },
        courses: prev.courses.map((c) =>
          c.id === courseId ? { ...c, [field]: value || null } : c,
        ),
      };
    });
  };

  return (
    <div className="setup">
      <div className="page-header">
        <div>
          <h1>Set up your semester</h1>
          <p>Three short steps. Everything stays on this device.</p>
        </div>
      </div>

      <ol className="setup-steps">
        <li className={step === "sync" ? "active" : ""}>
          <button type="button" className="btn btn-ghost" onClick={() => setStep("sync")}>
            1. Sync CourseLink
          </button>
        </li>
        <li className={step === "courses" ? "active" : ""}>
          <button type="button" className="btn btn-ghost" onClick={() => setStep("courses")}>
            2. Pick courses
          </button>
        </li>
        <li className={step === "sections" ? "active" : ""}>
          <button type="button" className="btn btn-ghost" onClick={() => setStep("sections")}>
            3. Sections (if needed)
          </button>
        </li>
        <li className={step === "ics" ? "active" : ""}>
          <button type="button" className="btn btn-ghost" onClick={() => setStep("ics")}>
            4. Optional calendar
          </button>
        </li>
      </ol>

      {step === "sync" && (
        <div className="card">
          <h2>Connect CourseLink</h2>
          <p className="small">
            Open CourseLink signed in (same browser). GryphOS uses your existing session — no passwords.
          </p>
          <div className="filters">
            <button type="button" className="btn btn-primary" onClick={() => void openCourseLink(true)}>
              Open CourseLink
            </button>
            <SyncButton />
          </div>
          {data.courses.length > 0 && (
            <p className="small" style={{ marginTop: "0.75rem" }}>
              Found {data.courses.length} courses.{" "}
              <button type="button" className="btn btn-sm" onClick={() => setStep("courses")}>
                Continue
              </button>
            </p>
          )}
        </div>
      )}

      {step === "courses" && (
        <div className="card">
          <h2>This semester</h2>
          <div className="setup-course-list">
            {data.courses.map((c) => (
              <label key={c.id} className="setup-course">
                <input type="checkbox" checked={selected.has(c.id)} onChange={() => toggle(c.id)} />
                <span className="nav-swatch" style={{ background: c.color }} />
                <span>
                  <strong>{c.code}</strong>
                  <div className="small muted">{c.title}</div>
                </span>
              </label>
            ))}
          </div>
          <button
            type="button"
            className="btn btn-primary"
            disabled={selected.size === 0}
            onClick={() => setStep("sections")}
          >
            Build semester ({selected.size})
          </button>
        </div>
      )}

      {step === "sections" && (
        <div className="card">
          <h2>Lab / lecture section</h2>
          <p className="small muted">Only ask when GryphOS needs it for deadlines or occurrences.</p>
          {data.courses
            .filter((c) => selected.has(c.id))
            .map((c) => (
              <div key={c.id} className="field">
                <label>
                  {c.code} lecture section
                  <input
                    defaultValue={c.lectureSection ?? ""}
                    placeholder="e.g. 0101"
                    onBlur={(e) => setSection(c.id, "lectureSection", e.target.value.trim())}
                  />
                </label>
                <label>
                  {c.code} lab section
                  <input
                    defaultValue={c.labSection ?? ""}
                    placeholder="e.g. 0102"
                    onBlur={(e) => setSection(c.id, "labSection", e.target.value.trim())}
                  />
                </label>
              </div>
            ))}
          <button type="button" className="btn btn-primary" onClick={() => setStep("ics")}>
            Continue
          </button>
        </div>
      )}

      {step === "ics" && (
        <div className="card">
          <h2>Optional personal calendar</h2>
          <p className="small">Import an .ics for commute/study blocks. Skip if you only want CourseLink.</p>
          <input
            type="file"
            accept=".ics,text/calendar"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (!f) return;
              void f.text().then((text) => {
                const incoming = parseIcs(text);
                void update((prev) => ({
                  ...prev,
                  calendarEvents: mergeCalendarByUid(prev.calendarEvents ?? [], incoming),
                }));
              });
            }}
          />
          <div className="filters" style={{ marginTop: "1rem" }}>
            <button type="button" className="btn btn-primary" onClick={() => nav("/")}>
              Open My Day
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
