import { describe, expect, it } from "vitest";
import courses from "../fixtures/courses.json";
import folders from "../fixtures/assignments.json";
import quizzes from "../fixtures/quizzes.json";
import grades from "../fixtures/grades.json";
import { shortCode, toCourse } from "@/normalize/course";
import { applyGrades, fromFolder, fromQuiz, withSubmissions } from "@/normalize/assessment";
import type { RawEntityDropbox } from "@/adapters/courselink/raw";

describe("normalize", () => {
  it("shortens course codes", () => {
    expect(shortCode(courses[0].Name, courses[0].Code)).toBe("CIS*2520");
  });

  it("maps courses", () => {
    const c = toCourse(courses[0], 0);
    expect(c.orgUnitId).toBe(1001);
    expect(c.code).toBe("CIS*2520");
    expect(c.id).toBe("course:1001");
  });

  it("maps folders and quizzes", () => {
    const course = toCourse(courses[0], 0);
    const a = fromFolder(folders[0], course);
    const q = fromQuiz(quizzes[0], course);
    expect(a?.assessment.type).toBe("assignment");
    expect(a?.assessment.due.certainty).toBe("exact");
    expect(q?.assessment.type).toBe("quiz");
  });

  it("applies submissions and grades", () => {
    const course = toCourse(courses[0], 0);
    const a = fromFolder(folders[0], course)!;
    const entities: RawEntityDropbox[] = [
      { Submissions: [{ Id: 1, SubmissionDate: "2026-09-19T20:00:00.000Z" }] },
    ];
    const withSub = withSubmissions(a.assessment, entities);
    expect(withSub.submissionState).toBe("submitted");
    const graded = applyGrades([withSub], grades.objects, grades.values);
    expect(graded[0].pointsEarned).toBe(18);
    expect(graded[0].weightPercent).toBe(10);
  });
});
