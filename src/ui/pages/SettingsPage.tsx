import type { AppData, ThemePreference } from "@/domain/types";
import { COURSE_COLORS } from "@/domain/constants";
import { buildIcs } from "@/engines/ics";
import { mergeCalendarByUid, parseIcs } from "@/engines/icsImport";
import { applyPersonalization } from "@/adapters/uofg/personalization";
import { resetAllData } from "@/storage/repository";
import { SyncButton } from "../components/SyncButton";
import { openCourseLink } from "@/shared/actions";

export function SettingsPage({
  data,
  update,
}: {
  data: AppData;
  update: (patch: Partial<AppData> | ((prev: AppData) => AppData)) => Promise<AppData>;
}) {
  const selected = new Set(data.preferences.selectedCourseIds ?? []);

  const toggleCourse = (id: string) => {
    void update((prev) => {
      const set = new Set(prev.preferences.selectedCourseIds ?? []);
      if (set.has(id)) set.delete(id);
      else set.add(id);
      const ids = [...set];
      return {
        ...prev,
        preferences: { ...prev.preferences, selectedCourseIds: ids },
        courses: prev.courses.map((c) => ({ ...c, selected: set.has(c.id) })),
      };
    });
  };

  const setTheme = (theme: ThemePreference) => {
    void update((prev) => ({
      ...prev,
      preferences: { ...prev.preferences, theme },
    }));
  };

  const setColor = (courseId: string, color: string) => {
    void update((prev) => ({
      ...prev,
      preferences: {
        ...prev.preferences,
        courseColors: { ...prev.preferences.courseColors, [courseId]: color },
      },
      courses: prev.courses.map((c) => (c.id === courseId ? { ...c, color } : c)),
    }));
  };

  const exportData = () => {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "gryphos-export.json";
    a.click();
    URL.revokeObjectURL(url);
  };

  const importIcs = async (file: File) => {
    const text = await file.text();
    const incoming = parseIcs(text);
    await update((prev) => ({
      ...prev,
      calendarEvents: mergeCalendarByUid(prev.calendarEvents ?? [], incoming),
      actionLog: [
        {
          id: `act:ics:${Date.now()}`,
          at: new Date().toISOString(),
          action: "ics_import",
          entityId: null,
          before: (prev.calendarEvents ?? []).length,
          after: incoming.length,
          undone: false,
        },
        ...(prev.actionLog ?? []),
      ].slice(0, 100),
    }));
  };

  const importBackup = async (file: File) => {
    const text = await file.text();
    const parsed = JSON.parse(text) as AppData;
    await update(() => parsed);
  };

  const applyScheduleFixtures = async () => {
    await update((prev) => {
      const p = applyPersonalization(prev.courses, prev.meetings, prev.people, prev.academicRules);
      return { ...prev, ...p };
    });
  };

  const exportIcs = () => {
    const selectedCourses = data.courses.filter((c) => selected.has(c.id));
    const assessments = data.assessments.filter((a) => selected.has(a.courseId));
    const ics = buildIcs(assessments, selectedCourses, data.academicDates);
    const blob = new Blob([ics], { type: "text/calendar" });
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
          <h1>Settings</h1>
          <p>Local preferences — nothing leaves your browser.</p>
        </div>
      </div>

      <div className="grid grid-2">
        <div className="card">
          <h2>Product</h2>
          <label className="small" style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <input
              type="checkbox"
              checked={!!data.preferences.developerMode}
              onChange={(e) =>
                void update((prev) => ({
                  ...prev,
                  preferences: { ...prev.preferences, developerMode: e.target.checked },
                }))
              }
            />
            Developer Mode (show deep diagnostics)
          </label>
          <label className="small" style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 8 }}>
            <input
              type="checkbox"
              checked={data.preferences.notifications?.enabled !== false}
              onChange={(e) =>
                void update((prev) => ({
                  ...prev,
                  preferences: {
                    ...prev.preferences,
                    notifications: {
                      dueTomorrow: true,
                      quizClosing: true,
                      midtermRoom: true,
                      deadlineChange: true,
                      gradePosted: true,
                      ...prev.preferences.notifications,
                      enabled: e.target.checked,
                    },
                  },
                }))
              }
            />
            Useful local notifications (due tomorrow, quiz closing, grades, deadline changes)
          </label>
          <p className="small muted" style={{ marginTop: 8 }}>
            <a href="#/setup">Re-run semester setup</a>
          </p>
        </div>

      <div className="card">
          <h2>Theme</h2>
          <div className="filters">
            {(["system", "light", "dark"] as ThemePreference[]).map((t) => (
              <button
                key={t}
                type="button"
                className={`btn${data.preferences.theme === t ? " btn-primary" : ""}`}
                onClick={() => setTheme(t)}
              >
                {t}
              </button>
            ))}
          </div>
        </div>

        <div className="card">
          <h2>Synchronization</h2>
          <p className="small muted">
            Status: {data.sync.status}
            {data.sync.message ? ` — ${data.sync.message}` : ""}
          </p>
          <p className="small muted">
            Last synced:{" "}
            {data.sync.lastSyncedAt ? new Date(data.sync.lastSyncedAt).toLocaleString() : "Never"}
          </p>
          <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
            <SyncButton />
            <button type="button" className="btn" onClick={() => void openCourseLink(true)}>
              Open CourseLink
            </button>
          </div>
          <div className="field" style={{ marginTop: "0.75rem" }}>
            <label htmlFor="warn">Deadline warning (hours)</label>
            <input
              id="warn"
              type="number"
              min={1}
              max={168}
              value={data.preferences.deadlineWarnHours}
              onChange={(e) =>
                void update((prev) => ({
                  ...prev,
                  preferences: { ...prev.preferences, deadlineWarnHours: Number(e.target.value) || 48 },
                }))
              }
            />
          </div>
        </div>

        <div className="card" style={{ gridColumn: "1 / -1" }}>
          <h2>Courses</h2>
          {data.courses.length === 0 ? (
            <p className="muted small">Sync to load courses.</p>
          ) : (
            <table className="table">
              <thead>
                <tr><th>Show</th><th>Code</th><th>Name</th><th>Colour</th></tr>
              </thead>
              <tbody>
                {data.courses.map((c) => (
                  <tr key={c.id}>
                    <td>
                      <input
                        type="checkbox"
                        checked={selected.has(c.id)}
                        onChange={() => toggleCourse(c.id)}
                        aria-label={`Select ${c.code}`}
                      />
                    </td>
                    <td>{c.code}</td>
                    <td>{c.title}</td>
                    <td>
                      <select
                        value={c.color}
                        onChange={(e) => setColor(c.id, e.target.value)}
                        aria-label={`Colour for ${c.code}`}
                      >
                        {COURSE_COLORS.map((col) => (
                          <option key={col} value={col}>{col}</option>
                        ))}
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="card">
          <h2>Export</h2>
          <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
            <button type="button" className="btn" onClick={exportIcs}>Export calendar (.ics)</button>
            <div className="field">
          <label>Import ICS (UNI/STUDY/BUS, America/Toronto, UID dedupe)</label>
          <input type="file" accept=".ics,text/calendar" onChange={(e) => { const f = e.target.files?.[0]; if (f) void importIcs(f); e.target.value = ""; }} />
        </div>
        <div className="field">
          <label>Import backup JSON</label>
          <input type="file" accept="application/json,.json" onChange={(e) => { const f = e.target.files?.[0]; if (f) void importBackup(f); e.target.value = ""; }} />
        </div>
        <button type="button" className="btn" onClick={() => void applyScheduleFixtures()}>
          Apply personalization fixtures (2430/2030/2520 sections)
        </button>
        <button type="button" className="btn" onClick={exportData}>Export local JSON</button>
          </div>
        </div>

        <div className="card">
          <h2>Data management</h2>
          <p className="small muted">Reset deletes all local gryphOS data on this device.</p>
          <button
            type="button"
            className="btn"
            onClick={() => {
              if (confirm("Reset all local gryphOS data?")) void resetAllData().then(() => location.reload());
            }}
          >
            Reset local data
          </button>
        </div>
      </div>
    </div>
  );
}
