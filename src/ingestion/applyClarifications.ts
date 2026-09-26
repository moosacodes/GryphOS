/**
 * Apply staff clarifications / announcement facts onto assessments (reconcile or conflict).
 */
import { exactDate } from "@/domain/dates";
import type { AnnouncementFact, Assessment, Conflict } from "@/domain/types";
import type { ExtractedFact } from "@/domain/facts";

export function applyDeadlineFacts(
  assessments: Assessment[],
  facts: AnnouncementFact[],
  staffFacts: ExtractedFact[],
): { assessments: Assessment[]; conflicts: Conflict[] } {
  const conflicts: Conflict[] = [];
  const byId = new Map(assessments.map((a) => [a.id, { ...a }]));

  const apply = (
    assessmentId: string | null,
    dueIso: string | null,
    dueLabel: string | null,
    sourceLabel: string,
    confidence: number,
  ) => {
    if (!assessmentId || (!dueIso && !dueLabel)) return;
    const a = byId.get(assessmentId);
    if (!a) return;
    const nextDue = dueIso
      ? exactDate(dueIso)
      : { certainty: "approximate" as const, iso: null, label: dueLabel };
    const prev = a.due.iso;
    if (prev && dueIso && prev.slice(0, 10) !== dueIso.slice(0, 10)) {
      if (confidence >= 0.7) {
        const conflict: Conflict = {
          id: `conflict:due:${assessmentId}:${Date.now()}`,
          entityId: assessmentId,
          entityKind: "assessment",
          field: "due",
          values: [
            { sourceType: "courselink_dropbox", value: a.due, label: String(prev) },
            { sourceType: "courselink_news", value: nextDue, label: String(dueIso) },
          ],
          resolvedValue: nextDue,
          resolutionRule: `${sourceLabel} deadline clarification (confidence ${confidence})`,
          unresolved: confidence < 0.85,
          createdAt: new Date().toISOString(),
        };
        conflicts.push(conflict);
        a.due = nextDue;
        a.conflictIds = [...a.conflictIds, conflict.id];
        a.fieldProvenance = {
          ...a.fieldProvenance,
          due: {
            value: nextDue,
            sourceType: "courselink_news",
            sourceId: sourceLabel,
            confidence,
            retrievedAt: new Date().toISOString(),
          },
        };
        a.updatedAt = new Date().toISOString();
      } else {
        conflicts.push({
          id: `conflict:due-review:${assessmentId}:${Date.now()}`,
          entityId: assessmentId,
          entityKind: "assessment",
          field: "due",
          values: [
            { sourceType: "courselink_dropbox", value: a.due, label: String(prev) },
            { sourceType: "courselink_discussion", value: nextDue, label: dueLabel ?? dueIso ?? "" },
          ],
          resolvedValue: a.due,
          resolutionRule: "Low-confidence clarification — needs review",
          unresolved: true,
          createdAt: new Date().toISOString(),
        });
      }
    } else if (!prev && (dueIso || dueLabel)) {
      a.due = nextDue;
      a.updatedAt = new Date().toISOString();
    }
    byId.set(assessmentId, a);
  };

  for (const f of facts) {
    if (f.kind !== "deadline_change" && f.kind !== "extension") continue;
    apply(f.assessmentId, f.dueIso, f.dueLabel, f.announcementId, f.confidence);
  }
  for (const sf of staffFacts) {
    if (sf.factType !== "staff_clarification") continue;
    const val = sf.value as { kind?: string; dueIso?: string | null; dueLabel?: string | null };
    if (val?.kind !== "deadline_change" && val?.kind !== "extension") continue;
    apply(sf.entityId, val.dueIso ?? null, val.dueLabel ?? null, sf.artifactId, sf.confidence);
  }

  return { assessments: [...byId.values()], conflicts };
}
