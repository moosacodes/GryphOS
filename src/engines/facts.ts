/** Field-level fact reconciliation with authority + temporal validity. */
import { authorityRank, type AuthorityClass } from "@/domain/authority";
import type { ExtractedFact, SourceArtifact, EntityLink } from "@/domain/facts";
import { syncContentHash } from "@/domain/facts";

export interface FieldResolution {
  field: string;
  entityId: string;
  value: unknown;
  winningFactId: string;
  authority: AuthorityClass;
  confidence: number;
  conflicted: boolean;
  candidates: ExtractedFact[];
}

export function reconcileFieldFacts(facts: ExtractedFact[], field: string, entityId: string): FieldResolution | null {
  const active = facts.filter(
    (f) => f.field === field && f.entityId === entityId && !f.supersededBy,
  );
  if (!active.length) return null;
  const sorted = [...active].sort((a, b) => {
    const ar = authorityRank(a.authority) - authorityRank(b.authority);
    if (ar !== 0) return -ar;
    if (a.confidence !== b.confidence) return b.confidence - a.confidence;
    return b.validFrom.localeCompare(a.validFrom);
  });
  const winner = sorted[0];
  const conflicted =
    sorted.length > 1 &&
    JSON.stringify(sorted[1].value) !== JSON.stringify(winner.value) &&
    authorityRank(sorted[1].authority) >= authorityRank(winner.authority) - 15;
  return {
    field,
    entityId,
    value: winner.value,
    winningFactId: winner.id,
    authority: winner.authority,
    confidence: winner.confidence,
    conflicted,
    candidates: sorted,
  };
}

/** Mark older facts superseded when a newer same-field fact arrives from >= authority. */
export function applySupersession(existing: ExtractedFact[], incoming: ExtractedFact): ExtractedFact[] {
  return existing.map((f) => {
    if (
      f.id !== incoming.id &&
      !f.supersededBy &&
      f.entityId === incoming.entityId &&
      f.field === incoming.field &&
      f.validFrom <= incoming.validFrom &&
      authorityRank(incoming.authority) >= authorityRank(f.authority)
    ) {
      return { ...f, supersededBy: incoming.id };
    }
    return f;
  });
}

export function detectArtifactChange(
  prev: SourceArtifact | null,
  nextText: string,
): { changed: boolean; newHash: string } {
  const newHash = syncContentHash(nextText);
  if (!prev) return { changed: true, newHash };
  return { changed: prev.contentHash !== newHash, newHash };
}

export function linkEntities(
  fromId: string,
  toId: string,
  kind: EntityLink["kind"],
  evidenceFactIds: string[],
  confidence: number,
): EntityLink {
  return {
    id: `link:${kind}:${fromId}:${toId}`,
    fromId,
    toId,
    kind,
    evidenceFactIds,
    confidence,
    createdAt: new Date().toISOString(),
  };
}

/** Staff vs student discussion: only staff posts become academic facts. */
export function isStaffDiscussionAuthor(role: string | null | undefined): boolean {
  if (!role) return false;
  const r = role.toLowerCase();
  return /instructor|professor|lecturer|ta\b|teaching assistant|staff|faculty/.test(r);
}
