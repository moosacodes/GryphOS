/**
 * Incremental local full-text search index with snippets.
 */
import type { AppData, SearchIndexEntry } from "@/domain/types";

const MAX_BODY = 8000;

function entry(
  id: string,
  courseId: string | null,
  kind: string,
  title: string,
  body: string,
  entityId: string | null,
): SearchIndexEntry {
  return {
    id,
    courseId,
    kind,
    title,
    body: body.slice(0, MAX_BODY),
    entityId,
    updatedAt: new Date().toISOString(),
  };
}

export function rebuildSearchIndex(data: AppData): SearchIndexEntry[] {
  const out: SearchIndexEntry[] = [];

  for (const a of data.assessments) {
    out.push(
      entry(
        `si:a:${a.id}`,
        a.courseId,
        "assessment",
        a.title,
        [a.type, a.notes, a.gradeDisplay, a.due.label, a.due.iso].filter(Boolean).join(" "),
        a.id,
      ),
    );
  }
  for (const n of data.announcements) {
    out.push(entry(`si:n:${n.id}`, n.courseId, "announcement", n.title, n.bodyText, n.id));
  }
  for (const p of data.discussionPosts ?? []) {
    out.push(
      entry(
        `si:d:${p.id}`,
        p.courseId,
        p.isAuthoritative ? "staff_discussion" : "discussion",
        p.subject,
        `${p.authorDisplayName} ${p.bodyText}`,
        p.id,
      ),
    );
  }
  for (const ci of data.contentItems ?? []) {
    out.push(
      entry(
        `si:c:${ci.id}`,
        ci.courseId,
        "content",
        ci.title,
        [ci.documentClass, ci.descriptionText, ci.bodyText].filter(Boolean).join(" "),
        ci.id,
      ),
    );
  }
  for (const lr of data.libraryResources ?? []) {
    out.push(
      entry(
        `si:lib:${lr.id}`,
        lr.courseId,
        "library",
        lr.filename,
        `${lr.documentClass} ${lr.moduleTitle ?? ""} ${lr.textContent}`,
        lr.id,
      ),
    );
  }
  for (const d of data.documents) {
    out.push(
      entry(
        `si:doc:${d.id}`,
        d.courseId,
        "outline",
        d.filename,
        d.textContent ?? "",
        d.id,
      ),
    );
  }
  for (const pol of data.policies) {
    out.push(entry(`si:pol:${pol.id}`, pol.courseId, "policy", pol.title, pol.body, pol.id));
  }
  for (const f of data.announcementFacts ?? []) {
    out.push(
      entry(
        `si:af:${f.id}`,
        f.courseId,
        "announcement_fact",
        f.kind,
        [f.detail, f.assessmentHint, f.dueLabel, f.location, f.snippet].filter(Boolean).join(" "),
        f.assessmentId,
      ),
    );
  }
  return out;
}

export function snippetFor(body: string, query: string, radius = 60): string {
  const q = query.toLowerCase().trim();
  if (!q || !body) return body.slice(0, 120);
  const idx = body.toLowerCase().indexOf(q.split(/\s+/)[0] ?? q);
  if (idx < 0) return body.slice(0, 120);
  const start = Math.max(0, idx - radius);
  const end = Math.min(body.length, idx + q.length + radius);
  return `${start > 0 ? "…" : ""}${body.slice(start, end).replace(/\s+/g, " ")}${end < body.length ? "…" : ""}`;
}
