/** Optional IndexedDB helpers (extension-page origin only). Not used as primary sync store. */
import { openDB, type IDBPDatabase } from "idb";
import { IDB_KEY, IDB_NAME, IDB_STORE } from "./schema";

let dbPromise: Promise<IDBPDatabase> | null = null;

function getDb() {
  dbPromise ??= openDB(IDB_NAME, 1, {
    upgrade(db) {
      if (!db.objectStoreNames.contains(IDB_STORE)) db.createObjectStore(IDB_STORE);
    },
  });
  return dbPromise;
}

export async function idbGet<T>(key: string = IDB_KEY): Promise<T | null> {
  try {
    const db = await getDb();
    return ((await db.get(IDB_STORE, key)) as T) ?? null;
  } catch {
    return null;
  }
}

export async function idbSet(value: unknown, key: string = IDB_KEY): Promise<void> {
  const db = await getDb();
  await db.put(IDB_STORE, value, key);
}
