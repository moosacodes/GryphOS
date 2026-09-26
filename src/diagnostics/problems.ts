/**
 * "Likely problems" summary for the diagnostics export.
 * Pure + deterministic: takes AppData, returns a ranked list of issues that
 * explain why the product may feel wrong with real CourseLink data.
 */
import type { AppData, Assessment, Course } from "@/domain/types";
import { endpointTemplate, type SyncTraceEntry } from "./trace";

export type ProblemSeverity = "error" | "warn" | "info";

export interface DiagnosticProblem {
  severity: ProblemSeverity;
  code: string;
  courseId: string | null;
  courseCode: string | null;
  message: string;
  /** Short supporting data (titles, endpoints, numbers) */
  details?: string[];
}

const SEVERITY_ORDER: Record<ProblemSeverity, number> = { error: 0, warn: 1, info: 2 };
const WEIGHT_TOLERANCE = 2;

export function selectedCoursesOf(data: AppData): Course[] {
  const ids = data.preferences.selectedCourseIds;
  if (ids?.length) return data.courses.filter((c) => ids.includes(c.id));
  return data.courses.filter((c) => c.selected);
}

function normTitle(t: string): string {
  return t.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

export interface WeightSummary {
  assessmentWeightSum: number | null;
  categoryWeightSum: number | null;
  /** Which figure is authoritative for the 100% check */
  basis: "categories" | "assessments" | "none";
  total: number | null;
  assessmentsMissingWeight: number;
}

export function summarizeWeights(data: AppData, courseId: string): WeightSummary {
  const items = data.assessments.filter((a) => a.courseId === courseId && !a.isBonus);
  const weights = items.map((a) => a.weightPercent).filter((w): w is number => w != null);
  const assessmentWeightSum = weights.length ? round1(weights.reduce((s, w) => s + w, 0)) : null;
  const cats = (data.gradeCategories ?? []).filter(
    (g) => g.courseId === courseId && g.weightPercent != null,
  );
  const categoryWeightSum = cats.length
    ? round1(cats.reduce((s, g) => s + (g.weightPercent ?? 0), 0))
    : null;
  const basis =
    categoryWeightSum != null && categoryWeightSum > 0
      ? "categories"
      : assessmentWeightSum != null
        ? "assessments"
        : "none";
  return {
    assessmentWeightSum,
    categoryWeightSum,
    basis,
    total: basis === "categories" ? categoryWeightSum : basis === "assessments" ? assessmentWeightSum : null,
    assessmentsMissingWeight: items.filter((a) => a.weightPercent == null).length,
  };
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function titles(list: Assessment[], max = 12): string[] {
  const out = list.slice(0, max).map((a) => a.title);
  if (list.length > max) out.push(`… +${list.length - max} more`);
  return out;
}

export function summarizeProblems(data: AppData, now: Date = new Date()): DiagnosticProblem[] {
  const out: DiagnosticProblem[] = [];
  const push = (p: DiagnosticProblem) => out.push(p);
  const trace: SyncTraceEntry[] = data.syncTrace ?? [];

  // ── Global sync state ─────────────────────────────────────────────
  if (!data.sync.lastSyncedAt) {
    push({
      severity: "error",
      code: "never_synced",
      courseId: null,
      courseCode: null,
      message: "No successful Sync recorded — all data is empty or stale.",
    });
  }
  if (data.sync.status === "signed_out") {
    push({ severity: "error", code: "signed_out", courseId: null, courseCode: null, message: "Last Sync found you signed out of CourseLink." });
  } else if (data.sync.status === "error") {
    push({
      severity: "error",
      code: "sync_error",
      courseId: null,
      courseCode: null,
      message: `Last Sync ended with an error: ${data.sync.message ?? "unknown"}`,
    });
  }
  if (data.sync.lastSyncedAt && now.getTime() - data.sync.lastSyncedAt > 3 * 864e5) {
    push({
      severity: "warn",
      code: "sync_stale",
      courseId: null,
      courseCode: null,
      message: `Last successful Sync was ${Math.round((now.getTime() - data.sync.lastSyncedAt) / 864e5)} day(s) ago.`,
    });
  }
  if (data.courses.length > 0 && trace.length === 0) {
    push({
      severity: "info",
      code: "no_sync_trace",
      courseId: null,
      courseCode: null,
      message: "No endpoint trace stored (last Sync ran on an older version). Sync once on CourseLink and export again for endpoint-level detail.",
    });
  }
  const courses = selectedCoursesOf(data);
  if (data.courses.length > 0 && courses.length === 0) {
    push({ severity: "error", code: "no_courses_selected", courseId: null, courseCode: null, message: "Courses exist but none are selected — Brief and My Day will be empty." });
  }
  if (data.sync.lastSyncedAt && data.courses.length === 0) {
    push({ severity: "error", code: "no_courses", courseId: null, courseCode: null, message: "Sync succeeded but no courses were returned by /mycourses." });
  }

  const globalFailures = trace.filter(
    (t) => t.kind !== "outline_candidate" && t.orgUnitId == null && !t.ok,
  );
  if (globalFailures.length) {
    push({
      severity: "warn",
      code: "global_endpoint_failures",
      courseId: null,
      courseCode: null,
      message: `${globalFailures.length} non-course request(s) failed.`,
      details: [...new Set(globalFailures.map((t) => `${t.status} ${endpointTemplate(t.endpoint)}`))].slice(0, 10),
    });
  }

  // ── Per course ────────────────────────────────────────────────────
  for (const c of courses) {
    const base = { courseId: c.id, courseCode: c.code };
    const items = data.assessments.filter((a) => a.courseId === c.id);
    const doc = data.documents.find((d) => d.id === c.outlineDocumentId);

    // Outline
    if (c.outlineStatus === "none_accessible" || c.outlineStatus === "not_checked") {
      push({
        ...base,
        severity: "error",
        code: "outline_not_found",
        message: `No course outline found (${c.outlineStatus}).`,
        details: c.outlineStatusDetail ? [c.outlineStatusDetail] : undefined,
      });
    } else if (c.outlineStatus === "blocked") {
      push({ ...base, severity: "error", code: "outline_blocked", message: "Outline download was blocked (401/403).", details: c.outlineStatusDetail ? [c.outlineStatusDetail] : undefined });
    } else if (c.outlineStatus === "parse_failed" || (doc && doc.parseError)) {
      push({ ...base, severity: "error", code: "outline_parse_failed", message: "Outline found but failed to parse.", details: doc?.parseError ? [doc.parseError] : undefined });
    }
    if (doc?.parseResult) {
      const pr = doc.parseResult;
      if (pr.assessments.length === 0) {
        push({ ...base, severity: "error", code: "outline_no_assessments", message: `Outline "${doc.filename}" parsed but no assessments were detected.` });
      }
      if (pr.confidence < 0.45) {
        push({ ...base, severity: "warn", code: "outline_low_confidence", message: `Outline parse confidence is low (${pr.confidence.toFixed(2)}).` });
      }
      if (pr.extractionIncomplete) {
        push({ ...base, severity: "warn", code: "outline_extraction_incomplete", message: "Outline extraction flagged as incomplete.", details: (pr.qualityChecks ?? []).filter((q) => !q.ok).map((q) => `${q.id}: ${q.detail}`).slice(0, 10) });
      }
      if ((doc.textContent ?? "").trim().length < 400) {
        push({ ...base, severity: "warn", code: "outline_text_short", message: `Outline text is very short (${(doc.textContent ?? "").trim().length} chars) — likely scanned/image PDF or wrong file.` });
      }
    } else if ((c.outlineStatus === "parsed" || c.outlineStatus === "found") && !doc) {
      push({ ...base, severity: "warn", code: "outline_doc_missing", message: `Outline status is "${c.outlineStatus}" but the outline document is not in local storage.` });
    }

    // Assessments
    if (items.length === 0) {
      push({ ...base, severity: "error", code: "no_assessments", message: "No assessments in the canonical model for this course." });
    }
    const noDate = items.filter((a) => !a.due.iso);
    if (noDate.length) {
      push({
        ...base,
        severity: noDate.length > items.length / 2 ? "error" : "warn",
        code: "assessments_without_dates",
        message: `${noDate.length} of ${items.length} assessment(s) have no due date.`,
        details: titles(noDate),
      });
    }
    const approx = items.filter((a) => a.due.iso && a.due.certainty !== "exact");
    if (approx.length) {
      push({ ...base, severity: "info", code: "assessments_approximate_dates", message: `${approx.length} assessment(s) have approximate/conflicting dates.`, details: titles(approx) });
    }
    const w = summarizeWeights(data, c.id);
    if (w.basis === "none" && items.length) {
      push({ ...base, severity: "warn", code: "no_weights", message: "No assessment or category weights known." });
    } else if (w.total != null && Math.abs(w.total - 100) > WEIGHT_TOLERANCE) {
      push({
        ...base,
        severity: "warn",
        code: "weights_not_100",
        message: `Weights sum to ${w.total}% (basis: ${w.basis}), not 100%.`,
        details: [
          `assessment weight sum: ${w.assessmentWeightSum ?? "n/a"}`,
          `category weight sum: ${w.categoryWeightSum ?? "n/a"}`,
          `assessments missing weight: ${w.assessmentsMissingWeight}`,
        ],
      });
    }
    const seen = new Map<string, number>();
    for (const a of items) seen.set(normTitle(a.title), (seen.get(normTitle(a.title)) ?? 0) + 1);
    const dups = [...seen.entries()].filter(([, n]) => n > 1);
    if (dups.length) {
      push({ ...base, severity: "warn", code: "duplicate_assessments", message: `${dups.length} assessment title(s) appear more than once (possible reconcile miss).`, details: dups.slice(0, 10).map(([t, n]) => `${t} ×${n}`) });
    }
    const unresolved = data.conflicts.filter((x) => x.unresolved && items.some((a) => a.id === x.entityId));
    if (unresolved.length) {
      push({ ...base, severity: "warn", code: "unresolved_conflicts", message: `${unresolved.length} unresolved source conflict(s).`, details: unresolved.slice(0, 8).map((x) => `${x.field} on ${x.entityId}`) });
    }

    // Schedule
    const occ = (data.meetingOccurrences ?? []).filter((o) => o.courseId === c.id);
    const meetings = (data.meetings ?? []).filter((m) => m.courseId === c.id);
    if (occ.length === 0 && meetings.length === 0) {
      push({ ...base, severity: "warn", code: "no_class_times", message: "No lectures/labs/tutorials known — My Day cannot show classes." });
    }

    // Endpoints
    const ct = trace.filter((t) => t.orgUnitId === c.orgUnitId && t.kind !== "outline_candidate");
    const blocked = ct.filter((t) => t.status === 403 || t.status === 401);
    if (blocked.length) {
      push({
        ...base,
        severity: "warn",
        code: "blocked_endpoints",
        message: `${blocked.length} request(s) blocked (401/403).`,
        details: [...new Set(blocked.map((t) => `${t.status} ${endpointTemplate(t.endpoint)}`))].slice(0, 15),
      });
    }
    const failed = ct.filter((t) => !t.ok && t.status !== 403 && t.status !== 401 && t.status !== 404);
    if (failed.length) {
      push({
        ...base,
        severity: "warn",
        code: "failed_endpoints",
        message: `${failed.length} request(s) failed (5xx / network / non-JSON).`,
        details: [...new Set(failed.map((t) => `${t.status} ${endpointTemplate(t.endpoint)}${t.error ? ` — ${t.error}` : ""}`))].slice(0, 15),
      });
    }
    const cov = (data.sourceCoverage ?? []).find((s) => s.courseId === c.id);
    const badCaps = (cov?.capabilities ?? []).filter((x) => x.status === "forbidden" || x.status === "error");
    if (badCaps.length) {
      push({ ...base, severity: "info", code: "coverage_gaps", message: `${badCaps.length} source(s) forbidden/error in coverage.`, details: badCaps.map((x) => `${x.key}: ${x.status}${x.lastError ? ` (${x.lastError})` : ""}`) });
    }
  }

  return out.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);
}
