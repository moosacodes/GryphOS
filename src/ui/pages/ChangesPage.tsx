import type { AppData } from "@/domain/types";
import { EmptyState } from "../components/EmptyState";

export function ChangesPage({
  data,
  update,
}: {
  data: AppData;
  update: (patch: Partial<AppData> | ((prev: AppData) => AppData)) => Promise<AppData>;
}) {
  const changes = data.changes ?? [];
  if (changes.length === 0) {
    return (
      <div>
        <div className="page-header">
          <div>
            <h1>Changes</h1>
            <p>Sync diffs land here — deadlines, weights, grades, new items.</p>
          </div>
        </div>
        <EmptyState title="No changes yet" body="Run Sync on CourseLink to detect updates." />
      </div>
    );
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Changes</h1>
          <p>{changes.filter((c) => !c.read).length} unread</p>
        </div>
        <button
          type="button"
          className="btn"
          onClick={() =>
            void update((prev) => ({
              ...prev,
              changes: (prev.changes ?? []).map((c) => ({ ...c, read: true })),
            }))
          }
        >
          Mark all read
        </button>
      </div>
      <div className="list">
        {changes.map((c) => (
          <div key={c.id} className="card" style={{ marginBottom: "0.5rem", opacity: c.read ? 0.7 : 1 }}>
            <strong>{c.title}</strong>
            <p className="small muted">
              {c.kind} · {new Date(c.createdAt).toLocaleString()}
            </p>
            <p className="small">{c.detail}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
