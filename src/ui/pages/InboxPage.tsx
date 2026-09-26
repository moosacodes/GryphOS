import { Link } from "react-router-dom";
import type { AppData, ChangeEvent } from "@/domain/types";
import { changeDiff } from "@/engines/notifications";
import { EmptyState } from "../components/EmptyState";

const KIND_LABEL: Record<ChangeEvent["kind"], string> = {
  deadline_changed: "Deadline change",
  weight_changed: "Weight change",
  new_assessment: "New assessment",
  removed_assessment: "Removed",
  grade_posted: "Grade posted",
  announcement: "Announcement",
  announcement_superseded: "Announcement update",
  document_version: "Document update",
  rule_changed: "Rule change",
  section_changed: "Section change",
  occurrence_cancelled: "Class cancelled",
  other: "Update",
};

function InboxCard({
  ch,
  courseCode,
  onRead,
}: {
  ch: ChangeEvent;
  courseCode: string | null;
  onRead: () => void;
}) {
  const diff = changeDiff(ch);
  return (
    <article className={`inbox-card card${ch.read ? " read" : ""}`}>
      <div className="inbox-card-head">
        <span className="badge">{KIND_LABEL[ch.kind]}</span>
        {courseCode ? <span className="myday-code">{courseCode}</span> : null}
        <span className="small muted">{new Date(ch.createdAt).toLocaleString()}</span>
      </div>
      <h3 className="inbox-title">{ch.title}</h3>
      {diff ? (
        <div className="diff-visual" aria-label="Before and after">
          <div className="diff-before">
            <span className="diff-label">Before</span>
            <code>{diff.before}</code>
          </div>
          <div className="diff-arrow" aria-hidden>
            →
          </div>
          <div className="diff-after">
            <span className="diff-label">After</span>
            <code>{diff.after}</code>
          </div>
        </div>
      ) : (
        <p className="small">{ch.detail}</p>
      )}
      <div className="inbox-actions">
        {!ch.read && (
          <button type="button" className="btn btn-sm" onClick={onRead}>
            Mark read
          </button>
        )}
        {ch.entityId && (
          <Link className="btn btn-sm" to={`/assessment/${encodeURIComponent(ch.entityId)}`}>
            Open
          </Link>
        )}
        {ch.courseId && !ch.entityId && (
          <Link className="btn btn-sm" to={`/courses/${encodeURIComponent(ch.courseId)}`}>
            Course
          </Link>
        )}
      </div>
    </article>
  );
}

export function InboxPage({
  data,
  update,
}: {
  data: AppData;
  update: (patch: Partial<AppData> | ((prev: AppData) => AppData)) => Promise<AppData>;
}) {
  const courses = new Map(data.courses.map((c) => [c.id, c]));
  const changes = [...(data.changes ?? [])].sort(
    (a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt),
  );
  const unread = changes.filter((c) => !c.read).length;

  // Also surface fresh announcements as inbox-like items
  const recentAnns = (data.announcements ?? [])
    .filter((a) => a.publishedAt)
    .sort((a, b) => Date.parse(b.publishedAt!) - Date.parse(a.publishedAt!))
    .slice(0, 15);

  if (changes.length === 0 && recentAnns.length === 0) {
    return (
      <div>
        <div className="page-header">
          <div>
            <h1>Inbox</h1>
            <p>Actionable updates — deadline changes, grades, new work, staff notes.</p>
          </div>
        </div>
        <EmptyState title="Inbox clear" body="Sync CourseLink to detect changes. Nothing is fabricated." />
      </div>
    );
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Inbox</h1>
          <p>
            {unread} unread · visual diffs for deadline/weight changes
          </p>
        </div>
        {unread > 0 && (
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
        )}
      </div>

      <div className="inbox-list">
        {changes.map((ch) => (
          <InboxCard
            key={ch.id}
            ch={ch}
            courseCode={ch.courseId ? courses.get(ch.courseId)?.code ?? null : null}
            onRead={() =>
              void update((prev) => ({
                ...prev,
                changes: (prev.changes ?? []).map((c) =>
                  c.id === ch.id ? { ...c, read: true } : c,
                ),
              }))
            }
          />
        ))}
      </div>

      {recentAnns.length > 0 && (
        <section style={{ marginTop: "1.5rem" }}>
          <h2 className="section-label">Recent announcements</h2>
          <div className="inbox-list">
            {recentAnns.map((a) => (
              <article key={a.id} className="inbox-card card">
                <div className="inbox-card-head">
                  <span className="badge">Announcement</span>
                  <span className="myday-code">{courses.get(a.courseId)?.code}</span>
                </div>
                <h3 className="inbox-title">{a.title}</h3>
                <p className="small">{a.bodyText.slice(0, 220)}{a.bodyText.length > 220 ? "…" : ""}</p>
                <div className="inbox-actions">
                  <Link className="btn btn-sm" to={`/courses/${encodeURIComponent(a.courseId)}`}>
                    Course
                  </Link>
                  {a.url && (
                    <a className="btn btn-sm" href={a.url} target="_blank" rel="noreferrer">
                      CourseLink
                    </a>
                  )}
                </div>
              </article>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
