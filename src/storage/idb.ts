/** IndexedDB helpers — multi-store for artifacts/facts/entities (extension-page origin). */
import { openDB, type IDBPDatabase } from "idb";
import { IDB_KEY, IDB_NAME, IDB_STORE } from "./schema";

export const IDB_STORES = [
  IDB_STORE,
  "sourceArtifacts",
  "extractedFacts",
  "entityLinks",
  "meetingPatterns",
  "meetingOccurrences",
  "academicRules",
  "changes",
  "contentModules",
  "contentItems",
] as const;

let dbPromise: Promise<IDBPDatabase> | null = null;

function getDb() {
  dbPromise ??= openDB(IDB_NAME, 3, {
    upgrade(db, oldVersion) {
      for (const name of IDB_STORES) {
        if (!db.objectStoreNames.contains(name)) {
          db.createObjectStore(name);
        }
      }
      void oldVersion;
    },
  });
  return dbPromise;
}

export async function idbGet<T>(key: string = IDB_KEY, store: string = IDB_STORE): Promise<T | null> {
  try {
    const db = await getDb();
    return ((await db.get(store, key)) as T) ?? null;
  } catch {
    return null;
  }
}

export async function idbSet(value: unknown, key: string = IDB_KEY, store: string = IDB_STORE): Promise<void> {
  const db = await getDb();
  await db.put(store, value, key);
}

export async function idbPutRecord(store: string, key: string, value: unknown): Promise<void> {
  const db = await getDb();
  await db.put(store, value, key);
}

export async function idbGetAll<T>(store: string): Promise<T[]> {
  try {
    const db = await getDb();
    return (await db.getAll(store)) as T[];
  } catch {
    return [];
  }
}
