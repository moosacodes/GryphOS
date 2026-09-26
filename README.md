# gryphOS

Privacy-first, local-first academic operating system for University of Guelph
students using CourseLink (D2L Brightspace).

gryphOS treats CourseLink as a **large academic data source**: after Sync it builds a
structured local mirror (assessments, content, announcements, discussions when exposed,
grades, files/text library, search) so you rarely need to tab-hop CourseLink tools.

No chatbot, backend, LLM, passwords, or telemetry. Authenticated CourseLink session only.

**Target browsers:** [Brave](https://brave.com/) and [Opera GX](https://www.opera.com/gx)
(Chromium-based). Google Chrome also works.

**Everyday use does not need a terminal.** Build once, load `dist/`, close the terminal.

## What Sync reconstructs (v1.6)

- Dropbox / quizzes / calendar / news with **structured announcement facts**
- Discussion **posts** when the Brightspace posts API allows (otherwise coverage says so)
- Content hierarchy + relevant file download/classify/hash versioning + offline library text
- Gradebook map (categories, items, unmatched) + feedback when API returns it
- Entity-linked assessment workspaces (spec, rubric, clarifications, grades, attempts)
- Local full-text search **with snippets** (course-scoped)
- Per-course **Source coverage** page — exact counts, never fake “supported”
- External tools (e.g. Zybook Q1–Q6 as separate entities + best N)

Honest limits: many LE routes 403 for students; file downloads may be blocked while the
Content UI works; DOM scrape is a last resort only on an already-open authenticated page.
See [docs/brightspace-capabilities.md](./docs/brightspace-capabilities.md).

## Privacy

See [PRIVACY.md](./PRIVACY.md). All academic data stays on your device.

## Install — normal use (Brave / Opera GX)

### 1. Build (one-time / when updating)

```bash
npm install
npm run build
```

### 2. Load unpacked

**Brave** → `brave://extensions` → Developer mode → Load unpacked → `dist/`

**Opera GX** → `opera://extensions` → Developer mode → allow Chromium extensions if asked → Load unpacked → `dist/`

**Chrome** → `chrome://extensions` → same.

### 3. Sync & open the in-page panel

1. Sign in to [CourseLink](https://courselink.uoguelph.ca) in the **same browser**
2. Open any CourseLink page
3. Toolbar icon → **Open panel** → **Sync**
4. Use **Coverage** to see what each course actually ingested
5. **Search** for specs/policies/staff clarifications with snippets

## Development

```bash
npm install
npm run typecheck
npm run lint
npm test
npm run build
```

## Architecture

```
CourseLink (session) → adapters → deep ingest → normalize → reconcile → canonical model
  → IndexedDB → engines (grades, search, study context) → UI
```

Details: [docs/architecture.md](./docs/architecture.md) · [docs/sources.md](./docs/sources.md)

## Attribution

CourseLink adapter patterns adapted from [gryphCal](https://github.com/dawhatnow/gryphCal) (MIT).
See [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md).

## Limitations

- Requires a real signed-in UofG session in the same browser
- Per-course 403/404 is normal; sync keeps partial results; coverage reports gaps
- Outline/PDF parsing is heuristic; DOCX/scanned PDFs limited
- Final exam dates often absent unless outline/calendar provides them
- Not built for Firefox or Safari

## License

MIT — see [LICENSE](./LICENSE)
