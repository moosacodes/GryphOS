/**
 * Material-aware linking hints from blueprint schedule + assessments.
 * Week CONTAINS lecture RELATES_TO lab PREPARES_FOR midterm.
 */
import type { EntityLink, EntityLinkKind } from "@/domain/facts";
import type { CourseBlueprint } from "./types";

function link(
  fromId: string,
  toId: string,
  kind: EntityLinkKind,
  confidence: number,
): EntityLink {
  return {
    id: `elink:${kind}:${fromId}:${toId}`,
    fromId,
    toId,
    kind,
    evidenceFactIds: [],
    confidence,
    createdAt: new Date().toISOString(),
  };
}

export function materialLinksFromBlueprint(
  bp: CourseBlueprint,
  assessmentIdByTitle: Map<string, string>,
): EntityLink[] {
  const links: EntityLink[] = [];
  const weeks = bp.scheduleEntities.filter((e) => e.kind === "week" || e.weekNumber != null);
  const lectures = bp.scheduleEntities.filter((e) => e.kind === "lecture");
  const labs = bp.scheduleEntities.filter((e) => e.kind === "lab");
  const midterms = [
    ...bp.scheduleEntities.filter((e) => e.kind === "midterm"),
    ...bp.instances.filter((i) => i.type === "midterm"),
  ];

  for (const week of weeks) {
    const weekId = `schedule:week:${bp.courseId ?? "x"}:${week.weekNumber ?? week.label}`;
    for (const lec of lectures) {
      if (week.weekNumber != null && lec.weekNumber != null && week.weekNumber !== lec.weekNumber) {
        continue;
      }
      const lecId = `schedule:lecture:${bp.courseId ?? "x"}:${lec.label}`;
      links.push(link(weekId, lecId, "CONTAINS", 0.7));
    }
    for (const lab of labs) {
      if (week.weekNumber != null && lab.weekNumber != null && week.weekNumber !== lab.weekNumber) {
        continue;
      }
      const labId = `schedule:lab:${bp.courseId ?? "x"}:${lab.label}`;
      links.push(link(weekId, labId, "CONTAINS", 0.7));
      for (const lec of lectures) {
        if (week.weekNumber != null && lec.weekNumber != null && lec.weekNumber === week.weekNumber) {
          links.push(
            link(
              `schedule:lecture:${bp.courseId ?? "x"}:${lec.label}`,
              labId,
              "ASSOCIATED_WITH",
              0.55,
            ),
          );
        }
      }
    }
  }

  for (const mid of midterms) {
    const midTitle = "label" in mid ? mid.label : mid.title;
    const midId =
      assessmentIdByTitle.get(midTitle.toLowerCase()) ??
      [...assessmentIdByTitle.entries()].find(([k]) => /midterm/i.test(k))?.[1] ??
      `schedule:midterm:${bp.courseId ?? "x"}:${midTitle}`;
    for (const lec of lectures) {
      links.push(
        link(`schedule:lecture:${bp.courseId ?? "x"}:${lec.label}`, midId, "INTRODUCED_DURING", 0.5),
      );
    }
    for (const lab of labs) {
      links.push(
        link(`schedule:lab:${bp.courseId ?? "x"}:${lab.label}`, midId, "PREPARES_FOR", 0.55),
      );
    }
  }

  // Auto-attach specs: relative / category instances → HAS_SPEC deferred to entityLinking content pass
  return links;
}
