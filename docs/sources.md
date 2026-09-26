# Sources

## CourseLink / Brightspace

Adapter: `src/adapters/courselink`

Uses the student session on `https://courselink.uoguelph.ca`.

Endpoints (versioned via `/d2l/api/versions/`):

- mycourses, whoami
- dropbox folders + mysubmissions
- quizzes
- grades + myGradeValues
- news, calendar events (best-effort)

## Course outlines

User-imported PDF/text/HTML via `src/adapters/outline`.

## UofG public dates

Seeded reference dates in `src/adapters/uofg/academicDates.ts` — not required
for core CourseLink sync.


## Course content / outlines

During sync, gryphOS reads `/content/toc` (or `/content/root/`) and scores file topics whose titles look like syllabus/outline documents. Matching PDF/text/HTML files are downloaded via `/content/topics/{id}/file`, parsed locally, and reconciled. Manual Documents import remains a fallback. 403/404 or missing files are non-fatal.
