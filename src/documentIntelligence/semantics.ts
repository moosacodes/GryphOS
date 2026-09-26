/**
 * Multi-pass semantics over DocumentLayout → CourseBlueprint.
 * Identity, People, Structure, Assessment instances, Categories, Dates, Relative.
 */
import { parseOutlineText, parseDateLabel, inferAssessmentType } from "@/adapters/outline/parse";
import type { DateCertainty, OutlineParseResult } from "@/domain/types";
import { expandInstances } from "./instances";
import { extractRelativeDeadlineRules, applyLabOccurrences } from "./relativeDeadlines";
import { scoreExtraction, secondPassBlueprint } from "./quality";
import type {
  BlueprintAssessmentInstance,
  BlueprintCategory,
  BlueprintPerson,
  BlueprintScheduleEntity,
  CourseBlueprint,
  DocumentLayout,
  SourceCitation,
} from "./types";

function simpleHash(s: string): string {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16);
}

function citationFromTable(
  page: number,
  snippet: string,
  confidence: number,
): SourceCitation {
  return {
    page,
    snippet: snippet.slice(0, 200),
    bbox: null,
    confidence,
    viewLabel: "View source",
  };
}

function mapHeaderIndexes(header: string[]): { title: number; weight: number; due: number } {
  const low = header.map((h) => h.toLowerCase());
  const find = (...keys: string[]) => low.findIndex((h) => keys.some((k) => h.includes(k)));
  let title = find("assessment", "component", "item", "activity", "deliverable", "evaluation", "description", "week", "topic");
  let weight = find("weight", "mark", "percent", "%", "value");
  const due = find("due", "date", "deadline", "when");
  if (title < 0) title = 0;
  if (weight < 0 && header.length >= 2) weight = 1;
  return { title, weight, due };
}

function parseWeight(cell: string | undefined): number | null {
  if (!cell) return null;
  const m = cell.match(/(\d{1,3}(?:\.\d+)?)\s*%?/);
  if (!m) return null;
  const n = Number(m[1]);
  return n >= 0 && n <= 100 ? n : null;
}

function dueKind(label: string | null, iso: string | null): BlueprintAssessmentInstance["due"]["kind"] {
  if (iso) return "exact";
  if (!label) return "unknown";
  if (/\bweek\s*\d+/i.test(label)) return "week";
  if (/\b(tbd|tba|exam\s*period|see\s+course)/i.test(label)) return "tbd";
  if (/\d+\s*days?\s+after/i.test(label)) return "relative";
  if (/\bto\b|\b-\b|\b–\b/.test(label) && /\d/.test(label)) return "range";
  return "unknown";
}

function assessmentsFromTables(layout: DocumentLayout, year?: number): {
  instances: BlueprintAssessmentInstance[];
  categories: BlueprintCategory[];
} {
  const instances: BlueprintAssessmentInstance[] = [];
  const categories: BlueprintCategory[] = [];
  const seen = new Set<string>();

  for (const page of layout.pages) {
    for (const table of page.tables) {
      if (table.kind !== "assessment" && table.kind !== "other") continue;
      const idx = mapHeaderIndexes(table.headers);
      for (const row of table.rows) {
        const titleRaw = (row[idx.title] ?? row[0] ?? "").replace(/^[-*\d.)\s]+/, "").trim();
        if (!titleRaw || /^total$/i.test(titleRaw)) continue;
        if (/^(assessment|component|weight|due|date)$/i.test(titleRaw)) continue;
        const key = titleRaw.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        let weight = idx.weight >= 0 ? parseWeight(row[idx.weight]) : null;
        if (weight == null) {
          const anywhere = row.join(" ").match(/(\d{1,3}(?:\.\d+)?)\s*%/);
          if (anywhere) weight = Number(anywhere[1]);
        }
        const dueLabel = idx.due >= 0 && row[idx.due] ? row[idx.due] : null;
        const parsed = dueLabel
          ? parseDateLabel(dueLabel, year)
          : { iso: null, certainty: "unknown" as DateCertainty, label: "" };
        const citation = citationFromTable(table.page, row.join(" | "), table.confidence);
        const expanded = expandInstances({
          title: titleRaw,
          type: inferAssessmentType(titleRaw),
          weightPercent: weight,
          dueLabel: dueLabel ? parsed.label || dueLabel : null,
          dueIso: parsed.iso,
          certainty: dueLabel ? parsed.certainty : "unknown",
          confidence: table.confidence,
          citation,
          sourceSnippet: row.join(" | ").slice(0, 200),
        });
        if (expanded.category) categories.push(expanded.category);
        // For single-row non-category, fix due kind from label
        for (const inst of expanded.instances) {
          if (expanded.instances.length === 1) {
            inst.due.kind = dueKind(inst.due.label, inst.due.iso);
            const wm = (inst.due.label ?? "").match(/\bweek\s*(\d+)/i);
            inst.due.weekNumber = wm ? Number(wm[1]) : inst.due.weekNumber;
          }
          instances.push(inst);
        }
      }
    }
  }
  return { instances, categories };
}

function scheduleFromTables(layout: DocumentLayout): BlueprintScheduleEntity[] {
  const out: BlueprintScheduleEntity[] = [];
  for (const page of layout.pages) {
    for (const table of page.tables) {
      if (table.kind !== "schedule") continue;
      for (const row of table.rows) {
        const label = row.join(" — ").slice(0, 120);
        const weekM = label.match(/\bweek\s*(\d+)/i) ?? (row[0] ?? "").match(/^(\d+)\b/);
        const weekNumber = weekM ? Number(weekM[1]) : null;
        let kind: BlueprintScheduleEntity["kind"] = "week";
        if (/zybook/i.test(label)) kind = "zybook";
        else if (/midterm/i.test(label)) kind = "midterm";
        else if (/\blab\b/i.test(label)) kind = "lab";
        else if (/lecture/i.test(label)) kind = "lecture";
        out.push({
          kind,
          label,
          weekNumber,
          citation: citationFromTable(table.page, label, table.confidence),
        });
      }
    }
  }
  return out;
}

function mergeOutlineFallback(
  layoutInstances: BlueprintAssessmentInstance[],
  layoutCategories: BlueprintCategory[],
  outline: OutlineParseResult,
): { instances: BlueprintAssessmentInstance[]; categories: BlueprintCategory[] } {
  if (layoutInstances.length >= 2) {
    // Still absorb grading categories from text parse
    const cats = [...layoutCategories];
    for (const c of outline.categories ?? []) {
      if (!cats.some((x) => x.name.toLowerCase() === c.name.toLowerCase())) {
        cats.push({
          name: c.name,
          weightPercent: c.weightPercent,
          promisedCount: null,
          bestN: c.bestN,
          dropLowest: c.dropLowest,
          instanceWeight: null,
          citation: null,
        });
      }
    }
    return { instances: layoutInstances, categories: cats };
  }
  const instances: BlueprintAssessmentInstance[] = [];
  const categories: BlueprintCategory[] = [...layoutCategories];
  for (const a of outline.assessments) {
    const expanded = expandInstances({
      title: a.title,
      type: a.type,
      weightPercent: a.weightPercent,
      dueLabel: a.dueLabel,
      dueIso: a.dueIso,
      certainty: a.certainty,
      confidence: a.confidence,
      citation: a.sourceSnippet
        ? { page: null, snippet: a.sourceSnippet, bbox: null, confidence: a.confidence, viewLabel: "View source" }
        : null,
      sourceSnippet: a.sourceSnippet,
    });
    if (expanded.category) categories.push(expanded.category);
    instances.push(...expanded.instances);
  }
  for (const c of outline.categories ?? []) {
    if (!categories.some((x) => x.name.toLowerCase() === c.name.toLowerCase())) {
      categories.push({
        name: c.name,
        weightPercent: c.weightPercent,
        promisedCount: null,
        bestN: c.bestN,
        dropLowest: c.dropLowest,
        instanceWeight: null,
        citation: null,
      });
    }
  }
  return { instances, categories };
}

export function buildCourseBlueprint(
  layout: DocumentLayout,
  opts: {
    courseId?: string | null;
    documentId?: string | null;
    labOccurrenceIsoByWeek?: Record<number, string>;
  } = {},
): CourseBlueprint {
  const outline = parseOutlineText(layout.readingText, {
    lines: layout.pages.flatMap((p) =>
      p.lines.map((l) => ({
        page: l.page,
        y: l.bbox.y,
        text: l.text,
        tokens: l.spans.map((s) => ({ str: s.text, x: s.x, y: s.y, w: s.w })),
      })),
    ),
  });

  const year = outline.term?.match(/(\d{4})/)?.[1]
    ? Number(outline.term.match(/(\d{4})/)![1])
    : undefined;

  const fromTables = assessmentsFromTables(layout, year);
  const merged = mergeOutlineFallback(fromTables.instances, fromTables.categories, outline);
  const scheduleEntities = scheduleFromTables(layout);

  // Relative deadlines from full text
  const relativeDeadlines = applyLabOccurrences(
    extractRelativeDeadlineRules(layout.readingText),
    opts.labOccurrenceIsoByWeek ?? {},
  );

  // Attach relative rules to matching instances
  for (const rule of relativeDeadlines) {
    const hint = rule.assessmentTitleHint.toLowerCase();
    const inst = merged.instances.find((i) => i.title.toLowerCase().includes(hint.replace(/\s+/g, " ").slice(0, 20)) || hint.includes(i.title.toLowerCase().slice(0, 8)));
    if (inst && !inst.due.iso) {
      inst.due.kind = "relative";
      inst.due.relativeRuleId = rule.id;
      inst.due.label = rule.raw.slice(0, 80);
      inst.due.iso = rule.resolvedCandidateIso;
      inst.certainty = rule.approx || !rule.resolvedCandidateIso ? "approximate" : "approximate";
      inst.citation = rule.citation;
    }
  }

  const people: BlueprintPerson[] = [
    ...outline.instructors.map((i) => ({
      name: i.name,
      email: i.email,
      role: "instructor" as const,
      citation: null,
    })),
    ...outline.tas.map((t) => ({
      name: t.name,
      email: t.email,
      role: "ta" as const,
      citation: null,
    })),
  ];

  const studentSectionNeeded = !!(
    /\b(lab|lecture|tutorial)\s*sections?\b/i.test(layout.readingText) &&
    /\b(register|enrol|enroll|your\s+section)\b/i.test(layout.readingText)
  );

  const tableCount = layout.pages.reduce((s, p) => s + p.tables.length, 0);
  const quality = scoreExtraction({
    courseCode: outline.courseCode,
    instructors: outline.instructors.length,
    instances: merged.instances,
    categories: merged.categories,
    tableCount,
    hasSchedule: scheduleEntities.length > 0 || outline.scheduleLines.length > 0,
    policies: outline.policies.length,
  });

  // Enrich outline assessments from blueprint instances for applyOutline compat
  const enrichedOutline: OutlineParseResult = {
    ...outline,
    assessments: merged.instances.map((inst) => ({
      title: inst.title,
      type: inst.type,
      weightPercent: inst.weightPercent,
      dueLabel: inst.due.label,
      dueIso: inst.due.iso,
      certainty: inst.certainty,
      confidence: inst.confidence,
      category: inst.categoryName,
      sourceSnippet: inst.sourceSnippet,
      sourcePage: inst.citation?.page ?? null,
      instanceIndex: inst.index,
      dueKind: inst.due.kind,
      relativeRuleId: inst.due.relativeRuleId,
    })),
    categories: merged.categories.map((c) => ({
      name: c.name,
      weightPercent: c.weightPercent,
      dropLowest: c.dropLowest,
      bestN: c.bestN,
    })),
    confidence: Math.max(outline.confidence, quality.score),
    diagnostics: [
      ...outline.diagnostics,
      {
        pass: "document_intelligence",
        message: `layout pages=${layout.pageCount} tables=${tableCount} method=${layout.extractionMethod} quality=${quality.score.toFixed(2)}`,
      },
    ],
  };

  let bp: CourseBlueprint = {
    id: `blueprint:${opts.documentId ?? simpleHash(layout.readingText.slice(0, 500))}`,
    courseId: opts.courseId ?? null,
    documentId: opts.documentId ?? null,
    courseCode: outline.courseCode,
    courseTitle: outline.courseTitle,
    term: outline.term,
    offeredSectionHint: null,
    studentSectionNeeded,
    people,
    categories: merged.categories,
    instances: merged.instances,
    relativeDeadlines,
    scheduleEntities,
    officeHours: outline.officeHours,
    policies: outline.policies.map((p) => ({ ...p, citation: null })),
    textbooks: outline.textbooks,
    quality,
    outlineParse: enrichedOutline,
    layoutSummary: {
      pageCount: layout.pageCount,
      tableCount,
      imageCount: layout.pages.reduce((s, p) => s + p.images.length, 0),
      ocrPages: layout.pages.filter((p) => p.ocrApplied).length,
      extractionMethod: layout.extractionMethod,
    },
    createdAt: new Date().toISOString(),
    contentHash: simpleHash(layout.readingText),
  };

  if (quality.contradictions.length || quality.incomplete) {
    bp = secondPassBlueprint(bp);
    bp.outlineParse = {
      ...bp.outlineParse,
      assessments: bp.instances.map((inst) => ({
        title: inst.title,
        type: inst.type,
        weightPercent: inst.weightPercent,
        dueLabel: inst.due.label,
        dueIso: inst.due.iso,
        certainty: inst.certainty,
        confidence: inst.confidence,
        category: inst.categoryName,
        sourceSnippet: inst.sourceSnippet,
        sourcePage: inst.citation?.page ?? null,
        instanceIndex: inst.index,
        dueKind: inst.due.kind,
        relativeRuleId: inst.due.relativeRuleId,
      })),
      confidence: Math.max(bp.outlineParse.confidence, bp.quality.score),
    };
  }

  return bp;
}
