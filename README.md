# gryphOS

Privacy-first, local-first academic operating system for University of Guelph
students using CourseLink (D2L Brightspace).

gryphOS discovers courses, deadlines, grades, and related academic information
from your existing CourseLink browser session, reconciles it with imported
course outlines, and presents a unified semester dashboard — without a chatbot,
backend, or telemetry.

**Target browsers:** [Brave](https://brave.com/) and [Opera GX](https://www.opera.com/gx)
(Chromium-based). Google Chrome also works the same way if you prefer it.

**Everyday use does not need a terminal.** After you build once and load the
extension from `dist/`, gryphOS runs entirely inside the browser. Close the
terminal; leave it closed.

## Features

### Semantic academic engine (Phase 5)

- **No runtime course fixtures** — CIS*2430/2030/2520 schedules live only under `tests/fixtures/`
- **MeetingOccurrence model** — relative deadlines attach to specific occurrences (never `Date.now()` / term-start / next Tuesday)
- **Typed AcademicRule union** — BestN, CombinedComponentThreshold, OccurrenceRelativeDeadline, etc. (not `Record<string, unknown>`)
- **Missed ≠ zero** — Best-N under incomplete data is provisional/projection, not definitive
- **SourceArtifact / ExtractedFact** — authority classes, supersession, field-level reconciliation
- **Command Centre** — explainable, weight-aware priorities; Assessment detail shows Why/provenance
- **ICS via ical.js (RFC5545)** — category from import context; America/Toronto

Honest limits: discussions/content hierarchy/search are modeled but CourseLink API coverage varies; external tools (Zybooks) need confirmation when no external state exists; some outline rules still need human review.

## Features

- **In-page CourseLink panel** — primary day-to-day UI is a side panel on the CourseLink site (toolbar popup opens/toggles it)
- **Auto outline discovery** during sync (content TOC/Structure, overview, news) when Brightspace allows; positional PDF parsing for tables/weights; manual Documents import is the fallback
- CourseLink sync via your signed-in browser session (no passwords)
- Canonical academic data model with provenance and conflict detection
- Deterministic grade engine (standing, remaining weight, target calculator)
- Workload / task views and polished calendar with `.ics` export
- Data health checks per course
- Light / dark / system theme
- Compact extension popup + optional full-page app

## Privacy

See [PRIVACY.md](./PRIVACY.md). All academic data stays on your device.

## Install — normal use (Brave / Opera GX)

Build once, then use the extension forever with no terminal and no local server.

### 1. Build (one-time / when updating)

```bash
npm install
npm run build
```

### 2. Load unpacked in your browser

**Brave**

1. Open `brave://extensions`
2. Enable **Developer mode** (top-right)
3. **Load unpacked** → select this repo's `dist/` folder
4. Pin gryphOS from the extensions puzzle menu if you like

**Opera GX**

1. Open `opera://extensions`
2. Enable **Developer mode**
3. If Opera asks you to allow Chromium/Chrome extensions, turn that on
4. **Load unpacked** → select this repo's `dist/` folder

**Chrome (optional)**

Same steps at `chrome://extensions` → Developer mode → Load unpacked → `dist/`.

### 3. Sync & open the in-page panel

1. Sign in to [CourseLink](https://courselink.uoguelph.ca) **in the same browser**
2. Open any CourseLink page (`https://courselink.uoguelph.ca/d2l/...`)
3. Click the gryphOS toolbar icon → **Open panel**
4. A side panel slides in on the right of the CourseLink page (deadlines, sync, upcoming work)
5. Use **Sync** from the popup or panel — outlines/syllabus files in course content are discovered automatically when accessible
6. **Full app** remains available as a secondary view from the panel/popup

You can close the terminal after step 1. Reload the extension on the extensions
page only after you run `npm run build` again.

## Development (optional)

```bash
npm install
npm run typecheck
npm run lint
npm test
npm run build
npm run dev          # optional Vite UI preview — NOT how you run the extension
```

## Architecture

```
DATA SOURCES → adapters → raw → normalize → reconcile → canonical model
  → local storage → derived engines → UI (in-page panel + full app)
```

Details: [docs/architecture.md](./docs/architecture.md)

## Attribution

CourseLink adapter patterns adapted from [gryphCal](https://github.com/dawhatnow/gryphCal) (MIT).
See [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md).

## Limitations

- Live CourseLink behaviour requires a real signed-in UofG session **in the same browser**
- Some Brightspace tools/content return 403/404 per course; sync continues; missing outlines stay unknown
- Auto outline discovery depends on content TOC/Structure + downloadable files (PDF/text/HTML). Brightspace may 403 file downloads even when Content UI works ? status shows `blocked` and Documents import remains available.
- Outline parsing is heuristic: complex multi-column scanned PDFs and DOCX are limited; Week N dates stay approximate
- Final exam dates are often absent from CourseLink unless outline/calendar provides them
- Opera GX must allow installing Chromium/unpacked extensions
- Not built for Firefox or Safari

## License

MIT — see [LICENSE](./LICENSE)
