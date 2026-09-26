/**
 * Fast local search across GryphOS entities with snippets. No network after sync.
 */
import type { AppData } from "@/domain/types";
import { snippetFor } from "@/ingestion/searchIndex";

export type SearchKind =
  | "assessment"
  | "course"
  | "announcement"
  | "content"
  | "document"
  | "policy"
  | "person"
  | "task"
  | "discussion"
  | "resource"
  | "library"
  | "staff_discussion";

export interface SearchHit {
  id: string;
  kind: SearchKind;
  title: string;
  subtitle: string;
  snippet: string | null;
  courseCode: string | null;
  href: string;
  score: number;
  courseId: string | null;
}

function norm(s: string): string {
  return s.toLowerCase().replace(/\s+/g, " ").trim();
}

function scoreText(query: string, ...fields: Array<string | null | undefined>): number {
  const q = norm(query);
  if (!q) return 0;
  const tokens = q.split(" ").filter(Boolean);
  const hay = norm(fields.filter(Boolean).join(" · "));
  if (!hay) return 0;
  let score = 0;
  if (hay.includes(q)) score += 40;
  for (const t of tokens) {
    if (hay.startsWith(t)) score += 12;
    else if (hay.includes(t)) score += 8;
    else return 0;
  }
  return score;
}

export function searchLocal(
  data: AppData,
  query: string,
  limit = 40,
  courseIdFilter: string | null = null,
): SearchHit[] {
  const q = query.trim();
  if (q.length < 1) return [];
  const courses = new Map(data.courses.map((c) => [c.id, c]));
  const hits: SearchHit[] = [];

  const inCourse = (courseId: string | null | undefined) =>
    !courseIdFilter || courseId === courseIdFilter;

  // Prefer incremental search index when present
  if ((data.searchIndex ?? []).length > 0) {
    for (const e of data.searchIndex) {
      if (!inCourse(e.courseId)) continue;
      const s = scoreText(q, e.title, e.body, e.kind);
      if (s <= 0) continue;
      const course = e.courseId ? courses.get(e.courseId) : undefined;
      const href =
        e.kind === "assessment" && e.entityId
          ? `/assessment/${encodeURIComponent(e.entityId)}`
          : e.courseId
            ? `/courses/${encodeURIComponent(e.courseId)}`
            : "/search";
      hits.push({
        id: e.id,
        kind: (e.kind as SearchKind) || "content",
        title: e.title,
        subtitle: [course?.code, e.kind].filter(Boolean).join(" · "),
        snippet: snippetFor(e.body, q),
        courseCode: course?.code ?? null,
        href,
        score: s,
        courseId: e.courseId,
      });
    }
    return hits.sort((a, b) => b.score - a.score || a.title.localeCompare(b.title)).slice(0, limit);
  }

  for (const c of data.courses) {
    if (!inCourse(c.id)) continue;
    const s = scoreText(q, c.code, c.title, c.semester);
    if (s > 0) {
      hits.push({
        id: `c:${c.id}`,
        kind: "course",
        title: c.code,
        subtitle: c.title,
        snippet: null,
        courseCode: c.code,
        href: `/courses/${encodeURIComponent(c.id)}`,
        score: s + 5,
        courseId: c.id,
      });
    }
  }

  for (const a of data.assessments) {
    if (!inCourse(a.courseId)) continue;
    const course = courses.get(a.courseId);
    const s = scoreText(q, a.title, a.type, a.notes, course?.code, a.gradeDisplay);
    if (s > 0) {
      hits.push({
        id: `a:${a.id}`,
        kind: "assessment",
        title: a.title,
        subtitle: [course?.code, a.type, a.weightPercent != null ? `${a.weightPercent}%` : null]
          .filter(Boolean)
          .join(" · "),
        snippet: a.notes ? snippetFor(a.notes, q) : null,
        courseCode: course?.code ?? null,
        href: `/assessment/${encodeURIComponent(a.id)}`,
        score: s,
        courseId: a.courseId,
      });
    }
  }

  for (const n of data.announcements) {
    if (!inCourse(n.courseId)) continue;
    const course = courses.get(n.courseId);
    const s = scoreText(q, n.title, n.bodyText, course?.code);
    if (s > 0) {
      hits.push({
        id: `n:${n.id}`,
        kind: "announcement",
        title: n.title,
        subtitle: course?.code ?? "Announcement",
        snippet: snippetFor(n.bodyText, q),
        courseCode: course?.code ?? null,
        href: `/courses/${encodeURIComponent(n.courseId)}`,
        score: s,
        courseId: n.courseId,
      });
    }
  }

  for (const p of data.discussionPosts ?? []) {
    if (!inCourse(p.courseId)) continue;
    const course = courses.get(p.courseId);
    const s = scoreText(q, p.subject, p.bodyText, p.authorDisplayName, course?.code);
    if (s > 0) {
      hits.push({
        id: `dp:${p.id}`,
        kind: p.isAuthoritative ? "staff_discussion" : "discussion",
        title: p.subject,
        subtitle: [course?.code, p.authorRole, p.authorDisplayName].filter(Boolean).join(" · "),
        snippet: snippetFor(p.bodyText, q),
        courseCode: course?.code ?? null,
        href: `/courses/${encodeURIComponent(p.courseId)}`,
        score: s + (p.isAuthoritative ? 5 : 0),
        courseId: p.courseId,
      });
    }
  }

  for (const item of data.contentItems ?? []) {
    if (!inCourse(item.courseId)) continue;
    const course = courses.get(item.courseId);
    const s = scoreText(q, item.title, item.documentClass, item.bodyText, course?.code);
    if (s > 0) {
      hits.push({
        id: `ci:${item.id}`,
        kind: "content",
        title: item.title,
        subtitle: [course?.code, item.documentClass].filter(Boolean).join(" · "),
        snippet: item.bodyText ? snippetFor(item.bodyText, q) : null,
        courseCode: course?.code ?? null,
        href: item.url ?? `/courses/${encodeURIComponent(item.courseId)}`,
        score: s,
        courseId: item.courseId,
      });
    }
  }

  for (const lr of data.libraryResources ?? []) {
    if (!inCourse(lr.courseId)) continue;
    const course = courses.get(lr.courseId);
    const s = scoreText(q, lr.filename, lr.textContent, lr.documentClass, course?.code);
    if (s > 0) {
      hits.push({
        id: `lib:${lr.id}`,
        kind: "library",
        title: lr.filename,
        subtitle: [course?.code, lr.documentClass].filter(Boolean).join(" · "),
        snippet: snippetFor(lr.textContent, q),
        courseCode: course?.code ?? null,
        href: `/courses/${encodeURIComponent(lr.courseId)}`,
        score: s,
        courseId: lr.courseId,
      });
    }
  }

  for (const d of data.documents) {
    if (!inCourse(d.courseId)) continue;
    const course = d.courseId ? courses.get(d.courseId) : undefined;
    const s = scoreText(q, d.filename, d.textContent?.slice(0, 2000), course?.code);
    if (s > 0) {
      hits.push({
        id: `d:${d.id}`,
        kind: "document",
        title: d.filename,
        subtitle: course?.code ?? "Document",
        snippet: d.textContent ? snippetFor(d.textContent, q) : null,
        courseCode: course?.code ?? null,
        href: "/documents",
        score: s,
        courseId: d.courseId,
      });
    }
  }

  for (const pol of data.policies) {
    if (!inCourse(pol.courseId)) continue;
    const course = courses.get(pol.courseId);
    const s = scoreText(q, pol.title, pol.body, pol.kind, course?.code);
    if (s > 0) {
      hits.push({
        id: `p:${pol.id}`,
        kind: "policy",
        title: pol.title,
        subtitle: [course?.code, pol.kind].filter(Boolean).join(" · "),
        snippet: snippetFor(pol.body, q),
        courseCode: course?.code ?? null,
        href: `/courses/${encodeURIComponent(pol.courseId)}`,
        score: s,
        courseId: pol.courseId,
      });
    }
  }

  return hits.sort((a, b) => b.score - a.score || a.title.localeCompare(b.title)).slice(0, limit);
}
