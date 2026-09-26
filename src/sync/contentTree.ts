/**
 * Persist Brightspace content TOC as local CourseContentModule / CourseContentItem trees.
 */
import type { RawContentModule } from "@/adapters/courselink/raw";
import { buildDeepContentTree } from "@/ingestion/contentIngest";
import type { CourseContentItem, CourseContentModule } from "@/domain/content";

export function buildContentTree(
  courseId: string,
  orgUnitId: number,
  modules: RawContentModule[],
  assessmentNames: string[] = [],
): { modules: CourseContentModule[]; items: CourseContentItem[] } {
  return buildDeepContentTree(courseId, orgUnitId, modules, assessmentNames);
}
