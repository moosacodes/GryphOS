import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import type { AppData, WhatIfOverride } from "@/domain/types";
import {
  requiredAverageOnRemaining,
  requiredFinalExamScore,
  summarizeCourseGrades,
  whatIfSummary,
} from "@/engines/grades";
import { EmptyState } from "../components/EmptyState";

export function GradesPage({
  data,
  update,
}: {
  data: AppData;
  update?: (patch: Partial<AppData> | ((prev: AppData) => AppData)) => Promise<AppData>;
}) {
  const courses = data.courses.filter((c) =>
    (data.preferences.selectedCourseIds ?? []).includes(c.id),
  );
  const [courseId, setCourseId] = useState(courses[0]?.id ?? "");
  const [target, setTarget] = useState(80);
  const [localOverrides, setLocalOverrides] = useState<WhatIfOverride[]>(data.whatIfOverrides ?? []);

  const course = courses.find((c) => c.id === courseId) ?? courses[0];
  const real = useMemo(() => {
    if (!course) return null;
    return summarizeCourseGrades(course, data.assessments, data.gradeCategories, data.academicRules, []);
  }, [course, data.assessments, data.gradeCategories, data.academicRules]);

  const whatIf = useMemo(() => {
    if (!course) return null;
    return whatIfSummary(course, data.assessments, data.gradeCategories, data.academicRules, localOverrides);
  }, [course, data.assessments, data.gradeCategories, data.academicRules, localOverrides]);

  if (!course || !real || !whatIf) {
    return (
      <div>
        <div className="page-header">
          <div>
            <h1>Grades</h1>
          </div>
        </div>
        <EmptyState title="No courses" body="Select courses after syncing." />
      </div>
    );
  }

  const required = requiredAverageOnRemaining(whatIf, target);
  const finalItem = whatIf.rows.find((r) => r.assessment.type === "final");
  const finalReq =
    finalItem?.assessment.weightPercent != null
      ? requiredFinalExamScore(whatIf, finalItem.assessment.weightPercent, target)
      : null;

  const setOverride = (assessmentId: string, patch: Partial<WhatIfOverride>) => {
    setLocalOverrides((prev) => {
      const existing = prev.find((o) => o.assessmentId === assessmentId);
      if (!existing) {
        return [...prev, { assessmentId, pointsEarned: null, pointsPossible: null, ...patch }];
      }
      return prev.map((o) => (o.assessmentId === assessmentId ? { ...o, ...patch } : o));
    });
  };

  const persistOverrides = () => {
    if (!update) return;
    void update((prev) => ({ ...prev, whatIfOverrides: localOverrides }));
  };

  const clearOverrides = () => {
    setLocalOverrides([]);
    if (update) void update((prev) => ({ ...prev, whatIfOverrides: [] }));
  };

  const maxPossible = (() => {
    // Assume 100% on all remaining counted weight
    if (real.calculatedPercent == null) return null;
    if (real.remainingWeight <= 0) return real.calculatedPercent;
    const total = real.completedWeight + real.remainingWeight;
    return (real.calculatedPercent * real.completedWeight + 100 * real.remainingWeight) / total;
  })();

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Grades</h1>
          <p>
            Real standing from synced grades. What-if never mutates official scores — overrides are local only.
          </p>
        </div>
        <select value={course.id} onChange={(e) => setCourseId(e.target.value)} aria-label="Course">
          {courses.map((c) => (
            <option key={c.id} value={c.id}>
              {c.code}
            </option>
          ))}
        </select>
      </div>

      <div className="grid grid-4" style={{ marginBottom: "1rem" }}>
        <div className="card card-tight">
          <h3>Current (real)</h3>
          <p className="stat-value">
            {real.calculatedPercent != null ? `${real.calculatedPercent.toFixed(1)}%` : "—"}
          </p>
          <p className="small muted">On graded work only</p>
        </div>
        <div className="card card-tight">
          <h3>% graded</h3>
          <p className="stat-value">{real.completedWeight.toFixed(0)}%</p>
          <p className="small muted">Remaining {real.remainingWeight.toFixed(0)}%</p>
        </div>
        <div className="card card-tight">
          <h3>Max possible</h3>
          <p className="stat-value">{maxPossible != null ? `${maxPossible.toFixed(1)}%` : "—"}</p>
          <p className="small muted">If remaining = 100%</p>
        </div>
        <div className="card card-tight">
          <h3>What-if standing</h3>
          <p className="stat-value">
            {whatIf.calculatedPercent != null ? `${whatIf.calculatedPercent.toFixed(1)}%` : "—"}
          </p>
          <p className="small muted">
            {real.missedCount} missed (not zeroed)
            {real.capReason ? ` · Cap: ${real.capReason}` : ""}
          </p>
        </div>
      </div>

      {real.thresholdDetail && (
        <div className="callout callout-warn" style={{ marginBottom: "1rem" }}>
          {real.thresholdDetail}
        </div>
      )}

      <div className="grid grid-2">
        <div className="card">
          <h2>Breakdown</h2>
          <table className="table">
            <thead>
              <tr>
                <th>Item</th>
                <th>Wt</th>
                <th>Real</th>
                <th>What-if %</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {whatIf.rows.map((r) => {
                const ov = localOverrides.find((o) => o.assessmentId === r.assessment.id);
                const realRow = real.rows.find((x) => x.assessment.id === r.assessment.id);
                return (
                  <tr key={r.assessment.id}>
                    <td>
                      <Link to={`/assessment/${encodeURIComponent(r.assessment.id)}`}>
                        {r.assessment.title}
                      </Link>
                      {r.missed ? " · missed" : ""}
                      {r.dropped ? " · dropped" : ""}
                      {r.provisionalDrop ? " · provisional drop" : ""}
                    </td>
                    <td>{r.assessment.weightPercent != null ? `${r.assessment.weightPercent}%` : "—"}</td>
                    <td>
                      {realRow?.percent != null
                        ? `${realRow.percent.toFixed(1)}%`
                        : r.assessment.gradeDisplay ?? "—"}
                    </td>
                    <td>
                      <input
                        type="number"
                        min={0}
                        max={100}
                        className="input-compact"
                        placeholder={r.percent != null ? r.percent.toFixed(0) : "—"}
                        value={ov?.pointsEarned != null && ov.pointsPossible ? Math.round((ov.pointsEarned / ov.pointsPossible) * 100) : ""}
                        onChange={(e) => {
                          const pct = e.target.value === "" ? null : Number(e.target.value);
                          if (pct == null) {
                            setOverride(r.assessment.id, { pointsEarned: null, pointsPossible: null });
                          } else {
                            setOverride(r.assessment.id, { pointsEarned: pct, pointsPossible: 100 });
                          }
                        }}
                        aria-label={`What-if for ${r.assessment.title}`}
                      />
                    </td>
                    <td>
                      <label className="small">
                        <input
                          type="checkbox"
                          checked={!!ov?.missed}
                          onChange={(e) => setOverride(r.assessment.id, { missed: e.target.checked })}
                        />{" "}
                        miss
                      </label>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <div className="filters" style={{ marginTop: "0.75rem" }}>
            <button type="button" className="btn btn-sm" onClick={persistOverrides}>
              Save what-if locally
            </button>
            <button type="button" className="btn btn-sm" onClick={clearOverrides}>
              Clear overrides
            </button>
          </div>
        </div>

        <div className="card">
          <h2>Target</h2>
          <div className="field">
            <label htmlFor="target">Target course grade (%)</label>
            <input
              id="target"
              type="number"
              min={0}
              max={100}
              value={target}
              onChange={(e) => setTarget(Number(e.target.value))}
            />
          </div>
          <p>
            Needed average on remaining:{" "}
            <strong>{required != null ? `${required.toFixed(1)}%` : "—"}</strong>
          </p>
          {finalReq != null && (
            <p>
              Needed on final ({finalItem?.assessment.weightPercent}%):{" "}
              <strong>{finalReq.toFixed(1)}%</strong>
            </p>
          )}
          <p className="small muted">
            Respects best-N / drop / threshold rules via the semantic engine. Official grades are never
            overwritten.
          </p>
        </div>
      </div>
    </div>
  );
}
