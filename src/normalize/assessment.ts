import { COURSELINK_ORIGIN } from "@/domain/constants";
import { parseDateLabel } from "@/adapters/outline/parse";
import { assessmentId, normalizeTitleKey, sourceRecordId } from "@/domain/ids";
import { exactDate, unknownDate } from "@/domain/dates";
import type {
  Announcement,
  Assessment,
  AssessmentType,
  Course,
  ProvenancedValue,
  SourceRecord,
  SubmissionState,
} from "@/domain/types";
import { DEFAULT_ITEM_STATE } from "@/domain/types";
import type {
  RawCalendarEvent,
  RawEntityDropbox,
  RawFolder,
  RawGradeObject,
  RawGradeValue,
  RawNewsItem,
  RawQuiz,
} from "@/adapters/courselink/raw";

function nowIso(): string {
  return new Date().toISOString();
}

function inferType(title: string, fallback: AssessmentType): AssessmentType {
  const t = title.toLowerCase();
  if (/\bfinal\b/.test(t)) return "final";
  if (/\bmid[- ]?term\b/.test(t)) return "midterm";
  if (/\blab\b/.test(t)) return "lab";
  if (/\bproject\b/.test(t)) return "project";
  if (/\bpresentation\b/.test(t)) return "presentation";
  if (/\bparticipation\b|\battendance\b/.test(t)) return "participation";
  if (/\bdiscussion\b|\bforum\b/.test(t)) return "discussion";
  if (/\bquiz\b|\btest\b/.test(t)) return "quiz";
  if (/\bassign/.test(t) || /\bhomework\b|\bhw\b/.test(t)) return "assignment";
  return fallback;
}

function baseAssessment(
  partial: Omit<
    Assessment,
    "fieldProvenance" | "conflictIds" | "manualOverrides" | "updatedAt" | "sourceRecords" | "state" | "attemptNumber"
  > & {
    sourceRecords?: string[];
    state?: Assessment["state"];
    attemptNumber?: number | null;
  },
  provenance: Partial<Record<string, ProvenancedValue<unknown>>>,
): Assessment {
  return {
    ...partial,
    attemptNumber: partial.attemptNumber ?? null,
    state: partial.state ?? { ...DEFAULT_ITEM_STATE, submission: partial.submissionState },
    sourceRecords: partial.sourceRecords ?? [],
    fieldProvenance: provenance,
    conflictIds: [],
    manualOverrides: {},
    updatedAt: nowIso(),
  };
}

export function fromFolder(
  f: RawFolder,
  course: Course,
): { assessment: Assessment; sources: SourceRecord[] } | null {
  const dueRaw = f.DueDate ?? f.Availability?.EndDate ?? null;
  if (f.IsHidden) return null;
  const id = assessmentId(course.id, "dropbox", String(f.Id));
  const retrievedAt = nowIso();
  const due = dueRaw ? exactDate(dueRaw) : unknownDate();
  const title = f.Name.trim();
  const type = inferType(title, "assignment");
  const srcId = sourceRecordId("courselink_dropbox", String(f.Id));
  const sources: SourceRecord[] = [
    {
      id: srcId,
      sourceType: "courselink_dropbox",
      sourceIdentifier: String(f.Id),
      entityId: id,
      field: "*",
      originalValue: f,
      confidence: 0.95,
      retrievedAt,
      sourceTimestamp: dueRaw,
    },
  ];
  const assessment = baseAssessment(
    {
      id,
      courseId: course.id,
      title,
      type,
      due,
      start: f.Availability?.StartDate ? exactDate(f.Availability.StartDate) : unknownDate(),
      end: f.Availability?.EndDate ? exactDate(f.Availability.EndDate) : unknownDate(),
      weightPercent: null,
      pointsPossible: null,
      pointsEarned: null,
      submissionState: "unknown",
      submittedAt: null,
      gradeDisplay: null,
      url: `${COURSELINK_ORIGIN}/d2l/lms/dropbox/user/folder_submit_files.d2l?db=${f.Id}&ou=${course.orgUnitId}`,
      notes: null,
      categoryId: null,
      isBonus: false,
      sourceRecords: [srcId],
    },
    {
      title: { value: title, sourceType: "courselink_dropbox", sourceId: srcId, confidence: 0.95, retrievedAt },
      due: { value: due, sourceType: "courselink_dropbox", sourceId: srcId, confidence: dueRaw ? 0.95 : 0.2, retrievedAt },
      type: { value: type, sourceType: "courselink_dropbox", sourceId: srcId, confidence: 0.8, retrievedAt },
    },
  );
  return { assessment, sources };
}

export function fromQuiz(
  q: RawQuiz,
  course: Course,
): { assessment: Assessment; sources: SourceRecord[] } | null {
  const dueRaw = q.DueDate ?? q.EndDate;
  if (q.IsActive === false) return null;
  const id = assessmentId(course.id, "quiz", String(q.QuizId));
  const retrievedAt = nowIso();
  const due = dueRaw ? exactDate(dueRaw) : unknownDate();
  const title = q.Name.trim();
  const type = inferType(title, "quiz");
  const srcId = sourceRecordId("courselink_quiz", String(q.QuizId));
  const sources: SourceRecord[] = [
    {
      id: srcId,
      sourceType: "courselink_quiz",
      sourceIdentifier: String(q.QuizId),
      entityId: id,
      field: "*",
      originalValue: q,
      confidence: 0.95,
      retrievedAt,
      sourceTimestamp: dueRaw,
    },
  ];
  const assessment = baseAssessment(
    {
      id,
      courseId: course.id,
      title,
      type,
      due,
      start: unknownDate(),
      end: q.EndDate ? exactDate(q.EndDate) : unknownDate(),
      weightPercent: null,
      pointsPossible: null,
      pointsEarned: null,
      submissionState: "unknown",
      submittedAt: null,
      gradeDisplay: null,
      url: `${COURSELINK_ORIGIN}/d2l/lms/quizzing/user/quiz_summary.d2l?qi=${q.QuizId}&ou=${course.orgUnitId}`,
      notes: null,
      categoryId: null,
      isBonus: false,
      sourceRecords: [srcId],
    },
    {
      title: { value: title, sourceType: "courselink_quiz", sourceId: srcId, confidence: 0.95, retrievedAt },
      due: { value: due, sourceType: "courselink_quiz", sourceId: srcId, confidence: dueRaw ? 0.95 : 0.2, retrievedAt },
      type: { value: type, sourceType: "courselink_quiz", sourceId: srcId, confidence: 0.85, retrievedAt },
    },
  );
  return { assessment, sources };
}

export function withSubmissions(
  a: Assessment,
  entities: RawEntityDropbox[] | null,
): Assessment {
  if (!entities) return a;
  const dates = entities
    .flatMap((e) => e.Submissions ?? [])
    .map((s) => s.SubmissionDate)
    .filter((x): x is string => !!x)
    .sort();
  const submitted: SubmissionState = dates.length > 0 ? "submitted" : "not_submitted";
  return {
    ...a,
    submissionState: submitted,
    submittedAt: dates.at(-1) ?? null,
    updatedAt: nowIso(),
  };
}

const norm = (s: string) => normalizeTitleKey(s);

export function applyGrades(
  items: Assessment[],
  objects: RawGradeObject[],
  values: RawGradeValue[],
): Assessment[] {
  const valueById = new Map(values.map((v) => [String(v.GradeObjectIdentifier), v]));
  return items.map((a) => {
    const sourceKey = a.id.split(":").pop() ?? "";
    const toolItemId = Number(sourceKey);
    const linked = Number.isFinite(toolItemId)
      ? objects.filter((g) => g.AssociatedTool?.ToolItemId === toolItemId)
      : [];
    const match =
      linked.find((g) => norm(g.Name) === norm(a.title)) ??
      (linked.length === 1 ? linked[0] : undefined) ??
      objects.find((g) => norm(g.Name) === norm(a.title));
    const v = match && valueById.get(String(match.Id));
    if (!match || !v || (v.PointsNumerator == null && !v.DisplayedGrade)) {
      const weight = match?.Weight ?? null;
      if (weight != null && a.weightPercent == null) {
        return { ...a, weightPercent: weight, isBonus: match?.IsBonus ?? a.isBonus };
      }
      return a;
    }
    return {
      ...a,
      submissionState: a.submissionState === "unknown" ? "submitted" : a.submissionState,
      pointsEarned: v.PointsNumerator,
      pointsPossible: v.PointsDenominator ?? match.MaxPoints ?? a.pointsPossible,
      gradeDisplay: v.DisplayedGrade,
      weightPercent: a.weightPercent ?? match.Weight ?? null,
      isBonus: match.IsBonus ?? a.isBonus,
      updatedAt: nowIso(),
    };
  });
}

/** Pull deadline phrases from news into assessments (never invent dates). */
export function assessmentsFromAnnouncement(
  n: RawNewsItem,
  course: Course,
): Assessment[] {
  if (n.IsHidden) return [];
  const body = `${n.Title ?? ""} ${n.Body?.Text ?? ""} ${(n.Body?.Html ?? "").replace(/<[^>]+>/g, " ")}`;
  const plain = body.replace(/\s+/g, " ").trim();
  const out: Assessment[] = [];
  const re =
    /\b((?:assignment|quiz|lab|project|mid[- ]?term|final(?:\s+exam)?|homework|hw)\s*#?\s*\d*|a\s*\d+|q\s*\d+)\b[^.!?]{0,60}?\b(?:due|deadline)\b[:\s]+([^.!?]{3,60})/gi;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(plain)) && i < 5) {
    const title = m[1].replace(/\s+/g, " ").trim();
    const dueRaw = m[2].trim();
    const parsed = parseDateLabel(dueRaw);
    const due = {
      certainty: parsed.certainty,
      iso: parsed.iso,
      label: parsed.label || dueRaw.slice(0, 80),
    };
    const id = assessmentId(course.id, "news", `${n.Id}:${i}`);
    out.push(
      baseAssessment(
        {
          id,
          courseId: course.id,
          title,
          type: inferType(title, "other"),
          due,
          start: unknownDate(),
          end: unknownDate(),
          weightPercent: null,
          pointsPossible: null,
          pointsEarned: null,
          submissionState: "unknown",
          submittedAt: null,
          gradeDisplay: null,
          url: `${COURSELINK_ORIGIN}/d2l/le/news/${course.orgUnitId}/${n.Id}/view`,
          notes: `From announcement: ${n.Title}`,
          categoryId: null,
          isBonus: false,
        },
        {
          due: {
            value: due,
            sourceType: "courselink_news",
            sourceId: String(n.Id),
            confidence: 0.55,
            retrievedAt: nowIso(),
          },
        },
      ),
    );
    i += 1;
  }
  return out;
}

export function announcementFromNews(n: RawNewsItem, course: Course): Announcement | null {
  if (n.IsHidden) return null;
  const body = n.Body?.Text ?? n.Body?.Html?.replace(/<[^>]+>/g, " ") ?? "";
  const bodyText = body.replace(/\s+/g, " ").trim();
  const blob = `${n.Title} ${bodyText}`;
  return {
    id: `news:${course.id}:${n.Id}`,
    courseId: course.id,
    title: n.Title.trim(),
    bodyText,
    publishedAt: n.StartDate,
    url: `${COURSELINK_ORIGIN}/d2l/le/news/${course.orgUnitId}/${n.Id}/view`,
    deadlineChangeSignal: /\b(due|deadline|extended|extension|postponed)\b/i.test(blob),
    extractedFactIds: [],
    bodyHash: null,
    fromInstructorOrTa: true, // CourseLink news is typically staff-authored
  };
}

export function assessmentFromCalendarEvent(
  e: RawCalendarEvent,
  course: Course,
): Assessment | null {
  const title = e.Title?.trim();
  if (!title || !e.StartDateTime) return null;
  const idNum = e.CalendarEventId ?? e.Id ?? title;
  const id = assessmentId(course.id, "cal", String(idNum));
  const due = exactDate(e.EndDateTime ?? e.StartDateTime);
  return baseAssessment(
    {
      id,
      courseId: course.id,
      title,
      type: inferType(title, "other"),
      due,
      start: exactDate(e.StartDateTime),
      end: e.EndDateTime ? exactDate(e.EndDateTime) : unknownDate(),
      weightPercent: null,
      pointsPossible: null,
      pointsEarned: null,
      submissionState: "unknown",
      submittedAt: null,
      gradeDisplay: null,
      url: null,
      notes: e.Description ?? null,
      categoryId: null,
      isBonus: false,
      sourceRecords: [],
    },
    {
      due: {
        value: due,
        sourceType: "courselink_calendar",
        sourceId: String(idNum),
        confidence: 0.7,
        retrievedAt: nowIso(),
      },
    },
  );
}
