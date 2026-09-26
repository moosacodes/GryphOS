import type { Conflict } from "@/domain/types";

export function ConflictBanner({ conflict }: { conflict: Conflict }) {
  return (
    <div className="conflict-banner" role="alert">
      <strong>⚠ {conflict.field} conflict</strong>
      <ul className="small" style={{ margin: "0.35rem 0 0", paddingLeft: "1.1rem" }}>
        {conflict.values.map((v, i) => (
          <li key={i}>
            {v.sourceType}: {typeof v.value === "object" ? v.label : String(v.value)}
          </li>
        ))}
      </ul>
      <div className="small muted" style={{ marginTop: "0.35rem" }}>
        {conflict.resolutionRule}
      </div>
    </div>
  );
}
