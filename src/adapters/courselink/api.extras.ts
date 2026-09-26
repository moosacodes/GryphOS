/**
 * Deep Brightspace LE/LP adapters for course reconstruction.
 * Session-cookie only — 403/404 → empty / logged; never fabricate.
 */
import { COURSELINK_ORIGIN } from "@/domain/constants";
import type { ApiExplorationEntry } from "@/domain/types";
import { HttpError, SignedOutError } from "./api";
import { countItems, recordSyncTrace } from "@/diagnostics/trace";

export interface ExploreLog {
  entries: ApiExplorationEntry[];
  courseId: string | null;
}

function nowIso(): string {
  return new Date().toISOString();
}

async function getJSON<T>(
  pathOrUrl: string,
  log?: ExploreLog,
  note = "",
): Promise<{ data: T | null; status: number | "network_error" }> {
  const url = pathOrUrl.startsWith("http") ? pathOrUrl : COURSELINK_ORIGIN + pathOrUrl;
  if (new URL(url).origin !== COURSELINK_ORIGIN) throw new Error(`Refusing to fetch ${url}`);
  try {
    const res = await fetch(url, {
      credentials: "include",
      headers: { Accept: "application/json" },
    });
    if (res.status === 401) throw new SignedOutError();
    const ct = res.headers.get("content-type") ?? "";
    const usable = res.ok && ct.includes("json");
    if (!usable) {
      recordSyncTrace({ kind: "api", endpoint: url, status: res.status, ok: false, itemCount: null, bytes: null, ms: null, error: res.ok ? `non-JSON (${ct.slice(0, 40)})` : `HTTP ${res.status}`, note: note || null });
    }
    if (log) {
      log.entries.push({
        id: `api:${Date.now()}:${log.entries.length}`,
        courseId: log.courseId,
        endpoint: pathOrUrl,
        method: "GET",
        status: res.status,
        usable,
        note: note || (usable ? "ok" : `non-usable (${res.status}, ct=${ct.slice(0, 40)})`),
        at: nowIso(),
      });
    }
    if (!res.ok) return { data: null, status: res.status };
    if (!ct.includes("json")) throw new SignedOutError();
    const json = (await res.json()) as T;
    recordSyncTrace({ kind: "api", endpoint: url, status: res.status, ok: true, itemCount: countItems(json), bytes: null, ms: null, error: null, note: note || null });
    return { data: json, status: res.status };
  } catch (e) {
    if (e instanceof SignedOutError) throw e;
    recordSyncTrace({ kind: "api", endpoint: url, status: "network_error", ok: false, itemCount: null, bytes: null, ms: null, error: String((e as Error).message ?? e), note: note || null });
    if (log) {
      log.entries.push({
        id: `api:${Date.now()}:${log.entries.length}`,
        courseId: log.courseId,
        endpoint: pathOrUrl,
        method: "GET",
        status: "network_error",
        usable: false,
        note: String((e as Error).message ?? e),
        at: nowIso(),
      });
    }
    return { data: null, status: "network_error" };
  }
}

export interface RawQuizAttempt {
  AttemptId: number;
  QuizId: number;
  UserId?: number;
  AttemptNumber: number;
  Score: number | null;
  Started: string | null;
  Completed: string | null;
  IsPublished?: boolean;
}

export interface RawDiscussionForum {
  ForumId?: number;
  Id?: number;
  Name: string;
  Description?: { Text?: string | null; Html?: string | null } | null;
  IsHidden?: boolean;
  StartDate?: string | null;
  EndDate?: string | null;
}

export interface RawDiscussionTopic {
  ForumId?: number;
  TopicId?: number;
  Id?: number;
  Name: string;
  Description?: { Text?: string | null; Html?: string | null } | null;
  DueDate?: string | null;
  IsHidden?: boolean;
  PinnedPostCount?: number;
  StartDate?: string | null;
  EndDate?: string | null;
}

export interface RawDiscussionPost {
  ForumId: number;
  TopicId: number;
  PostId: number;
  ThreadId?: number | null;
  ParentPostId?: number | null;
  PostingUserId?: number | null;
  PostingUserDisplayName?: string | null;
  Subject?: string | null;
  Message?: { Text?: string | null; Html?: string | null } | null;
  DatePosted?: string | null;
  LastEditedDate?: string | null;
  IsDeleted?: boolean;
  IsAnonymous?: boolean;
  ThreadIsPinned?: boolean;
  WordCount?: number;
}

export interface RawGradeCategory {
  Id: number;
  Name: string;
  ShortName?: string | null;
  Weight?: number | null;
  MaxPoints?: number | null;
  NumberOfHighestToDrop?: number | null;
  NumberOfLowestToDrop?: number | null;
}

export interface RawDropboxFeedback {
  Score?: number | null;
  Feedback?: { Text?: string | null; Html?: string | null } | null;
  IsGraded?: boolean;
}

export interface RawChecklist {
  ChecklistId?: number;
  Id?: number;
  Name: string;
  Description?: { Text?: string | null } | null;
}

export interface RawContentTopicDetail {
  TopicId?: number;
  Id?: number;
  Title?: string;
  Url?: string | null;
  TopicType?: number;
  LastModifiedDate?: string | null;
  DueDate?: string | null;
  StartDate?: string | null;
  EndDate?: string | null;
  Description?: { Text?: string | null; Html?: string | null } | null;
  IsHidden?: boolean;
}

/** Quiz attempts for a quiz. Student sessions may 403. */
export async function getQuizAttempts(
  le: string,
  ou: number,
  quizId: number,
  userId?: string | number,
  log?: ExploreLog,
): Promise<RawQuizAttempt[]> {
  const q = userId != null ? `?userId=${encodeURIComponent(String(userId))}` : "";
  const path = `/d2l/api/le/${le}/${ou}/quizzes/${quizId}/attempts/${q}`;
  const { data, status } = await getJSON<{ Objects?: RawQuizAttempt[] } | RawQuizAttempt[]>(
    path,
    log,
    "quiz attempts",
  );
  if (!data) {
    if (status === 403 || status === 404) return [];
    return [];
  }
  return Array.isArray(data) ? data : (data.Objects ?? []);
}

export async function getDiscussionForums(
  le: string,
  ou: number,
  log?: ExploreLog,
): Promise<RawDiscussionForum[]> {
  const { data } = await getJSON<RawDiscussionForum[]>(
    `/d2l/api/le/${le}/${ou}/discussions/forums/`,
    log,
    "discussion forums",
  );
  return data ?? [];
}

export async function getDiscussionTopics(
  le: string,
  ou: number,
  forumId: number,
  log?: ExploreLog,
): Promise<RawDiscussionTopic[]> {
  const { data } = await getJSON<RawDiscussionTopic[]>(
    `/d2l/api/le/${le}/${ou}/discussions/forums/${forumId}/topics/`,
    log,
    "discussion topics",
  );
  return data ?? [];
}

export async function getDiscussionPosts(
  le: string,
  ou: number,
  forumId: number,
  topicId: number,
  log?: ExploreLog,
): Promise<RawDiscussionPost[]> {
  const path = `/d2l/api/le/${le}/${ou}/discussions/forums/${forumId}/topics/${topicId}/posts/?pageSize=200&pageNumber=1`;
  const { data } = await getJSON<RawDiscussionPost[] | { Objects?: RawDiscussionPost[] }>(
    path,
    log,
    "discussion posts",
  );
  if (!data) return [];
  return Array.isArray(data) ? data : (data.Objects ?? []);
}

export async function getGradeCategories(
  le: string,
  ou: number,
  log?: ExploreLog,
): Promise<RawGradeCategory[]> {
  const { data } = await getJSON<RawGradeCategory[]>(
    `/d2l/api/le/${le}/${ou}/grades/categories/`,
    log,
    "grade categories",
  );
  return data ?? [];
}

/** Student feedback on own dropbox submission — often entityId = whoami. */
export async function getMyDropboxFeedback(
  le: string,
  ou: number,
  folderId: number,
  userId: string | number,
  log?: ExploreLog,
): Promise<RawDropboxFeedback | null> {
  const path = `/d2l/api/le/${le}/${ou}/dropbox/folders/${folderId}/feedback/user/${userId}`;
  const { data, status } = await getJSON<RawDropboxFeedback>(path, log, "dropbox feedback");
  if (!data) {
    if (status === 403 || status === 404) return null;
    return null;
  }
  return data;
}

export async function getChecklists(
  le: string,
  ou: number,
  log?: ExploreLog,
): Promise<RawChecklist[]> {
  const { data } = await getJSON<RawChecklist[] | { Objects?: RawChecklist[] }>(
    `/d2l/api/le/${le}/${ou}/checklists/`,
    log,
    "checklists",
  );
  if (!data) return [];
  return Array.isArray(data) ? data : (data.Objects ?? []);
}

export async function getContentTopicDetail(
  le: string,
  ou: number,
  topicId: number,
  log?: ExploreLog,
): Promise<RawContentTopicDetail | null> {
  const { data } = await getJSON<RawContentTopicDetail>(
    `/d2l/api/le/${le}/${ou}/content/topics/${topicId}`,
    log,
    "content topic detail",
  );
  return data;
}

export async function getGroups(
  le: string,
  ou: number,
  log?: ExploreLog,
): Promise<unknown[]> {
  const { data } = await getJSON<unknown[] | { Objects?: unknown[] }>(
    `/d2l/api/lp/${le}/${ou}/groupcategories/`,
    log,
    "group categories (lp)",
  );
  // Note: groups live under LP; version may differ — logged honestly.
  if (!data) return [];
  return Array.isArray(data) ? data : (data.Objects ?? []);
}

export { HttpError, SignedOutError };
