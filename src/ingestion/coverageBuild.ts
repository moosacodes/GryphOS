/**
 * Build honest per-course source coverage diagnostics.
 */
import { emptyCapability, type CourseSourceCoverage, type SourceCapability } from "@/domain/coverage";

export interface CoverageInput {
  courseId: string;
  orgUnitId: number;
  dropbox: { discovered: number; ingested: number; error?: string | null };
  quizzes: { discovered: number; ingested: number; attemptsDiscovered: number; attemptsIngested: number; error?: string | null };
  grades: { objects: number; values: number; categories: number; unmatched: number; error?: string | null };
  news: { discovered: number; ingested: number; facts: number; error?: string | null };
  calendar: { discovered: number; ingested: number; error?: string | null };
  content: { modules: number; topics: number; filesDownloaded: number; error?: string | null };
  discussions: {
    forums: number;
    topics: number;
    posts: number;
    postsUnavailable: boolean;
    error?: string | null;
  };
  feedback: { ingested: number; error?: string | null };
  checklists: { discovered: number; error?: string | null };
  groups: { discovered: number; error?: string | null };
}

function cap(
  key: string,
  label: string,
  endpoint: string,
  discovered: number,
  ingested: number,
  opts?: { unavailable?: boolean; forbidden?: boolean; error?: string | null; detail?: string },
): SourceCapability {
  const base = emptyCapability(key, label, endpoint);
  if (opts?.forbidden) {
    return { ...base, status: "forbidden", discovered, ingested, detail: opts.detail ?? "403 Forbidden", lastError: opts.error ?? null };
  }
  if (opts?.unavailable) {
    return {
      ...base,
      status: "unavailable",
      discovered,
      ingested,
      detail: opts.detail ?? "Endpoint missing or empty",
      lastError: opts.error ?? null,
    };
  }
  if (opts?.error) {
    return { ...base, status: "error", discovered, ingested, detail: opts.error, lastError: opts.error };
  }
  if (discovered > 0 && ingested === 0) {
    return {
      ...base,
      status: "partial",
      discovered,
      ingested,
      detail: opts?.detail ?? "Discovered but not fully ingested",
      lastError: null,
    };
  }
  if (discovered > 0 && ingested < discovered) {
    return {
      ...base,
      status: "partial",
      discovered,
      ingested,
      detail: opts?.detail ?? `Ingested ${ingested} of ${discovered}`,
      lastError: null,
    };
  }
  if (discovered === 0 && ingested === 0) {
    return {
      ...base,
      status: "unavailable",
      discovered: 0,
      ingested: 0,
      detail: opts?.detail ?? "None found (or tool unused)",
      lastError: null,
    };
  }
  return {
    ...base,
    status: "available",
    discovered,
    ingested,
    detail: opts?.detail ?? `OK (${ingested})`,
    lastError: null,
  };
}

export function buildCourseCoverage(input: CoverageInput): CourseSourceCoverage {
  const capabilities: SourceCapability[] = [
    cap("dropbox", "Dropbox / Assignments", "/dropbox/folders/", input.dropbox.discovered, input.dropbox.ingested, {
      error: input.dropbox.error,
    }),
    cap("quizzes", "Quizzes", "/quizzes/", input.quizzes.discovered, input.quizzes.ingested, {
      error: input.quizzes.error,
    }),
    cap(
      "quiz_attempts",
      "Quiz attempts",
      "/quizzes/{id}/attempts/",
      input.quizzes.attemptsDiscovered,
      input.quizzes.attemptsIngested,
      {
        detail:
          input.quizzes.attemptsDiscovered === 0 && input.quizzes.discovered > 0
            ? "Quizzes present; attempts unavailable or empty for this session"
            : undefined,
        error: input.quizzes.error,
      },
    ),
    cap("grades", "Grade objects", "/grades/", input.grades.objects, input.grades.values, {
      detail: input.grades.unmatched
        ? `${input.grades.unmatched} unmatched grade items`
        : undefined,
      error: input.grades.error,
    }),
    cap("grade_categories", "Grade categories", "/grades/categories/", input.grades.categories, input.grades.categories, {
      error: input.grades.error,
    }),
    cap("news", "Announcements / News", "/news/", input.news.discovered, input.news.ingested, {
      detail: `${input.news.facts} structured facts extracted`,
      error: input.news.error,
    }),
    cap("calendar", "Calendar events", "/calendar/events/", input.calendar.discovered, input.calendar.ingested, {
      error: input.calendar.error,
    }),
    cap("content", "Content modules/topics", "/content/toc", input.content.topics, input.content.topics, {
      detail: `${input.content.modules} modules; ${input.content.filesDownloaded} files downloaded`,
      error: input.content.error,
    }),
    cap(
      "discussions",
      "Discussion forums/topics/posts",
      "/discussions/forums/.../posts/",
      input.discussions.forums,
      input.discussions.posts,
      {
        detail: input.discussions.postsUnavailable
          ? `Forums discovered (${input.discussions.forums}), topics ${input.discussions.topics}, posts unavailable`
          : `${input.discussions.topics} topics, ${input.discussions.posts} posts`,
        error: input.discussions.error,
      },
    ),
    cap("feedback", "Dropbox feedback", "/dropbox/folders/{id}/feedback/...", input.feedback.ingested, input.feedback.ingested, {
      error: input.feedback.error,
      detail: input.feedback.ingested === 0 ? "No feedback returned for this session" : undefined,
    }),
    cap("checklists", "Checklists", "/checklists/", input.checklists.discovered, input.checklists.discovered, {
      error: input.checklists.error,
    }),
    cap("groups", "Groups / sections", "/groupcategories/", input.groups.discovered, input.groups.discovered, {
      error: input.groups.error,
      detail: "Often LP-scoped; may 404 with LE version",
    }),
  ];

  return {
    courseId: input.courseId,
    orgUnitId: input.orgUnitId,
    updatedAt: new Date().toISOString(),
    capabilities,
  };
}
