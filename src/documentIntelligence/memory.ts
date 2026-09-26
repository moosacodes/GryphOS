/**
 * Document Memory — track outline revisions by semantic change, not metadata noise.
 */
import type { CourseBlueprint, DocumentMemoryEntry } from "./types";

function simpleHash(s: string): string {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16);
}

/** Semantic fingerprint: assessments + weights + relative rules (ignore headers/page noise). */
export function semanticFingerprint(bp: CourseBlueprint): string {
  const parts = [
    bp.courseCode ?? "",
    bp.term ?? "",
    ...bp.instances.map(
      (i) =>
        `${i.title}|${i.weightPercent ?? ""}|${i.due.kind}|${i.due.label ?? ""}|${i.due.iso ?? ""}`,
    ),
    ...bp.categories.map(
      (c) => `${c.name}|${c.weightPercent ?? ""}|best${c.bestN ?? ""}|drop${c.dropLowest}`,
    ),
    ...bp.relativeDeadlines.map((r) => `${r.offsetDays}|${r.anchorKind}|${r.assessmentTitleHint}`),
  ];
  return simpleHash(parts.join("::"));
}

export function rememberDocument(input: {
  courseId: string | null;
  documentId: string;
  filename: string;
  contentHash: string;
  blueprint: CourseBlueprint;
  previous: DocumentMemoryEntry | null;
}): DocumentMemoryEntry {
  const semanticHash = semanticFingerprint(input.blueprint);
  let changeKind: DocumentMemoryEntry["changeKind"] = "initial";
  let revisionOf: string | null = null;
  if (input.previous) {
    revisionOf = input.previous.id;
    if (input.previous.semanticHash === semanticHash) {
      changeKind =
        input.previous.contentHash === input.contentHash ? "reparse" : "metadata_only";
    } else {
      changeKind = "semantic";
    }
  }
  return {
    id: `docmem:${input.documentId}:${Date.now()}`,
    courseId: input.courseId,
    documentId: input.documentId,
    filename: input.filename,
    contentHash: input.contentHash,
    semanticHash,
    blueprintId: input.blueprint.id,
    qualityScore: input.blueprint.quality.score,
    retrievedAt: new Date().toISOString(),
    revisionOf,
    changeKind,
    notes:
      changeKind === "metadata_only"
        ? "Content hash changed but academic semantics unchanged"
        : changeKind === "semantic"
          ? "Semantic change in assessments/weights/deadlines"
          : null,
  };
}

export function shouldRebuildFromRevision(entry: DocumentMemoryEntry): boolean {
  return entry.changeKind === "initial" || entry.changeKind === "semantic";
}
