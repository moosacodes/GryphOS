import { useState } from "react";
import type { AppData, Assessment, ImportedDocument, Person } from "@/domain/types";
import { parseOutlineFile } from "@/adapters/outline";
import { reconcileAssessments } from "@/reconcile/merge";
import { EmptyState } from "../components/EmptyState";

function uid(): string {
  return `doc:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`;
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

      await update((prev) => {
        const courses = prev.courses.map((c) =>
          c.id === courseId ? { ...c, outlineDocumentId: doc.id, instructorNames: result.instructors.map((i) => i.name) } : c,
        );

        const people: Person[] = [
          ...result.instructors.map((i, idx): Person => ({
            id: `person:${courseId}:inst:${idx}`,
            name: i.name,
            email: i.email,
            role: "instructor",
            courseId,
          })),
          ...result.tas.map((t, idx): Person => ({
            id: `person:${courseId}:ta:${idx}`,
            name: t.name,
            email: t.email,
            role: "ta",
            courseId,
          })),
        ];

        const outlineAssessments: Assessment[] = result.assessments.map((oa, i) => ({
          id: `outline:${courseId}:${i}:${oa.title.toLowerCase().replace(/\s+/g, "-")}`,
          courseId,
          title: oa.title,
          type: oa.type,
          due: { certainty: oa.certainty, iso: oa.dueIso, label: oa.dueLabel },
          start: { certainty: "unknown", iso: null, label: null },
          end: { certainty: "unknown", iso: null, label: null },
          weightPercent: oa.weightPercent,
          pointsPossible: null,
          pointsEarned: null,
          submissionState: "unknown",
          submittedAt: null,
          gradeDisplay: null,
          url: null,
          notes: null,
          categoryId: null,
          isBonus: false,
          sourceRecords: [],
          fieldProvenance: {
            weightPercent: {
              value: oa.weightPercent,
              sourceType: "course_outline",
              sourceId: doc.id,
              confidence: oa.confidence,
              retrievedAt: doc.importedAt,
            },
            due: {
              value: { certainty: oa.certainty, iso: oa.dueIso, label: oa.dueLabel },
              sourceType: "course_outline",
              sourceId: doc.id,
              confidence: oa.confidence,
              retrievedAt: doc.importedAt,
            },
          },
          conflictIds: [],
          manualOverrides: {},
          updatedAt: new Date().toISOString(),
        }));

        const withoutOldOutline = prev.assessments.filter(
          (a) => !(a.courseId === courseId && a.id.startsWith("outline:")),
        );
        const reconciled = reconcileAssessments([...withoutOldOutline, ...outlineAssessments]);

        const policies = result.policies.map((p, i) => ({
          id: `policy:${courseId}:${i}`,
          courseId,
          kind: p.kind,
          title: p.title,
          body: p.body,
        }));

        const resources = result.textbooks.map((t, i) => ({
          id: `res:${courseId}:${i}`,
          courseId,
          title: t,
          kind: "textbook" as const,
          url: null,
          notes: null,
        }));

        return {
          ...prev,
          documents: [...prev.documents.filter((d) => d.courseId !== courseId), doc],
          courses,
          assessments: reconciled.assessments,
          conflicts: [
            ...prev.conflicts.filter((c) => !reconciled.conflicts.some((n) => n.id === c.id)),
            ...reconciled.conflicts,
          ],
          people: [...prev.people.filter((p) => p.courseId !== courseId), ...people],
          policies: [...prev.policies.filter((p) => p.courseId !== courseId), ...policies],
          resources: [...prev.resources.filter((r) => r.courseId !== courseId), ...resources],
        };
      });
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
          c.outlineDocumentId === id ? { ...c, outlineDocumentId: null } : c,
        ),
        assessments: doc?.courseId
          ? prev.assessments.filter((a) => !(a.courseId === doc.courseId && a.id.startsWith("outline:")))
          : prev.assessments,
      };
    });
  };

  const applyCorrection = async (docId: string, assessmentIndex: number, field: string, value: string) => {
    await update((prev) => {
      const documents = prev.documents.map((d) => {
        if (d.id !== docId || !d.parseResult) return d;
        const assessments = d.parseResult.assessments.map((a, i) => {
          if (i !== assessmentIndex) return a;
          if (field === "title") return { ...a, title: value };
          if (field === "weight") return { ...a, weightPercent: value === "" ? null : Number(value) };
          if (field === "due") return { ...a, dueLabel: value, dueIso: null, certainty: "approximate" as const };
          return a;
        });
        return { ...d, parseResult: { ...d.parseResult, assessments } };
      });
      return { ...prev, documents };
    });
  };

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Documents</h1>
          <p>Outlines are discovered automatically during CourseLink sync when content files are available. Manual import below is a fallback. Parsing is local and deterministic.</p>
        </div>
      </div>

      <div className="card" style={{ marginBottom: "1rem" }}>
        <h2>Manual import (fallback)</h2>
        <div className="field">
          <label htmlFor="course">Associate with course</label>
          <select id="course" defaultValue={data.courses[0]?.id ?? ""}>
            {data.courses.map((c) => (
              <option key={c.id} value={c.id}>{c.code} — {c.title}</option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="file">File</label>
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
        {busy && <p className="small muted">Parsing…</p>}
        {error && <p className="small" style={{ color: "var(--danger)" }}>{error}</p>}
      </div>

      {data.documents.length === 0 ? (
        <EmptyState title="No documents" body="Import a syllabus/outline to enrich weights, policies, and people." />
      ) : (
        data.documents.map((d) => (
          <div key={d.id} className="card" style={{ marginBottom: "1rem" }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: "1rem" }}>
              <div>
                <h2 style={{ marginTop: 0 }}>{d.filename}</h2>
                <p className="small muted">
                  {data.courses.find((c) => c.id === d.courseId)?.code ?? "Unassigned"} ·{" "}
                  {new Date(d.importedAt).toLocaleString()}
                  {d.parseResult ? ` · confidence ${Math.round(d.parseResult.confidence * 100)}%` : ""}
                </p>
              </div>
              <div style={{ display: "flex", gap: "0.4rem" }}>
                <button type="button" className="btn" onClick={() => setEditing(editing === d.id ? null : d.id)}>
                  {editing === d.id ? "Hide" : "Inspect"}
                </button>
                <button type="button" className="btn" onClick={() => void removeDoc(d.id)}>Remove</button>
              </div>
            </div>
            {editing === d.id && d.parseResult && (
              <div style={{ marginTop: "0.75rem" }}>
                <p className="small">
                  Code: {d.parseResult.courseCode ?? "—"} · Title: {d.parseResult.courseTitle ?? "—"} · Term:{" "}
                  {d.parseResult.term ?? "—"}
                </p>
                <table className="table">
                  <thead>
                    <tr><th>Assessment</th><th>Weight</th><th>Due</th><th>Fix</th></tr>
                  </thead>
                  <tbody>
                    {d.parseResult.assessments.map((a, i) => (
                      <tr key={i}>
                        <td>{a.title}</td>
                        <td>{a.weightPercent != null ? `${a.weightPercent}%` : "—"}</td>
                        <td>{a.dueLabel ?? a.dueIso ?? a.certainty}</td>
                        <td>
                          <button
                            type="button"
                            className="btn"
                            onClick={() => {
                              const title = prompt("Correct title", a.title);
                              if (title != null) void applyCorrection(d.id, i, "title", title);
                            }}
                          >
                            Edit title
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p className="small muted">Original document text is never modified — corrections update structured parse data only.</p>
              </div>
            )}
          </div>
        ))
      )}
    </div>
  );
}
