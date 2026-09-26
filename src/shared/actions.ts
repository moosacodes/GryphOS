import { COURSELINK_ORIGIN } from "@/domain/constants";
import { loadAppData, saveAppData } from "@/storage/repository";

export async function openCourseLink(active = true): Promise<void> {
  const data = await loadAppData();
  await saveAppData({ ...data, pendingSync: true });
  await chrome.tabs.create({ url: `${COURSELINK_ORIGIN}/d2l/home`, active });
}

export async function requestSync(): Promise<void> {
  const tabs = await chrome.tabs.query({ url: `${COURSELINK_ORIGIN}/*` });
  const tab = tabs.find((t) => t.id !== undefined);
  if (!tab?.id) {
    await openCourseLink(false);
    return;
  }
  try {
    await chrome.tabs.sendMessage(tab.id, { type: "GRYPHOS_SYNC" });
  } catch {
    const data = await loadAppData();
    await saveAppData({ ...data, pendingSync: true });
    await chrome.tabs.reload(tab.id);
  }
}

/** Open the full app from the packed extension (chrome-extension://…/app.html). */
export async function openApp(): Promise<void> {
  const url = chrome.runtime.getURL("app.html");
  try {
    await chrome.tabs.create({ url });
  } catch {
    // Popup context can flake; background owns a reliable open path.
    try {
      await chrome.runtime.sendMessage({ type: "GRYPHOS_OPEN_APP" });
    } catch {
      window.open(url, "_blank");
    }
  }
}
