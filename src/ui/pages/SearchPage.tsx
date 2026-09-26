import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import type { AppData } from "@/domain/types";
import { searchLocal } from "@/engines/search";

export function SearchPage({ data }: { data: AppData }) {
  const [q, setQ] = useState("");
  const [courseId, setCourseId] = useState<string>("");
  const hits = useMemo(
    () => searchLocal(data, q, 60, courseId || null),
    [data, q, courseId],
  );
  const selected = data.courses.filter((c) =>
    (data.preferences.selectedCourseIds ?? []).includes(c.id),
  );

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Search</h1>
          <p>Local full-text with snippets — content, PDFs/text library, outline, announcements, discussions, specs, policies.</p>
        </div>
      </div>
      <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap", marginBottom: "0.75rem" }}>
        <input
          className="search-hero"
          autoFocus
          placeholder="Quiz 3 · late policy · office hours · A2…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          aria-label="Global search"
          style={{ flex: 1, minWidth: 220 }}
        />
        <select
          value={courseId}
          onChange={(e) => setCourseId(e.target.value)}
          aria-label="Course filter"
        >
          <option value="">All courses</option>
          {selected.map((c) => (
            <option key={c.id} value={c.id}>
              {c.code}
            </option>
          ))}
        </select>
      </div>
      <div className="search-results">
        {q.trim() && hits.length === 0 && <p className="muted">No local matches. Sync may still be needed.</p>}
        {hits.map((h) => (
          <div key={h.id} className="card card-tight search-hit">
            <div className="small muted">
              {h.kind}
              {h.courseCode ? ` · ${h.courseCode}` : ""}
            </div>
            {h.href.startsWith("http") ? (
              <a href={h.href} target="_blank" rel="noreferrer">
                <strong>{h.title}</strong>
              </a>
            ) : (
              <Link to={h.href}>
                <strong>{h.title}</strong>
              </Link>
            )}
            <div className="small">{h.subtitle}</div>
            {h.snippet && <p className="small muted search-snippet">{h.snippet}</p>}
          </div>
        ))}
      </div>
    </div>
  );
}
