# AGENTS.md — gryphOS

Guide for coding agents working in this repository.

## Supported browsers

Primary targets: **Brave** and **Opera GX** (Chromium MV3). Chrome also works.
Use the standard `chrome.*` APIs — both browsers expose them. Do not add a
`browser` polyfill unless Firefox support is explicitly required.

## Production vs development

- **Users run the Chrome extension from `dist/`.** After `npm run build` and
  Load unpacked, no terminal, no `npm run dev`, and no localhost server is
  required. Do not document or implement a workflow that needs a live terminal
  for everyday use.
- `npm run dev` is optional UI preview for contributors only.

## Repository map

- `src/domain` — canonical types, IDs, date helpers
- `src/adapters/courselink` — Brightspace HTTP client (content-script session)
- `src/adapters/outline` — deterministic outline/PDF parsing
- `src/adapters/uofg` — seeded academic dates (no brittle scrape required)
- `src/normalize` — raw → domain
- `src/reconcile` — dedupe, merge, conflicts
- `src/storage` — chrome.storage.local (+ optional IDB helpers) with migrations
- `src/sync` — bounded-concurrency sync engine
- `src/engines` — grades, workload, health, status, ICS
- `src/content` — CourseLink content script entry
- `src/background` — MV3 service worker
- `src/ui` — full React app (bundled into dist/)
- `src/popup` — compact popup (bundled into dist/)
- `tests` / `fixtures` — sanitized automated tests
- `docs` — architecture docs
- `dist/` — loadable MV3 extension artifact (self-contained)

## Commands

- `npm install`
- `npm run typecheck`
- `npm run lint`
- `npm test`
- `npm run build` → self-contained `dist/` for Chrome Load unpacked
- `npm run dev` → optional Vite UI preview only (not required for the extension)

## Architectural invariants

1. **No chatbot / no LLM API** for product function
2. **Never invent** academic facts — use unknown / approximate / conflicting
3. UI consumes **canonical** model only, never raw CourseLink payloads
4. Sync is polite: bounded concurrency; 403/404 are non-fatal per tool
5. Manual overrides never destroy source records
6. No telemetry, no backend, no passwords
7. Do not commit `_ref/` or `MASTER_BUILD.md`
8. **Production `dist/` must not depend on localhost / a running terminal**

## Entry points

- UI: `src/ui/main.tsx` → `app.html` → `dist/app.html`
- Popup: `src/popup/main.tsx` → `popup.html` → `dist/popup.html`
- Sync: content script message `GRYPHOS_SYNC` → `src/sync/engine.ts`

## Testing

Prefer pure domain/engine tests with `fixtures/`. Never commit real student data.
