/**
 * Runtime personalization helpers.
 * Hardcoded CIS*2430/2030/2520 schedules live ONLY in tests/fixtures/fall2026.ts.
 * Production personalization comes from CourseLink, ICS/timetable, user section config,
 * or manual correction — never from baked-in course fixtures.
 */
import type { Course, Meeting, Person } from "@/domain/types";
import type { AcademicRule } from "@/domain/rules";

export interface SectionConfig {
  courseId: string;
  lectureSection?: string | null;
  labSection?: string | null;
  tutorialSection?: string | null;
}

export interface ManualMeetingInput {
  courseId: string;
  kind: Meeting["kind"];
  dayOfWeek: number;
  startTime: string;
  endTime: string;
  location?: string | null;
  sectionCode?: string | null;
  notes?: string | null;
}

export function applySectionConfig(courses: Course[], configs: SectionConfig[]): Course[] {
  if (!configs.length) return courses;
  const byId = new Map(configs.map((c) => [c.courseId, c]));
  return courses.map((c) => {
    const cfg = byId.get(c.id);
    if (!cfg) return c;
    return {
      ...c,
      lectureSection: cfg.lectureSection ?? c.lectureSection,
      labSection: cfg.labSection ?? c.labSection,
      tutorialSection: cfg.tutorialSection ?? c.tutorialSection,
    };
  });
}

export function mergeManualMeetings(
  existing: Meeting[],
  manual: ManualMeetingInput[],
  replaceCourseIds: string[] = [],
): Meeting[] {
  let meetings = [...existing];
  const replace = new Set(replaceCourseIds);
  if (replace.size) {
    meetings = meetings.filter((m) => !replace.has(m.courseId));
  }
  for (let i = 0; i < manual.length; i++) {
    const m = manual[i];
    meetings.push({
      id: `meet:manual:${m.courseId}:${m.kind}:${i}`,
      courseId: m.courseId,
      kind: m.kind,
      dayOfWeek: m.dayOfWeek,
      startTime: m.startTime,
      endTime: m.endTime,
      location: m.location ?? null,
      notes: m.notes ?? null,
      sectionCode: m.sectionCode ?? null,
    });
  }
  return meetings;
}

/** Identity no-op — fixtures must never inject into production sync. */
export function applyPersonalization(
  courses: Course[],
  existingMeetings: Meeting[],
  existingPeople: Person[],
  existingRules: AcademicRule[],
): {
  courses: Course[];
  meetings: Meeting[];
  people: Person[];
  rules: AcademicRule[];
} {
  return {
    courses,
    meetings: existingMeetings,
    people: existingPeople,
    rules: existingRules,
  };
}
