/** Discussion forums / topics / posts — local academic model. */
export type AuthorRole = "instructor" | "ta" | "staff" | "student" | "unknown";

export interface DiscussionForum {
  id: string;
  courseId: string;
  forumId: number;
  name: string;
  descriptionText: string | null;
  isHidden: boolean;
  startDate: string | null;
  endDate: string | null;
}

export interface DiscussionTopicLocal {
  id: string;
  courseId: string;
  forumId: number;
  topicId: number;
  name: string;
  descriptionText: string | null;
  dueDate: string | null;
  isHidden: boolean;
  pinnedPostCount: number;
}

export interface DiscussionPost {
  id: string;
  courseId: string;
  forumId: number;
  topicId: number;
  postId: number;
  threadId: number | null;
  parentPostId: number | null;
  subject: string;
  bodyText: string;
  authorDisplayName: string;
  authorUserId: number | null;
  authorRole: AuthorRole;
  /** Only staff posts are authoritative academic evidence */
  isAuthoritative: boolean;
  postedAt: string | null;
  lastEditedAt: string | null;
  isDeleted: boolean;
  threadIsPinned: boolean;
  bodyHash: string;
}

/** Conservative role classification from outline/course staff names. */
export function classifyAuthorRole(
  displayName: string,
  staffNames: string[],
  instructorNames: string[],
  taNames: string[],
): AuthorRole {
  const n = displayName.toLowerCase().replace(/\s+/g, " ").trim();
  if (!n) return "unknown";
  const hit = (list: string[]) =>
    list.some((s) => {
      const t = s.toLowerCase().replace(/\s+/g, " ").trim();
      if (!t || t.length < 2) return false;
      return n === t || n.includes(t) || t.includes(n);
    });
  if (hit(instructorNames)) return "instructor";
  if (hit(taNames)) return "ta";
  if (hit(staffNames)) return "staff";
  // Heuristic: titles in display name
  if (/\b(prof|dr\.|instructor|lecturer)\b/i.test(displayName)) return "instructor";
  if (/\b(t\.?a\.?|teaching\s+assistant)\b/i.test(displayName)) return "ta";
  return "student";
}

export function isStaffRole(role: AuthorRole): boolean {
  return role === "instructor" || role === "ta" || role === "staff";
}
