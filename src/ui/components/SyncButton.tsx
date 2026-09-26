import { useState } from "react";
import { requestSync } from "@/shared/actions";

export function SyncButton({ compact = false }: { compact?: boolean }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  return (
    <span style={{ display: "inline-flex", flexDirection: "column", gap: 4, alignItems: "stretch" }}>
      <button
        type="button"
        className={compact ? "btn" : "btn btn-primary"}
        disabled={busy}
        onClick={() => {
          setBusy(true);
          setErr(null);
          void requestSync()
            .then((r) => {
              if (r && !r.ok) setErr(r.error ?? "Sync failed");
            })
            .catch((e: unknown) => setErr(String((e as Error).message ?? e)))
            .finally(() => setTimeout(() => setBusy(false), 500));
        }}
      >
        {busy ? "Syncing..." : "Sync CourseLink"}
      </button>
      {err ? (
        <span className="small" style={{ color: "var(--danger)", maxWidth: 280 }}>
          {err}
        </span>
      ) : null}
    </span>
  );
}
