/**
 * Persist Brightspace content TOC as local CourseContentModule / CourseContentItem trees.
 */
import type { RawContentModule, RawContentTopic } from "@/adapters/courselink/raw";
import { classifyDocument, type CourseContentItem, type CourseContentModule } from "@/domain/content";
import { COURSELINK_ORIGIN } from "@/domain/constants";

function modId(courseId: string, raw: RawContentModule, fallback: string): string {
  const id = raw.ModuleId ?? raw.Id;
  return `content-mod:${courseId}:${id ?? fallback}`;
}

function topicId(courseId: string, t: RawContentTopic, fallback: string): string {
  const id = t.TopicId ?? t.Id ?? t.Identifier;
  return `content-item:${courseId}:${id ?? fallback}`;
}

function topicUrl(ou: number, t: RawContentTopic): string | null {
  if (t.Url) {
    if (/^https?:\/\//i.test(t.Url)) return t.Url;
    return `${COURSELINK_ORIGIN}${t.Url.startsWith("/") ? "" : "/"}${t.Url}`;
  }
  const id = t.TopicId ?? t.Id;
  if (id != null) {
    return `${COURSELINK_ORIGIN}/d2l/le/content/${ou}/viewContent/${id}/View`;
  }
  return null;
}

export function buildContentTree(
  courseId: string,
  orgUnitId: number,
  modules: RawContentModule[],
): { modules: CourseContentModule[]; items: CourseContentItem[] } {
  const outMods: CourseContentModule[] = [];
  const outItems: CourseContentItem[] = [];
  let order = 0;

  function walk(mods: RawContentModule[], parentModuleId: string | null) {
    for (const m of mods) {
      if (m.IsHidden) continue;
      order += 1;
      const id = modId(courseId, m, `o${order}`);
      outMods.push({
        id,
        courseId,
        title: m.Title ?? "Module",
        sortOrder: order,
        parentModuleId,
      });
      for (const t of m.Topics ?? []) {
        if (t.IsHidden || t.IsBroken) continue;
        outItems.push({
          id: topicId(courseId, t, `${id}:${t.Title}`),
          moduleId: id,
          courseId,
          title: t.Title ?? "Untitled",
          url: topicUrl(orgUnitId, t),
          documentClass: classifyDocument(t.Title ?? ""),
          contentHash: null,
          updatedAt: t.LastModifiedDate ?? null,
        });
      }
      if (m.Modules?.length) walk(m.Modules, id);
      for (const node of m.Structure ?? []) {
        const asTopic = node as RawContentTopic;
        if ((asTopic.TopicId != null || asTopic.Type === 1) && asTopic.Title) {
          if (asTopic.IsHidden || asTopic.IsBroken) continue;
          outItems.push({
            id: topicId(courseId, asTopic, `${id}:${asTopic.Title}`),
            moduleId: id,
            courseId,
            title: asTopic.Title,
            url: topicUrl(orgUnitId, asTopic),
            documentClass: classifyDocument(asTopic.Title),
            contentHash: null,
            updatedAt: asTopic.LastModifiedDate ?? null,
          });
        } else {
          walk([node as RawContentModule], id);
        }
      }
    }
  }

  walk(modules, null);
  return { modules: outMods, items: outItems };
}
