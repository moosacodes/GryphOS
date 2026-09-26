import { useMemo, useState } from "react";
import type { AppData } from "@/domain/types";
import {
  requiredAverageOnRemaining,
  requiredFinalExamScore,
  summarizeCourseGrades,
} from "@/engines/grades";
import { EmptyState } from "../components/EmptyState";

export function GradesPage({ data }: { data: AppData; update?: (patch: Partial<AppData> | ((prev: AppData) => AppData)) => Promise<AppData> }) {
  const courses = data.courses.filter((c) =>
    (data.preferences.selectedCourseIds ?? []).includes(c.id),
  );
  const [courseId, setCourseId] = useState(courses[0]?.id ?? "");
  const [target, setTarget] = useState(80);
  const [hypo, setHypo] = useState(85);

  const course = courses.find((c) => c.id === courseId) ?? courses[0];
  const summary = useMemo(() => {
    if (!course) return null;
    return summarizeCourseGrades(course, data.assessments, data.gradeCategories, data.academicRules, data.whatIfOverrides);
  }, [course, data.assessments, data.gradeCategories, data.academicRules, data.whatIfOverrides]);

  if (!course || !summary) {
    return (
      <div>
        <div className="page-header"><div><h1>Grades</h1></div></div>
        <EmptyState title="No courses" body="Select courses after syncing." />
      </div>
    );
  }

  const required = requiredAverageOnRemaining(summary, target);
  const finalItem = summary.rows.find((r) => r.assessment.type === "final");
  const finalReq =
    finalItem?.assessment.weightPercent != null
      ? requiredFinalExamScore(summary, finalItem.assessment.weightPercent, target)
      : null;

  const projected =
    summary.completedWeight + summary.remainingWeight > 0 && summary.calculatedPercent != null
      ? (summary.calculatedPercent * summary.completedWeight + hypo * summary.remainingWeight) /
        (summary.completedWeight + summary.remainingWeight)
      : null;

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Grades</h1>
          <p>Deterministic calculations from your local data. Not official University grades.</p>
        </div>
        <select value={course.id} onChange={(e) => setCourseId(e.target.value)} aria-label="Course">
          {courses.map((c) => (
            <option key={c.id} value={c.id}>{c.code}</option>
          ))}
        </select>
      </div>

      <div className="grid grid-3" style={{ marginBottom: "1rem" }}>
        <div className="card">
          <h3>Calculated standing</h3>
          <p style={{ fontSize: "2rem", margin: 0, fontWeight: 700 }}>
            {summary.calculatedPercent != null ? `${summary.calculatedPercent.toFixed(1)}%` : "—"}
          </p>
          <p className="small muted">On completed weighted work</p>
        </div>
        <div className="card">
          <h3>Completed weight</h3>
          <p style={{ fontSize: "2rem", margin: 0, fontWeight: 700 }}>{summary.completedWeight.toFixed(0)}%</p>
          <p className="small muted">Remaining {summary.remainingWeight.toFixed(0)}%</p>
        </div>
        <div className="card">
          <h3>Graded items</h3>
          <p style={{ fontSize: "2rem", margin: 0, fontWeight: 700 }}>{summary.gradedCount}</p>
          <p className="small muted">{summary.ungradedCount} ungraded ? {summary.missedCount} missed (not zeroed)</p>
          {summary.capReason && <p className="small" style={{ color: "var(--danger)" }}>Cap: {summary.capReason}</p>}
        </div>
      </div>

      <div className="grid grid-2">
        <div className="card">
          <h2>Assessment breakdown</h2>
          <table className="table">
            <thead>
              <tr>
                <th>Item</th>
                <th>Weight</th>
                <th>Score</th>
                <th>Official</th>
              </tr>
            </thead>
            <tbody>
              {summary.rows.map((r) => (
                <tr key={r.assessment.id}>
                  <td>
                    {r.assessment.title}
                    {r.missed ? " (missed)" : ""}{r.dropped ? " (dropped)" : ""}
                  </td>
                  <td>{r.assessment.weightPercent != null ? `${r.assessment.weightPercent}%` : "—"}</td>
                  <td>{r.percent != null ? `${r.percent.toFixed(1)}%` : "—"}</td>
                  <td>{r.assessment.gradeDisplay ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="card">
          <h2>Target & what-if</h2>
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
            Required average on remaining work:{" "}
            <strong>{required != null ? `${required.toFixed(1)}%` : "—"}</strong>
          </p>
          {finalReq != null && (
            <p>
              Required on final ({finalItem?.assessment.weightPercent}%):{" "}
              <strong>{finalReq.toFixed(1)}%</strong>
            </p>
          )}
          <div className="field">
            <label htmlFor="hypo">Hypothetical average on remaining (%)</label>
            <input
              id="hypo"
              type="number"
              min={0}
              max={100}
              value={hypo}
              onChange={(e) => setHypo(Number(e.target.value))}
            />
          </div>
          <p>
            Projected course grade:{" "}
            <strong>{projected != null ? `${projected.toFixed(1)}%` : "—"}</strong>
          </p>
          <p className="small muted">
            Hypothetical projections are local math only and are not official.
          </p>
        </div>
      </div>
    </div>
  );
}
