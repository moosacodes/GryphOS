import type { ReactNode } from "react";

export function EmptyState({
  title,
  body,
  action,
}: {
  title: string;
  body: string;
  action?: ReactNode;
}) {
  return (
    <div className="empty" role="status">
      <strong>{title}</strong>
      <p className="muted small">{body}</p>
      {action}
    </div>
  );
}
