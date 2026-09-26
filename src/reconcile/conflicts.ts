import { conflictId } from "@/domain/ids";
import type { AcademicDateValue, Assessment, Conflict, SourceType } from "@/domain/types";

/** Field-specific authority: higher wins when values disagree. */
const DUE_PRIORITY: Record<SourceType, number> = {
  manual: 100,
  courselink_dropbox: 90,
  courselink_quiz: 90,
  courselink_calendar: 80,
  courselink_news: 75,
  courselink_grade: 50,
  course_outline: 60,
  courselink_content: 55,
  courselink_course: 40,
  uofg_academic_date: 45,
  uofg_catalogue: 30,
  ics: 55,
  user_task: 90,
  rule_engine: 50,
  external_activity: 40,
  courselink_discussion: 45,
};

const WEIGHT_PRIORITY: Record<SourceType, number> = {
  manual: 100,
  course_outline: 85,
  courselink_grade: 80,
  courselink_dropbox: 50,
  courselink_quiz: 50,
  courselink_calendar: 40,
  courselink_news: 40,
  courselink_content: 45,
  courselink_course: 20,
  uofg_academic_date: 10,
  uofg_catalogue: 10,
  ics: 55,
  user_task: 90,
  rule_engine: 50,
  external_activity: 40,
  courselink_discussion: 45,
};

function dueKey(d: AcademicDateValue): string {
  return `${d.certainty}|${d.iso ?? ""}|${d.label ?? ""}`;
}

export function resolveDueConflict(
  entityId: string,
  candidates: Array<{ sourceType: SourceType; value: AcademicDateValue; label: string }>,
): { value: AcademicDateValue; conflict: Conflict | null } {
  if (candidates.length <= 1) {
    return { value: candidates[0]?.value ?? { certainty: "unknown", iso: null, label: null }, conflict: null };
  }
  const unique = new Map<string, (typeof candidates)[0]>();
  for (const c of candidates) unique.set(dueKey(c.value), c);
  if (unique.size <= 1) return { value: candidates[0].value, conflict: null };

  const ranked = [...unique.values()].sort(
    (a, b) => (DUE_PRIORITY[b.sourceType] ?? 0) - (DUE_PRIORITY[a.sourceType] ?? 0),
  );
  const winner = ranked[0];
  const conflict: Conflict = {
    id: conflictId(entityId, "due"),
    entityId,
    entityKind: "assessment",
    field: "due",
    values: ranked.map((r) => ({
      sourceType: r.sourceType,
      value: r.value,
      label: r.label,
    })),
    resolvedValue: winner.value,
    resolutionRule: `Prefer ${winner.sourceType} for deadlines`,
    unresolved: true,
    createdAt: new Date().toISOString(),
  };
  return {
    value: { ...winner.value, certainty: "conflicting" },
    conflict,
  };
}

export function resolveWeightConflict(
  entityId: string,
  candidates: Array<{ sourceType: SourceType; value: number; label: string }>,
): { value: number | null; conflict: Conflict | null } {
  if (candidates.length === 0) return { value: null, conflict: null };
  const unique = new Map<number, (typeof candidates)[0]>();
  for (const c of candidates) unique.set(c.value, c);
  if (unique.size <= 1) return { value: candidates[0].value, conflict: null };

  const ranked = [...unique.values()].sort(
    (a, b) => (WEIGHT_PRIORITY[b.sourceType] ?? 0) - (WEIGHT_PRIORITY[a.sourceType] ?? 0),
  );
  const winner = ranked[0];
  const conflict: Conflict = {
    id: conflictId(entityId, "weightPercent"),
    entityId,
    entityKind: "assessment",
    field: "weightPercent",
    values: ranked.map((r) => ({ sourceType: r.sourceType, value: r.value, label: r.label })),
    resolvedValue: winner.value,
    resolutionRule: `Prefer ${winner.sourceType} for weights`,
    unresolved: true,
    createdAt: new Date().toISOString(),
  };
  return { value: winner.value, conflict };
}

export function applyManualOverrides(a: Assessment): Assessment {
  const o = a.manualOverrides;
  if (!o || Object.keys(o).length === 0) return a;
  const next = { ...a };
  if ("title" in o && typeof o.title === "string") next.title = o.title;
  if ("type" in o) next.type = o.type as Assessment["type"];
  if ("weightPercent" in o) next.weightPercent = o.weightPercent as number | null;
  if ("due" in o) next.due = o.due as Assessment["due"];
  return next;
}
