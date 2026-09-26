/** Inject / toggle the gryphOS side panel iframe on CourseLink pages. */

const HOST_ID = "gryphos-panel-host";
const FRAME_ID = "gryphos-panel-frame";
const WIDTH = 400;

function ensureHost(): HTMLElement {
  let host = document.getElementById(HOST_ID);
  if (host) return host;

  host = document.createElement("div");
  host.id = HOST_ID;
  host.setAttribute("data-gryphos", "panel");
  Object.assign(host.style, {
    all: "initial",
    position: "fixed",
    top: "12px",
    right: "12px",
    bottom: "12px",
    width: `${WIDTH}px`,
    maxWidth: "calc(100vw - 24px)",
    zIndex: "2147483646",
    borderRadius: "14px",
    overflow: "hidden",
    boxShadow: "0 18px 50px rgba(0,0,0,.38), 0 0 0 1px rgba(255,255,255,.06)",
    transform: "translateX(calc(100% + 28px))",
    opacity: "0",
    transition: "transform 220ms cubic-bezier(.2,.8,.2,1), opacity 180ms ease",
    background: "#0e1014",
    fontFamily: "system-ui, sans-serif",
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
    left: "-44px",
    width: "36px",
    height: "36px",
    borderRadius: "10px",
    border: "0",
    cursor: "pointer",
    background: "#b42318",
    color: "#fff",
    fontSize: "14px",
    fontWeight: "700",
    boxShadow: "0 4px 14px rgba(0,0,0,.3)",
  });
  close.addEventListener("click", () => setPanelOpen(false));

  host.appendChild(close);
  host.appendChild(frame);
  document.documentElement.appendChild(host);
  // Force layout before animating open on first inject
  void host.offsetWidth;
  return host;
}

export function isPanelOpen(): boolean {
  const host = document.getElementById(HOST_ID);
  return !!host && host.dataset.open === "1";
}

export function setPanelOpen(open: boolean): void {
  const host = ensureHost();
  host.dataset.open = open ? "1" : "0";
  if (open) {
    host.style.transform = "translateX(0)";
    host.style.opacity = "1";
  } else {
    host.style.transform = "translateX(calc(100% + 28px))";
    host.style.opacity = "0";
  }
}

export function togglePanel(): boolean {
  const next = !isPanelOpen();
  setPanelOpen(next);
  return next;
}
