import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import type { AppData } from "@/domain/types";
import { searchLocal } from "@/engines/search";

export function SearchPage({ data }: { data: AppData }) {
  const [q, setQ] = useState("");
  const hits = useMemo(() => searchLocal(data, q, 60), [data, q]);

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Search</h1>
          <p>Local across content, docs, announcements, assessments, policies, people, tasks.</p>
        </div>
      </div>
      <input
        className="search-hero"
        autoFocus
        placeholder="Quiz 3 · late policy · office hours · A2…"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        aria-label="Global search"
      />
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
          </div>
        ))}
      </div>
    </div>
  );
}
