# Sources

## CourseLink / Brightspace

Adapter: `src/adapters/courselink`

Uses the student session on `https://courselink.uoguelph.ca` (content script matches the whole origin so session cookies apply on Sync).

Endpoints (versioned via `/d2l/api/versions/`):

- mycourses, whoami
- dropbox folders + mysubmissions
- quizzes
- grades + myGradeValues
- news, calendar events (best-effort)
- content TOC / root Structure, topic file download, topic Url fetch
- course overview + overview attachment (best-effort)

## Course outlines (auto + manual)

**Automatic (every Sync):** for each selected course, gryphOS aggressively discovers outline/syllabus candidates from:

1. Content TOC (`/content/toc`) and ContentObject Structure (`/content/root/`)
2. Multiple ranked candidates (prefer titles/URLs with outline/syllabus/course outline; parent module titles boost score)
3. Download via `/content/topics/{id}/file`, then fallback fetch of topic `Url` (`/content/enforced/...`)
4. Course overview HTML + `/overview/attachment`
5. News posts that clearly discuss outline/grading (text only)

Parsed assessments/weights/dates merge through reconciliation. Per-course `outlineStatus` is stored: `parsed` | `found` | `none_accessible` | `blocked` | `not_checked`.

**Limitation:** Brightspace sometimes returns 403 on topic file download even when Content UI can open the file. gryphOS records `blocked`, tries Url/overview/news alternates, and never invents data. Manual Documents import remains the fallback.

**Manual:** PDF/text/HTML via `src/adapters/outline` on the Documents page.

## UofG public dates

Seeded reference dates in `src/adapters/uofg/academicDates.ts` — not required
for core CourseLink sync.
