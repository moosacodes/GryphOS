# Architecture

Pipeline:

`DATA SOURCES → SOURCE ADAPTERS → RAW RECORDS → NORMALIZATION → RECONCILIATION → CANONICAL MODEL → LOCAL STORAGE → DERIVED ENGINES → UI`

## Extension surfaces

| Surface | Role |
|--------|------|
| Content script | Runs on CourseLink; performs authenticated `fetch` with cookies |
| Service worker | Lightweight message helpers |
| Popup | Compact next-deadline / sync / open app |
| App (`app.html`) | Full dashboard, calendar, courses, grades, tasks, documents, settings |

## Storage

- **IndexedDB** (`gryphos`) — full `AppData` document
- **chrome.storage.local** — preferences, sync status, pendingSync (fast cross-context)

Schema versioning via `src/storage/migrations.ts`.

## Sync isolation

Per-course and per-tool failures are swallowed (except signed-out). Previously
good data for other courses is preserved.
