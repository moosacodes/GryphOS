import type {
  Assessment,
  Conflict,
  Course,
  HealthStatus,
  ImportedDocument,
  Meeting,
  Person,
} from "@/domain/types";

export interface HealthCheck {
  id: string;
  ok: boolean;
  warn: boolean;
  label: string;
}

export interface CourseHealth {
  courseId: string;
  status: HealthStatus;
  score: number;
  checks: HealthCheck[];
}

export function computeCourseHealth(
  course: Course,
  assessments: Assessment[],
  conflicts: Conflict[],
  documents: ImportedDocument[],
  people: Person[],
  meetings: Meeting[],
): CourseHealth {
  const items = assessments.filter((a) => a.courseId === course.id);
  const courseConflicts = conflicts.filter(
    (c) => c.unresolved && items.some((a) => a.id === c.entityId),
  );
  const outline = documents.find((d) => d.id === course.outlineDocumentId && d.parseResult);
  const weights = items.map((a) => a.weightPercent).filter((w): w is number => w != null);
  const weightSum = weights.reduce((s, w) => s + w, 0);
  const missingWeights = items.filter((a) => a.weightPercent == null).length;
  const missingDates = items.filter((a) => !a.due.iso || a.due.certainty === "unknown").length;
  const finals = items.filter((a) => a.type === "final");
  const finalUnknown = finals.length === 0 || finals.some((a) => a.due.certainty === "unknown");
  const hasInstructor =
    course.instructorNames.length > 0 ||
    people.some((p) => p.courseId === course.id && p.role === "instructor");
  const hasSchedule = meetings.some((m) => m.courseId === course.id);

  const checks: HealthCheck[] = [
    { id: "courselink", ok: true, warn: false, label: "CourseLink connected" },
    {
      id: "outline",
      ok: !!outline || course.outlineStatus === "parsed" || course.outlineStatus === "found",
      warn: !outline && course.outlineStatus !== "parsed" && course.outlineStatus !== "found",
      label: outlineStatusLabel(course),
    },
    {
      id: "assessments",
      ok: items.length > 0,
      warn: items.length === 0,
      label: items.length > 0 ? `${items.length} assessments discovered` : "No assessments discovered",
    },
    {
      id: "weights",
      ok: weights.length > 0 && Math.abs(weightSum - 100) <= 5,
      warn: missingWeights > 0 || (weights.length > 0 && Math.abs(weightSum - 100) > 5),
      label:
        weights.length === 0
          ? "Assessment weights unknown"
          : Math.abs(weightSum - 100) <= 5
            ? "Assessment weights total ~100%"
            : `Weights sum to ${weightSum.toFixed(1)}%`,
    },
    {
      id: "missing_weights",
      ok: missingWeights === 0,
      warn: missingWeights > 0,
      label:
        missingWeights === 0
          ? "All assessments have weights"
          : `${missingWeights} assessments missing weights`,
    },
    {
      id: "dates",
      ok: missingDates === 0,
      warn: missingDates > 0,
      label:
        missingDates === 0
          ? "All assessments have dates"
          : `${missingDates} assessments missing dates`,
    },
    {
      id: "final",
      ok: !finalUnknown,
      warn: finalUnknown,
      label: finalUnknown ? "Final exam date unknown" : "Final exam date known",
    },
    {
      id: "conflicts",
      ok: courseConflicts.length === 0,
      warn: courseConflicts.length > 0,
      label:
        courseConflicts.length === 0
          ? "No unresolved conflicts"
          : `${courseConflicts.length} unresolved conflict(s)`,
    },
    {
      id: "instructor",
      ok: hasInstructor,
      warn: !hasInstructor,
      label: hasInstructor ? "Instructor detected" : "Instructor not detected",
    },
    {
      id: "schedule",
      ok: hasSchedule,
      warn: !hasSchedule,
      label: hasSchedule ? "Course schedule detected" : "Course schedule not detected",
    },
  ];

  const scored = checks.filter((c) => c.id !== "courselink");
  const okCount = scored.filter((c) => c.ok).length;
  const score = Math.round((okCount / scored.length) * 100);
  const warnCount = checks.filter((c) => c.warn).length;

  let status: HealthStatus;
  if (warnCount === 0 && score >= 90) status = "complete";
  else if (score >= 70) status = "good";
  else if (courseConflicts.length > 0 || missingDates > items.length / 2) status = "needs_attention";
  else status = "missing_information";

  return { courseId: course.id, status, score, checks };
}

function outlineStatusLabel(course: Course): string {
  switch (course.outlineStatus) {
    case "parsed":
      return course.outlineStatusDetail ?? "Outline found & parsed";
    case "found":
      return course.outlineStatusDetail ?? "Outline found (limited parse)";
    case "blocked":
      return course.outlineStatusDetail ?? "Outline blocked by Brightspace (403)";
    case "none_accessible":
      return course.outlineStatusDetail ?? "No outline accessible";
    case "parse_failed":
      return "Outline download failed to parse";
    case "not_checked":
    default:
      return "Outline not checked yet — Sync on CourseLink";
  }
}

export function healthStatusLabel(s: HealthStatus): string {
  switch (s) {
    case "complete": return "Complete";
    case "good": return "Good";
    case "missing_information": return "Missing information";
    case "needs_attention": return "Needs attention";
  }
}
