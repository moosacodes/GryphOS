import type { Assessment, Course } from "@/domain/types";
import { formatInToronto } from "@/domain/dates";
import { StatusBadge } from "./StatusBadge";

export function AssessmentRow({
  assessment,
  course,
  onClick,
}: {
  assessment: Assessment;
  course?: Course;
  onClick?: () => void;
}) {
  const due =
    assessment.due.iso
      ? formatInToronto(assessment.due.iso, "EEE MMM d, h:mm a")
      : assessment.due.label ?? "Date unknown";
  return (
    <button
      type="button"
      className="list-item"
      onClick={onClick}
      style={{ width: "100%", cursor: onClick ? "pointer" : "default", textAlign: "left" }}
    >
      <span className="dot" style={{ background: course?.color ?? "#888" }} aria-hidden />
      <div>
        <div style={{ fontWeight: 600 }}>
          {course ? <span className="muted small">{course.code} · </span> : null}
          {assessment.title}
        </div>
        <div className="small muted">
          {due}
          {assessment.weightPercent != null ? ` · ${assessment.weightPercent}%` : ""}
          {assessment.due.certainty === "approximate" ? " · approximate" : ""}
          {assessment.due.certainty === "conflicting" ? " · conflict" : ""}
        </div>
      </div>
      <StatusBadge assessment={assessment} />
    </button>
  );
}
