import { Link, useParams } from "react-router-dom";
import type { AppData } from "@/domain/types";
import { computeCourseHealth, healthStatusLabel } from "@/engines/health";
import { summarizeCourseGrades } from "@/engines/grades";
import { formatInToronto, torontoDayKey } from "@/domain/dates";
import { AssessmentRow } from "../components/AssessmentRow";
import { ConflictBanner } from "../components/ConflictBanner";

function ContentTree({ data, courseId }: { data: AppData; courseId: string }) {
  const modules = (data.contentModules ?? [])
    .filter((m) => m.courseId === courseId)
    .sort((a, b) => a.sortOrder - b.sortOrder);
  const items = (data.contentItems ?? []).filter((i) => i.courseId === courseId);
  if (modules.length === 0 && items.length === 0) {
    return <p className="muted small">Content tree empty — sync while on CourseLink to pull modules.</p>;
  }
  const roots = modules.filter((m) => !m.parentModuleId);
  const byParent = new Map<string, typeof modules>();
  for (const m of modules) {
    if (!m.parentModuleId) continue;
    byParent.set(m.parentModuleId, [...(byParent.get(m.parentModuleId) ?? []), m]);
  }
  const itemsByMod = new Map<string, typeof items>();
  for (const it of items) {
    itemsByMod.set(it.moduleId, [...(itemsByMod.get(it.moduleId) ?? []), it]);
  }

  const renderMod = (id: string, depth: number): import("react").ReactNode => {
    const mod = modules.find((m) => m.id === id);
    if (!mod) return null;
    const kids = byParent.get(id) ?? [];
    const its = itemsByMod.get(id) ?? [];
    return (
      <div key={id} className="content-mod" style={{ marginLeft: depth * 12 }}>
        <div className="content-mod-title">{mod.title}</div>
        <ul className="clean-list">
          {its.map((it) => (
            <li key={it.id}>
              {it.url ? (
                <a href={it.url} target="_blank" rel="noreferrer">
                  {it.title}
                </a>
              ) : (
                it.title
              )}{" "}
              <span className="badge">{it.documentClass}</span>
            </li>
          ))}
        </ul>
        {kids.map((k) => renderMod(k.id, depth + 1))}
      </div>
    );
  };

  // Orphan items
  const orphan = items.filter((i) => !modules.some((m) => m.id === i.moduleId));

  return (
    <div>
      {(roots.length ? roots : modules).map((m) => renderMod(m.id, 0))}
      {orphan.length > 0 && (
        <ul className="clean-list">
          {orphan.map((it) => (
            <li key={it.id}>
              {it.url ? (
                <a href={it.url} target="_blank" rel="noreferrer">
                  {it.title}
                </a>
              ) : (
                it.title
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function CourseDetailPage({ data }: { data: AppData }) {
  const { courseId = "" } = useParams();
  const id = decodeURIComponent(courseId);
  const course = data.courses.find((c) => c.id === id);
  if (!course) {
    return (
      <div>
        <p>Course not found.</p>
        <Link to="/courses">Back</Link>
      </div>
    );
  }

  const assessments = data.assessments.filter((a) => a.courseId === course.id);
  const health = computeCourseHealth(
    course,
    data.assessments,
    data.conflicts,
    data.documents,
    data.people,
    data.meetings,
  );
  const grades = summarizeCourseGrades(
    course,
    assessments,
    data.gradeCategories,
    data.academicRules,
    data.whatIfOverrides,
  );
  const conflicts = data.conflicts.filter(
    (c) => c.unresolved && assessments.some((a) => a.id === c.entityId),
  );
  const people = data.people.filter((p) => p.courseId === course.id);
  const meetings = data.meetings.filter((m) => m.courseId === course.id);
  const resources = data.resources.filter((r) => r.courseId === course.id);
  const policies = data.policies.filter((p) => p.courseId === course.id);
  const anns = data.announcements
    .filter((a) => a.courseId === course.id)
    .sort((a, b) => Date.parse(b.publishedAt ?? "0") - Date.parse(a.publishedAt ?? "0"));
  const today = torontoDayKey(new Date().toISOString());
  const nextOcc = (data.meetingOccurrences ?? [])
    .filter((o) => o.courseId === course.id && !o.cancelled && o.date >= today)
    .sort((a, b) => a.startIso.localeCompare(b.startIso))[0];
  const nextAssess = assessments
    .filter((a) => a.due.iso && a.submissionState !== "submitted" && !a.state?.missed)
    .sort((a, b) => (a.due.iso ?? "").localeCompare(b.due.iso ?? ""))[0];

  const byType = {
    quiz: assessments.filter((a) => a.type === "quiz"),
    lab: assessments.filter((a) => a.type === "lab"),
    midterm: assessments.filter((a) => a.type === "midterm"),
    final: assessments.filter((a) => a.type === "final"),
    assignment: assessments.filter((a) => a.type === "assignment" || a.type === "project"),
  };

  const progress = (list: typeof assessments) => {
    const done = list.filter(
      (a) => a.submissionState === "submitted" || a.pointsEarned != null || a.state?.missed,
    ).length;
    return list.length ? `${done}/${list.length}` : "—";
  };

  return (
    <div className="workspace course-workspace">
      <div className="page-header">
        <div>
          <p className="small">
            <Link to="/courses">← Courses</Link>
          </p>
          <h1>
            <span className="dot" style={{ display: "inline-block", background: course.color, marginRight: 8 }} />
            {course.code}
          </h1>
          <p>
            {course.title}
            {course.semester ? ` · ${course.semester}` : ""}
          </p>
        </div>
        <a className="btn btn-primary" href={course.url} target="_blank" rel="noreferrer">
          Open CourseLink
        </a>
      </div>

      <div className="grid grid-3" style={{ marginBottom: "1rem" }}>
        <div className="card card-tight">
          <h3>Standing</h3>
          <p className="stat-value">
            {grades.calculatedPercent != null ? `${grades.calculatedPercent.toFixed(1)}%` : "—"}
          </p>
          <p className="small muted">
            {grades.completedWeight.toFixed(0)}% graded · {grades.remainingWeight.toFixed(0)}% remaining
          </p>
        </div>
        <div className="card card-tight">
          <h3>Next class</h3>
          {nextOcc ? (
            <>
              <p className="stat-value" style={{ fontSize: "1.1rem" }}>
                {nextOcc.kind} · {formatInToronto(nextOcc.startIso, "EEE h:mm a")}
              </p>
              <p className="small muted">{nextOcc.location ?? "Location unknown"}</p>
            </>
          ) : (
            <p className="muted small">No upcoming occurrence</p>
          )}
        </div>
        <div className="card card-tight">
          <h3>Next assessment</h3>
          {nextAssess ? (
            <>
              <p className="stat-value" style={{ fontSize: "1.1rem" }}>
                <Link to={`/assessment/${encodeURIComponent(nextAssess.id)}`}>{nextAssess.title}</Link>
              </p>
              <p className="small muted">
                {nextAssess.due.iso ? formatInToronto(nextAssess.due.iso) : nextAssess.due.label ?? "Date unknown"}
                {nextAssess.weightPercent != null ? ` · ${nextAssess.weightPercent}%` : ""}
              </p>
            </>
          ) : (
            <p className="muted small">Nothing upcoming with a date</p>
          )}
        </div>
      </div>

      <div className="workspace-grid">
        <section className="card">
          <h2>Progress by type</h2>
          <ul className="clean-list">
            <li>Quizzes {progress(byType.quiz)}</li>
            <li>Labs {progress(byType.lab)}</li>
            <li>Assignments {progress(byType.assignment)}</li>
            <li>Midterms {progress(byType.midterm)}</li>
            <li>Final {progress(byType.final)}</li>
          </ul>
          <p className="small muted">Data health: {healthStatusLabel(health.status)}</p>
        </section>

        <section className="card">
          <h2>Grading breakdown</h2>
          {(data.gradeCategories.filter((c) => c.courseId === course.id).length === 0 &&
            assessments.every((a) => a.weightPercent == null)) ? (
            <p className="muted small">Weights unknown until outline/grades sync.</p>
          ) : (
            <ul className="clean-list">
              {data.gradeCategories
                .filter((c) => c.courseId === course.id)
                .map((c) => (
                  <li key={c.id}>
                    {c.name}: {c.weightPercent ?? "?"}%
                    {c.bestN != null ? ` · best ${c.bestN}` : ""}
                    {c.dropLowest ? ` · drop ${c.dropLowest}` : ""}
                  </li>
                ))}
              {data.gradeCategories.filter((c) => c.courseId === course.id).length === 0 &&
                assessments
                  .filter((a) => a.weightPercent != null)
                  .map((a) => (
                    <li key={a.id}>
                      {a.title}: {a.weightPercent}%
                    </li>
                  ))}
            </ul>
          )}
        </section>

        <section className="card" style={{ gridColumn: "1 / -1" }}>
          <h2>Assessments & deadlines</h2>
          <div className="list">
            {assessments.map((a) => (
              <AssessmentRow key={a.id} assessment={a} course={course} />
            ))}
          </div>
        </section>

        <section className="card">
          <h2>Announcements</h2>
          {anns.length === 0 ? (
            <p className="muted small">None synced.</p>
          ) : (
            <ul className="clean-list">
              {anns.slice(0, 10).map((a) => (
                <li key={a.id}>
                  <strong>{a.title}</strong>
                  <div className="small muted">{a.publishedAt ? formatInToronto(a.publishedAt) : ""}</div>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="card">
          <h2>Staff & office hours</h2>
          <ul className="clean-list">
            {course.instructorNames.map((n) => (
              <li key={n}>{n} (instructor)</li>
            ))}
            {people.map((p) => (
              <li key={p.id}>
                {p.name} ({p.role}){p.email ? ` · ${p.email}` : ""}
              </li>
            ))}
          </ul>
          <h3 style={{ marginTop: "0.75rem" }}>Schedule</h3>
          {meetings.length === 0 ? (
            <p className="muted small">No pattern yet — set section in Settings after sync.</p>
          ) : (
            <ul className="clean-list">
              {meetings.map((m) => (
                <li key={m.id}>
                  {m.kind}
                  {m.sectionCode ? ` ${m.sectionCode}` : ""}: {m.notes ?? m.location ?? "—"}
                  {m.startTime ? ` · ${m.startTime}–${m.endTime}` : ""}
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="card" style={{ gridColumn: "1 / -1" }}>
          <h2>Content</h2>
          <ContentTree data={data} courseId={course.id} />
        </section>

        <section className="card">
          <h2>Files & resources</h2>
          {resources.length === 0 ? (
            <p className="muted small">None yet.</p>
          ) : (
            <ul className="clean-list">
              {resources.map((r) => (
                <li key={r.id}>
                  {r.url ? (
                    <a href={r.url} target="_blank" rel="noreferrer">
                      {r.title}
                    </a>
                  ) : (
                    r.title
                  )}{" "}
                  <span className="badge">{r.purpose}</span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="card">
          <h2>Policies</h2>
          {policies.length === 0 ? (
            <p className="muted small">Import/outline sync fills this.</p>
          ) : (
            <ul className="clean-list">
              {policies.map((p) => (
                <li key={p.id}>
                  <strong>{p.title}</strong>
                  <div className="small">{p.body.slice(0, 200)}{p.body.length > 200 ? "…" : ""}</div>
                </li>
              ))}
            </ul>
          )}
        </section>

        {conflicts.length > 0 && (
          <section className="card" style={{ gridColumn: "1 / -1" }}>
            <h2>Conflicts</h2>
            {conflicts.map((c) => (
              <ConflictBanner key={c.id} conflict={c} />
            ))}
          </section>
        )}
      </div>
    </div>
  );
}
