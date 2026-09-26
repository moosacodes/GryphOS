import type { Preferences, SyncState } from "@/domain/types";
import { DEFAULT_PREFERENCES, DEFAULT_SYNC } from "@/domain/types";

export interface ChromeMeta {
  preferences: Preferences;
  sync: SyncState;
  pendingSync: boolean;
  schemaVersion: number;
}

export async function readChromeMeta(): Promise<Partial<ChromeMeta>> {
  if (typeof chrome === "undefined" || !chrome.storage?.local) return {};
  return (await chrome.storage.local.get([
    "preferences",
    "sync",
    "pendingSync",
    "schemaVersion",
  ])) as Partial<ChromeMeta>;
}

export async function writeChromeMeta(patch: Partial<ChromeMeta>): Promise<void> {
  if (typeof chrome === "undefined" || !chrome.storage?.local) return;
  await chrome.storage.local.set(patch);
}

export function effectiveStatus(sync: SyncState): SyncState["status"] {
  if (sync.status === "syncing" && Date.now() - (sync.startedAt ?? 0) > 120_000) return "idle";
  return sync.status;
}

export { DEFAULT_PREFERENCES, DEFAULT_SYNC };
