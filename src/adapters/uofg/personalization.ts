/**
 * Personalization seeds — lecture vs lab section fields + meetings.
 * Generic data; not hardcoded into the rule engine.
 */
import type { Course, Meeting, AcademicRule, Person } from "@/domain/types";

export interface PersonalizationProfile {
  courseCode: string;
  lectureSection: string;
  labSection: string;
  instructor: string;
  meetings: Array<Omit<Meeting, "id" | "courseId">>;
  rules?: Array<Omit<AcademicRule, "id" | "courseId">>;
}

/** Fall-style fixtures matching user schedule requests. */
export const PERSONALIZATION_FIXTURES: PersonalizationProfile[] = [
  {
    courseCode: "CIS*2430",
    lectureSection: "0101",
    labSection: "0101",
    instructor: "Fei Song",
    meetings: [
      { kind: "lecture", dayOfWeek: 1, startTime: "10:30", endTime: "11:20", location: null, notes: "MWF lecture", sectionCode: "0101" },
      { kind: "lecture", dayOfWeek: 3, startTime: "10:30", endTime: "11:20", location: null, notes: "MWF lecture", sectionCode: "0101" },
      { kind: "lecture", dayOfWeek: 5, startTime: "10:30", endTime: "11:20", location: null, notes: "MWF lecture", sectionCode: "0101" },
      { kind: "lab", dayOfWeek: 2, startTime: "14:30", endTime: "16:20", location: "SSC 1303", notes: "Tue lab", sectionCode: "0101" },
    ],
    rules: [
      {
        kind: "relative_deadline",
        label: "Lab reports due 8 days after Tuesday lab",
        params: { fromMeetingKind: "lab", dayOfWeek: 2, offsetDays: 8, applyToTypes: ["lab"] },
        sourceType: "manual",
        confidence: 0.9,
      },
    ],
  },
  {
    courseCode: "CIS*2030",
    lectureSection: "0105",
    labSection: "0105",
    instructor: "Gurjit Randhawa",
    meetings: [
      { kind: "lecture", dayOfWeek: 2, startTime: "10:00", endTime: "11:20", location: null, notes: "TR lecture", sectionCode: "0105" },
      { kind: "lecture", dayOfWeek: 4, startTime: "10:00", endTime: "11:20", location: null, notes: "TR lecture", sectionCode: "0105" },
      { kind: "lab", dayOfWeek: 3, startTime: "17:30", endTime: "20:20", location: null, notes: "Wed lab", sectionCode: "0105" },
    ],
    rules: [
      {
        kind: "best_n",
        label: "Best 10 of 11 quizzes",
        params: { n: 10, of: 11, applyToTypes: ["quiz"] },
        sourceType: "course_outline",
        confidence: 0.9,
      },
      {
        kind: "threshold",
        label: "Exam threshold / grade cap",
        params: { applyToTypes: ["final"], thresholdPercent: 50, capPercent: 45 },
        sourceType: "course_outline",
        confidence: 0.75,
      },
    ],
  },
  {
    courseCode: "CIS*2520",
    lectureSection: "0104",
    labSection: "0104",
    instructor: "Yan Yan",
    meetings: [
      { kind: "lecture", dayOfWeek: 1, startTime: "13:30", endTime: "14:20", location: null, notes: "MWF lecture", sectionCode: "0104" },
      { kind: "lecture", dayOfWeek: 3, startTime: "13:30", endTime: "14:20", location: null, notes: "MWF lecture", sectionCode: "0104" },
      { kind: "lecture", dayOfWeek: 5, startTime: "13:30", endTime: "14:20", location: null, notes: "MWF lecture", sectionCode: "0104" },
      { kind: "lab", dayOfWeek: 3, startTime: "10:30", endTime: "12:20", location: "MCKN 311", notes: "Wed lab", sectionCode: "0104" },
    ],
    rules: [
      {
        kind: "best_n",
        label: "Zybook best 5 of 6",
        params: { n: 5, of: 6, applyToTypes: ["assignment"], category: "Zybook" },
        sourceType: "course_outline",
        confidence: 0.85,
      },
    ],
  },
];

export function applyPersonalization(
  courses: Course[],
  existingMeetings: Meeting[],
  existingPeople: Person[],
  existingRules: import("@/domain/types").AcademicRule[],
): {
  courses: Course[];
  meetings: Meeting[];
  people: Person[];
  rules: import("@/domain/types").AcademicRule[];
} {
  let meetings = [...existingMeetings];
  let people = [...existingPeople];
  let rules = [...existingRules];
  const coursesOut = courses.map((c) => {
    const fx = PERSONALIZATION_FIXTURES.find((f) =>
      c.code.replace(/\s/g, "").toUpperCase().startsWith(f.courseCode.replace(/\s/g, "").toUpperCase()),
    );
    if (!fx) return c;
    // Replace meetings for this course from fixture
    meetings = meetings.filter((m) => m.courseId !== c.id);
    for (let i = 0; i < fx.meetings.length; i++) {
      const m = fx.meetings[i];
      meetings.push({
        id: `meet:${c.id}:${m.kind}:${i}`,
        courseId: c.id,
        ...m,
      });
    }
    people = people.filter((p) => !(p.courseId === c.id && p.role === "instructor"));
    people.push({
      id: `person:${c.id}:inst:personal`,
      name: fx.instructor,
      email: null,
      role: "instructor",
      courseId: c.id,
    });
    rules = rules.filter((r) => r.courseId !== c.id || r.sourceType !== "manual");
    for (let i = 0; i < (fx.rules?.length ?? 0); i++) {
      const r = fx.rules![i];
      rules.push({
        id: `rule:${c.id}:pers:${i}`,
        courseId: c.id,
        ...r,
      });
    }
    return {
      ...c,
      lectureSection: fx.lectureSection,
      labSection: fx.labSection,
      tutorialSection: c.tutorialSection ?? null,
      instructorNames: c.instructorNames.includes(fx.instructor)
        ? c.instructorNames
        : [...c.instructorNames, fx.instructor],
    };
  });
  return { courses: coursesOut, meetings, people, rules };
}
