import { useState } from "react";
import type { AppData } from "@/domain/types";
import { buildDiagnostics, diagnosticsFilename } from "@/diagnostics/export";

function extensionVersion(): string {
  try {
    if (typeof chrome !== "undefined" && chrome.runtime?.getManifest) {
      return chrome.runtime.getManifest().version;
    }
  } catch {
    /* not in extension */
  }
  return "dev";
}

/** Local-only download via Blob link — nothing is uploaded anywhere. */
export function downloadDiagnostics(
  data: AppData,
  opts: { includeGrades: boolean; includeOutlineText: boolean },
): string {
  const version = extensionVersion();
  const now = new Date();
  const payload = buildDiagnostics(data, opts, {
    extensionVersion: version,
    userAgent: typeof navigator !== "undefined" ? navigator.userAgent : null,
    now,
  });
  const filename = diagnosticsFilename(version, now);
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.rel = "noopener";
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
  return filename;
}

export function DiagnosticsExport({ data, compact = false }: { data: AppData; compact?: boolean }) {
  const [includeGrades, setIncludeGrades] = useState(false);
  const [includeOutlineText, setIncludeOutlineText] = useState(true);
  const [status, setStatus] = useState<string | null>(null);

  const onExport = () => {
    try {
      const name = downloadDiagnostics(data, { includeGrades, includeOutlineText });
      setStatus(`Saved ${name} to your Downloads folder`);
    } catch (e) {
      setStatus(`Export failed: ${String((e as Error).message ?? e)}`);
    }
  };

  const row = { display: "flex", gap: 6, alignItems: "center" } as const;
  return (
    <div
      className="diagnostics-export"
      style={
        compact
          ? { display: "flex", flexWrap: "wrap", gap: "4px 10px", alignItems: "center" }
          : { display: "flex", flexDirection: "column", gap: 8, alignItems: "flex-start" }
      }
    >
      <button type="button" className="btn btn-sm" onClick={onExport} title="Download a local JSON diagnostics file (redacted by default)">
        Export diagnostics
      </button>
      <label className="small" style={row}>
        <input type="checkbox" checked={includeGrades} onChange={(e) => setIncludeGrades(e.target.checked)} />
        Include grades
      </label>
      <label className="small" style={row}>
        <input type="checkbox" checked={includeOutlineText} onChange={(e) => setIncludeOutlineText(e.target.checked)} />
        {compact ? "Include outline text" : "Include outline text excerpts"}
      </label>
      {!compact && (
        <p className="small muted" style={{ margin: 0 }}>
          Redacted by default: your name, student id, emails, grade values and discussion post bodies. Never includes
          cookies, tokens or passwords. The file stays on this computer.
        </p>
      )}
      {status && <p className="small muted" style={{ margin: 0 }} role="status">{status}</p>}
    </div>
  );
}
