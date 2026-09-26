import type { CourseBlueprint, DocumentLayout } from "@/documentIntelligence/types";

export function DocumentDebugger({
  layout,
  blueprint,
}: {
  layout: DocumentLayout | null | undefined;
  blueprint: CourseBlueprint | null | undefined;
}) {
  if (!layout && !blueprint) {
    return (
      <p className="small muted">No layout/blueprint debug data for this document.</p>
    );
  }
  return (
    <div className="card" style={{ marginTop: 12 }}>
      <h3>Document Intelligence Debugger</h3>
      {blueprint && (
        <div className="small" style={{ marginBottom: 8 }}>
          <div>
            Quality: {(blueprint.quality.score * 100).toFixed(0)}%
            {blueprint.quality.incomplete ? " (incomplete)" : ""}
          </div>
          <div>
            Method: {blueprint.layoutSummary.extractionMethod} · pages{" "}
            {blueprint.layoutSummary.pageCount} · tables {blueprint.layoutSummary.tableCount} · OCR
            pages {blueprint.layoutSummary.ocrPages}
          </div>
          <div>
            Instances: {blueprint.instances.length} · categories {blueprint.categories.length} ·
            relative rules {blueprint.relativeDeadlines.length}
          </div>
          {blueprint.quality.checks.length > 0 && (
            <ul>
              {blueprint.quality.checks.map((c) => (
                <li key={c.id}>
                  {c.ok ? "✓" : "✗"} {c.id}: {c.detail}
                </li>
              ))}
            </ul>
          )}
          {blueprint.quality.contradictions.length > 0 && (
            <div className="danger small">
              Contradictions: {blueprint.quality.contradictions.join("; ")}
            </div>
          )}
        </div>
      )}
      {layout &&
        layout.pages.map((page) => (
          <details key={page.page} style={{ marginBottom: 8 }}>
            <summary>
              Page {page.page} — {page.lines.length} lines, {page.tables.length} tables, density{" "}
              {page.textDensity.toFixed(5)}
              {page.ocrApplied ? " (OCR)" : ""}
            </summary>
            {page.renderDataUrl && (
              <img
                src={page.renderDataUrl}
                alt={`Page ${page.page} render`}
                style={{ maxWidth: "100%", border: "1px solid #ccc", marginTop: 8 }}
              />
            )}
            <div className="small muted" style={{ marginTop: 6 }}>
              Columns: {page.columns.length}
            </div>
            {page.tables.map((t) => (
              <div key={t.id} className="small" style={{ marginTop: 6 }}>
                <strong>
                  Table {t.kind} (p{t.page}
                  {t.endPage !== t.page ? `–${t.endPage}` : ""})
                </strong>
                <div>{t.headers.join(" | ")}</div>
                {t.rows.slice(0, 8).map((r, i) => (
                  <div key={i}>{r.join(" | ")}</div>
                ))}
              </div>
            ))}
            <pre
              className="small"
              style={{
                maxHeight: 160,
                overflow: "auto",
                background: "var(--surface-2, #1113)",
                padding: 8,
              }}
            >
              {page.lines
                .slice()
                .sort((a, b) => a.readingOrder - b.readingOrder)
                .map((l) => l.text)
                .join("\n")}
            </pre>
            {blueprint && (
              <div className="small" style={{ marginTop: 6 }}>
                Facts on this page:
                <ul>
                  {blueprint.instances
                    .filter((i) => i.citation?.page === page.page)
                    .slice(0, 12)
                    .map((i) => (
                      <li key={i.title}>
                        {i.title} {i.weightPercent != null ? `${i.weightPercent}%` : ""} —{" "}
                        <button type="button" className="btn" style={{ padding: "0 6px" }}>
                          {i.citation?.viewLabel ?? "View source"}
                        </button>
                        {i.citation?.snippet ? (
                          <span className="muted"> “{i.citation.snippet.slice(0, 80)}”</span>
                        ) : null}
                      </li>
                    ))}
                </ul>
              </div>
            )}
          </details>
        ))}
    </div>
  );
}
