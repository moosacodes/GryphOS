/** Per-course source coverage diagnostics — honest counts, never fake support. */
export type SourceCapabilityStatus =
  | "available"
  | "partial"
  | "unavailable"
  | "forbidden"
  | "not_checked"
  | "error";

export interface SourceCapability {
  key: string;
  label: string;
  status: SourceCapabilityStatus;
  discovered: number;
  ingested: number;
  detail: string;
  lastError: string | null;
  endpoint: string | null;
}

export interface CourseSourceCoverage {
  courseId: string;
  orgUnitId: number;
  updatedAt: string;
  capabilities: SourceCapability[];
}

export function emptyCapability(
  key: string,
  label: string,
  endpoint: string | null = null,
): SourceCapability {
  return {
    key,
    label,
    status: "not_checked",
    discovered: 0,
    ingested: 0,
    detail: "Not checked this sync",
    lastError: null,
    endpoint,
  };
}

export function summarizeCoverage(c: CourseSourceCoverage): string {
  const parts = c.capabilities
    .filter((x) => x.status !== "not_checked")
    .map((x) => `${x.key}:${x.status}(${x.ingested}/${x.discovered})`);
  return parts.join("; ") || "no sources checked";
}
