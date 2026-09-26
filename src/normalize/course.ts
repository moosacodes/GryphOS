import { COURSELINK_ORIGIN, COURSE_COLORS } from "@/domain/constants";
import { courseIdFromOrgUnit } from "@/domain/ids";
import type { Course, UserProfile } from "@/domain/types";
import type { RawCourse, RawWhoAmI } from "@/adapters/courselink/raw";

/** "CIS*2500*0101: Intermediate Programming F26" -> "CIS*2500" */
export function shortCode(name: string, code: string | null): string {
  const m = `${code ?? ""} ${name}`.match(/([A-Z]{2,5})\*(\d{4})/);
  return m ? `${m[1]}*${m[2]}` : name.slice(0, 14);
}

export function toUser(w: RawWhoAmI): UserProfile {
  return {
    name: `${w.FirstName} ${w.LastName}`.trim(),
    id: w.UniqueName || w.Identifier,
  };
}

export function toCourse(c: RawCourse, colorIndex = 0): Course {
  const orgUnitId = Number(c.OrgUnitId);
  const id = courseIdFromOrgUnit(orgUnitId);
  return {
    id,
    orgUnitId,
    code: shortCode(c.Name, c.Code),
    title: c.Name,
    semester: c.SemesterName ?? null,
    startDate: c.StartDate ?? null,
    endDate: c.EndDate ?? null,
    color: COURSE_COLORS[colorIndex % COURSE_COLORS.length],
    selected: false,
    instructorNames: [],
    url: `${COURSELINK_ORIGIN}/d2l/home/${orgUnitId}`,
    outlineDocumentId: null,
    outlineStatus: "not_checked",
    outlineStatusDetail: null,
    lectureSection: null,
    labSection: null,
    tutorialSection: null,
    updatedAt: new Date().toISOString(),
  };
}

export function currentSemester(courses: Course[]): string | null {
  const counts = new Map<string, number>();
  for (const c of courses) {
    if (c.semester) counts.set(c.semester, (counts.get(c.semester) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
}

export function isLikelyCurrent(c: Course, now = Date.now()): boolean {
  const day = 864e5;
  if (c.endDate && Date.parse(c.endDate) < now - 14 * day) return false;
  if (c.startDate && Date.parse(c.startDate) > now + 60 * day) return false;
  if (c.startDate && !c.endDate && Date.parse(c.startDate) < now - 200 * day) return false;
  return true;
}
