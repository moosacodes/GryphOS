/**
 * CourseLink / Brightspace HTTP client.
 * Runs in a CourseLink tab so the student's session cookie is sent automatically.
 * Adapted from dawhatnow/gryphCal (MIT).
 */
import { COURSELINK_ORIGIN } from "@/domain/constants";
import type {
  ObjectListPage,
  RawCalendarEvent,
  RawContentModule,
  RawContentToc,
  RawContentTopic,
  RawCourse,
  RawCoursePage,
  RawEntityDropbox,
  RawFolder,
  RawGradeObject,
  RawGradeValue,
  RawNewsItem,
  RawQuiz,
  RawVersion,
  RawWhoAmI,
} from "./raw";

export class SignedOutError extends Error {
  constructor(message = "Signed out of CourseLink") {
    super(message);
    this.name = "SignedOutError";
  }
}

export class HttpError extends Error {
  constructor(
    public status: number,
    url: string,
  ) {
    super(`${status} from ${url}`);
    this.name = "HttpError";
  }
}

async function getJSON<T>(pathOrUrl: string): Promise<T> {
  const url = pathOrUrl.startsWith("http") ? pathOrUrl : COURSELINK_ORIGIN + pathOrUrl;
  if (new URL(url).origin !== COURSELINK_ORIGIN) {
    throw new Error(`Refusing to fetch ${url}`);
  }
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

async function getBinary(pathOrUrl: string): Promise<{ buffer: ArrayBuffer; contentType: string; filename: string }> {
  const url = pathOrUrl.startsWith("http") ? pathOrUrl : COURSELINK_ORIGIN + pathOrUrl;
  if (new URL(url).origin !== COURSELINK_ORIGIN) {
    throw new Error(`Refusing to fetch ${url}`);
  }
  const res = await fetch(url, { credentials: "include" });
  if (res.status === 401) throw new SignedOutError();
  if (!res.ok) throw new HttpError(res.status, url);
  const contentType = res.headers.get("content-type") ?? "application/octet-stream";
  const cd = res.headers.get("content-disposition") ?? "";
  const nameMatch = cd.match(/filename\*?=(?:UTF-8''|")?([^";]+)/i);
  const filename = nameMatch ? decodeURIComponent(nameMatch[1].replace(/"/g, "")) : "download";
  return { buffer: await res.arrayBuffer(), contentType, filename };
}

export async function getVersions(): Promise<{ lp: string; le: string }> {
  const list = await getJSON<RawVersion[]>("/d2l/api/versions/");
  const find = (code: string) => list.find((v) => v.ProductCode === code)?.LatestVersion;
  const lp = find("lp");
  const le = find("le");
  if (!lp || !le) throw new Error("CourseLink did not report API versions");
  return { lp, le };
}

export const getWhoAmI = (lp: string) =>
  getJSON<RawWhoAmI>(`/d2l/api/lp/${lp}/users/whoami`);

export async function getCourses(): Promise<RawCourse[]> {
  const all: RawCourse[] = [];
  let bookmark = "";
  do {
    const q = `?pageSize=20&sort=current&orgUnitTypeId=3&embedDepth=0${
      bookmark ? `&bookmark=${encodeURIComponent(bookmark)}` : ""
    }`;
    const page = await getJSON<RawCoursePage>(`/d2l/le/manageCourses/api/mycourses${q}`);
    all.push(...page.Courses);
    bookmark = page.Courses.length > 0 ? (page.Bookmark ?? "") : "";
  } while (bookmark);
  return all;
}

async function getAllPages<T>(path: string): Promise<T[]> {
  const out: T[] = [];
  let next: string | null = path;
  while (next) {
    const data: T[] | ObjectListPage<T> = await getJSON(next);
    if (Array.isArray(data)) return data;
    out.push(...data.Objects);
    next = data.Next;
  }
  return out;
}

export const getFolders = (le: string, ou: number) =>
  getJSON<RawFolder[]>(`/d2l/api/le/${le}/${ou}/dropbox/folders/`);

export const getMySubmissions = (le: string, ou: number, folderId: number) =>
  getJSON<RawEntityDropbox[]>(
    `/d2l/api/le/${le}/${ou}/dropbox/folders/${folderId}/submissions/mysubmissions/`,
  );

export const getQuizzes = (le: string, ou: number) =>
  getAllPages<RawQuiz>(`/d2l/api/le/${le}/${ou}/quizzes/`);

export const getGradeObjects = (le: string, ou: number) =>
  getJSON<RawGradeObject[]>(`/d2l/api/le/${le}/${ou}/grades/`);

export const getMyGradeValues = (le: string, ou: number) =>
  getJSON<RawGradeValue[]>(`/d2l/api/le/${le}/${ou}/grades/values/myGradeValues/`);

export async function getNews(le: string, ou: number): Promise<RawNewsItem[]> {
  try {
    return await getAllPages<RawNewsItem>(`/d2l/api/le/${le}/${ou}/news/`);
  } catch (e) {
    if (e instanceof HttpError && (e.status === 403 || e.status === 404)) return [];
    throw e;
  }
}

export async function getCalendarEvents(
  le: string,
  ou: number,
): Promise<RawCalendarEvent[]> {
  try {
    return await getJSON<RawCalendarEvent[]>(`/d2l/api/le/${le}/${ou}/calendar/events/`);
  } catch (e) {
    if (e instanceof HttpError && (e.status === 403 || e.status === 404)) return [];
    throw e;
  }
}

/** Full course content TOC when available. */
export async function getContentToc(le: string, ou: number): Promise<RawContentModule[]> {
  try {
    const toc = await getJSON<RawContentToc | RawContentModule[]>(
      `/d2l/api/le/${le}/${ou}/content/toc`,
    );
    if (Array.isArray(toc)) return toc;
    return toc.Modules ?? [];
  } catch (e) {
    if (e instanceof HttpError && (e.status === 403 || e.status === 404)) {
      try {
        return await getJSON<RawContentModule[]>(`/d2l/api/le/${le}/${ou}/content/root/`);
      } catch (e2) {
        if (e2 instanceof HttpError && (e2.status === 403 || e2.status === 404)) return [];
        throw e2;
      }
    }
    throw e;
  }
}

export async function getContentTopicFile(
  le: string,
  ou: number,
  topicId: number,
): Promise<{ buffer: ArrayBuffer; contentType: string; filename: string }> {
  return getBinary(`/d2l/api/le/${le}/${ou}/content/topics/${topicId}/file?stream=1`);
}

export type { RawContentTopic, RawContentModule };
