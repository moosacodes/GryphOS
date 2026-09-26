import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { parseOutlineText } from "@/adapters/outline/parse";

const root = dirname(fileURLToPath(import.meta.url));

describe("outline parser", () => {
  it("extracts code, weights, instructor from sample", () => {
    const text = readFileSync(join(root, "../fixtures/outline-sample.txt"), "utf8");
    const r = parseOutlineText(text);
    expect(r.courseCode).toBe("CIS*2520");
    expect(r.instructors[0]?.name).toMatch(/Jane/);
    expect(r.assessments.length).toBeGreaterThanOrEqual(4);
    const weights = r.assessments.map((a) => a.weightPercent).filter((w): w is number => w != null);
    const sum = weights.reduce((s, w) => s + w, 0);
    expect(sum).toBe(100);
    expect(r.confidence).toBeGreaterThan(0.5);
  });

  it("does not invent dates for week labels", () => {
    const r = parseOutlineText("Evaluation\nProject 20% due Week 6\n");
    const project = r.assessments.find((a) => /project/i.test(a.title));
    if (project?.dueLabel?.toLowerCase().includes("week")) {
      expect(project.certainty).toBe("approximate");
      expect(project.dueIso).toBeNull();
    }
  });
});
