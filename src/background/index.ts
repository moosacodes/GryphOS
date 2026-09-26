/** MV3 service worker — message relay and open-app helpers. */
import { COURSELINK_ORIGIN } from "@/domain/constants";

chrome.runtime.onInstalled.addListener(() => {
  // no-op; storage migrations run on first loadAppData
});

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === "GRYPHOS_OPEN_APP") {
    void chrome.tabs.create({ url: chrome.runtime.getURL("app.html") });
    sendResponse({ ok: true });
    return false;
  }
  if (msg?.type === "GRYPHOS_OPEN_COURSELINK") {
    void chrome.tabs.create({ url: `${COURSELINK_ORIGIN}/d2l/home`, active: msg.active !== false });
    sendResponse({ ok: true });
    return false;
  }
  return undefined;
});
