import { Link } from "react-router-dom";
import type { AppData, Assessment } from "@/domain/types";
import { DEFAULT_ITEM_STATE } from "@/domain/types";
import { buildCommandCentre, type PriorityBucket } from "@/engines/priority";
import { deadlineSafetyFromAssessment } from "@/engines/deadlines";
import { EmptyState } from "../components/EmptyState";
import { SyncButton } from "../components/SyncButton";
import { openCourseLink } from "@/shared/actions";

const BUCKET_LABEL: Record<PriorityBucket, string> = {
  NOW: "Now",
  NEXT: "Next",
  NEEDS_ACTION: "Needs action",
  CONFIRMATION: "Needs confirmation",
  CHANGES: "Changes",
  WATCH: "Watch",
  DONE: "Done",
};

export function CommandCentre({
  data,
  update,
}: {
  data: AppData;
  update?: (patch: Partial<AppData> | ((prev: AppData) => AppData)) => Promise<AppData>;
}) {
  const courses = data.courses.filter((c) =>
    (data.preferences.selectedCourseIds ?? data.courses.map((x) => x.id)).includes(c.id),
  );
  const selected = courses.length ? courses : data.courses.filter((c) => c.selected);
  const assessments = data.assessments.filter((a) => selected.some((c) => c.id === a.courseId));
  const items = buildCommandCentre(selected, assessments, data.changes ?? []);
  const name = data.user?.name?.split(" ")[0] ?? "there";

  const confirm = async (a: Assessment, kind: "did" | "missed" | "submitted") => {
    if (!update) return;
    await update((prev) => ({
      ...prev,
      assessments: prev.assessments.map((x) => {
        if (x.id !== a.id) return x;
        const state = {
          ...DEFAULT_ITEM_STATE,
          ...x.state,
          needsConfirmation: false,
          pastDueConfirmed: true,
        };
        if (kind === "did") {
          state.userCompleted = "confirmed";
          state.work = "completed";
        }
        if (kind === "missed") {
          state.missed = true;
          state.userCompleted = "denied";
        }
        if (kind === "submitted") {
          return {
            ...x,
            submissionState: "submitted" as const,
            state: {
              ...state,
              submission: "submitted",
              work: "completed",
              userCompleted: "confirmed",
            },
          };
        }
        return { ...x, state };
      }),
    }));
  };

  if (!data.sync.lastSyncedAt && selected.length === 0) {
    return (
      <div>
        <div className="page-header">
          <div>
            <h1>Command Centre</h1>
            <p>Semantic academic priorities — evidence first, no invented certainty.</p>
          </div>
        </div>
        <EmptyState
          title="Not synced yet"
          body="Open CourseLink while signed in, then sync. No passwords. No chatbot."
          action={
            <div style={{ display: "flex", gap: "0.5rem", justifyContent: "center", marginTop: "0.75rem" }}>
              <button type="button" className="btn btn-primary" onClick={() => void openCourseLink(true)}>
                Open CourseLink
              </button>
              <SyncButton />
            </div>
          }
        />
      </div>
    );
  }

  const buckets: PriorityBucket[] = [
    "NOW",
    "NEEDS_ACTION",
    "CONFIRMATION",
    "CHANGES",
    "NEXT",
    "WATCH",
  ];

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Command Centre</h1>
          <p>
            Hi {name}. Priorities are weight-aware and explainable. Derived deadlines are labeled — never
            presented as registrar fact.
          </p>
        </div>
        <SyncButton />
      </div>

      {buckets.map((b) => {
        const list = items.filter((i) => i.bucket === b);
        if (!list.length) return null;
        return (
          <section key={b} className="card" style={{ marginBottom: "1rem" }}>
            <h2 style={{ marginTop: 0 }}>{BUCKET_LABEL[b]}</h2>
            <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
              {list.slice(0, 12).map((item) => {
                const a = item.assessmentId
                  ? assessments.find((x) => x.id === item.assessmentId)
                  : null;
                const safety = a ? deadlineSafetyFromAssessment(a) : null;
                return (
                  <li
                    key={item.id}
                    style={{
                      padding: "0.65rem 0",
                      borderBottom: "1px solid var(--border, #3333)",
                    }}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", gap: "0.75rem" }}>
                      <div>
                        <strong>{item.courseCode}</strong> · {item.title}
                        {safety ? (
                          <span className="badge" style={{ marginLeft: "0.5rem", opacity: 0.8 }}>
                            {safety}
                          </span>
                        ) : null}
                        <div style={{ fontSize: "0.85rem", opacity: 0.85, marginTop: "0.25rem" }}>
                          {item.explanation.join(" · ")}
                        </div>
                        {a ? (
                          <div style={{ marginTop: "0.35rem" }}>
                            <Link to={`/assessment/${encodeURIComponent(a.id)}`}>Why / detail</Link>
                          </div>
                        ) : null}
                      </div>
                      {b === "CONFIRMATION" && a && update ? (
                        <div style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
                          <button type="button" className="btn btn-sm" onClick={() => void confirm(a, "did")}>
                            I did it
                          </button>
                          <button type="button" className="btn btn-sm" onClick={() => void confirm(a, "missed")}>
                            Missed
                          </button>
                          <button
                            type="button"
                            className="btn btn-sm"
                            onClick={() => void confirm(a, "submitted")}
                          >
                            Submitted
                          </button>
                        </div>
                      ) : null}
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
