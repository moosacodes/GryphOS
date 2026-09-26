/**
 * Quick structured capture — "2430 finish A2 testing tomorrow"
 */
import type { AppData, UserTask } from "@/domain/types";

const DAY_WORDS: Record<string, number> = {
  today: 0,
  tomorrow: 1,
  mon: 1,
  monday: 1,
  tue: 2,
  tuesday: 2,
  wed: 3,
  wednesday: 3,
  thu: 4,
  thursday: 4,
  fri: 5,
  friday: 5,
  sat: 6,
  saturday: 6,
  sun: 0,
  sunday: 0,
};

function resolveDue(text: string, now = new Date()): string | null {
  const lower = text.toLowerCase();
  for (const [word, offset] of Object.entries(DAY_WORDS)) {
    if (new RegExp(`\\b${word}\\b`).test(lower)) {
      const d = new Date(now);
      if (word === "today" || word === "tomorrow") {
        d.setDate(d.getDate() + offset);
      } else {
        const target = offset;
        const cur = d.getDay();
        let add = (target - cur + 7) % 7;
        if (add === 0) add = 7;
        d.setDate(d.getDate() + add);
      }
      d.setHours(23, 59, 0, 0);
      return d.toISOString();
    }
  }
  const iso = lower.match(/\b(20\d{2}-\d{2}-\d{2})\b/);
  if (iso) return new Date(iso[1] + "T23:59:00").toISOString();
  return null;
}

function matchCourseId(data: AppData, text: string): string | null {
  const compact = text.replace(/\s/g, "").toLowerCase();
  for (const c of data.courses) {
    const code = c.code.replace(/\s|\*/g, "").toLowerCase();
    const digits = code.match(/\d{4}/)?.[0];
    if (digits && compact.includes(digits)) return c.id;
    if (compact.includes(code)) return c.id;
  }
  return null;
}

export function parseCapture(text: string, data: AppData, now = new Date()): UserTask {
  const dueIso = resolveDue(text, now);
  const courseId = matchCourseId(data, text);
  const title = text
    .replace(/\b(today|tomorrow|monday|tuesday|wednesday|thursday|friday|saturday|sunday|mon|tue|wed|thu|fri|sat|sun)\b/gi, "")
    .replace(/\b20\d{2}-\d{2}-\d{2}\b/g, "")
    .replace(/\s+/g, " ")
    .trim() || text.trim();
  const id = `task:${Date.now().toString(36)}:${Math.random().toString(36).slice(2, 7)}`;
  return {
    id,
    courseId,
    title,
    notes: null,
    dueIso,
    done: false,
    checklist: [],
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
  };
}

export function addCapturedTask(data: AppData, text: string): AppData {
  const task = parseCapture(text, data);
  return {
    ...data,
    userTasks: [task, ...(data.userTasks ?? [])],
  };
}
