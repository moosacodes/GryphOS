import { describe, expect, it } from "vitest";
import {
  fixture2430,
  fixture2030,
  fixture2520,
  expandFixtureOccurrences,
  FALL_2026_HOLIDAYS,
} from "./fixtures/fall2026";
import { applyOccurrenceDeadlines } from "@/engines/deadlines";
import { applyGradeRules, evaluateCombinedComponentThreshold } from "@/engines/rules";
import { generateOccurrences, courseKeyFromCode, torontoDateTimeIso } from "@/domain/meetings";
import { ensureTypedRule } from "@/domain/rules";
import { applySupersession, reconcileFieldFacts, isStaffDiscussionAuthor } from "@/engines/facts";
import { detectArtifactChange } from "@/engines/facts";
import type { ExtractedFact, SourceArtifact } from "@/domain/facts";
import { syncContentHash } from "@/domain/facts";
import { formatInTimeZone } from "date-fns-tz";
import { UOFG_TIMEZONE } from "@/domain/constants";
import { parseIcs } from "@/engines/icsImport";
import { migrate } from "@/storage/migrations";
import { DEFAULT_ITEM_STATE } from "@/domain/types";

describe("occurrence-relative: Lab 2 Tue Sep 29 +8d â†’ Wed Oct 7 23:59 Toronto", () => {
  it("derives from specific occurrence, not now/term-start", () => {
    const fx = fixture2430();
    const occs = expandFixtureOccurrences(fx);
    const labOccs = occs.filter((o) => o.kind === "lab").sort((a, b) => a.date.localeCompare(b.date));
    // First Tuesday lab on/after Sep 10 2026 â€” find Sep 29
    const sep29 = labOccs.find((o) => o.date === "2026-09-29");
    expect(sep29).toBeTruthy();
    expect(sep29!.id).toBe("meeting-pattern:c2430:lab:0101:2026-09-29");
    expect(sep29!.indexInPattern).toBeGreaterThanOrEqual(1);

    const { assessments, derived } = applyOccurrenceDeadlines(fx.assessments, occs, fx.rules);
    const lab2 = assessments.find((a) => a.title === "Lab 2")!;
    expect(lab2.due.iso).toBeTruthy();
    const wall = formatInTimeZone(new Date(lab2.due.iso!), UOFG_TIMEZONE, "yyyy-MM-dd HH:mm");
    expect(wall).toBe("2026-10-07 23:59");
    expect(derived[0]?.occurrenceId).toContain("2026-09-29");
    expect(lab2.fieldProvenance.due?.sourceType).toBe("rule_engine");
  });
});

describe("end-of-lab: Wed Nov 11 Lab 4 due 12:20 Toronto", () => {
  it("uses occurrence end time", () => {
    const fx = fixture2520();
    const occs = expandFixtureOccurrences(fx);
    const lab4Occ = occs.filter((o) => o.kind === "lab").find((o) => o.indexInPattern === 4);
    expect(lab4Occ).toBeTruthy();
    // Nov 11 2026 is a Wednesday
    expect(lab4Occ!.date).toBe("2026-11-11");
    const { assessments } = applyOccurrenceDeadlines(fx.assessments, occs, fx.rules);
    const lab4 = assessments.find((a) => a.title === "Lab 4")!;
    const wall = formatInTimeZone(new Date(lab4.due.iso!), UOFG_TIMEZONE, "yyyy-MM-dd HH:mm");
    expect(wall).toBe("2026-11-11 12:20");
  });
});

describe("Best-N incomplete data", () => {
  it("marks drops provisional when futures ungraded; missed not zero", () => {
    const fx = fixture2030();
    const rules = [
      {
        id: "rule:2030:best3",
        courseId: fx.course.id,
        kind: "BestN" as const,
        label: "Best 3 of 11 quizzes (incomplete)",
        n: 3,
        of: 11,
        applyToTypes: ["quiz" as const],
        category: null,
        sourceType: "course_outline" as const,
        confidence: 0.95,
      },
    ];
    const quizzes = fx.assessments
      .filter((a) => a.type === "quiz")
      .map((a, i) => {
        if (i === 1) return a;
        if (i >= 7) return { ...a, pointsEarned: null, state: { ...a.state, missed: false } };
        return { ...a, pointsEarned: a.pointsEarned ?? 8 - (i % 3), pointsPossible: 10 };
      });
    const effect = applyGradeRules(quizzes, [], rules);
    expect(effect.droppedIds.size).toBe(0);
    expect(effect.provisionalDroppedIds.size).toBeGreaterThan(0);
    const missed = fx.assessments.find((a) => a.title === "Quiz 2")!;
    expect(missed.state.missed).toBe(true);
    expect(missed.pointsEarned).toBeNull();
  });
});

describe("CombinedComponentThreshold CIS*2030", () => {
  it("needs 30 of 60 course points; caps correctly", () => {
    const fx = fixture2030();
    const rule = fx.rules.find((r) => r.kind === "CombinedComponentThreshold")!;
    const mid = fx.assessments.find((a) => a.type === "midterm")!;
    const fin = fx.assessments.find((a) => a.type === "final")!;
    // mid 40% of 25 = 10 pts; final 50% of 35 = 17.5; total 27.5 < 30 â†’ fail
    const result = evaluateCombinedComponentThreshold(
      [mid, fin],
      rule,
      70,
    );
    expect(result.applies).toBe(true);
    expect(result.earned!).toBeCloseTo(27.5, 1);
    expect(result.cappedTo).toBe(45); // raw 70 > 45 â†’ 45

    const resultLow = evaluateCombinedComponentThreshold([mid, fin], rule, 40);
    expect(resultLow.cappedTo).toBe(40); // raw <= 45 stay raw

    // Boundary: exactly 30
    const midPass = { ...mid, pointsEarned: 60 }; // 15 of 25
    const finExact = { ...fin, pointsEarned: (15 / 35) * 100 };
    const exact = evaluateCombinedComponentThreshold([midPass, finExact], rule, 80);
    expect(exact.applies).toBe(false);
    expect(exact.earned!).toBeCloseTo(30, 0);
  });
});

describe("announcement supersession", () => {
  it("newer instructor fact supersedes older", () => {
    const older: ExtractedFact = {
      id: "f1",
      artifactId: "art1",
      courseId: "c",
      entityId: "a2",
      field: "due",
      factType: "deadline",
      value: "2026-10-01",
      label: "old due",
      authority: "COURSE_OUTLINE",
      confidence: 0.8,
      validFrom: "2026-09-01T00:00:00.000Z",
      supersededBy: null,
      retrievedAt: "2026-09-01T00:00:00.000Z",
      snippet: null,
    };
    const newer: ExtractedFact = {
      ...older,
      id: "f2",
      artifactId: "art2",
      value: "2026-10-08",
      label: "extended",
      authority: "INSTRUCTOR_ANNOUNCEMENT",
      validFrom: "2026-09-20T00:00:00.000Z",
      retrievedAt: "2026-09-20T00:00:00.000Z",
    };
    const after = applySupersession([older], newer);
    expect(after[0].supersededBy).toBe("f2");
    const res = reconcileFieldFacts([...after, newer], "due", "a2");
    expect(res?.value).toBe("2026-10-08");
    expect(res?.authority).toBe("INSTRUCTOR_ANNOUNCEMENT");
  });
});

describe("staff vs student discussion", () => {
  it("only staff roles count for academic facts", () => {
    expect(isStaffDiscussionAuthor("Instructor")).toBe(true);
    expect(isStaffDiscussionAuthor("Teaching Assistant")).toBe(true);
    expect(isStaffDiscussionAuthor("Student")).toBe(false);
  });
});

describe("document version hash change", () => {
  it("detects content hash change", () => {
    const prev: SourceArtifact = {
      id: "d1",
      sourceType: "course_outline",
      externalId: "outline.pdf",
      courseId: "c",
      retrievedAt: "2026-09-01T00:00:00.000Z",
      contentHash: syncContentHash("version1"),
      mimeType: "application/pdf",
      title: "Outline",
      textSnapshot: "version1",
      url: null,
    };
    expect(detectArtifactChange(prev, "version1").changed).toBe(false);
    expect(detectArtifactChange(prev, "version2").changed).toBe(true);
  });
});

describe("user override survival", () => {
  it("manual due override is not overwritten by occurrence rules", () => {
    const fx = fixture2430();
    const occs = expandFixtureOccurrences(fx);
    const withOverride = fx.assessments.map((a) =>
      a.title === "Lab 2"
        ? {
            ...a,
            manualOverrides: { due: { certainty: "exact", iso: "2026-10-10T03:59:00.000Z", label: null } },
            due: { certainty: "exact" as const, iso: "2026-10-10T03:59:00.000Z", label: "user" },
          }
        : a,
    );
    const { assessments } = applyOccurrenceDeadlines(withOverride, occs, fx.rules);
    expect(assessments.find((a) => a.title === "Lab 2")!.due.iso).toBe("2026-10-10T03:59:00.000Z");
  });
});

describe("migration preserves personal state", () => {
  it("migrates to schema with rules/facts stores and keeps overrides", () => {
    const raw = {
      schemaVersion: 1,
      assessments: [
        {
          id: "a1",
          courseId: "c1",
          title: "A1",
          type: "assignment",
          due: { certainty: "exact", iso: "2026-10-01T00:00:00.000Z", label: null },
          start: { certainty: "unknown", iso: null, label: null },
          end: { certainty: "unknown", iso: null, label: null },
          weightPercent: 10,
          pointsPossible: null,
          pointsEarned: null,
          submissionState: "unknown",
          submittedAt: null,
          gradeDisplay: null,
          url: null,
          notes: null,
          categoryId: null,
          isBonus: false,
          sourceRecords: [],
          fieldProvenance: {},
          conflictIds: [],
          manualOverrides: { due: true },
          updatedAt: "2026-09-01T00:00:00.000Z",
          state: { ...DEFAULT_ITEM_STATE, missed: true, userCompleted: "denied" },
        },
      ],
      courses: [],
      academicRules: [
        {
          id: "r1",
          courseId: "c1",
          kind: "best_n",
          label: "best 10",
          params: { n: 10, of: 11, applyToTypes: ["quiz"] },
          sourceType: "course_outline",
          confidence: 0.9,
        },
      ],
    };
    const migrated = migrate(raw);
    expect(migrated.schemaVersion).toBeGreaterThanOrEqual(3);
    expect(migrated.assessments[0].manualOverrides.due).toBe(true);
    expect(migrated.assessments[0].state.missed).toBe(true);
    expect(migrated.academicRules[0].kind).toBe("BestN");
    expect(migrated.meetingOccurrences).toEqual([]);
    expect(migrated.sourceArtifacts).toEqual([]);
  });
});

describe("timezone / DST boundary", () => {
  it("Toronto wall times convert stably around Nov DST", () => {
    // 2026-11-01 is after DST end in Toronto (Nov 1 2026)
    const iso = torontoDateTimeIso("2026-11-01", "23:59");
    const wall = formatInTimeZone(new Date(iso), UOFG_TIMEZONE, "yyyy-MM-dd HH:mm");
    expect(wall).toBe("2026-11-01 23:59");
    const sep = torontoDateTimeIso("2026-09-29", "14:30");
    expect(formatInTimeZone(new Date(sep), UOFG_TIMEZONE, "HH:mm")).toBe("14:30");
  });
});

describe("rule parser corpus", () => {
  it("migrates legacy corpus phrases into typed rules", () => {
    const corpus = [
      { kind: "best_n", label: "best 10 of 11", params: { n: 10, of: 11, applyToTypes: ["quiz"] } },
      { kind: "best_n", label: "highest 5 of 6", params: { n: 5, of: 6, applyToTypes: ["assignment"] } },
      {
        kind: "CombinedComponentThreshold",
        label: "30 of 60",
        params: {
          requiredCoursePoints: 30,
          availableCoursePoints: 60,
          capAt: 45,
          components: [
            { applyToTypes: ["midterm"], titlePattern: null, weightPercent: 25 },
            { applyToTypes: ["final"], titlePattern: null, weightPercent: 35 },
          ],
        },
      },
      { kind: "grade_cap", label: "capped at 45", params: { capPercent: 45 } },
      { kind: "attempt", label: "two attempts higher score", params: { maxAttempts: 2, applyToTypes: ["quiz"] } },
    ];
    for (const c of corpus) {
      const r = ensureTypedRule({
        id: `t:${c.label}`,
        courseId: "c",
        kind: c.kind,
        label: c.label,
        params: c.params,
        sourceType: "course_outline",
        confidence: 0.9,
      });
      expect(r.kind).toBeTruthy();
      expect(r.label).toBe(c.label);
    }
  });
});

describe("ICS RFC5545 via ical.js", () => {
  it("parses UID CATEGORIES EXDATE; category from import context", () => {
    const raw = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "BEGIN:VEVENT",
      "UID:abc-123",
      "DTSTART:20260926T143000",
      "SUMMARY:Lecture",
      "CATEGORIES:UNI",
      "EXDATE:20261003",
      "END:VEVENT",
      "END:VCALENDAR",
    ].join("\r\n");
    const ev = parseIcs(raw, { defaultCategory: "STUDY" });
    expect(ev).toHaveLength(1);
    expect(ev[0].uid).toBe("abc-123");
    expect(ev[0].category).toBe("STUDY"); // context wins
  });
});

describe("Zybook best 5 of 6", () => {
  it("drops lowest when all graded", () => {
    const fx = fixture2520();
    const z = fx.assessments.filter((a) => a.title.startsWith("Zybook"));
    const effect = applyGradeRules(z, [], fx.rules);
    expect(effect.droppedIds.size).toBe(1);
    expect(effect.droppedIds.has("a:2520:zy6")).toBe(true);
  });
});

describe("holidays skip occurrences", () => {
  it("does not generate Thanksgiving week labs incorrectly", () => {
    const fx = fixture2520();
    const labPattern = fx.patterns.find((p) => p.kind === "lab")!;
    const occs = generateOccurrences(labPattern, FALL_2026_HOLIDAYS, courseKeyFromCode(fx.course.code));
    expect(occs.some((o) => o.date === "2026-10-14")).toBe(false);
  });
});

describe("fixtures not in runtime personalization", () => {
  it("runtime applyPersonalization does not inject CIS schedules", async () => {
    const { applyPersonalization } = await import("@/adapters/uofg/personalization");
    const out = applyPersonalization(
      [{ id: "c", code: "CIS*2430", title: "x", orgUnitId: 1, semester: "F26", startDate: null, endDate: null, color: "#000", selected: true, instructorNames: [], url: "", outlineDocumentId: null, outlineStatus: "not_checked", outlineStatusDetail: null, lectureSection: null, labSection: null, tutorialSection: null, updatedAt: "" }],
      [],
      [],
      [],
    );
    expect(out.meetings).toHaveLength(0);
    expect(out.courses[0].lectureSection).toBeNull();
  });
});

