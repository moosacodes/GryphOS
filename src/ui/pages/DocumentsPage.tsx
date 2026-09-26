import { useState } from "react";
import type { AppData, ImportedDocument } from "@/domain/types";
import { parseOutlineFile } from "@/adapters/outline";
import { applyOutlineDocument } from "@/sync/applyOutline";
import { EmptyState } from "../components/EmptyState";

function uid(): string {
  return `doc:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`;
}

function emDash(): string {
  return "\u2014";
}

export function DocumentsPage({
  data,
  update,
}: {
  data: AppData;
  update: (patch: Partial<AppData> | ((prev: AppData) => AppData)) => Promise<AppData>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);

  const onImport = async (file: File, courseId: string) => {
    setBusy(true);
    setError(null);
    try {
      const { text, result } = await parseOutlineFile(file);
      const doc: ImportedDocument = {
        id: uid(),
        courseId: courseId || null,
        filename: file.name,
        mimeType: file.type || "application/octet-stream",
        importedAt: new Date().toISOString(),
        textContent: text,
        parseResult: result,
        parseError: null,
      };

      await update((prev) =>
        applyOutlineDocument(prev, courseId, doc, { preferExistingManual: false }),
      );
    } catch (e) {
      setError(String((e as Error).message ?? e));
    } finally {
      setBusy(false);
    }
  };

  const removeDoc = async (id: string) => {
    await update((prev) => {
      const doc = prev.documents.find((d) => d.id === id);
      return {
        ...prev,
        documents: prev.documents.filter((d) => d.id !== id),
        courses: prev.courses.map((c) =>
          c.outlineDocumentId === id
            ? {
                ...c,
                outlineDocumentId: null,
                outlineStatus: "none_accessible" as const,
                outlineStatusDetail: "Outline document removed",
              }
            : c,
        ),
        assessments: doc?.courseId
          ? prev.assessments.filter(
              (a) => !(a.courseId === doc.courseId && a.id.startsWith("outline:")),
            )
          : prev.assessments,
        gradeCategories: doc?.courseId
          ? prev.gradeCategories.filter((g) => g.courseId !== doc.courseId)
          : prev.gradeCategories,
      };
    });
  };

  const applyCorrection = async (
    docId: string,
    assessmentIndex: number,
    field: string,
    value: string,
  ) => {
    await update((prev) => {
      const doc = prev.documents.find((d) => d.id === docId);
      if (!doc?.parseResult || !doc.courseId) return prev;

      const assessments = doc.parseResult.assessments.map((a, i) => {
        if (i !== assessmentIndex) return a;
        if (field === "title") return { ...a, title: value };
        if (field === "weight") {
          return { ...a, weightPercent: value === "" ? null : Number(value) };
        }
        if (field === "due") {
          return {
            ...a,
            dueLabel: value,
            dueIso: null,
            certainty: "approximate" as const,
          };
        }
        return a;
      });

      const nextDoc: ImportedDocument = {
        ...doc,
        parseResult: { ...doc.parseResult, assessments },
      };
      // Single safe path: rebuild canonical model via applyOutline
      return applyOutlineDocument(prev, doc.courseId, nextDoc, {
        preferExistingManual: false,
      });
    });
  };

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Documents</h1>
          <p>
            Outlines are discovered on CourseLink Sync when Brightspace allows downloads.
            Manual import is the fallback. Parsing is local and deterministic (no LLM).
            Corrections below rebuild assessments immediately.
          </p>
        </div>
      </div>

      <div className="card" style={{ marginBottom: "1rem" }}>
        <h2>Manual import (fallback)</h2>
        <div className="field">
          <label htmlFor="course">Associate with course</label>
          <select id="course" defaultValue={data.courses[0]?.id ?? ""}>
            {data.courses.map((c) => (
              <option key={c.id} value={c.id}>
                {c.code} {emDash()} {c.title}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="file">File (PDF / TXT / HTML)</label>
          <input
            id="file"
            type="file"
            accept=".pdf,.txt,.html,.htm,text/plain,application/pdf,text/html"
            disabled={busy || data.courses.length === 0}
            onChange={(e) => {
              const file = e.target.files?.[0];
              const select = document.getElementById("course") as HTMLSelectElement | null;
              if (file && select?.value) void onImport(file, select.value);
              e.target.value = "";
            }}
          />
        </div>
        {busy && <p className="small muted">Parsing...</p>}
        {error && (
          <p className="small" style={{ color: "var(--danger)" }}>
            {error}
          </p>
        )}
      </div>

      {data.documents.length === 0 ? (
        <EmptyState
          title="No documents"
          body="Import a syllabus/outline to enrich weights, policies, and people."
        />
      ) : (
        data.documents.map((d) => {
          const r = d.parseResult;
          return (
            <div key={d.id} className="card" style={{ marginBottom: "1rem" }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: "1rem" }}>
                <div>
                  <h2 style={{ marginTop: 0 }}>{d.filename}</h2>
                  <p className="small muted">
                    {data.courses.find((c) => c.id === d.courseId)?.code ?? "Unassigned"} ·{" "}
                    {new Date(d.importedAt).toLocaleString()}
                    {r ? ` · confidence ${Math.round(r.confidence * 100)}%` : ""}
                  </p>
                </div>
                <div style={{ display: "flex", gap: "0.4rem" }}>
                  <button
                    type="button"
                    className="btn"
                    onClick={() => setEditing(editing === d.id ? null : d.id)}
                  >
                    {editing === d.id ? "Hide" : "Inspect"}
                  </button>
                  <button type="button" className="btn" onClick={() => void removeDoc(d.id)}>
                    Remove
                  </button>
                </div>
              </div>

              {editing === d.id && r && (
                <div style={{ marginTop: "0.75rem" }}>
                  <section style={{ marginBottom: "1rem" }}>
                    <h3>Metadata</h3>
                    <p className="small">
                      Code: {r.courseCode ?? emDash()} · Title: {r.courseTitle ?? emDash()} · Term:{" "}
                      {r.term ?? emDash()}
                    </p>
                    <p className="small">
                      Instructors:{" "}
                      {r.instructors.length
                        ? r.instructors.map((i) => i.name).join(", ")
                        : emDash()}
                      {" · "}
                      TAs: {r.tas.length ? r.tas.map((t) => t.name).join(", ") : emDash()}
                    </p>
                  </section>

                  <section style={{ marginBottom: "1rem" }}>
                    <h3>Assessments</h3>
                    <table className="table">
                      <thead>
                        <tr>
                          <th>Assessment</th>
                          <th>Weight</th>
                          <th>Due</th>
                          <th>Source</th>
                          <th>Fix</th>
                        </tr>
                      </thead>
                      <tbody>
                        {r.assessments.map((a, i) => (
                          <tr key={i}>
                            <td>
                              {a.title}
                              <div className="small muted">{a.type}</div>
                            </td>
                            <td>
                              {a.weightPercent != null ? `${a.weightPercent}%` : emDash()}
                            </td>
                            <td>
                              {a.dueLabel ?? a.dueIso ?? a.certainty}
                              {a.certainty === "approximate" ? " (approx)" : ""}
                            </td>
                            <td className="small muted" style={{ maxWidth: 180 }}>
                              {a.sourceSnippet ?? emDash()}
                            </td>
                            <td>
                              <button
                                type="button"
                                className="btn btn-sm"
                                onClick={() => {
                                  const title = prompt("Title", a.title);
                                  if (title != null) void applyCorrection(d.id, i, "title", title);
                                  const w = prompt(
                                    "Weight %",
                                    a.weightPercent != null ? String(a.weightPercent) : "",
                                  );
                                  if (w != null) void applyCorrection(d.id, i, "weight", w);
                                  const due = prompt("Due label", a.dueLabel ?? "");
                                  if (due != null) void applyCorrection(d.id, i, "due", due);
                                }}
                              >
                                Edit
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </section>

                  {(r.gradingRules?.length ?? 0) > 0 && (
                    <section style={{ marginBottom: "1rem" }}>
                      <h3>Grading rules</h3>
                      <ul className="small">
                        {r.gradingRules.map((g, i) => (
                          <li key={i}>{g.label}</li>
                        ))}
                      </ul>
                    </section>
                  )}

                  {(r.categories?.length ?? 0) > 0 && (
                    <section style={{ marginBottom: "1rem" }}>
                      <h3>Categories</h3>
                      <ul className="small">
                        {r.categories.map((c, i) => (
                          <li key={i}>
                            {c.name}
                            {c.weightPercent != null ? ` · ${c.weightPercent}%` : ""}
                            {c.bestN != null ? ` · best ${c.bestN}` : ""}
                            {c.dropLowest ? ` · drop ${c.dropLowest}` : ""}
                          </li>
                        ))}
                      </ul>
                    </section>
                  )}

                  {r.policies.length > 0 && (
                    <section style={{ marginBottom: "1rem" }}>
                      <h3>Policies</h3>
                      {r.policies.map((p, i) => (
                        <div key={i} className="small" style={{ marginBottom: "0.5rem" }}>
                          <strong>{p.title}</strong>
                          <div className="muted">{p.body.slice(0, 280)}...</div>
                        </div>
                      ))}
                    </section>
                  )}

                  {r.scheduleLines.length > 0 && (
                    <section style={{ marginBottom: "1rem" }}>
                      <h3>Schedule</h3>
                      <ul className="small">
                        {r.scheduleLines.map((l, i) => (
                          <li key={i}>{l}</li>
                        ))}
                      </ul>
                    </section>
                  )}

                  {r.textbooks.length > 0 && (
                    <section style={{ marginBottom: "1rem" }}>
                      <h3>Resources</h3>
                      <ul className="small">
                        {r.textbooks.map((t, i) => (
                          <li key={i}>{t}</li>
                        ))}
                      </ul>
                    </section>
                  )}

                  {(r.diagnostics?.length ?? 0) > 0 && (
                    <section>
                      <h3>Parse diagnostics</h3>
                      <ul className="small muted">
                        {r.diagnostics.map((diag, i) => (
                          <li key={i}>
                            [{diag.pass}] {diag.message}
                            {diag.snippet ? ` — ${diag.snippet}` : ""}
                          </li>
                        ))}
                      </ul>
                    </section>
                  )}
                </div>
              )}
            </div>
          );
        })
      )}
    </div>
  );
}