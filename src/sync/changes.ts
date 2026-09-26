/**
 * Change detection — compare previous vs next assessment snapshots.
 */
import type { Assessment, ChangeEvent } from "@/domain/types";

export function detectAssessmentChanges(
  before: Assessment[],
  after: Assessment[],
  now = new Date().toISOString(),
): ChangeEvent[] {
  const prev = new Map(before.map((a) => [a.id, a]));
  const next = new Map(after.map((a) => [a.id, a]));
  const out: ChangeEvent[] = [];

  for (const [id, a] of next) {
    const b = prev.get(id);
    if (!b) {
      out.push({
        id: `chg:new:${id}:${now}`,
        courseId: a.courseId,
        entityId: id,
        kind: "new_assessment",
        title: `New: ${a.title}`,
        detail: "Discovered during sync",
        createdAt: now,
        read: false,
        evidenceIds: [],
      });
      continue;
    }
    if ((b.due.iso ?? "") !== (a.due.iso ?? "") || (b.due.label ?? "") !== (a.due.label ?? "")) {
      out.push({
        id: `chg:due:${id}:${now}`,
        courseId: a.courseId,
        entityId: id,
        kind: "deadline_changed",
        title: `Deadline changed: ${a.title}`,
        detail: `${b.due.iso ?? b.due.label ?? "?"} → ${a.due.iso ?? a.due.label ?? "?"}`,
        createdAt: now,
        read: false,
        evidenceIds: [],
      });
    }
    if (b.weightPercent !== a.weightPercent) {
      out.push({
        id: `chg:wt:${id}:${now}`,
        courseId: a.courseId,
        entityId: id,
        kind: "weight_changed",
        title: `Weight changed: ${a.title}`,
        detail: `${b.weightPercent ?? "?"} → ${a.weightPercent ?? "?"}`,
        createdAt: now,
        read: false,
        evidenceIds: [],
      });
    }
    if (
      (b.pointsEarned == null && a.pointsEarned != null) ||
      (!b.gradeDisplay && a.gradeDisplay)
    ) {
      out.push({
        id: `chg:gr:${id}:${now}`,
        courseId: a.courseId,
        entityId: id,
        kind: "grade_posted",
        title: `Grade posted: ${a.title}`,
        detail: a.gradeDisplay ?? `${a.pointsEarned}/${a.pointsPossible}`,
        createdAt: now,
        read: false,
        evidenceIds: [],
      });
    }
  }

  for (const [id, b] of prev) {
    if (!next.has(id) && !id.startsWith("outline:")) {
      out.push({
        id: `chg:rm:${id}:${now}`,
        courseId: b.courseId,
        entityId: id,
        kind: "removed_assessment",
        title: `Removed: ${b.title}`,
        detail: "No longer present after sync (may be hidden)",
        createdAt: now,
        read: false,
        evidenceIds: [],
      });
    }
  }

  return out;
}
