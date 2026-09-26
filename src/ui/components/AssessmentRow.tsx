import type { Assessment, Course } from "@/domain/types";
import { formatInToronto } from "@/domain/dates";
import { StatusBadge } from "./StatusBadge";
import { ProvenanceBadge } from "./ProvenanceBadge";

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
  const hasConflict = assessment.due.certainty === "conflicting" || assessment.conflictIds.length > 0;
  return (
    <button
      type="button"
      className={`list-item deadline-card ${hasConflict ? "sev-conflict" : ""}`}
      onClick={onClick}
      style={{ width: "100%", cursor: onClick ? "pointer" : "default", textAlign: "left" }}
    >
      <span className="dot" style={{ background: course?.color ?? "#888" }} aria-hidden />
      <div>
        <div className="deadline-title-row">
          <span style={{ fontWeight: 650 }}>
            {course ? <span className="muted small">{course.code} · </span> : null}
            {assessment.title}
          </span>
        </div>
        <div className="small muted">
          {due}
          {assessment.weightPercent != null ? ` · ${assessment.weightPercent}%` : ""}
          {assessment.due.certainty === "approximate" ? " · approximate" : ""}
          {hasConflict ? " · conflict" : ""}
        </div>
        <div className="prov-inline">
          {assessment.fieldProvenance.due && <ProvenanceBadge source={assessment.fieldProvenance.due.sourceType} />}
          {assessment.fieldProvenance.weightPercent && (
            <ProvenanceBadge source={assessment.fieldProvenance.weightPercent.sourceType} />
          )}
        </div>
      </div>
      <StatusBadge assessment={assessment} />
    </button>
  );
}
