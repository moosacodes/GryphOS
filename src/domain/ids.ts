/** Stable deterministic IDs for canonical entities. */
export function assessmentId(courseId: string, kind: string, sourceKey: string): string {
  return `${kind}:${courseId}:${sourceKey}`;
}

export function courseIdFromOrgUnit(orgUnitId: string | number): string {
  return `course:${orgUnitId}`;
}

export function sourceRecordId(sourceType: string, sourceKey: string, field?: string): string {
  return field ? `src:${sourceType}:${sourceKey}:${field}` : `src:${sourceType}:${sourceKey}`;
}

export function conflictId(entityId: string, field: string): string {
  return `conflict:${entityId}:${field}`;
}

export function normalizeTitleKey(title: string): string {
  return title
    .toLowerCase()
    .replace(/\bassign(?:ment)?s?\b/g, "assignment")
    .replace(/\bhw\b|\bhomework\b/g, "assignment")
    .replace(/\ba\s*#?\s*(\d+)\b/g, "assignment $1")
    .replace(/\bq\s*#?\s*(\d+)\b/g, "quiz $1")
    .replace(/#\s*(\d+)\b/g, "$1")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
