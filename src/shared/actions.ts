import { COURSELINK_ORIGIN } from "@/domain/constants";
import { loadAppData, saveAppData } from "@/storage/repository";
import { getChrome } from "./extensionApi";

export async function openCourseLink(active = true): Promise<void> {
  const api = getChrome();
  const data = await loadAppData();
  await saveAppData({ ...data, pendingSync: true });
  await api.tabs.create({ url: `${COURSELINK_ORIGIN}/d2l/home`, active });
}

async function withCourseLinkTab(): Promise<number> {
  const api = getChrome();
  const tabs = await api.tabs.query({ url: `${COURSELINK_ORIGIN}/*` });
  const tab = tabs.find((t) => t.id !== undefined);
  if (tab?.id) return tab.id;
  const created = await api.tabs.create({ url: `${COURSELINK_ORIGIN}/d2l/home`, active: true });
  if (!created.id) throw new Error("Could not open CourseLink");
  // Give the content script a moment to inject
  await new Promise((r) => setTimeout(r, 1500));
  return created.id;
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

/** Toggle the in-page gryphOS panel on an open CourseLink tab (opens one if needed). */
export async function toggleCourseLinkPanel(): Promise<void> {
  const api = getChrome();
  const tabId = await withCourseLinkTab();
  try {
    await api.tabs.sendMessage(tabId, { type: "GRYPHOS_TOGGLE_PANEL" });
    await api.tabs.update(tabId, { active: true });
  } catch {
    const data = await loadAppData();
    await saveAppData({ ...data, pendingSync: true });
    await api.tabs.reload(tabId);
    await new Promise((r) => setTimeout(r, 1200));
    try {
      await api.tabs.sendMessage(tabId, { type: "GRYPHOS_OPEN_PANEL" });
    } catch {
      // content script may still be loading
    }
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
