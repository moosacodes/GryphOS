# AGENTS.md — gryphOS

Guide for coding agents working in this repository.

## Repository map

- `src/domain` — canonical types, IDs, date helpers
- `src/adapters/courselink` — Brightspace HTTP client (content-script session)
- `src/adapters/outline` — deterministic outline/PDF parsing
- `src/adapters/uofg` — seeded academic dates (no brittle scrape required)
- `src/normalize` — raw → domain
- `src/reconcile` — dedupe, merge, conflicts
- `src/storage` — IndexedDB + chrome.storage.local + migrations
- `src/sync` — bounded-concurrency sync engine
- `src/engines` — grades, workload, health, status, ICS
- `src/content` — CourseLink content script entry
- `src/background` — MV3 service worker
- `src/ui` — full React app
- `src/popup` — compact popup
- `tests` / `fixtures` — sanitized automated tests
- `docs` — architecture docs

## Commands

- `npm install`
- `npm run typecheck`
- `npm run lint`
- `npm test`
- `npm run build` → `dist/` loadable extension

## Architectural invariants

1. **No chatbot / no LLM API** for product function
2. **Never invent** academic facts — use unknown / approximate / conflicting
3. UI consumes **canonical** model only, never raw CourseLink payloads
4. Sync is polite: bounded concurrency; 403/404 are non-fatal per tool
5. Manual overrides never destroy source records
6. No telemetry, no backend, no passwords
7. Do not commit `_ref/` or `MASTER_BUILD.md`

## Entry points

- UI: `src/ui/main.tsx` → `app.html`
- Popup: `src/popup/main.tsx` → `popup.html`
- Sync: content script message `GRYPHOS_SYNC` → `src/sync/engine.ts`

## Testing

Prefer pure domain/engine tests with `fixtures/`. Never commit real student data.
