/** SourceArtifact + ExtractedFact + entity linking + temporal validity. */
import type { AuthorityClass } from "./authority";
import type { SourceType } from "./types";

export type FactType =
  | "deadline"
  | "weight"
  | "title"
  | "section"
  | "schedule"
  | "grade"
  | "announcement_deadline_change"
  | "announcement_clarification"
  | "announcement_extension"
  | "announcement_cancel"
  | "announcement_location"
  | "announcement_exam"
  | "announcement_grade_release"
  | "announcement_resource"
  | "staff_clarification"
  | "rule"
  | "location"
  | "instructor"
  | "content_module"
  | "document_class"
  | "feedback"
  | "submission"
  | "other";

export interface SourceArtifact {
  id: string;
  sourceType: SourceType;
  /** Stable external id (orgUnit, dropbox id, URL, ICS UID, …) */
  externalId: string;
  courseId: string | null;
  retrievedAt: string;
  contentHash: string;
  mimeType: string | null;
  title: string | null;
  /** Retained raw/text snapshot (bounded) */
  textSnapshot: string | null;
  url: string | null;
}

export interface ExtractedFact {
  id: string;
  artifactId: string;
  courseId: string | null;
  entityId: string | null;
  field: string;
  factType: FactType;
  value: unknown;
  label: string;
  authority: AuthorityClass;
  confidence: number;
  validFrom: string;
  /** Set when a newer fact supersedes this one */
  supersededBy: string | null;
  retrievedAt: string;
  snippet: string | null;
  /** Structured academic change metadata */
  property?: string | null;
  previousValue?: unknown;
  newValue?: unknown;
  authorRole?: string | null;
}

export type EntityLinkKind =
  | "SAME_AS"
  | "ABOUT"
  | "ASSOCIATED_WITH"
  | "HAS_SPEC"
  | "SUBMITS_TO"
  | "GRADED_BY"
  | "CHANGES_DEADLINE_OF"
  | "CLARIFIES"
  | "CONTAINS"
  | "OCCURS_DURING"
  | "USES_EXTERNAL_TOOL"
  | "EXTENDS_DEADLINE_OF"
  | "BELONGS_TO_MODULE"
  | "INTRODUCED_DURING"
  | "SCHEDULED_AS"
  | "LINKS_TO_EXTERNAL_ACTIVITY"
  | "DERIVED_FROM"
  | "HAS_FEEDBACK"
  | "HAS_SUBMISSION"
  | "HAS_RUBRIC"
  | "HAS_STARTER";

export interface EntityLink {
  id: string;
  fromId: string;
  toId: string;
  kind: EntityLinkKind;
  evidenceFactIds: string[];
  confidence: number;
  createdAt: string;
}

export type WorkCalcState = "counted" | "dropped" | "excluded" | "pending" | "provisional_drop";

export interface CalculationState {
  assessmentId: string;
  workCalc: WorkCalcState;
  /** official | provisional | projection */
  dropMode: "official" | "provisional" | "projection" | "none";
  reason: string | null;
}

export async function sha256Hex(text: string): Promise<string> {
  if (typeof crypto !== "undefined" && crypto.subtle) {
    const data = new TextEncoder().encode(text);
    const buf = await crypto.subtle.digest("SHA-256", data);
    return Array.from(new Uint8Array(buf))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  }
  // Fallback sync hash for Node/test (FNV-1a 32 + length) — not crypto-grade
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return `fnv_${(h >>> 0).toString(16)}_${text.length}`;
}

export function syncContentHash(text: string): string {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return `fnv_${(h >>> 0).toString(16)}_${text.length}`;
}

/** Tiny line-oriented diff for change events (practical, not a full Myers pack). */
export function simpleTextDiff(prev: string, next: string, maxLines = 12): string {
  const a = prev.split(/\r?\n/);
  const b = next.split(/\r?\n/);
  const out: string[] = [];
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n && out.length < maxLines; i++) {
    if (a[i] === b[i]) continue;
    if (a[i] != null && b[i] == null) out.push(`- ${a[i].slice(0, 120)}`);
    else if (a[i] == null && b[i] != null) out.push(`+ ${b[i].slice(0, 120)}`);
    else {
      out.push(`- ${(a[i] ?? "").slice(0, 120)}`);
      out.push(`+ ${(b[i] ?? "").slice(0, 120)}`);
    }
  }
  return out.join("\n");
}
