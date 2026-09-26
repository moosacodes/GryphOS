/**
 * Entity linking: auto-assemble assessment workspaces from local graph relations.
 */
import type { CourseContentItem, LibraryResource } from "@/domain/content";
import type { EntityLink, EntityLinkKind } from "@/domain/facts";
import { normalizeTitleKey } from "@/domain/ids";
import type {
  Announcement,
  AnnouncementFact,
  Assessment,
  CalendarEventItem,
  FeedbackRecord,
  GradeRecord,
} from "@/domain/types";

function scoreTitle(a: string, b: string): number {
  const ka = normalizeTitleKey(a);
  const kb = normalizeTitleKey(b);
  if (!ka || !kb) return 0;
  if (ka === kb) return 100;
  if (ka.includes(kb) || kb.includes(ka)) return 75;
  const ta = ka.split("-").filter((t) => t.length > 1);
  const tb = new Set(kb.split("-").filter((t) => t.length > 1));
  const hits = ta.filter((t) => tb.has(t)).length;
  if (hits === 0) return 0;
  return Math.min(70, 25 + hits * 15);
}

function link(
  fromId: string,
  toId: string,
  kind: EntityLinkKind,
  confidence: number,
): EntityLink {
  return {
    id: `elink:${kind}:${fromId}:${toId}`,
    fromId,
    toId,
    kind,
    evidenceFactIds: [],
    confidence,
    createdAt: new Date().toISOString(),
  };
}

export function buildEntityLinks(input: {
  assessments: Assessment[];
  contentItems: CourseContentItem[];
  library: LibraryResource[];
  announcements: Announcement[];
  announcementFacts: AnnouncementFact[];
  gradeRecords: GradeRecord[];
  feedback: FeedbackRecord[];
  calendarEvents: CalendarEventItem[];
}): EntityLink[] {
  const links: EntityLink[] = [];
  const seen = new Set<string>();
  const add = (l: EntityLink) => {
    if (seen.has(l.id)) return;
    seen.add(l.id);
    links.push(l);
  };

  for (const a of input.assessments) {
    // Content / specs
    for (const ci of input.contentItems) {
      if (ci.courseId !== a.courseId) continue;
      const s = scoreTitle(a.title, ci.title);
      const classHit =
        ci.documentClass === "assignment_specification" ||
        ci.documentClass === "lab_instructions" ||
        ci.documentClass === "grading_rubric" ||
        ci.documentClass === "starter_code_metadata" ||
        ci.documentClass === "assignment_spec" ||
        ci.documentClass === "lab_handout";
      if (s >= 50 || (classHit && s >= 30)) {
        if (
          ci.documentClass === "assignment_specification" ||
          ci.documentClass === "lab_instructions" ||
          ci.documentClass === "assignment_spec" ||
          ci.documentClass === "lab_handout"
        ) {
          add(link(a.id, ci.id, "HAS_SPEC", Math.max(s, 55) / 100));
        } else if (ci.documentClass === "grading_rubric" || ci.documentClass === "grading_scheme") {
          add(link(a.id, ci.id, "HAS_RUBRIC", Math.max(s, 50) / 100));
        } else if (ci.documentClass === "starter_code_metadata") {
          add(link(a.id, ci.id, "HAS_STARTER", Math.max(s, 50) / 100));
        } else {
          add(link(a.id, ci.id, "ASSOCIATED_WITH", s / 100));
        }
        add(link(ci.id, a.id, "BELONGS_TO_MODULE", 0.4));
      }
      if (ci.moduleId) add(link(ci.id, ci.moduleId, "CONTAINS", 0.9));
    }

    for (const lr of input.library) {
      if (lr.courseId !== a.courseId) continue;
      const s = scoreTitle(a.title, lr.filename + " " + (lr.moduleTitle ?? ""));
      if (s >= 45) {
        add(link(a.id, lr.id, "HAS_SPEC", s / 100));
        lr.assessmentId = a.id;
      }
    }

    // Announcement facts
    for (const f of input.announcementFacts) {
      if (f.courseId !== a.courseId) continue;
      if (f.assessmentId === a.id || (f.assessmentHint && scoreTitle(a.title, f.assessmentHint) >= 50)) {
        if (f.kind === "deadline_change" || f.kind === "extension") {
          add(link(f.announcementId, a.id, "CHANGES_DEADLINE_OF", f.confidence));
        } else {
          add(link(f.announcementId, a.id, "CLARIFIES", f.confidence));
        }
      }
    }

    for (const n of input.announcements) {
      if (n.courseId !== a.courseId) continue;
      if (scoreTitle(a.title, n.title + " " + n.bodyText.slice(0, 80)) >= 45) {
        add(link(n.id, a.id, "ABOUT", 0.5));
      }
    }

    // Grades / feedback / submissions
    for (const g of input.gradeRecords) {
      if (g.assessmentId === a.id) add(link(a.id, g.id, "GRADED_BY", 0.95));
    }
    for (const fb of input.feedback) {
      if (fb.assessmentId === a.id) add(link(a.id, fb.id, "HAS_FEEDBACK", 0.9));
    }
    if (a.submissionState === "submitted") {
      add(link(a.id, `submission:${a.id}`, "HAS_SUBMISSION", 0.9));
      add(link(a.id, a.id, "SUBMITS_TO", 0.85));
    }

    // Calendar
    for (const ev of input.calendarEvents) {
      if (ev.courseId !== a.courseId) continue;
      if (scoreTitle(a.title, ev.title) >= 50) {
        add(link(ev.id, a.id, "SCHEDULED_AS", 0.7));
        add(link(a.id, ev.id, "OCCURS_DURING", 0.65));
      }
    }

    // External tool
    if (/\bzybook|wiley|pearson|connect|crowdmark|gradescope\b/i.test(a.title + (a.notes ?? "") + (a.url ?? ""))) {
      add(link(a.id, `ext:${a.id}`, "USES_EXTERNAL_TOOL", 0.7));
    }
  }

  return links;
}

/** Linked workspace payload for an assessment. */
export function assessmentWorkspace(
  assessmentId: string,
  links: EntityLink[],
  data: {
    contentItems: CourseContentItem[];
    library: LibraryResource[];
    announcements: Announcement[];
    announcementFacts: AnnouncementFact[];
    feedback: FeedbackRecord[];
    gradeRecords: GradeRecord[];
  },
) {
  const related = links.filter((l) => l.fromId === assessmentId || l.toId === assessmentId);
  const ids = new Set(related.flatMap((l) => [l.fromId, l.toId]));
  return {
    links: related,
    specs: data.contentItems.filter((c) => ids.has(c.id)),
    library: data.library.filter((l) => ids.has(l.id) || l.assessmentId === assessmentId),
    announcements: data.announcements.filter((a) => ids.has(a.id)),
    facts: data.announcementFacts.filter((f) => f.assessmentId === assessmentId || ids.has(f.announcementId)),
    feedback: data.feedback.filter((f) => f.assessmentId === assessmentId),
    grades: data.gradeRecords.filter((g) => g.assessmentId === assessmentId),
  };
}
