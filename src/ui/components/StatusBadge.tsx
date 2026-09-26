import { statusLabel, classifyTaskStatus } from "@/engines/status";
import type { Assessment } from "@/domain/types";

export function StatusBadge({ assessment }: { assessment: Assessment }) {
  const s = classifyTaskStatus(assessment);
  const cls =
    s === "overdue"
      ? "badge badge-danger"
      : s === "due_today" || s === "due_soon"
        ? "badge badge-warn"
        : s === "submitted" || s === "graded"
          ? "badge badge-ok"
          : "badge";
  return <span className={cls}>{statusLabel(s)}</span>;
}
