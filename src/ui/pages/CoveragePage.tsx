import { Link, useParams } from "react-router-dom";
import type { AppData } from "@/domain/types";

export function CoveragePage({ data }: { data: AppData }) {
  const { courseId } = useParams();
  const id = courseId ? decodeURIComponent(courseId) : null;
  const courses = data.courses.filter((c) =>
    id ? c.id === id : (data.preferences.selectedCourseIds ?? []).includes(c.id),
  );

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Source coverage</h1>
          <p>
            Honest per-source diagnostics after sync. Counts are exact for what was discovered vs
            ingested — never claimed as supported when posts/files are unavailable.
          </p>
        </div>
      </div>
      {courses.length === 0 && <p className="muted">No courses selected. Sync first.</p>}
      {courses.map((c) => {
        const cov = (data.sourceCoverage ?? []).find((x) => x.courseId === c.id);
        return (
          <div key={c.id} className="card" style={{ marginBottom: "1rem" }}>
            <h2>
              <Link to={`/courses/${encodeURIComponent(c.id)}`}>{c.code}</Link>{" "}
              <span className="muted small">{c.title}</span>
            </h2>
            {!cov && <p className="muted">No coverage report yet — run Sync.</p>}
            {cov && (
              <>
                <p className="small muted">Updated {new Date(cov.updatedAt).toLocaleString()}</p>
                <table className="table" style={{ width: "100%", fontSize: "0.9rem" }}>
                  <thead>
                    <tr>
                      <th>Source</th>
                      <th>Status</th>
                      <th>Discovered</th>
                      <th>Ingested</th>
                      <th>Detail</th>
                    </tr>
                  </thead>
                  <tbody>
                    {cov.capabilities.map((cap) => (
                      <tr key={cap.key}>
                        <td>
                          <strong>{cap.label}</strong>
                          {cap.endpoint && (
                            <div className="small muted">{cap.endpoint}</div>
                          )}
                        </td>
                        <td>{cap.status}</td>
                        <td>{cap.discovered}</td>
                        <td>{cap.ingested}</td>
                        <td>
                          {cap.detail}
                          {cap.lastError ? (
                            <div className="small" style={{ color: "var(--danger)" }}>
                              {cap.lastError}
                            </div>
                          ) : null}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            )}
          </div>
        );
      })}
    </div>
  );
}
