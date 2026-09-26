/** MV3 service worker — open-app helpers + local useful notifications. */
import { COURSELINK_ORIGIN } from "@/domain/constants";
import { loadAppData } from "@/storage/repository";
import {
  collectNotificationCandidates,
  DEFAULT_NOTIFICATION_PREFS,
} from "@/engines/notifications";

chrome.runtime.onInstalled.addListener(() => {
  // storage migrations run on first loadAppData
});

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === "GRYPHOS_OPEN_APP") {
    void chrome.tabs.create({ url: chrome.runtime.getURL("app.html") });
    sendResponse({ ok: true });
    return false;
  }
  if (msg?.type === "GRYPHOS_OPEN_COURSELINK") {
    void chrome.tabs.create({
      url: `${COURSELINK_ORIGIN}/d2l/home`,
      active: msg.active !== false,
    });
    sendResponse({ ok: true });
    return false;
  }
  if (msg?.type === "GRYPHOS_REFRESH_NOTIFICATIONS") {
    void refreshNotifications().then(() => sendResponse({ ok: true }));
    return true;
  }
  return undefined;
});

async function refreshNotifications(): Promise<void> {
  try {
    if (!chrome.notifications) return;
    const data = await loadAppData();
    const prefs = data.preferences.notifications ?? DEFAULT_NOTIFICATION_PREFS;
    if (!prefs.enabled) return;
    const shownKey = "gryphos:notif:shown";
    const stored = await chrome.storage.local.get(shownKey);
    const shown = new Set<string>(Array.isArray(stored[shownKey]) ? stored[shownKey] : []);
    const candidates = collectNotificationCandidates(data, prefs);
    for (const c of candidates.slice(0, 5)) {
      if (shown.has(c.id)) continue;
      await chrome.notifications.create(c.id, {
        type: "basic",
        iconUrl: chrome.runtime.getURL("icons/icon-128.png"),
        title: c.title,
        message: c.body,
        priority: 1,
      });
      shown.add(c.id);
    }
    // keep last 100 ids
    await chrome.storage.local.set({ [shownKey]: [...shown].slice(-100) });
  } catch {
    // notifications optional
  }
}

chrome.runtime.onStartup?.addListener?.(() => {
  void refreshNotifications();
});

chrome.notifications?.onClicked?.addListener((id) => {
  void chrome.tabs.create({ url: chrome.runtime.getURL("app.html") });
  void chrome.notifications.clear(id);
});
