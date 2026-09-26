/** Content script: injected into CourseLink pages to sync with the student session. */
import { SYNC_STALE_MS } from "@/domain/constants";
import { loadAppData } from "@/storage/repository";
import { runSync } from "@/sync/engine";

let running: Promise<void> | null = null;

function sync(): Promise<void> {
  running ??= runSync().finally(() => {
    running = null;
  });
  return running;
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === "GRYPHOS_SYNC") {
    sync()
      .then(() => sendResponse({ ok: true }))
      .catch((e: unknown) =>
        sendResponse({ ok: false, error: String((e as Error).message ?? e) }),
      );
    return true;
  }
  if (msg?.type === "GRYPHOS_PING") {
    sendResponse({ ok: true });
    return false;
  }
  return undefined;
});

void loadAppData().then((s) => {
  const stale = !s.sync.lastSyncedAt || Date.now() - s.sync.lastSyncedAt > SYNC_STALE_MS;
  if (s.pendingSync || stale) void sync();
});
