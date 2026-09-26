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
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
