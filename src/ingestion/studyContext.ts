/**
 * Study context aggregation (no LLM) — week materials + upcoming assessment.
 */
import type { AppData, Assessment } from "@/domain/types";
import type { CourseContentItem, LibraryResource } from "@/domain/content";

export interface StudyContext {
  courseId: string;
  weekLabel: string | null;
  upcoming: Assessment | null;
  materials: CourseContentItem[];
  library: LibraryResource[];
  announcements: Array<{ id: string; title: string }>;
  staffNotes: Array<{ id: string; subject: string; snippet: string }>;
}

export function buildStudyContext(
  data: AppData,
  courseId: string,
  now = Date.now(),
): StudyContext {
  const upcoming =
    data.assessments
      .filter((a) => a.courseId === courseId && a.due.iso && Date.parse(a.due.iso) >= now)
      .filter((a) => a.submissionState !== "submitted" && !a.state?.missed)
      .sort((a, b) => Date.parse(a.due.iso!) - Date.parse(b.due.iso!))[0] ?? null;

  let weekLabel: string | null = null;
  if (upcoming) {
    const m = upcoming.title.match(/\bweek\s*(\d{1,2})\b/i);
    weekLabel = m ? `Week ${m[1]}` : null;
  }

  const materials = (data.contentItems ?? []).filter((ci) => {
    if (ci.courseId !== courseId) return false;
    if (weekLabel && new RegExp(weekLabel.replace(" ", "\\s*"), "i").test(ci.title)) return true;
    if (upcoming && ci.title.toLowerCase().includes(upcoming.title.toLowerCase().slice(0, 10)))
      return true;
    const mod = (data.contentModules ?? []).find((m) => m.id === ci.moduleId);
    if (weekLabel && mod && new RegExp(weekLabel.replace(" ", "\\s*"), "i").test(mod.title)) return true;
    return false;
  });

  const materialIds = new Set(materials.map((m) => m.id));
  const library = (data.libraryResources ?? []).filter(
    (l) =>
      l.courseId === courseId &&
      (materialIds.has(l.contentItemId ?? "") ||
        (weekLabel && l.weekHint && l.weekHint.toLowerCase() === weekLabel.toLowerCase()) ||
        (upcoming && l.assessmentId === upcoming.id)),
  );

  const announcements = data.announcements
    .filter((n) => n.courseId === courseId)
    .slice(0, 8)
    .map((n) => ({ id: n.id, title: n.title }));

  const staffNotes = (data.discussionPosts ?? [])
    .filter((p) => p.courseId === courseId && p.isAuthoritative && !p.isDeleted)
    .slice(0, 8)
    .map((p) => ({
      id: p.id,
      subject: p.subject,
      snippet: p.bodyText.slice(0, 160),
    }));

  return { courseId, weekLabel, upcoming, materials, library, announcements, staffNotes };
}
