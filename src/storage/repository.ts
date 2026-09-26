import type { AppData, Preferences, SyncState } from "@/domain/types";
import { migrate } from "./migrations";
import { emptyAppData } from "./schema";

/**
 * Primary store is chrome.storage.local so content scripts (CourseLink origin)
 * and extension pages share the same data. IndexedDB on a content script would
 * be partitioned to courselink.uoguelph.ca and invisible to the extension UI.
 */

const APP_KEY = "appData";

let memoryCache: AppData | null = null;
const listeners = new Set<(data: AppData) => void>();

function notify(data: AppData) {
  for (const l of listeners) l(data);
}

export function subscribe(fn: (data: AppData) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

async function readRaw(): Promise<unknown> {
  if (typeof chrome !== "undefined" && chrome.storage?.local) {
    const raw = await chrome.storage.local.get(APP_KEY);
    return raw[APP_KEY] ?? null;
  }
  // Vitest / non-extension fallback
  if (typeof localStorage !== "undefined") {
    const s = localStorage.getItem(APP_KEY);
    return s ? JSON.parse(s) : null;
  }
  return null;
}

async function writeRaw(data: AppData): Promise<void> {
  if (typeof chrome !== "undefined" && chrome.storage?.local) {
    await chrome.storage.local.set({
      [APP_KEY]: data,
      preferences: data.preferences,
      sync: data.sync,
      pendingSync: data.pendingSync,
      schemaVersion: data.schemaVersion,
    });
    return;
  }
  if (typeof localStorage !== "undefined") {
    localStorage.setItem(APP_KEY, JSON.stringify(data));
  }
}

export async function loadAppData(): Promise<AppData> {
  if (memoryCache) return memoryCache;
  const data = migrate(await readRaw());
  memoryCache = data;
  return data;
}

export async function saveAppData(data: AppData): Promise<void> {
  memoryCache = data;
  await writeRaw(data);
  notify(data);
}

export async function patchAppData(patch: Partial<AppData>): Promise<AppData> {
  const current = await loadAppData();
  const next = { ...current, ...patch };
  await saveAppData(next);
  return next;
}

export async function updateSync(sync: Partial<SyncState>): Promise<AppData> {
  const current = await loadAppData();
  return patchAppData({ sync: { ...current.sync, ...sync } });
}

export async function updatePreferences(prefs: Partial<Preferences>): Promise<AppData> {
  const current = await loadAppData();
  return patchAppData({
    preferences: { ...current.preferences, ...prefs },
  });
}

export async function resetAllData(): Promise<AppData> {
  memoryCache = null;
  if (typeof chrome !== "undefined" && chrome.storage?.local) {
    await chrome.storage.local.clear();
  } else if (typeof localStorage !== "undefined") {
    localStorage.removeItem(APP_KEY);
  }
  const empty = emptyAppData();
  await saveAppData(empty);
  return empty;
}

export function getCached(): AppData | null {
  return memoryCache;
}

/** Invalidate memory cache when another context writes storage. */
export function invalidateCache(): void {
  memoryCache = null;
}
