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
  | "rule"
  | "location"
  | "instructor"
  | "content_module"
  | "document_class"
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
}

export type EntityLinkKind =
  | "SAME_AS"
  | "ABOUT"
  | "ASSOCIATED_WITH"
  | "SUBMITS_TO"
  | "GRADES"
  | "EXTENDS_DEADLINE_OF"
  | "CLARIFIES"
  | "BELONGS_TO_MODULE"
  | "INTRODUCED_DURING"
  | "SCHEDULED_AS"
  | "LINKS_TO_EXTERNAL_ACTIVITY"
  | "DERIVED_FROM";

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
