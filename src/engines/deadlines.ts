/**
 * Occurrence-relative deadline derivation.
 * NEVER derives from Date.now() / term start / "next Tuesday".
 * Attaches to a SPECIFIC MeetingOccurrence with provenance.
 */
import type { Assessment, AssessmentType } from "@/domain/types";
import type {
  AcademicRule,
  OccurrenceRelativeDeadlineRule,
  RelativeDeadlineRule,
} from "@/domain/rules";
import type { MeetingOccurrence } from "@/domain/meetings";
import {
  addTorontoDays,
  torontoDateTimeIso,
  formatOccurrenceLabel,
} from "@/domain/meetings";
import type { DeadlineSafety } from "@/domain/authority";
import { formatInTimeZone } from "date-fns-tz";
import { UOFG_TIMEZONE } from "@/domain/constants";

function matchesType(a: Assessment, types: AssessmentType[]): boolean {
  if (!types.length) return true;
  return types.includes(a.type);
}

function titleMatches(title: string, pattern: string | null): boolean {
  if (!pattern) return true;
  try {
    return new RegExp(pattern, "i").test(title);
  } catch {
    return title.toLowerCase().includes(pattern.toLowerCase());
  }
}

function extractLabIndex(title: string): number | null {
  const m = title.match(/\b(?:lab|assignment|quiz|a)\s*#?\s*(\d+)\b/i);
  return m ? Number(m[1]) : null;
}

export interface DerivedDeadline {
  assessmentId: string;
  iso: string;
  safety: DeadlineSafety;
  label: string;
  occurrenceId: string;
  ruleId: string;
  explanation: string;
}

function pickOccurrenceForAssessment(
  a: Assessment,
  rule: OccurrenceRelativeDeadlineRule | RelativeDeadlineRule,
  occurrences: MeetingOccurrence[],
): MeetingOccurrence | null {
  const courseOcc = occurrences
    .filter((o) => o.courseId === a.courseId && !o.cancelled)
    .sort((x, y) => x.date.localeCompare(y.date));

  if (rule.kind === "OccurrenceRelativeDeadline") {
    const key = rule.patternKey.toLowerCase();
    const pool = courseOcc.filter((o) => {
      const blob = `${o.kind}:${o.sectionCode ?? ""}`.toLowerCase();
      return blob.includes(key) || o.kind === key || o.id.toLowerCase().includes(key);
    });
    const byIndex = pool.find((o) => o.indexInPattern === rule.introducedAtOccurrenceIndex);
    if (byIndex) return byIndex;
    // Fallback: Lab N → Nth lab occurrence
    const labN = extractLabIndex(a.title);
    if (labN != null) {
      const hit = pool.find((o) => o.indexInPattern === labN);
      if (hit) return hit;
    }
    return pool[rule.introducedAtOccurrenceIndex - 1] ?? null;
  }

  // RelativeDeadline with optional occurrenceIndex
  const kind = rule.fromMeetingKind;
  const pool = courseOcc.filter(
    (o) =>
      o.kind === kind &&
      (rule.dayOfWeek == null ||
        new Date(Date.UTC(+o.date.slice(0, 4), +o.date.slice(5, 7) - 1, +o.date.slice(8, 10))).getUTCDay() ===
          rule.dayOfWeek),
  );
  const idx = rule.occurrenceIndex ?? extractLabIndex(a.title) ?? 1;
  return pool.find((o) => o.indexInPattern === idx) ?? pool[idx - 1] ?? null;
}

function dueFromOccurrence(
  occ: MeetingOccurrence,
  offsetDays: number,
  dueMode: "end_of_occurrence" | "time",
  dueTime: string | null,
): { iso: string; safety: DeadlineSafety; label: string } {
  if (dueMode === "end_of_occurrence" && offsetDays === 0) {
    return {
      iso: occ.endIso,
      safety: "DERIVED",
      label: `End of ${formatOccurrenceLabel(occ)}`,
    };
  }
  const dueYmd = addTorontoDays(occ.date, offsetDays);
  const hm = dueTime ?? "23:59";
  const iso = torontoDateTimeIso(dueYmd, hm);
  const wall = formatInTimeZone(new Date(iso), UOFG_TIMEZONE, "yyyy-MM-dd HH:mm zzz");
  return {
    iso,
    safety: "DERIVED",
    label: `+${offsetDays}d from ${occ.date} → ${wall}`,
  };
}

/**
 * Apply occurrence-relative and indexed relative deadline rules.
 * Does not overwrite exact CourseLink / manual dues.
 */
export function applyOccurrenceDeadlines(
  assessments: Assessment[],
  occurrences: MeetingOccurrence[],
  rules: AcademicRule[],
): { assessments: Assessment[]; derived: DerivedDeadline[] } {
  const deadlineRules = rules.filter(
    (r): r is OccurrenceRelativeDeadlineRule | RelativeDeadlineRule =>
      r.kind === "OccurrenceRelativeDeadline" || r.kind === "RelativeDeadline",
  );
  if (!deadlineRules.length) return { assessments, derived: [] };

  const derived: DerivedDeadline[] = [];

  const out = assessments.map((a) => {
    if (a.manualOverrides?.due) return a;
    if (a.due.certainty === "exact" && a.due.iso) {
      const prov = a.fieldProvenance.due?.sourceType;
      if (prov === "courselink_dropbox" || prov === "courselink_quiz" || prov === "manual") {
        return a;
      }
    }

    for (const rule of deadlineRules) {
      if (rule.courseId && rule.courseId !== a.courseId) continue;
      if (!matchesType(a, rule.applyToTypes)) continue;
      if (rule.kind === "OccurrenceRelativeDeadline" && !titleMatches(a.title, rule.assessmentTitlePattern)) {
        continue;
      }

      const occ = pickOccurrenceForAssessment(a, rule, occurrences);
      if (!occ) continue;

      const offsetDays = rule.offsetDays;
      const dueMode = rule.kind === "OccurrenceRelativeDeadline" ? rule.dueMode : "time";
      const dueTime =
        rule.kind === "OccurrenceRelativeDeadline" ? rule.dueTime : rule.dueTime;
      const { iso, safety, label } = dueFromOccurrence(occ, offsetDays, dueMode, dueTime);

      const explanation =
        `Assessment "${a.title}" linked to occurrence ${occ.id} ` +
        `(${formatOccurrenceLabel(occ)}). Rule "${rule.label}" ` +
        `(${rule.kind}): offsetDays=${offsetDays}, dueMode=${dueMode}. ` +
        `Derived due ${formatInTimeZone(new Date(iso), UOFG_TIMEZONE, "yyyy-MM-dd HH:mm")} America/Toronto.`;

      derived.push({
        assessmentId: a.id,
        iso,
        safety,
        label,
        occurrenceId: occ.id,
        ruleId: rule.id,
        explanation,
      });

      return {
        ...a,
        due: {
          certainty: "approximate" as const,
          iso,
          label: `${rule.label} (${label})`,
        },
        fieldProvenance: {
          ...a.fieldProvenance,
          due: {
            value: { certainty: "approximate", iso, label, safety, occurrenceId: occ.id },
            sourceType: "rule_engine" as const,
            sourceId: rule.id,
            confidence: rule.confidence,
            retrievedAt: new Date().toISOString(),
          },
        },
        notes: a.notes
          ? `${a.notes}\n${explanation}`
          : explanation,
        updatedAt: new Date().toISOString(),
      };
    }
    return a;
  });

  return { assessments: out, derived };
}

export function deadlineSafetyFromAssessment(a: Assessment): DeadlineSafety {
  if (a.manualOverrides?.due) return "EXACT_USER_OVERRIDE";
  if (a.due.certainty === "conflicting") return "EXACT_SOURCE_CONFLICT";
  if (a.due.certainty === "exact" && a.due.iso) {
    const st = a.fieldProvenance.due?.sourceType;
    if (st === "courselink_dropbox" || st === "courselink_quiz" || st === "uofg_academic_date") {
      return "EXACT_AUTHORITATIVE";
    }
    return "EXACT_AUTHORITATIVE";
  }
  if (a.due.certainty === "approximate" && a.fieldProvenance.due?.sourceType === "rule_engine") {
    return "DERIVED";
  }
  if (a.due.certainty === "approximate") return "APPROXIMATE";
  if (a.due.label && !a.due.iso) return "TBD";
  return "UNKNOWN";
}
