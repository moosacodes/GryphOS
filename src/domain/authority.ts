/** Authority classes for fact reconciliation (higher = more authoritative). */
export type AuthorityClass =
  | "REGISTRAR_OFFICIAL"
  | "COURSELINK_TOOL_EXACT"
  | "INSTRUCTOR_ANNOUNCEMENT"
  | "COURSE_OUTLINE"
  | "COURSELINK_CONTENT"
  | "STAFF_DISCUSSION"
  | "USER_MANUAL"
  | "DERIVED_RULE"
  | "STUDENT_DISCUSSION"
  | "EXTERNAL_UNVERIFIED";

const RANK: Record<AuthorityClass, number> = {
  REGISTRAR_OFFICIAL: 100,
  COURSELINK_TOOL_EXACT: 90,
  USER_MANUAL: 85,
  INSTRUCTOR_ANNOUNCEMENT: 75,
  STAFF_DISCUSSION: 70,
  COURSE_OUTLINE: 60,
  COURSELINK_CONTENT: 50,
  DERIVED_RULE: 40,
  STUDENT_DISCUSSION: 20,
  EXTERNAL_UNVERIFIED: 10,
};

export function authorityRank(a: AuthorityClass): number {
  return RANK[a] ?? 0;
}

export type DeadlineSafety =
  | "EXACT_AUTHORITATIVE"
  | "EXACT_SOURCE_CONFLICT"
  | "EXACT_USER_OVERRIDE"
  | "DERIVED"
  | "APPROXIMATE"
  | "DATE_RANGE"
  | "TBD"
  | "UNKNOWN";
