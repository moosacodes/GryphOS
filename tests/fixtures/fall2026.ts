/**
 * Fall 2026 TEST FIXTURES ONLY — never imported by runtime/production sync.
 * Correct personalization schedules for CIS*2430 / 2030 / 2520.
 */
import type { Course, Meeting, Assessment, Person } from "@/domain/types";
import { DEFAULT_ITEM_STATE } from "@/domain/types";
import type { AcademicRule } from "@/domain/rules";
import type { RecurringMeetingPattern, HolidayWindow } from "@/domain/meetings";
import { courseKeyFromCode, generateOccurrences, patternsFromLegacyMeetings } from "@/domain/meetings";

export const FALL_2026_RANGE = { start: "2026-09-10", end: "2026-12-04" } as const;

/** Thanksgiving + Fall Study Break (approximate UofG Fall 2026 windows for tests). */
export const FALL_2026_HOLIDAYS: HolidayWindow[] = [
  { start: "2026-10-12", end: "2026-10-12", label: "Thanksgiving" },
  { start: "2026-10-13", end: "2026-10-16", label: "Fall Study Break" },
];

export interface CourseFixture {
  course: Course;
  meetings: Meeting[];
  patterns: RecurringMeetingPattern[];
  rules: AcademicRule[];
  people: Person[];
  assessments: Assessment[];
}

function baseCourse(partial: Partial<Course> & { id: string; code: string; title: string }): Course {
  return {
    orgUnitId: Number(partial.code.replace(/\D/g, "").slice(0, 4) || 1),
    semester: "F26",
    startDate: "2026-09-10T04:00:00.000Z",
    endDate: "2026-12-04T05:00:00.000Z",
    color: "#C8102E",
    selected: true,
    instructorNames: [],
    url: "",
    outlineDocumentId: null,
    outlineStatus: "not_checked",
    outlineStatusDetail: null,
    lectureSection: null,
    labSection: null,
    tutorialSection: null,
    updatedAt: "2026-09-01T00:00:00.000Z",
    ...partial,
  };
}

function assessment(
  partial: Partial<Assessment> & { id: string; courseId: string; title: string },
): Assessment {
  return {
    type: "lab",
    due: { certainty: "unknown", iso: null, label: null },
    start: { certainty: "unknown", iso: null, label: null },
    end: { certainty: "unknown", iso: null, label: null },
    weightPercent: null,
    pointsPossible: null,
    pointsEarned: null,
    submissionState: "unknown",
    submittedAt: null,
    gradeDisplay: null,
    url: null,
    notes: null,
    categoryId: null,
    isBonus: false,
    attemptNumber: null,
    state: { ...DEFAULT_ITEM_STATE },
    sourceRecords: [],
    fieldProvenance: {},
    conflictIds: [],
    manualOverrides: {},
    updatedAt: "2026-09-01T00:00:00.000Z",
    ...partial,
  };
}

/** CIS*2430 — Lec MWF 2:30–3:20 RICH 2520; Lab Tue 2:30–4:20 SSC 1303 */
export function fixture2430(): CourseFixture {
  const course = baseCourse({
    id: "course:cis2430",
    code: "CIS*2430",
    title: "Object Oriented Programming",
    lectureSection: "0101",
    labSection: "0101",
    instructorNames: ["Fei Song"],
  });
  const meetings: Meeting[] = [
    { id: "m:2430:lec:1", courseId: course.id, kind: "lecture", dayOfWeek: 1, startTime: "14:30", endTime: "15:20", location: "RICH 2520", notes: "MWF lecture", sectionCode: "0101" },
    { id: "m:2430:lec:3", courseId: course.id, kind: "lecture", dayOfWeek: 3, startTime: "14:30", endTime: "15:20", location: "RICH 2520", notes: "MWF lecture", sectionCode: "0101" },
    { id: "m:2430:lec:5", courseId: course.id, kind: "lecture", dayOfWeek: 5, startTime: "14:30", endTime: "15:20", location: "RICH 2520", notes: "MWF lecture", sectionCode: "0101" },
    { id: "m:2430:lab", courseId: course.id, kind: "lab", dayOfWeek: 2, startTime: "14:30", endTime: "16:20", location: "SSC 1303", notes: "Tue lab", sectionCode: "0101" },
  ];
  const patterns = patternsFromLegacyMeetings(
    meetings,
    FALL_2026_RANGE.start,
    FALL_2026_RANGE.end,
    "manual",
  ).map((p) =>
    p.kind === "lab"
      ? { ...p, rangeStart: "2026-09-22", exdates: [] } // Lab1=Sep22, Lab2=Sep29
      : p,
  );
  const rules: AcademicRule[] = [
    {
      id: "rule:2430:lab2:occ",
      courseId: course.id,
      kind: "OccurrenceRelativeDeadline",
      label: "Lab reports due ~8 days after introducing lab",
      patternKey: "lab:0101",
      introducedAtOccurrenceIndex: 2,
      offsetDays: 8,
      dueMode: "time",
      dueTime: "23:59",
      applyToTypes: ["lab"],
      assessmentTitlePattern: "Lab\\s*2",
      sourceType: "course_outline",
      confidence: 0.9,
      provenanceNote: "Lab 2 introduced at 2nd Tuesday lab occurrence",
    },
  ];
  const people: Person[] = [
    { id: "person:2430:inst", name: "Fei Song", email: null, role: "instructor", aliases: [], courseId: course.id },
  ];
  const assessments = [
    assessment({ id: "a:2430:lab1", courseId: course.id, title: "Lab 1", type: "lab", weightPercent: 5 }),
    assessment({ id: "a:2430:lab2", courseId: course.id, title: "Lab 2", type: "lab", weightPercent: 5 }),
    assessment({ id: "a:2430:a2", courseId: course.id, title: "A2", type: "assignment", weightPercent: 10, due: { certainty: "exact", iso: "2026-10-20T03:59:00.000Z", label: null }, fieldProvenance: { due: { value: { certainty: "exact", iso: "2026-10-20T03:59:00.000Z" }, sourceType: "courselink_dropbox", sourceId: "db:a2", confidence: 0.95, retrievedAt: "2026-09-15T12:00:00.000Z" } } }),
  ];
  return { course, meetings, patterns, rules, people, assessments };
}

/** CIS*2030 — Lec TR 8:30–9:50 ROZH 103; Lab Wed 5:30–8:20 SSC 1303 */
export function fixture2030(): CourseFixture {
  const course = baseCourse({
    id: "course:cis2030",
    code: "CIS*2030",
    title: "Structure and Application of Microcomputers",
    lectureSection: "0105",
    labSection: "0105",
    instructorNames: ["Gurjit Randhawa"],
    color: "#0B6E4F",
  });
  const meetings: Meeting[] = [
    { id: "m:2030:lec:2", courseId: course.id, kind: "lecture", dayOfWeek: 2, startTime: "08:30", endTime: "09:50", location: "ROZH 103", notes: "TR lecture", sectionCode: "0105" },
    { id: "m:2030:lec:4", courseId: course.id, kind: "lecture", dayOfWeek: 4, startTime: "08:30", endTime: "09:50", location: "ROZH 103", notes: "TR lecture", sectionCode: "0105" },
    { id: "m:2030:lab", courseId: course.id, kind: "lab", dayOfWeek: 3, startTime: "17:30", endTime: "20:20", location: "SSC 1303", notes: "Wed lab", sectionCode: "0105" },
  ];
  const patterns = patternsFromLegacyMeetings(meetings, FALL_2026_RANGE.start, FALL_2026_RANGE.end);
  const rules: AcademicRule[] = [
    {
      id: "rule:2030:best10",
      courseId: course.id,
      kind: "BestN",
      label: "Best 10 of 11 quizzes",
      n: 10,
      of: 11,
      applyToTypes: ["quiz"],
      category: null,
      sourceType: "course_outline",
      confidence: 0.95,
    },
    {
      id: "rule:2030:combined",
      courseId: course.id,
      kind: "CombinedComponentThreshold",
      label: "Midterm+Final combined threshold (30 of 60)",
      components: [
        { applyToTypes: ["midterm"], titlePattern: null, weightPercent: 25 },
        { applyToTypes: ["final"], titlePattern: null, weightPercent: 35 },
      ],
      requiredCoursePoints: 30,
      availableCoursePoints: 60,
      capAt: 45,
      sourceType: "course_outline",
      confidence: 0.95,
    },
  ];
  const people: Person[] = [
    { id: "person:2030:inst", name: "Gurjit Randhawa", email: null, role: "instructor", aliases: [], courseId: course.id },
  ];
  const quizzes = Array.from({ length: 11 }, (_, i) =>
    assessment({
      id: `a:2030:q${i + 1}`,
      courseId: course.id,
      title: `Quiz ${i + 1}`,
      type: "quiz",
      weightPercent: 1,
      pointsPossible: 10,
      pointsEarned: i === 1 ? null : i === 0 ? 6 : 9,
      state: {
        ...DEFAULT_ITEM_STATE,
        missed: i === 1,
      },
    }),
  );
  // Leave quizzes 8-11 ungraded (futures) except we set earned above for 0 and 2-10...
  // For provisional drop: only grade first 4, miss quiz 2, leave 5-11 unknown
  const quizzesPartial = quizzes.map((q, i) => {
    if (i === 1) return q; // missed
    if (i >= 4) {
      return { ...q, pointsEarned: null, state: { ...DEFAULT_ITEM_STATE } };
    }
    return q;
  });
  const assessments = [
    ...quizzesPartial,
    assessment({
      id: "a:2030:mid",
      courseId: course.id,
      title: "Midterm",
      type: "midterm",
      weightPercent: 25,
      pointsPossible: 100,
      pointsEarned: 40,
    }),
    assessment({
      id: "a:2030:final",
      courseId: course.id,
      title: "Final Exam",
      type: "final",
      weightPercent: 35,
      pointsPossible: 100,
      pointsEarned: 50,
    }),
  ];
  return { course, meetings, patterns, rules, people, assessments };
}

/** CIS*2520 — Lec MWF 3:30–4:20 CRSC 116; Lab Wed 10:30–12:20 MCKN 311 */
export function fixture2520(): CourseFixture {
  const course = baseCourse({
    id: "course:cis2520",
    code: "CIS*2520",
    title: "Data Structures",
    lectureSection: "0104",
    labSection: "0104",
    instructorNames: ["Yan Yan"],
    color: "#1B4F72",
  });
  const meetings: Meeting[] = [
    { id: "m:2520:lec:1", courseId: course.id, kind: "lecture", dayOfWeek: 1, startTime: "15:30", endTime: "16:20", location: "CRSC 116", notes: "MWF lecture", sectionCode: "0104" },
    { id: "m:2520:lec:3", courseId: course.id, kind: "lecture", dayOfWeek: 3, startTime: "15:30", endTime: "16:20", location: "CRSC 116", notes: "MWF lecture", sectionCode: "0104" },
    { id: "m:2520:lec:5", courseId: course.id, kind: "lecture", dayOfWeek: 5, startTime: "15:30", endTime: "16:20", location: "CRSC 116", notes: "MWF lecture", sectionCode: "0104" },
    { id: "m:2520:lab", courseId: course.id, kind: "lab", dayOfWeek: 3, startTime: "10:30", endTime: "12:20", location: "MCKN 311", notes: "Wed lab", sectionCode: "0104" },
  ];
  const patterns = patternsFromLegacyMeetings(meetings, FALL_2026_RANGE.start, FALL_2026_RANGE.end).map((p) =>
    p.kind === "lab"
      ? { ...p, rangeStart: "2026-10-21", exdates: [] } // Lab1=Oct21 ... Lab4=Nov11
      : p,
  );
  const rules: AcademicRule[] = [
    {
      id: "rule:2520:lab4:end",
      courseId: course.id,
      kind: "OccurrenceRelativeDeadline",
      label: "Lab 4 due at end of lab",
      patternKey: "lab:0104",
      introducedAtOccurrenceIndex: 4,
      offsetDays: 0,
      dueMode: "end_of_occurrence",
      dueTime: null,
      applyToTypes: ["lab"],
      assessmentTitlePattern: "Lab\\s*4",
      sourceType: "course_outline",
      confidence: 0.9,
    },
    {
      id: "rule:2520:zybook",
      courseId: course.id,
      kind: "ExternalActivity",
      label: "Zybook best 5 of 6",
      tool: "Zybooks",
      applyToTypes: ["assignment"],
      bestN: 5,
      of: 6,
      sourceType: "course_outline",
      confidence: 0.9,
    },
    {
      id: "rule:2520:minpass",
      courseId: course.id,
      kind: "MinimumComponentPass",
      label: "Minimum component pass on assignments",
      componentCategory: "assignment",
      minimumPercent: 50,
      consequence: "fail_course",
      capPercent: null,
      sourceType: "course_outline",
      confidence: 0.85,
    },
  ];
  const people: Person[] = [
    { id: "person:2520:inst", name: "Yan Yan", email: null, role: "instructor", aliases: [], courseId: course.id },
  ];
  const labs = [1, 2, 3, 4, 5].map((n) =>
    assessment({ id: `a:2520:lab${n}`, courseId: course.id, title: `Lab ${n}`, type: "lab", weightPercent: 4 }),
  );
  const zybooks = [9, 8, 7, 6, 5, 4].map((p, i) =>
    assessment({
      id: `a:2520:zy${i + 1}`,
      courseId: course.id,
      title: `Zybook Q${i + 1}`,
      type: "assignment",
      weightPercent: 2,
      pointsPossible: 10,
      pointsEarned: p,
    }),
  );
  return { course, meetings, patterns, rules, people, assessments: [...labs, ...zybooks] };
}

export function allFall2026Fixtures(): CourseFixture[] {
  return [fixture2430(), fixture2030(), fixture2520()];
}

export function expandFixtureOccurrences(fx: CourseFixture) {
  const key = courseKeyFromCode(fx.course.code);
  return fx.patterns.flatMap((p) => generateOccurrences(p, FALL_2026_HOLIDAYS, key));
}
