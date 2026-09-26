import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { AppData } from "@/domain/types";
import { searchLocal } from "@/engines/search";
import { addCapturedTask } from "@/engines/capture";
import { requestSync } from "@/shared/actions";

type Mode = "command" | "search" | "capture";

export function CommandPalette({
  data,
  update,
  open,
  onOpenChange,
}: {
  data: AppData;
  update: (patch: Partial<AppData> | ((prev: AppData) => AppData)) => Promise<AppData>;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const nav = useNavigate();
  const [q, setQ] = useState("");
  const [mode, setMode] = useState<Mode>("command");
  const [active, setActive] = useState(0);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        onOpenChange(!open);
      }
      if (e.key === "Escape") onOpenChange(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onOpenChange]);

  useEffect(() => {
    if (!open) {
      setQ("");
      setMode("command");
      setActive(0);
    }
  }, [open]);

  const commands = useMemo(
    () => [
      { id: "today", label: "Open Today", run: () => nav("/") },
      { id: "inbox", label: "Open Inbox", run: () => nav("/inbox") },
      { id: "calendar", label: "Open Calendar", run: () => nav("/calendar") },
      { id: "grades", label: "Open Grades", run: () => nav("/grades") },
      { id: "tasks", label: "Open Tasks", run: () => nav("/tasks") },
      { id: "search", label: "Search everything", run: () => nav("/search") },
      { id: "sync", label: "Sync CourseLink", run: () => void requestSync() },
      { id: "capture", label: "Quick capture task…", run: () => setMode("capture") },
      ...data.courses
        .filter((c) => (data.preferences.selectedCourseIds ?? []).includes(c.id))
        .map((c) => ({
          id: `course:${c.id}`,
          label: `Open ${c.code}`,
          run: () => nav(`/courses/${encodeURIComponent(c.id)}`),
        })),
    ],
    [data.courses, data.preferences.selectedCourseIds, nav],
  );

  const filteredCommands = commands.filter((c) =>
    !q.trim() ? true : c.label.toLowerCase().includes(q.toLowerCase()),
  );
  const hits = mode === "search" || (mode === "command" && q.trim().length >= 2)
    ? searchLocal(data, q, 12)
    : [];

  const rows: Array<{ id: string; label: string; sub?: string; run: () => void }> =
    mode === "capture"
      ? [
          {
            id: "cap",
            label: q.trim() ? `Add task: ${q.trim()}` : "Type a task…",
            sub: 'e.g. "2430 finish A2 testing tomorrow"',
            run: () => {
              if (!q.trim()) return;
              void update((prev) => addCapturedTask(prev, q.trim()));
              onOpenChange(false);
              nav("/tasks");
            },
          },
        ]
      : [
          ...filteredCommands.map((c) => ({ id: c.id, label: c.label, run: c.run })),
          ...hits.map((h) => ({
            id: h.id,
            label: h.title,
            sub: h.subtitle,
            run: () => {
              if (h.href.startsWith("http")) window.open(h.href, "_blank");
              else nav(h.href);
            },
          })),
        ];

  if (!open) return null;

  return (
    <div className="palette-backdrop" role="dialog" aria-modal="true" aria-label="Command palette">
      <div className="palette">
        <div className="palette-modes">
          <button type="button" className={mode === "command" ? "active" : ""} onClick={() => setMode("command")}>
            Commands
          </button>
          <button type="button" className={mode === "search" ? "active" : ""} onClick={() => setMode("search")}>
            Search
          </button>
          <button type="button" className={mode === "capture" ? "active" : ""} onClick={() => setMode("capture")}>
            Capture
          </button>
        </div>
        <input
          autoFocus
          className="palette-input"
          placeholder={
            mode === "capture"
              ? "2430 finish A2 testing tomorrow"
              : mode === "search"
                ? "Search courses, docs, announcements…"
                : "Type a command or search…"
          }
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setActive(0);
          }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setActive((i) => Math.min(i + 1, rows.length - 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setActive((i) => Math.max(i - 1, 0));
            } else if (e.key === "Enter") {
              e.preventDefault();
              const row = rows[active];
              if (row) {
                row.run();
                if (mode !== "capture" || q.trim()) onOpenChange(false);
              }
            }
          }}
        />
        <ul className="palette-list">
          {rows.map((r, i) => (
            <li key={r.id}>
              <button
                type="button"
                className={i === active ? "active" : ""}
                onMouseEnter={() => setActive(i)}
                onClick={() => {
                  r.run();
                  onOpenChange(false);
                }}
              >
                <span>{r.label}</span>
                {r.sub ? <span className="small muted">{r.sub}</span> : null}
              </button>
            </li>
          ))}
          {rows.length === 0 && <li className="muted small" style={{ padding: "0.75rem" }}>No matches</li>}
        </ul>
        <div className="palette-foot small muted">Ctrl+K · Esc to close · ↑↓ Enter</div>
      </div>
    </div>
  );
}
