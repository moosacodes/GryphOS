/**
 * External tools (Zybooks etc.) as first-class entities.
 * CIS*2520-like Zybook Q1–Q6 → separate entities + best 5/6.
 */
import type { Assessment, ExternalActivity } from "@/domain/types";
import { assessmentId } from "@/domain/ids";
import { unknownDate } from "@/domain/dates";
import { DEFAULT_ITEM_STATE } from "@/domain/types";

const ZYBOOK_GROUP =
  /\b(zybook|zybooks)\b.*?\b(?:activities?|participation|assignments?)?\b/i;

export function detectExternalActivities(
  courseId: string,
  contentTitles: string[],
  assessments: Assessment[],
): { activities: ExternalActivity[]; syntheticAssessments: Assessment[] } {
  const activities: ExternalActivity[] = [];
  const synthetic: Assessment[] = [];
  const blob = [...contentTitles, ...assessments.map((a) => a.title)].join(" \n ");

  // Find Zybook Q1..Qn mentions (including "Q1 through Q6" / "Q1-Q6" ranges)
  const qMatches = [...blob.matchAll(/\b(?:zybooks?\s*)?(?:activity\s*)?q\s*([1-9]\d?)\b/gi)];
  const numsSet = new Set(qMatches.map((m) => Number(m[1])).filter((n) => n >= 1 && n <= 20));
  const range = blob.match(/\bq\s*([1-9]\d?)\s*(?:through|thru|to|-|–|—)\s*q?\s*([1-9]\d?)\b/i);
  if (range) {
    const a = Number(range[1]);
    const b = Number(range[2]);
    const lo = Math.min(a, b);
    const hi = Math.max(a, b);
    for (let i = lo; i <= hi && i <= 20; i++) numsSet.add(i);
  }
  // "best 5 of 6" / "best 5/6" without explicit list → assume Q1..Q6
  if (numsSet.size === 0 && /zybooks?/i.test(blob) && /best\s*5\s*(?:of|\/)\s*6/i.test(blob)) {
    for (let i = 1; i <= 6; i++) numsSet.add(i);
  }
  const nums = [...numsSet].sort((a, b) => a - b);

  if (nums.length >= 3 || (ZYBOOK_GROUP.test(blob) && nums.length >= 1) || (/zybooks?/i.test(blob) && nums.length >= 1)) {
    const groupId = `extgroup:${courseId}:zybook`;
    const bestN = nums.length >= 6 ? 5 : Math.max(1, nums.length - 1);
    for (const n of nums.length ? nums : [1, 2, 3, 4, 5, 6]) {
      const key = `Q${n}`;
      const id = `ext:${courseId}:zybook:${key}`;
      const aid = assessmentId(courseId, "external", `zybook-${key}`);
      activities.push({
        id,
        courseId,
        title: `Zybook ${key}`,
        tool: "zybooks",
        url: null,
        notes: `External Zybook activity ${key}`,
        activityKey: key,
        parentGroupId: groupId,
        bestNOf: bestN,
        groupSize: Math.max(nums.length, 6),
        assessmentId: aid,
      });
      // Only synthesize if no existing assessment matches
      const exists = assessments.some(
        (a) => a.courseId === courseId && /zybook/i.test(a.title) && new RegExp(`\\bq\\s*${n}\\b`, "i").test(a.title),
      );
      if (!exists) {
        synthetic.push({
          id: aid,
          courseId,
          title: `Zybook ${key}`,
          type: "other",
          due: unknownDate(),
          start: unknownDate(),
          end: unknownDate(),
          weightPercent: null,
          pointsPossible: null,
          pointsEarned: null,
          submissionState: "unknown",
          submittedAt: null,
          gradeDisplay: null,
          url: null,
          notes: `External tool activity; best ${bestN} of ${Math.max(nums.length, 6)}`,
          categoryId: null,
          isBonus: false,
          attemptNumber: null,
          state: { ...DEFAULT_ITEM_STATE },
          sourceRecords: [],
          fieldProvenance: {},
          conflictIds: [],
          manualOverrides: {},
          updatedAt: new Date().toISOString(),
        });
      }
    }
  }

  // Generic external links from assessments
  for (const a of assessments) {
    if (!a.url) continue;
    if (/zybooks\.com|pearson|wiley|connect\.|crowdmark|gradescope/i.test(a.url)) {
      const tool = /zybooks?/i.test(a.url)
        ? "zybooks"
        : /gradescope/i.test(a.url)
          ? "gradescope"
          : /crowdmark/i.test(a.url)
            ? "crowdmark"
            : "external";
      activities.push({
        id: `ext:${a.id}`,
        courseId,
        title: a.title,
        tool,
        url: a.url,
        notes: null,
        activityKey: null,
        parentGroupId: null,
        bestNOf: null,
        groupSize: null,
        assessmentId: a.id,
      });
    }
  }

  return { activities, syntheticAssessments: synthetic };
}

