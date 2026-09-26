import { useState } from "react";
import { requestSync } from "@/shared/actions";

export function SyncButton({ compact = false }: { compact?: boolean }) {
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button"
      className={compact ? "btn" : "btn btn-primary"}
      disabled={busy}
      onClick={() => {
        setBusy(true);
        void requestSync().finally(() => setTimeout(() => setBusy(false), 800));
      }}
    >
      {busy ? "Syncing…" : "Sync CourseLink"}
    </button>
  );
}
