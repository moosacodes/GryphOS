/**
 * Chromium extension API surface.
 * Brave, Opera GX, and Chrome all expose the `chrome.*` namespace for MV3.
 * No `browser` polyfill is required for gryphOS's supported targets.
 */
export function getChrome(): typeof chrome {
  if (typeof chrome === "undefined" || !chrome.runtime?.id) {
    throw new Error("gryphOS must run as a loaded browser extension (Brave / Opera GX / Chrome).");
  }
  return chrome;
}

export function hasExtensionApis(): boolean {
  return typeof chrome !== "undefined" && !!chrome.runtime?.id;
}
