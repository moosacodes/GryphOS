import { COURSELINK_ORIGIN } from "@/domain/constants";
import { loadAppData, saveAppData } from "@/storage/repository";
import { getChrome } from "./extensionApi";

export async function openCourseLink(active = true): Promise<void> {
  const api = getChrome();
  const data = await loadAppData();
  await saveAppData({ ...data, pendingSync: true });
  await api.tabs.create({ url: `${COURSELINK_ORIGIN}/d2l/home`, active });
}

export async function requestSync(): Promise<void> {
  const api = getChrome();
  const tabs = await api.tabs.query({ url: `${COURSELINK_ORIGIN}/*` });
  const tab = tabs.find((t) => t.id !== undefined);
  if (!tab?.id) {
    await openCourseLink(false);
    return;
  }
  try {
    await api.tabs.sendMessage(tab.id, { type: "GRYPHOS_SYNC" });
  } catch {
    const data = await loadAppData();
    await saveAppData({ ...data, pendingSync: true });
    await api.tabs.reload(tab.id);
  }
}

/** Open the full app from the packed extension (extension://…/app.html). */
export async function openApp(): Promise<void> {
  const api = getChrome();
  const url = api.runtime.getURL("app.html");
  try {
    await api.tabs.create({ url });
  } catch {
    try {
      await api.runtime.sendMessage({ type: "GRYPHOS_OPEN_APP" });
    } catch {
      window.open(url, "_blank");
    }
  }
}
