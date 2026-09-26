import type {
  AppData,
  Assessment,
  CoursePolicy,
  GradeCategory,
  ImportedDocument,
  Person,
  Resource,
} from "@/domain/types";
import { reconcileAssessments } from "@/reconcile/merge";

/** Merge a parsed outline document into app data for one course. */
export function applyOutlineDocument(
  data: AppData,
  courseId: string,
  doc: ImportedDocument,
  opts: { preferExistingManual?: boolean } = {},
): AppData {
  const result = doc.parseResult;
  if (!result) return data;

  const existingManual = data.documents.find(
    (d) => d.courseId === courseId && !d.id.startsWith("auto:") && !!d.parseResult,
  );
  if (opts.preferExistingManual && existingManual && doc.id.startsWith("auto:")) {
    // Keep manual outline as authority; still store auto doc for inspection
    const documents = [
      ...data.documents.filter((d) => !(d.courseId === courseId && d.id.startsWith("auto:"))),
      doc,
      existingManual,
    ].filter((d, i, arr) => arr.findIndex((x) => x.id === d.id) === i);

    return { ...data, documents };
  }

  const courses = data.courses.map((c) =>
    c.id === courseId
      ? {
          ...c,
          outlineDocumentId: doc.id,
          outlineStatus: result.assessments.length > 0 || result.confidence >= 0.45 ? "parsed" as const : "found" as const,
          outlineStatusDetail: result.assessments.length > 0
            ? `Outline parsed (${result.assessments.length} assessments)` 
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
        courseId,
      }),
    ),
    ...result.tas.map(
      (t, idx): Person => ({
        id: `person:${courseId}:ta:${idx}`,
        name: t.name,
        email: t.email,
        role: "ta",
        courseId,
      }),
    ),
  ];

  const outlineAssessments: Assessment[] = result.assessments.map((oa, i) => ({
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
    notes: oa.sourceSnippet ?? null,
    categoryId: oa.category ? `gcat:${courseId}:${oa.category}` : null,
    isBonus: false,
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
  }));

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
    })),
  ];

  const documents = [
    ...data.documents.filter(
      (d) => !(d.courseId === courseId && (d.id.startsWith("auto:") || d.id === doc.id)),
    ),
    doc,
  ];

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
  };
}
