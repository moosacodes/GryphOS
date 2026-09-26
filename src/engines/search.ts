/**
 * Fast local search across GryphOS entities. No network after sync.
 */
import type { AppData } from "@/domain/types";

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
  | "resource";

export interface SearchHit {
  id: string;
  kind: SearchKind;
  title: string;
  subtitle: string;
  courseCode: string | null;
  href: string;
  score: number;
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

export function searchLocal(data: AppData, query: string, limit = 40): SearchHit[] {
  const q = query.trim();
  if (q.length < 1) return [];
  const courses = new Map(data.courses.map((c) => [c.id, c]));
  const hits: SearchHit[] = [];

  for (const c of data.courses) {
    const s = scoreText(q, c.code, c.title, c.semester);
    if (s > 0) {
      hits.push({
        id: `c:${c.id}`,
        kind: "course",
        title: c.code,
        subtitle: c.title,
        courseCode: c.code,
        href: `/courses/${encodeURIComponent(c.id)}`,
        score: s + 5,
      });
    }
  }

  for (const a of data.assessments) {
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
        courseCode: course?.code ?? null,
        href: `/assessment/${encodeURIComponent(a.id)}`,
        score: s,
      });
    }
  }

  for (const n of data.announcements) {
    const course = courses.get(n.courseId);
    const s = scoreText(q, n.title, n.bodyText, course?.code);
    if (s > 0) {
      hits.push({
        id: `n:${n.id}`,
        kind: "announcement",
        title: n.title,
        subtitle: course?.code ?? "Announcement",
        courseCode: course?.code ?? null,
        href: `/courses/${encodeURIComponent(n.courseId)}`,
        score: s,
      });
    }
  }

  for (const item of data.contentItems ?? []) {
    const course = courses.get(item.courseId);
    const s = scoreText(q, item.title, item.documentClass, course?.code);
    if (s > 0) {
      hits.push({
        id: `ci:${item.id}`,
        kind: "content",
        title: item.title,
        subtitle: [course?.code, item.documentClass].filter(Boolean).join(" · "),
        courseCode: course?.code ?? null,
        href: item.url ?? `/courses/${encodeURIComponent(item.courseId)}`,
        score: s,
      });
    }
  }

  for (const d of data.documents) {
    const course = d.courseId ? courses.get(d.courseId) : undefined;
    const s = scoreText(q, d.filename, d.textContent?.slice(0, 500), course?.code);
    if (s > 0) {
      hits.push({
        id: `d:${d.id}`,
        kind: "document",
        title: d.filename,
        subtitle: course?.code ?? "Document",
        courseCode: course?.code ?? null,
        href: "/documents",
        score: s,
      });
    }
  }

  for (const p of data.policies) {
    const course = courses.get(p.courseId);
    const s = scoreText(q, p.title, p.body, p.kind, course?.code);
    if (s > 0) {
      hits.push({
        id: `p:${p.id}`,
        kind: "policy",
        title: p.title,
        subtitle: [course?.code, p.kind].filter(Boolean).join(" · "),
        courseCode: course?.code ?? null,
        href: `/courses/${encodeURIComponent(p.courseId)}`,
        score: s,
      });
    }
  }

  for (const person of data.people) {
    const course = person.courseId ? courses.get(person.courseId) : undefined;
    const s = scoreText(q, person.name, person.email, person.role, course?.code);
    if (s > 0) {
      hits.push({
        id: `pe:${person.id}`,
        kind: "person",
        title: person.name,
        subtitle: [person.role, course?.code, person.email].filter(Boolean).join(" · "),
        courseCode: course?.code ?? null,
        href: person.courseId ? `/courses/${encodeURIComponent(person.courseId)}` : "/courses",
        score: s,
      });
    }
  }

  for (const t of data.userTasks ?? []) {
    const course = t.courseId ? courses.get(t.courseId) : undefined;
    const s = scoreText(q, t.title, t.notes, course?.code);
    if (s > 0) {
      hits.push({
        id: `t:${t.id}`,
        kind: "task",
        title: t.title,
        subtitle: course?.code ?? "Personal task",
        courseCode: course?.code ?? null,
        href: "/tasks",
        score: s,
      });
    }
  }

  for (const r of data.resources) {
    const course = courses.get(r.courseId);
    const s = scoreText(q, r.title, r.purpose, r.notes, course?.code);
    if (s > 0) {
      hits.push({
        id: `r:${r.id}`,
        kind: "resource",
        title: r.title,
        subtitle: [course?.code, r.purpose].filter(Boolean).join(" · "),
        courseCode: course?.code ?? null,
        href: r.url ?? `/courses/${encodeURIComponent(r.courseId)}`,
        score: s,
      });
    }
  }

  return hits.sort((a, b) => b.score - a.score || a.title.localeCompare(b.title)).slice(0, limit);
}
