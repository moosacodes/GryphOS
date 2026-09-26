import { describe, expect, it } from "vitest";
import {
  flattenContentTopics,
  scoreOutlineCandidate,
} from "@/adapters/courselink/discoverOutlines";
import type { RawContentModule } from "@/adapters/courselink/raw";

describe("outline discovery scoring", () => {
  it("scores syllabus/outline titles highly", () => {
    expect(scoreOutlineCandidate("Course Outline Fall 2026", "outline.pdf")).toBeGreaterThanOrEqual(50);
    expect(scoreOutlineCandidate("Syllabus", "CIS2520_Syllabus.pdf")).toBeGreaterThan(
      scoreOutlineCandidate("Lecture 3 slides", "lecture3.pdf"),
    );
  });

  it("boosts children when parent module is Course Outline", () => {
    const child = scoreOutlineCandidate("F26.pdf", "F26.pdf", "Course Outline");
    const alone = scoreOutlineCandidate("F26.pdf", "F26.pdf");
    expect(child).toBeGreaterThan(alone);
    expect(child).toBeGreaterThanOrEqual(25);
  });

  it("penalizes lectures and assignments", () => {
    expect(scoreOutlineCandidate("Assignment 2", "a2.pdf")).toBeLessThan(40);
  });
});

describe("flattenContentTopics Structure shape", () => {
  it("flattens Brightspace ContentObject Structure arrays", () => {
    const modules: RawContentModule[] = [
      {
        Title: "Course Outline",
        Type: 0,
        Structure: [
          {
            Title: "CIS*2500 Outline.pdf",
            Type: 1,
            TopicType: 1,
            Id: 42,
            Url: "/content/enforced/123-CIS2500/outline.pdf",
          } as never,
          {
            Title: "Week 1",
            Type: 0,
            Structure: [
              {
                Title: "Lecture 1",
                Type: 1,
                Id: 99,
                Url: "/content/enforced/123-CIS2500/lec1.pdf",
              } as never,
            ],
          },
        ],
      },
    ];
    const flat = flattenContentTopics(modules);
    expect(flat.map((t) => t.title)).toContain("CIS*2500 Outline.pdf");
    expect(flat.map((t) => t.title)).toContain("Lecture 1");
    const outline = flat.find((t) => t.id === 42);
    expect(outline?.parentTitle).toBe("Course Outline");
    expect(outline?.isFileLike).toBe(true);
  });

  it("still flattens classic TOC Topics/Modules", () => {
    const modules: RawContentModule[] = [
      {
        Title: "Start Here",
        Topics: [{ Title: "Syllabus", TopicId: 7, Url: "syllabus.pdf" }],
        Modules: [
          {
            Title: "Nested",
            Topics: [{ Title: "Other", TopicId: 8, Url: "x.txt" }],
          },
        ],
      },
    ];
    const flat = flattenContentTopics(modules);
    expect(flat).toHaveLength(2);
    expect(flat[0].id).toBe(7);
  });
});
