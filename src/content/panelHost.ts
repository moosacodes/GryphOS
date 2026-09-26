/** Inject / toggle the gryphOS side panel iframe on CourseLink pages. */

const HOST_ID = "gryphos-panel-host";
const FRAME_ID = "gryphos-panel-frame";

function ensureHost(): HTMLElement {
  let host = document.getElementById(HOST_ID);
  if (host) return host;

  host = document.createElement("div");
  host.id = HOST_ID;
  host.setAttribute("data-gryphos", "panel");
  Object.assign(host.style, {
    all: "initial",
    position: "fixed",
    top: "0",
    right: "0",
    width: "380px",
    maxWidth: "100vw",
    height: "100vh",
    zIndex: "2147483646",
    boxShadow: "-8px 0 32px rgba(0,0,0,.28)",
    transform: "translateX(105%)",
    transition: "transform 160ms ease",
    background: "#0f1115",
  });

  const frame = document.createElement("iframe");
  frame.id = FRAME_ID;
  frame.title = "gryphOS";
  frame.src = chrome.runtime.getURL("panel.html");
  frame.allow = "clipboard-read; clipboard-write";
  Object.assign(frame.style, {
    border: "0",
    width: "100%",
    height: "100%",
    background: "transparent",
    display: "block",
  });

  const close = document.createElement("button");
  close.type = "button";
  close.textContent = "✕";
  close.setAttribute("aria-label", "Close gryphOS panel");
  Object.assign(close.style, {
    position: "absolute",
    top: "10px",
    left: "-40px",
    width: "32px",
    height: "32px",
    borderRadius: "8px 0 0 8px",
    border: "0",
    cursor: "pointer",
    background: "#c8102e",
    color: "#fff",
    fontSize: "14px",
    fontWeight: "700",
    boxShadow: "0 2px 8px rgba(0,0,0,.25)",
  });
  close.addEventListener("click", () => setPanelOpen(false));

  host.appendChild(close);
  host.appendChild(frame);
  document.documentElement.appendChild(host);
  return host;
}

export function isPanelOpen(): boolean {
  const host = document.getElementById(HOST_ID);
  return !!host && host.dataset.open === "1";
}

export function setPanelOpen(open: boolean): void {
  const host = ensureHost();
  host.dataset.open = open ? "1" : "0";
  host.style.transform = open ? "translateX(0)" : "translateX(105%)";
}

export function togglePanel(): boolean {
  const next = !isPanelOpen();
  setPanelOpen(next);
  return next;
}
