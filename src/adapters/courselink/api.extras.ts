/**
 * Additional Brightspace LE endpoints explored for productization.
 * Safe: session-cookie only, no auth bypass. 403/404 → empty.
 */
import { COURSELINK_ORIGIN } from "@/domain/constants";
import { HttpError, SignedOutError } from "./api";

async function getJSON<T>(pathOrUrl: string): Promise<T> {
  const url = pathOrUrl.startsWith("http") ? pathOrUrl : COURSELINK_ORIGIN + pathOrUrl;
  if (new URL(url).origin !== COURSELINK_ORIGIN) throw new Error(`Refusing to fetch ${url}`);
  const res = await fetch(url, {
    credentials: "include",
    headers: { Accept: "application/json" },
  });
  if (res.status === 401) throw new SignedOutError();
  if (!res.ok) throw new HttpError(res.status, url);
  const ct = res.headers.get("content-type") ?? "";
  if (!ct.includes("json")) throw new SignedOutError();
  return (await res.json()) as T;
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
  Description?: { Text?: string | null } | null;
}

export interface RawDiscussionTopic {
  TopicId?: number;
  Id?: number;
  Name: string;
  Description?: { Text?: string | null } | null;
}

/** Quiz attempts for a quiz (optionally filtered to userId). Student sessions may 403. */
export async function getQuizAttempts(
  le: string,
  ou: number,
  quizId: number,
  userId?: string | number,
): Promise<RawQuizAttempt[]> {
  try {
    const q = userId != null ? `?userId=${encodeURIComponent(String(userId))}` : "";
    const data = await getJSON<{ Objects?: RawQuizAttempt[] } | RawQuizAttempt[]>(
      `/d2l/api/le/${le}/${ou}/quizzes/${quizId}/attempts/${q}`,
    );
    return Array.isArray(data) ? data : (data.Objects ?? []);
  } catch (e) {
    if (e instanceof HttpError && (e.status === 403 || e.status === 404)) return [];
    throw e;
  }
}

export async function getDiscussionForums(
  le: string,
  ou: number,
): Promise<RawDiscussionForum[]> {
  try {
    return await getJSON<RawDiscussionForum[]>(`/d2l/api/le/${le}/${ou}/discussions/forums/`);
  } catch (e) {
    if (e instanceof HttpError && (e.status === 403 || e.status === 404)) return [];
    throw e;
  }
}

export async function getDiscussionTopics(
  le: string,
  ou: number,
  forumId: number,
): Promise<RawDiscussionTopic[]> {
  try {
    return await getJSON<RawDiscussionTopic[]>(
      `/d2l/api/le/${le}/${ou}/discussions/forums/${forumId}/topics/`,
    );
  } catch (e) {
    if (e instanceof HttpError && (e.status === 403 || e.status === 404)) return [];
    throw e;
  }
}
