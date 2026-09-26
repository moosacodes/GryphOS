/**
 * Build the "Export diagnostics" JSON — a real-data snapshot of what Sync saw,
 * what the outline parser produced, the reconciled model and the Brief output.
 * Pure: no network, no telemetry. All output passes through the redaction scrubber.
 */
import type { AppData } from "@/domain/types";
import { buildCinematicBrief } from "@/engines/brief";
import { buildMyDay } from "@/engines/myday";
import { makeScrubber, REDACTED_GRADE, type RedactionOptions } from "./redact";
import { selectedCoursesOf, summarizeProblems, summarizeWeights } from "./problems";
import { endpointTemplate, type SyncTraceEntry } from "./trace";

export const DIAGNOSTICS_FORMAT = "gryphos-diagnostics/1";
export const OUTLINE_EXCERPT_CHARS = 3000;

export interface DiagnosticsOptions {
  includeGrades: boolean;
  includeOutlineText: boolean;
  /** Include non-selected courses too (default: selected only) */
  allCourses?: boolean;
}

export interface DiagnosticsMeta {
  extensionVersion: string;
  userAgent?: string | null;
  now?: Date;
}

function safeRun<T>(fn: () => T): T | { error: string } {
  try {
    return fn();
  } catch (e) {
    return { error: String((e as Error)?.message ?? e) };
  }
}

function excerpt(s: string | null | undefined, n: number): string | null {
  if (!s) return null;
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > n ? `${t.slice(0, n)}…` : t;
}

interface EndpointAggregate {
  endpoint: string;
  calls: number;
  statuses: Record<string, number>;
  items: number;
  bytes: number;
  errors: string[];
}

export function aggregateTrace(entries: SyncTraceEntry[]): EndpointAggregate[] {
  const map = new Map<string, EndpointAggregate>();
  for (const e of entries) {
    if (e.kind === "outline_candidate") continue;
    const key = endpointTemplate(e.endpoint);
    const agg = map.get(key) ?? { endpoint: key, calls: 0, statuses: {}, items: 0, bytes: 0, errors: [] };
    agg.calls += 1;
    const st = String(e.status ?? "none");
    agg.statuses[st] = (agg.statuses[st] ?? 0) + 1;
    agg.items += e.itemCount ?? 0;
    agg.bytes += e.bytes ?? 0;
    if (e.error && agg.errors.length < 5 && !agg.errors.includes(e.error)) agg.errors.push(e.error);
    map.set(key, agg);
  }
  return [...map.values()].sort((a, b) => a.endpoint.localeCompare(b.endpoint));
}

export function buildDiagnostics(
  data: AppData,
  opts: DiagnosticsOptions,
  meta: DiagnosticsMeta,
): Record<string, unknown> {
  const now = meta.now ?? new Date();
  const redaction: RedactionOptions = {
    includeGrades: opts.includeGrades,
    userName: data.user?.name ?? null,
    userId: data.user?.id ?? null,
  };
  const scrub = makeScrubber(redaction);
  const grade = <T>(v: T): T | string => (opts.includeGrades || v == null ? v : REDACTED_GRADE);
  const trace = data.syncTrace ?? [];
  const courses = opts.allCourses ? data.courses : selectedCoursesOf(data);

  const perCourse = courses.map((c) => {
    const ctrace = trace.filter((t) => t.orgUnitId === c.orgUnitId);
    const doc = data.documents.find((d) => d.id === c.outlineDocumentId) ?? null;
    const blueprint =
      (data.courseBlueprints ?? []).find((b) => b.id === doc?.blueprintId) ??
      (data.courseBlueprints ?? []).find((b) => b.courseId === c.id) ??
      null;
    const assessments = data.assessments.filter((a) => a.courseId === c.id);
    const pr = doc?.parseResult ?? null;

    return {
      course: {
        id: c.id,
        orgUnitId: c.orgUnitId,
        code: c.code,
        name: c.title,
        semester: c.semester,
        startDate: c.startDate,
        endDate: c.endDate,
        selected: c.selected,
        sections: { lecture: c.lectureSection, lab: c.labSection, tutorial: c.tutorialSection },
        instructorNames: c.instructorNames,
      },
      sync: {
        endpoints: aggregateTrace(ctrace),
        requests: ctrace.filter((t) => t.kind !== "outline_candidate"),
        coverage: (data.sourceCoverage ?? []).find((s) => s.courseId === c.id)?.capabilities ?? [],
        explorationLog: (data.apiExplorationLog ?? [])
          .filter((e) => e.courseId === c.id)
          .map((e) => ({ endpoint: e.endpoint, status: e.status, usable: e.usable, note: e.note })),
      },
      documents: {
        outlineDetected: !!doc,
        outlineStatus: c.outlineStatus,
        outlineStatusDetail: c.outlineStatusDetail,
        outlineCandidates: ctrace
          .filter((t) => t.kind === "outline_candidate")
          .map((t) => ({ title: t.endpoint, accepted: t.ok, note: t.note })),
        imported: data.documents
          .filter((d) => d.courseId === c.id)
          .map((d) => ({
            id: d.id,
            filename: d.filename,
            mimeType: d.mimeType,
            importedAt: d.importedAt,
            textLength: (d.textContent ?? "").length,
            isCourseOutline: d.id === c.outlineDocumentId,
            parsed: !!d.parseResult,
            parseError: d.parseError,
            extractionQuality: d.extractionQuality ?? null,
            layoutSummary: d.layoutSummary ?? null,
          })),
        contentItems: (data.contentItems ?? [])
          .filter((i) => i.courseId === c.id)
          .map((i) => ({
            title: i.title,
            documentClass: i.documentClass,
            mimeType: i.mimeType,
            topicType: i.topicType,
            isExternal: i.isExternal,
            isHidden: i.isHidden,
            dueDate: i.dueDate,
            hasLibraryText: !!i.libraryResourceId,
          })),
        libraryFiles: (data.libraryResources ?? [])
          .filter((l) => l.courseId === c.id)
          .map((l) => ({
            filename: l.filename,
            mimeType: l.mimeType,
            documentClass: l.documentClass,
            byteLength: l.byteLength,
            textLength: (l.textContent ?? "").length,
            moduleTitle: l.moduleTitle,
            linkedAssessmentId: l.assessmentId,
          })),
      },
      outlineParse: pr
        ? {
            documentId: doc!.id,
            filename: doc!.filename,
            confidence: pr.confidence,
            extractionIncomplete: pr.extractionIncomplete ?? false,
            passesUsed: [...new Set(pr.diagnostics.map((d) => d.pass))],
            extractionMethod: doc!.layoutSummary?.extractionMethod ?? blueprint?.layoutSummary.extractionMethod ?? null,
            secondPassApplied: blueprint?.quality.secondPassApplied ?? null,
            courseCode: pr.courseCode,
            term: pr.term,
            assessments: pr.assessments.map((a) => ({
              name: a.title,
              type: a.type,
              weightPercent: a.weightPercent,
              dueIso: a.dueIso,
              dueLabel: a.dueLabel,
              dueKind: a.dueKind ?? null,
              certainty: a.certainty,
              confidence: a.confidence,
              category: a.category,
              sourcePage: a.sourcePage ?? null,
              sourceSnippet: excerpt(a.sourceSnippet, 240),
            })),
            categories: pr.categories,
            rules: pr.gradingRules,
            warnings: pr.diagnostics.map((d) => ({ pass: d.pass, message: d.message, snippet: excerpt(d.snippet, 200) })),
            qualityChecks: pr.qualityChecks ?? [],
            scheduleLineCount: pr.scheduleLines.length,
            policyCount: pr.policies.length,
            instructorsDetected: pr.instructors.length,
            textExcerpt: opts.includeOutlineText
              ? (doc!.textContent ?? "").slice(0, OUTLINE_EXCERPT_CHARS)
              : "[excluded by option]",
            textLength: (doc!.textContent ?? "").length,
          }
        : null,
      blueprint: blueprint
        ? {
            id: blueprint.id,
            quality: blueprint.quality,
            layoutSummary: blueprint.layoutSummary,
            studentSectionNeeded: blueprint.studentSectionNeeded,
            categories: blueprint.categories.map((k) => ({ ...k, citation: k.citation ? { page: k.citation.page, snippet: excerpt(k.citation.snippet, 160) } : null })),
            instances: blueprint.instances.map((i) => ({
              title: i.title,
              type: i.type,
              weightPercent: i.weightPercent,
              categoryName: i.categoryName,
              due: i.due,
              certainty: i.certainty,
              confidence: i.confidence,
            })),
            relativeDeadlines: blueprint.relativeDeadlines.map((r) => ({ hint: r.assessmentTitleHint, offsetDays: r.offsetDays, anchor: r.anchorKind, raw: excerpt(r.raw, 200), resolved: r.resolvedCandidateIso })),
            createdAt: blueprint.createdAt,
          }
        : null,
      canonical: {
        weights: summarizeWeights(data, c.id),
        assessments: assessments.map((a) => ({
          id: a.id,
          title: a.title,
          type: a.type,
          due: a.due,
          start: a.start,
          end: a.end,
          weightPercent: a.weightPercent,
          pointsPossible: a.pointsPossible,
          pointsEarned: a.pointsEarned,
          gradeDisplay: a.gradeDisplay,
          submissionState: a.submissionState,
          submittedAt: a.submittedAt,
          categoryId: a.categoryId,
          isBonus: a.isBonus,
          state: a.state,
          provenance: Object.fromEntries(
            Object.entries(a.fieldProvenance ?? {}).map(([k, p]) => [k, p ? { source: p.sourceType, confidence: p.confidence } : null]),
          ),
          conflictIds: a.conflictIds,
          hasManualOverrides: Object.keys(a.manualOverrides ?? {}).length > 0,
          notes: excerpt(a.notes, 200),
        })),
        gradeCategories: (data.gradeCategories ?? []).filter((g) => g.courseId === c.id),
        rules: (data.academicRules ?? []).filter((r) => r.courseId === c.id),
        meetings: (data.meetings ?? []).filter((m) => m.courseId === c.id),
        meetingPatterns: (data.meetingPatterns ?? []).filter((p) => p.courseId === c.id),
        meetingOccurrences: {
          count: (data.meetingOccurrences ?? []).filter((o) => o.courseId === c.id).length,
          sample: (data.meetingOccurrences ?? [])
            .filter((o) => o.courseId === c.id)
            .slice(0, 40)
            .map((o) => ({ kind: o.kind, date: o.date, startIso: o.startIso, endIso: o.endIso, location: o.location, cancelled: o.cancelled })),
        },
        conflicts: data.conflicts.filter((x) => assessments.some((a) => a.id === x.entityId)),
        gradeRecords: (data.gradeRecords ?? [])
          .filter((g) => g.courseId === c.id)
          .map((g) => ({ ...g, pointsEarned: g.pointsEarned, displayedGrade: g.displayedGrade, feedbackText: g.feedbackText })),
        quizAttempts: (data.quizAttempts ?? [])
          .filter((q) => q.courseId === c.id)
          .map((q) => ({ quizId: q.quizId, assessmentId: q.assessmentId, attemptNumber: q.attemptNumber, score: grade(q.score), completedAt: q.completedAt })),
        feedback: (data.feedbackRecords ?? [])
          .filter((f) => f.courseId === c.id)
          .map((f) => ({ assessmentId: f.assessmentId, source: f.source, score: grade(f.score), feedbackText: excerpt(f.text, 300) })),
        announcements: data.announcements
          .filter((n) => n.courseId === c.id)
          .map((n) => ({ title: n.title, publishedAt: n.publishedAt, deadlineChangeSignal: n.deadlineChangeSignal, fromStaff: n.fromInstructorOrTa, bodyLength: n.bodyText.length, factCount: n.extractedFactIds.length })),
        announcementFacts: (data.announcementFacts ?? [])
          .filter((f) => f.courseId === c.id)
          .map((f) => ({ kind: f.kind, assessmentId: f.assessmentId, dueIso: f.dueIso, dueLabel: f.dueLabel, detail: excerpt(f.detail, 200), confidence: f.confidence })),
        discussions: {
          forums: (data.discussionForums ?? []).filter((f) => f.courseId === c.id).length,
          topics: (data.discussionTopics ?? []).filter((t) => t.courseId === c.id).length,
          posts: (data.discussionPosts ?? [])
            .filter((p) => p.courseId === c.id)
            .map((p) => ({ topicId: p.topicId, subject: p.subject, authorRole: p.authorRole, isAuthoritative: p.isAuthoritative, postedAt: p.postedAt, bodyLength: p.bodyText.length, postBody: p.bodyText })),
        },
        externalActivities: (data.externalActivities ?? []).filter((e) => e.courseId === c.id).map((e) => ({ title: e.title, tool: e.tool, assessmentId: e.assessmentId })),
      },
      calendarEvents: (data.calendarEvents ?? [])
        .filter((e) => e.courseId === c.id)
        .map((e) => ({ title: e.title, category: e.category, startIso: e.startIso, endIso: e.endIso, allDay: e.allDay, location: e.location, sourceType: e.sourceType, description: excerpt(e.description, 200) })),
    };
  });

  const brief = safeRun(() => {
    const b = buildCinematicBrief(data, now);
    return {
      generatedAt: b.generatedAt,
      greeting: b.greeting,
      headline: b.headline,
      subhead: b.subhead,
      tone: b.tone,
      pulse: b.pulse,
      systemNote: b.systemNote,
      staleSummary: b.staleSummary,
      staleGaps: b.staleGaps,
      replanNote: b.replanNote,
      requestRecheck: b.requestRecheck,
      beats: b.beats.map((x) => ({
        id: x.id,
        section: x.section,
        kicker: x.kicker,
        line: x.line,
        detail: x.detail ?? null,
        priority: x.priority,
        assessmentId: x.assessmentId ?? x.item?.id ?? null,
        evidence: x.reasons ?? [],
        ignoreImpact: x.ignoreImpact ?? null,
      })),
      risks: b.risks,
      recovery: b.recovery,
    };
  });

  const myDay = safeRun(() => {
    const m = buildMyDay(data, now);
    return {
      generatedAt: m.generatedAt,
      standingLines: m.standingLines,
      sections: m.sections.map((s) => ({
        id: s.id,
        label: s.label,
        items: s.items.map((i) => ({
          id: i.id,
          kind: i.kind,
          courseCode: i.courseCode,
          title: i.title,
          subtitle: i.subtitle,
          startIso: i.startIso,
          endIso: i.endIso,
          weightPercent: i.weightPercent,
          statusLabel: i.statusLabel,
          actionable: i.actionable,
          ctas: i.ctas.map((c) => c.kind),
        })),
      })),
    };
  });

  const problems = safeRun(() => summarizeProblems(data, now));

  const out = {
    format: DIAGNOSTICS_FORMAT,
    extensionVersion: meta.extensionVersion,
    generatedAt: now.toISOString(),
    generatedAtLocal: now.toString(),
    timezone: safeRun(() => Intl.DateTimeFormat().resolvedOptions().timeZone),
    userAgent: meta.userAgent ?? null,
    schemaVersion: data.schemaVersion,
    privacy: {
      redacted: [
        "user name",
        "student/user id",
        "email addresses",
        ...(opts.includeGrades ? [] : ["grade values (points earned, displayed grades, scores, feedback)"]),
        "discussion post bodies",
      ],
      includeGrades: opts.includeGrades,
      includeOutlineText: opts.includeOutlineText,
      neverIncluded: ["cookies", "tokens", "passwords", "request headers", "response bodies"],
    },
    sync: {
      status: data.sync.status,
      message: data.sync.message,
      lastSyncedAt: data.sync.lastSyncedAt ? new Date(data.sync.lastSyncedAt).toISOString() : null,
      traceEntries: trace.length,
      globalRequests: trace.filter((t) => t.orgUnitId == null && t.kind !== "outline_candidate"),
    },
    counts: {
      coursesTotal: data.courses.length,
      coursesSelected: selectedCoursesOf(data).length,
      assessments: data.assessments.length,
      documents: data.documents.length,
      calendarEvents: (data.calendarEvents ?? []).length,
      meetingOccurrences: (data.meetingOccurrences ?? []).length,
      conflictsUnresolved: data.conflicts.filter((c) => c.unresolved).length,
    },
    summary: { problems },
    courses: perCourse,
    allCourses: data.courses.map((c) => ({ id: c.id, code: c.code, name: c.title, semester: c.semester, selected: c.selected })),
    unassignedCalendarEvents: (data.calendarEvents ?? [])
      .filter((e) => !e.courseId)
      .map((e) => ({ title: e.title, category: e.category, startIso: e.startIso, endIso: e.endIso, sourceType: e.sourceType })),
    brief,
    myDay,
  };

  return scrub.value(out) as Record<string, unknown>;
}

export function diagnosticsFilename(version: string, now: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  const stamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}`;
  return `gryphos-diagnostics-v${version}-${stamp}.json`;
}
