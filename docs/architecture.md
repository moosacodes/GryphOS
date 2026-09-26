# Architecture

Pipeline:

`DATA SOURCES → SOURCE ADAPTERS → RAW RECORDS → NORMALIZATION → RECONCILIATION → CANONICAL MODEL → LOCAL STORAGE → DERIVED ENGINES → UI`

## How the extension runs

`npm run build` produces a **self-contained** Manifest V3 package in `dist/`.
Brave, Opera GX, or Chrome loads those static files via **Load unpacked**. No Vite server, no
localhost, and no terminal need to stay open for normal use.

## Extension surfaces

| Surface | Role |
|--------|------|
| Content script | Runs on CourseLink; performs authenticated `fetch` with cookies |
| Service worker | Lightweight message helpers |
| Popup | Compact next-deadline / sync / open app |
| App (`app.html`) | Full dashboard, calendar, courses, grades, tasks, documents, settings |

## Storage

- **chrome.storage.local** — primary `AppData` document shared by content script,
  popup, and app (content scripts cannot share extension-origin IndexedDB)
- Optional IndexedDB helpers exist for extension-page-only blobs; sync does not
  depend on them

Schema versioning via `src/storage/migrations.ts`.

## Sync isolation

Per-course and per-tool failures are swallowed (except signed-out). Previously
good data for other courses is preserved.
