/**
 * Ingest discussion forums → topics → posts with staff role classification.
 */
import type {
  RawDiscussionForum,
  RawDiscussionPost,
  RawDiscussionTopic,
} from "@/adapters/courselink/api.extras";
import {
  classifyAuthorRole,
  isStaffRole,
  type DiscussionForum,
  type DiscussionPost,
  type DiscussionTopicLocal,
} from "@/domain/discussions";
import { syncContentHash, type ExtractedFact, type EntityLink } from "@/domain/facts";
import type { Assessment, Course, Person } from "@/domain/types";
import { extractAnnouncementFacts } from "./announcementFacts";
import { normalizeTitleKey } from "@/domain/ids";

function richText(r?: { Text?: string | null; Html?: string | null } | null): string {
  if (!r) return "";
  if (r.Text) return r.Text.replace(/\s+/g, " ").trim();
  if (r.Html) return r.Html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  return "";
}

export function mapForum(courseId: string, f: RawDiscussionForum): DiscussionForum {
  const forumId = f.ForumId ?? f.Id ?? 0;
  return {
    id: `dforum:${courseId}:${forumId}`,
    courseId,
    forumId,
    name: f.Name?.trim() || "Forum",
    descriptionText: richText(f.Description) || null,
    isHidden: !!f.IsHidden,
    startDate: f.StartDate ?? null,
    endDate: f.EndDate ?? null,
  };
}

export function mapTopic(
  courseId: string,
  forumId: number,
  t: RawDiscussionTopic,
): DiscussionTopicLocal {
  const topicId = t.TopicId ?? t.Id ?? 0;
  return {
    id: `dtopic:${courseId}:${forumId}:${topicId}`,
    courseId,
    forumId,
    topicId,
    name: t.Name?.trim() || "Topic",
    descriptionText: richText(t.Description) || null,
    dueDate: t.DueDate ?? null,
    isHidden: !!t.IsHidden,
    pinnedPostCount: t.PinnedPostCount ?? 0,
  };
}

export function mapPost(
  course: Course,
  p: RawDiscussionPost,
  staff: { instructors: string[]; tas: string[]; all: string[] },
): DiscussionPost {
  const body = richText(p.Message);
  const author = p.IsAnonymous ? "Anonymous" : (p.PostingUserDisplayName ?? "Unknown");
  const role = p.IsAnonymous
    ? "unknown"
    : classifyAuthorRole(author, staff.all, staff.instructors, staff.tas);
  return {
    id: `dpost:${course.id}:${p.ForumId}:${p.TopicId}:${p.PostId}`,
    courseId: course.id,
    forumId: p.ForumId,
    topicId: p.TopicId,
    postId: p.PostId,
    threadId: p.ThreadId ?? null,
    parentPostId: p.ParentPostId ?? null,
    subject: (p.Subject ?? "").trim() || "(no subject)",
    bodyText: body,
    authorDisplayName: author,
    authorUserId: p.PostingUserId ?? null,
    authorRole: role,
    isAuthoritative: isStaffRole(role),
    postedAt: p.DatePosted ?? null,
    lastEditedAt: p.LastEditedDate ?? null,
    isDeleted: !!p.IsDeleted,
    threadIsPinned: !!p.ThreadIsPinned,
    bodyHash: syncContentHash(`${p.Subject ?? ""}\n${body}`),
  };
}

export function staffNamesFromCourse(
  course: Course,
  people: Person[],
): { instructors: string[]; tas: string[]; all: string[] } {
  const coursePeople = people.filter((p) => p.courseId === course.id);
  const instructors = [
    ...course.instructorNames,
    ...coursePeople.filter((p) => p.role === "instructor").flatMap((p) => [p.name, ...p.aliases]),
  ];
  const tas = coursePeople
    .filter((p) => p.role === "ta")
    .flatMap((p) => [p.name, ...p.aliases]);
  const all = [
    ...instructors,
    ...tas,
    ...coursePeople.filter((p) => p.role === "staff").flatMap((p) => [p.name, ...p.aliases]),
  ];
  return { instructors, tas, all };
}

/** Staff posts → structured clarifications linked to assessments. */
export function staffClarificationsFromPosts(
  posts: DiscussionPost[],
  assessments: Assessment[],
): { facts: ExtractedFact[]; links: EntityLink[] } {
  const facts: ExtractedFact[] = [];
  const links: EntityLink[] = [];
  const now = new Date().toISOString();

  for (const post of posts) {
    if (!post.isAuthoritative || post.isDeleted) continue;
    // Reuse announcement fact extractor on post body
    const fakeAnn = {
      id: post.id,
      courseId: post.courseId,
      title: post.subject,
      bodyText: post.bodyText,
      publishedAt: post.postedAt,
      url: null,
      deadlineChangeSignal: false,
      fromInstructorOrTa: true,
      extractedFactIds: [],
      bodyHash: post.bodyHash,
    };
    const extracted = extractAnnouncementFacts(fakeAnn, assessments);
    for (const ef of extracted) {
      const factId = `fact:staff:${post.id}:${ef.id}`;
      facts.push({
        id: factId,
        artifactId: post.id,
        courseId: post.courseId,
        entityId: ef.assessmentId,
        field: ef.kind === "deadline_change" || ef.kind === "extension" ? "due" : ef.kind,
        factType: "staff_clarification",
        value: {
          kind: ef.kind,
          dueIso: ef.dueIso,
          dueLabel: ef.dueLabel,
          location: ef.location,
          detail: ef.detail,
        },
        label: `Staff clarification: ${ef.kind}`,
        authority: "STAFF_DISCUSSION",
        confidence: ef.confidence,
        validFrom: post.postedAt ?? now,
        supersededBy: null,
        retrievedAt: now,
        snippet: ef.snippet,
        property: ef.kind,
        previousValue: null,
        newValue: ef.dueIso ?? ef.location ?? ef.detail,
        authorRole: post.authorRole,
      });
      if (ef.assessmentId) {
        links.push({
          id: `link:clarifies:${post.id}:${ef.assessmentId}`,
          fromId: post.id,
          toId: ef.assessmentId,
          kind: ef.kind === "deadline_change" || ef.kind === "extension"
            ? "CHANGES_DEADLINE_OF"
            : "CLARIFIES",
          evidenceFactIds: [factId],
          confidence: ef.confidence,
          createdAt: now,
        });
      }
    }

    // Title-only association
    if (extracted.length === 0) {
      const key = normalizeTitleKey(post.subject + " " + post.bodyText.slice(0, 80));
      for (const a of assessments.filter((x) => x.courseId === post.courseId)) {
        const ak = normalizeTitleKey(a.title);
        if (ak && key.includes(ak.slice(0, Math.min(12, ak.length)))) {
          links.push({
            id: `link:about:${post.id}:${a.id}`,
            fromId: post.id,
            toId: a.id,
            kind: "ABOUT",
            evidenceFactIds: [],
            confidence: 0.4,
            createdAt: now,
          });
          break;
        }
      }
    }
  }
  return { facts, links };
}
