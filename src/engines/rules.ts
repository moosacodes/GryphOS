/**
 * Generic academic RULE ENGINE — never hardcodes course IDs.
 * Rules carry courseId as data; matching is by category/type/section/params.
 */
import type {
  AcademicRule,
  Assessment,
  AssessmentType,
  GradeCategory,
  Meeting,
} from "@/domain/types";

function asNum(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) return Number(v);
  return null;
}

function asStr(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v : null;
}

function matchesType(a: Assessment, types: unknown): boolean {
  if (!Array.isArray(types) || types.length === 0) return true;
  return types.map(String).includes(a.type);
}

/** Derive due dates: meeting dayOfWeek + offsetDays (e.g. Tue lab → due +8 days). */
export function applyRelativeDeadlines(
  assessments: Assessment[],
  meetings: Meeting[],
  rules: AcademicRule[],
  termStartIso?: string | null,
): Assessment[] {
  const rel = rules.filter((r) => r.kind === "relative_deadline");
  if (!rel.length) return assessments;

  const anchor = termStartIso ? Date.parse(termStartIso) : Date.now();

  return assessments.map((a) => {
    // Never overwrite exact CourseLink / manual dues
    if (a.manualOverrides.due) return a;
    if (a.due.certainty === "exact" && a.due.iso) {
      const prov = a.fieldProvenance.due?.sourceType;
      if (prov === "courselink_dropbox" || prov === "courselink_quiz" || prov === "manual") {
        return a;
      }
    }

    for (const rule of rel) {
      if (rule.courseId && rule.courseId !== a.courseId) continue;
      if (!matchesType(a, rule.params.applyToTypes)) continue;
      const meetingKind = asStr(rule.params.fromMeetingKind) ?? "lab";
      const dayOfWeek = asNum(rule.params.dayOfWeek);
      const offsetDays = asNum(rule.params.offsetDays) ?? 0;
      const meeting = meetings.find(
        (m) =>
          m.courseId === a.courseId &&
          m.kind === meetingKind &&
          (dayOfWeek == null || m.dayOfWeek === dayOfWeek),
      );
      if (!meeting || meeting.dayOfWeek == null) continue;

      // Next occurrence of meeting weekday from term start (or now), then + offset
      const start = new Date(Number.isFinite(anchor) ? anchor : Date.now());
      const delta = (meeting.dayOfWeek - start.getDay() + 7) % 7;
      const meetDay = new Date(start);
      meetDay.setHours(0, 0, 0, 0);
      meetDay.setDate(meetDay.getDate() + delta);
      const due = new Date(meetDay);
      due.setDate(due.getDate() + offsetDays);
      if (meeting.endTime) {
        const [hh, mm] = meeting.endTime.split(":").map(Number);
        due.setHours(hh || 23, mm || 59, 0, 0);
      } else {
        due.setHours(23, 59, 0, 0);
      }
      const iso = due.toISOString();
      return {
        ...a,
        due: {
          certainty: "approximate",
          iso,
          label: `${rule.label} (derived)`,
        },
        fieldProvenance: {
          ...a.fieldProvenance,
          due: {
            value: { certainty: "approximate", iso, label: rule.label },
            sourceType: "rule_engine",
            sourceId: rule.id,
            confidence: rule.confidence,
            retrievedAt: new Date().toISOString(),
          },
        },
        updatedAt: new Date().toISOString(),
      };
    }
    return a;
  });
}

/** Section-relative: offset from the student's lab/lecture section meeting. */
export function applySectionRelativeDeadlines(
  assessments: Assessment[],
  meetings: Meeting[],
  rules: AcademicRule[],
  labSection: string | null,
): Assessment[] {
  const rulesList = rules.filter((r) => r.kind === "section_relative");
  if (!rulesList.length) return assessments;

  return assessments.map((a) => {
    if (a.manualOverrides.due) return a;
    for (const rule of rulesList) {
      if (rule.courseId && rule.courseId !== a.courseId) continue;
      if (!matchesType(a, rule.params.applyToTypes)) continue;
      const kind = asStr(rule.params.sectionKind) ?? "lab";
      const offsetDays = asNum(rule.params.offsetDays) ?? 0;
      const meeting = meetings.find(
        (m) =>
          m.courseId === a.courseId &&
          m.kind === kind &&
          (!labSection || !m.sectionCode || m.sectionCode === labSection),
      );
      if (!meeting || meeting.dayOfWeek == null) continue;
      const start = new Date();
      start.setHours(0, 0, 0, 0);
      const delta = (meeting.dayOfWeek - start.getDay() + 7) % 7;
      const meetDay = new Date(start);
      meetDay.setDate(meetDay.getDate() + delta);
      const due = new Date(meetDay);
      due.setDate(due.getDate() + offsetDays);
      due.setHours(23, 59, 0, 0);
      const iso = due.toISOString();
      return {
        ...a,
        due: { certainty: "approximate", iso, label: `${rule.label} (section)` },
        fieldProvenance: {
          ...a.fieldProvenance,
          due: {
            value: { certainty: "approximate", iso, label: rule.label },
            sourceType: "rule_engine",
            sourceId: rule.id,
            confidence: rule.confidence,
            retrievedAt: new Date().toISOString(),
          },
        },
        updatedAt: new Date().toISOString(),
      };
    }
    return a;
  });
}

export interface RuleGradeEffect {
  droppedIds: Set<string>;
  cappedCoursePercent: number | null;
  capReason: string | null;
}

/**
 * Apply best_n / drop_lowest / grade_cap / threshold.
 * Missed items are excluded from "scored" pools unless explicitly counted as zero by user.
 * Dropped ≠ missed.
 */
export function applyGradeRules(
  assessments: Assessment[],
  categories: GradeCategory[],
  rules: AcademicRule[],
): RuleGradeEffect {
  const droppedIds = new Set<string>();
  const courseId = assessments[0]?.courseId;

  const percent = (a: Assessment): number | null => {
    if (a.state?.missed && a.pointsEarned == null) return null; // missed ≠ zero
    if (a.pointsEarned != null && a.pointsPossible && a.pointsPossible > 0) {
      return (a.pointsEarned / a.pointsPossible) * 100;
    }
    if (a.gradeDisplay) {
      const m = a.gradeDisplay.match(/(\d+(?:\.\d+)?)\s*%/);
      if (m) return Number(m[1]);
    }
    return null;
  };

  // Category-level bestN / dropLowest
  for (const cat of categories.filter((c) => !courseId || c.courseId === courseId)) {
    const members = assessments.filter(
      (a) => a.categoryId === cat.id || (cat.name && a.title.toLowerCase().includes(cat.name.toLowerCase())),
    );
    if (cat.dropLowest > 0) {
      const scored = members
        .map((a) => ({ a, p: percent(a) }))
        .filter((x) => x.p != null && !x.a.state?.missed)
        .sort((x, y) => x.p! - y.p!);
      for (let i = 0; i < cat.dropLowest && i < scored.length; i++) droppedIds.add(scored[i].a.id);
    }
    if (cat.bestN != null && cat.bestN > 0) {
      const scored = members
        .map((a) => ({ a, p: percent(a) }))
        .filter((x) => x.p != null && !x.a.state?.missed)
        .sort((x, y) => y.p! - x.p!);
      const keep = new Set(scored.slice(0, cat.bestN).map((x) => x.a.id));
      for (const m of members) {
        if (percent(m) != null && !m.state?.missed && !keep.has(m.id)) droppedIds.add(m.id);
      }
    }
  }

  // Rule-level best_n / drop_lowest by type
  for (const rule of rules) {
    if (courseId && rule.courseId && rule.courseId !== courseId) continue;
    const types = (rule.params.applyToTypes as AssessmentType[] | undefined) ?? [];
    const pool = assessments.filter((a) => matchesType(a, types));
    if (rule.kind === "drop_lowest") {
      const n = asNum(rule.params.n) ?? 0;
      const scored = pool
        .map((a) => ({ a, p: percent(a) }))
        .filter((x) => x.p != null && !x.a.state?.missed)
        .sort((x, y) => x.p! - y.p!);
      for (let i = 0; i < n && i < scored.length; i++) droppedIds.add(scored[i].a.id);
    }
    if (rule.kind === "best_n") {
      const n = asNum(rule.params.n) ?? 0;
      const of = asNum(rule.params.of);
      const scored = pool
        .map((a) => ({ a, p: percent(a) }))
        .filter((x) => x.p != null && !x.a.state?.missed)
        .sort((x, y) => y.p! - x.p!);
      const keepN = n > 0 ? n : of != null ? Math.max(0, scored.length - 0) : 0;
      const keep = new Set(scored.slice(0, keepN).map((x) => x.a.id));
      for (const m of pool) {
        if (percent(m) != null && !m.state?.missed && !keep.has(m.id)) droppedIds.add(m.id);
      }
    }
  }

  // Threshold / grade_cap (e.g. must hit exam threshold or course capped)
  let cappedCoursePercent: number | null = null;
  let capReason: string | null = null;
  for (const rule of rules) {
    if (courseId && rule.courseId && rule.courseId !== courseId) continue;
    if (rule.kind !== "threshold" && rule.kind !== "grade_cap") continue;
    const types = (rule.params.applyToTypes as AssessmentType[] | undefined) ?? ["final", "midterm"];
    const threshold = asNum(rule.params.thresholdPercent);
    const cap = asNum(rule.params.capPercent);
    const target = assessments.find((a) => matchesType(a, types) && percent(a) != null);
    if (!target || threshold == null) continue;
    const p = percent(target);
    if (p != null && p < threshold && cap != null) {
      cappedCoursePercent = cap;
      capReason = rule.label;
    }
  }
  for (const cat of categories) {
    if (cat.thresholdPercent != null && cat.gradeCapPercent != null) {
      const members = assessments.filter((a) => a.categoryId === cat.id);
      const exam = members.find((a) => percent(a) != null) ?? assessments.find((a) => a.type === "final");
      const p = exam ? percent(exam) : null;
      if (p != null && p < cat.thresholdPercent) {
        cappedCoursePercent = cat.gradeCapPercent;
        capReason = `${cat.name} below ${cat.thresholdPercent}%`;
      }
    }
  }

  return { droppedIds, cappedCoursePercent, capReason };
}

export function rulesFromOutlineHints(
  courseId: string,
  gradingRules: Array<{ kind: string; label: string; n: number | null; category: string | null }>,
): AcademicRule[] {
  return gradingRules.map((g, i) => ({
    id: `rule:${courseId}:${g.kind}:${i}`,
    courseId,
    kind: g.kind === "best_n" || g.kind === "drop_lowest" ? g.kind : "best_n",
    label: g.label,
    params: {
      n: g.n,
      applyToTypes: g.category
        ? g.category.toLowerCase().includes("quiz")
          ? ["quiz"]
          : g.category.toLowerCase().includes("lab")
            ? ["lab"]
            : ["assignment"]
        : ["quiz"],
      category: g.category,
    },
    sourceType: "course_outline" as const,
    confidence: 0.8,
  }));
}
