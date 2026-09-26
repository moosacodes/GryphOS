/**
 * Merge a parsed outline / CourseBlueprint into app data for one course.
 * CourseLink live items reconcile into ONE canonical assessment later.
 */
import type {
  AppData,
  Assessment,
  CoursePolicy,
  GradeCategory,
  ImportedDocument,
  Person,
  Resource,
} from "@/domain/types";
import { DEFAULT_ITEM_STATE } from "@/domain/types";
import { rulesFromOutlineHints } from "@/engines/rules";
import { reconcileAssessments } from "@/reconcile/merge";
import type { CourseBlueprint, DocumentMemoryEntry } from "@/documentIntelligence/types";
import { materialLinksFromBlueprint } from "@/documentIntelligence/materialLinks";
import { shouldRebuildFromRevision } from "@/documentIntelligence/memory";

export function applyOutlineDocument(
  data: AppData,
  courseId: string,
  doc: ImportedDocument,
  opts: {
    preferExistingManual?: boolean;
    blueprint?: CourseBlueprint | null;
    memory?: DocumentMemoryEntry | null;
  } = {},
): AppData {
  const result = doc.parseResult;
  if (!result) return data;

  const existingManual = data.documents.find(
    (d) => d.courseId === courseId && !d.id.startsWith("auto:") && !!d.parseResult,
  );
  if (opts.preferExistingManual && existingManual && doc.id.startsWith("auto:")) {
    const documents = [
      ...data.documents.filter((d) => !(d.courseId === courseId && d.id.startsWith("auto:"))),
      doc,
      existingManual,
    ].filter((d, i, arr) => arr.findIndex((x) => x.id === d.id) === i);

    let next: AppData = { ...data, documents };
    if (opts.blueprint) {
      next = {
        ...next,
        courseBlueprints: [
          ...(next.courseBlueprints ?? []).filter((b) => b.courseId !== courseId),
          { ...opts.blueprint, courseId },
        ],
      };
    }
    if (opts.memory) {
      next = {
        ...next,
        documentMemories: [
          ...(next.documentMemories ?? []).filter((m) => m.documentId !== (opts.memory?.documentId ?? "")),
          ...(opts.memory ? [opts.memory] : []),
        ],
      };
    }
    return next;
  }

  // Skip semantic rebuild if memory says metadata-only
  if (opts.memory && !shouldRebuildFromRevision(opts.memory) && opts.memory.changeKind === "metadata_only") {
    const documents = [
      ...data.documents.filter(
        (d) => !(d.courseId === courseId && (d.id.startsWith("auto:") || d.id === doc.id)),
      ),
      doc,
    ];
    return {
      ...data,
      documents,
      documentMemories: [
        ...(data.documentMemories ?? []).filter((m) => m.documentId !== opts.memory!.documentId),
        opts.memory,
      ],
      courses: data.courses.map((c) =>
        c.id === courseId
          ? {
              ...c,
              outlineDocumentId: doc.id,
              outlineStatusDetail: `Outline unchanged semantically (${opts.memory?.notes ?? "metadata only"})`,
            }
          : c,
      ),
    };
  }

  const bp = opts.blueprint;
  const courses = data.courses.map((c) =>
    c.id === courseId
      ? {
          ...c,
          outlineDocumentId: doc.id,
          outlineStatus:
            result.assessments.length > 0 || result.confidence >= 0.45
              ? ("parsed" as const)
              : ("found" as const),
          outlineStatusDetail:
            result.assessments.length > 0
              ? `Outline understood (${result.assessments.length} assessments` +
                (bp ? `, quality=${bp.quality.score.toFixed(2)}` : "") +
                (result.extractionIncomplete ? ", incomplete" : "") +
                ")"
              : "Outline document applied",
          instructorNames:
            result.instructors.length > 0
              ? result.instructors.map((i) => i.name)
              : c.instructorNames,
        }
      : c,
  );

  const people: Person[] = [
    ...data.people.filter((p) => p.courseId !== courseId),
    ...result.instructors.map(
      (i, idx): Person => ({
        id: `person:${courseId}:inst:${idx}`,
        name: i.name,
        email: i.email,
        role: "instructor",
        aliases: [],
        courseId,
      }),
    ),
    ...result.tas.map(
      (t, idx): Person => ({
        id: `person:${courseId}:ta:${idx}`,
        name: t.name,
        email: t.email,
        role: "ta",
        aliases: [],
        courseId,
      }),
    ),
  ];

  const outlineAssessments: Assessment[] = result.assessments.map((oa, i) => {
    const citeBits = [
      oa.sourcePage != null ? `p.${oa.sourcePage}` : null,
      oa.sourceSnippet,
    ].filter(Boolean);
    return {
      id: `outline:${courseId}:${i}:${oa.title.toLowerCase().replace(/\s+/g, "-")}`,
      courseId,
      title: oa.title,
      type: oa.type,
      due: { certainty: oa.certainty, iso: oa.dueIso, label: oa.dueLabel },
      start: { certainty: "unknown" as const, iso: null, label: null },
      end: { certainty: "unknown" as const, iso: null, label: null },
      weightPercent: oa.weightPercent,
      pointsPossible: null,
      pointsEarned: null,
      submissionState: "unknown" as const,
      submittedAt: null,
      gradeDisplay: null,
      url: null,
      notes: citeBits.length ? citeBits.join(" — ") : oa.sourceSnippet ?? null,
      categoryId: oa.category ? `gcat:${courseId}:${oa.category}` : null,
      isBonus: false,
      attemptNumber: oa.instanceIndex ?? null,
      state: { ...DEFAULT_ITEM_STATE },
      sourceRecords: [],
      fieldProvenance: {
        weightPercent: {
          value: oa.weightPercent,
          sourceType: "course_outline",
          sourceId: doc.id,
          confidence: oa.confidence,
          retrievedAt: doc.importedAt,
        },
        due: {
          value: { certainty: oa.certainty, iso: oa.dueIso, label: oa.dueLabel },
          sourceType: "course_outline",
          sourceId: doc.id,
          confidence: oa.confidence,
          retrievedAt: doc.importedAt,
        },
      },
      conflictIds: [],
      manualOverrides: {},
      updatedAt: new Date().toISOString(),
    };
  });

  const withoutOldOutline = data.assessments.filter(
    (a) => !(a.courseId === courseId && a.id.startsWith("outline:")),
  );
  const reconciled = reconcileAssessments([...withoutOldOutline, ...outlineAssessments]);

  const policies: CoursePolicy[] = [
    ...data.policies.filter((p) => p.courseId !== courseId),
    ...result.policies.map((p, i) => ({
      id: `policy:${courseId}:${i}`,
      courseId,
      kind: p.kind,
      title: p.title,
      body: p.body,
    })),
  ];

  const resources: Resource[] = [
    ...data.resources.filter((r) => r.courseId !== courseId),
    ...result.textbooks.map((t, i) => ({
      id: `res:${courseId}:${i}`,
      courseId,
      title: t,
      kind: "textbook" as const,
      purpose: "reading" as const,
      url: null,
      notes: null,
    })),
  ];

  const gradeCategories: GradeCategory[] = [
    ...data.gradeCategories.filter((g) => g.courseId !== courseId),
    ...(result.categories ?? []).map((c, i) => ({
      id: `gcat:${courseId}:${i}`,
      courseId,
      name: c.name,
      weightPercent: c.weightPercent,
      dropLowest: c.dropLowest,
      bestN: c.bestN,
      gradeCapPercent: null,
      thresholdPercent: null,
      brightspaceCategoryId: null,
    })),
  ];

  const academicRules = [
    ...data.academicRules.filter(
      (r) => r.courseId !== courseId || r.sourceType !== "course_outline",
    ),
    ...rulesFromOutlineHints(courseId, result.gradingRules ?? []),
  ];

  const documents = [
    ...data.documents.filter(
      (d) => !(d.courseId === courseId && (d.id.startsWith("auto:") || d.id === doc.id)),
    ),
    doc,
  ];

  const titleToId = new Map(
    outlineAssessments.map((a) => [a.title.toLowerCase(), a.id] as const),
  );
  const materialLinks = bp
    ? materialLinksFromBlueprint({ ...bp, courseId }, titleToId)
    : [];

  return {
    ...data,
    courses,
    documents,
    assessments: reconciled.assessments,
    conflicts: [
      ...data.conflicts.filter((c) => !reconciled.conflicts.some((n) => n.id === c.id)),
      ...reconciled.conflicts,
    ],
    people,
    policies,
    resources,
    gradeCategories,
    academicRules,
    courseBlueprints: [
      ...(data.courseBlueprints ?? []).filter((b) => b.courseId !== courseId),
      ...(bp ? [{ ...bp, courseId }] : []),
    ],
    documentMemories: [
      ...(data.documentMemories ?? []).filter((m) => m.courseId !== courseId || (opts.memory && m.documentId !== opts.memory.documentId)),
      ...(opts.memory ? [opts.memory] : []),
    ],
    entityLinks: [
      ...(data.entityLinks ?? []).filter(
        (l) => !l.id.includes(`:${courseId}:`) || !l.id.startsWith("elink:CONTAINS:schedule:"),
      ),
      ...materialLinks,
    ],
  };
}
