import { STORAGE_SCHEMA_VERSION } from "@/domain/constants";
import type { AppData, Course } from "@/domain/types";
import { emptyAppData } from "./schema";

type Migration = (data: AppData) => AppData;

const migrations: Record<number, Migration> = {
  // Future: 1 -> 2 goes here
};

function ensureCourseFields(c: Course): Course {
  return {
    ...c,
    outlineStatus: c.outlineStatus ?? "not_checked",
    outlineStatusDetail: c.outlineStatusDetail ?? null,
    outlineDocumentId: c.outlineDocumentId ?? null,
  };
}

export function migrate(raw: unknown): AppData {
  const base = emptyAppData();
  if (!raw || typeof raw !== "object") return base;
  let data = { ...base, ...(raw as Partial<AppData>) } as AppData;
  if (typeof data.schemaVersion !== "number") data.schemaVersion = 0;
  while (data.schemaVersion < STORAGE_SCHEMA_VERSION) {
    const next = data.schemaVersion + 1;
    const fn = migrations[next];
    if (fn) data = fn(data);
    data.schemaVersion = next;
  }
  data.preferences = { ...base.preferences, ...data.preferences, courseColors: { ...data.preferences?.courseColors } };
  data.sync = { ...base.sync, ...data.sync };
  data.courses = (data.courses ?? []).map(ensureCourseFields);
  return data;
}
