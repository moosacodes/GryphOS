/**
 * Expand category rows into assessment instances.
 * Examples: "Assignments 3×15%" → A1/A2/A3; "11 quizzes best 10" → Quiz 1..11.
 */
import type { AssessmentType } from "@/domain/types";
import { inferAssessmentType } from "@/adapters/outline/parse";
import type { BlueprintAssessmentInstance, BlueprintCategory, SourceCitation } from "./types";

const MULT =
  /\b(\d+)\s*[x×]\s*(\d{1,3}(?:\.\d+)?)\s*%/i;
const COUNT_WEIGHT =
  /\((\d+)\s*(?:assignments?|quizzes?|labs?|projects?|tests?)?\)\s*[-:]?\s*(\d{1,3}(?:\.\d+)?)\s*%/i;
const BEST_OF =
  /\bbest\s*(?:of\s*)?(\d+)\s*(?:of\s*)?(\d+)/i;
const N_OF_M =
  /\b(\d+)\s*(quizzes?|labs?|assignments?|tests?|homeworks?|projects?)\b(?:[^%]{0,40}?)\b(\d{1,3}(?:\.\d+)?)\s*%/i;

function singular(type: AssessmentType, categoryName: string): string {
  if (type === "quiz") return "Quiz";
  if (type === "lab") return "Lab";
  if (type === "assignment") return "Assignment";
  if (type === "project") return "Project";
  if (type === "midterm") return "Midterm";
  const base = categoryName.replace(/\(.*?\)/g, "").replace(/s\b/i, "").trim();
  return base || "Item";
}

export function parseCategoryExpansion(title: string, weightPercent: number | null): {
  count: number | null;
  instanceWeight: number | null;
  bestN: number | null;
  dropLowest: number;
  cleanName: string;
} {
  let count: number | null = null;
  let instanceWeight: number | null = null;
  let bestN: number | null = null;
  let dropLowest = 0;

  const mult = title.match(MULT);
  if (mult) {
    count = Number(mult[1]);
    instanceWeight = Number(mult[2]);
  }
  const cw = title.match(COUNT_WEIGHT);
  if (cw) {
    count = Number(cw[1]);
    if (weightPercent != null && count > 0) instanceWeight = weightPercent / count;
  }
  const best = title.match(BEST_OF);
  if (best) {
    bestN = Number(best[1]);
    const total = best[2] ? Number(best[2]) : null;
    if (total != null) count = total;
    if (bestN != null && count != null && count > bestN) dropLowest = count - bestN;
  }
  const nom = title.match(N_OF_M);
  if (nom && count == null) {
    count = Number(nom[1]);
    if (weightPercent == null) {
      /* weight in group 3 is category weight */
    }
  }
  // "Quizzes (best 5 of 7) 15%"
  const bestOf7 = title.match(/\bbest\s*(\d+)\s*of\s*(\d+)/i);
  if (bestOf7) {
    bestN = Number(bestOf7[1]);
    count = Number(bestOf7[2]);
    dropLowest = count - bestN;
  }

  const cleanName = title
    .replace(MULT, "")
    .replace(/\bbest\s*\d+\s*of\s*\d+/gi, "")
    .replace(/\(\s*\d+\s*\)/g, "")
    .replace(/\s{2,}/g, " ")
    .replace(/[()]/g, " ")
    .trim();

  return { count, instanceWeight, bestN, dropLowest, cleanName: cleanName || title };
}

export function expandInstances(input: {
  title: string;
  type?: AssessmentType;
  weightPercent: number | null;
  dueLabel: string | null;
  dueIso: string | null;
  certainty: BlueprintAssessmentInstance["certainty"];
  confidence: number;
  citation: SourceCitation | null;
  sourceSnippet: string | null;
}): { category: BlueprintCategory | null; instances: BlueprintAssessmentInstance[] } {
  const type = input.type ?? inferAssessmentType(input.title);
  const exp = parseCategoryExpansion(input.title, input.weightPercent);
  const looksCategory =
    (exp.count != null && exp.count >= 2) ||
    exp.bestN != null ||
    /\b(quizzes|labs|assignments|homeworks|projects)\b/i.test(input.title);

  if (!looksCategory || (exp.count == null && exp.bestN == null)) {
    return {
      category: null,
      instances: [
        {
          title: input.title.slice(0, 120),
          type,
          weightPercent: input.weightPercent,
          index: null,
          categoryName: null,
          due: {
            kind: input.dueIso
              ? "exact"
              : /\bweek\s*\d+/i.test(input.dueLabel ?? "")
                ? "week"
                : /\b(tbd|tba|exam\s*period)\b/i.test(input.dueLabel ?? "")
                  ? "tbd"
                  : input.dueLabel
                    ? "unknown"
                    : "unknown",
            iso: input.dueIso,
            endIso: null,
            label: input.dueLabel,
            weekNumber: (() => {
              const m = (input.dueLabel ?? "").match(/\bweek\s*(\d+)/i);
              return m ? Number(m[1]) : null;
            })(),
            relativeRuleId: null,
          },
          certainty: input.certainty,
          confidence: input.confidence,
          citation: input.citation,
          sourceSnippet: input.sourceSnippet,
        },
      ],
    };
  }

  const count = exp.count ?? (exp.bestN != null ? exp.bestN + (exp.dropLowest || 0) : 1);
  const catWeight = input.weightPercent;
  const per =
    exp.instanceWeight ??
    (catWeight != null && count > 0 ? Math.round((catWeight / count) * 1000) / 1000 : null);
  const base = singular(type, exp.cleanName);
  const category: BlueprintCategory = {
    name: exp.cleanName || base,
    weightPercent: catWeight,
    promisedCount: count,
    bestN: exp.bestN,
    dropLowest: exp.dropLowest,
    instanceWeight: per,
    citation: input.citation,
  };

  const instances: BlueprintAssessmentInstance[] = [];
  for (let i = 1; i <= count; i++) {
    instances.push({
      title: `${base} ${i}`,
      type,
      weightPercent: per,
      index: i,
      categoryName: category.name,
      due: {
        kind: "unknown",
        iso: null,
        endIso: null,
        label: input.dueLabel,
        weekNumber: null,
        relativeRuleId: null,
      },
      certainty: input.dueLabel ? input.certainty : "unknown",
      confidence: Math.min(input.confidence, 0.8),
      citation: input.citation,
      sourceSnippet: input.sourceSnippet,
    });
  }
  return { category, instances };
}
