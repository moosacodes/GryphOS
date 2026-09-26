import { useCallback, useEffect, useState } from "react";
import type { AppData } from "@/domain/types";
import { emptyAppData } from "@/storage/schema";
import { invalidateCache, loadAppData, saveAppData, subscribe } from "@/storage/repository";

export function useAppData() {
  const [data, setData] = useState<AppData>(emptyAppData());
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let alive = true;
    void loadAppData().then((d) => {
      if (alive) {
        setData(d);
        setReady(true);
      }
    });
    const unsub = subscribe((d) => setData(d));
    const onStorage = () => {
      invalidateCache();
      void loadAppData().then(setData);
    };
    if (typeof chrome !== "undefined" && chrome.storage?.onChanged) {
      chrome.storage.onChanged.addListener(onStorage);
    }
    return () => {
      alive = false;
      unsub();
      if (typeof chrome !== "undefined" && chrome.storage?.onChanged) {
        chrome.storage.onChanged.removeListener(onStorage);
      }
    };
  }, []);

  const update = useCallback(async (patch: Partial<AppData> | ((prev: AppData) => AppData)) => {
    const current = await loadAppData();
    const next = typeof patch === "function" ? patch(current) : { ...current, ...patch };
    await saveAppData(next);
    setData(next);
    return next;
  }, []);

  return { data, ready, update };
}
