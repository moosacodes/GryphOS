# gryphOS

Privacy-first, local-first academic operating system for University of Guelph
students using CourseLink (D2L Brightspace).

gryphOS discovers courses, deadlines, grades, and related academic information
from your existing CourseLink browser session, reconciles it with imported
course outlines, and presents a unified semester dashboard — without a chatbot,
backend, or telemetry.

**Everyday use does not need a terminal.** After you build once and load the
extension from `dist/`, gryphOS runs entirely inside Chrome. Close the terminal;
leave it closed.

## Features

- CourseLink sync via your signed-in browser session (no passwords)
- Canonical academic data model with provenance and conflict detection
- Deterministic grade engine (standing, remaining weight, target calculator)
- Workload / task views and polished calendar with `.ics` export
- Local course outline import (PDF / text / HTML) with deterministic parsing
- Data health checks per course
- Light / dark / system theme
- Compact extension popup + full app

## Privacy

See [PRIVACY.md](./PRIVACY.md). All academic data stays on your device.

## Install (Chrome) — normal use

Build once, then use the extension forever with no terminal and no local server:

1. One-time setup (terminal only for this step):
   ```bash
   npm install
   npm run build
   ```
2. Open `chrome://extensions`
3. Enable **Developer mode**
4. **Load unpacked** → select the `dist/` folder in this repo
5. Pin gryphOS if you like. You can close the terminal now.
6. Sign in to [CourseLink](https://courselink.uoguelph.ca), open any CourseLink page, then click **Sync** in the extension popup (or in the full app)

The `dist/` folder is a complete Manifest V3 extension (HTML, JS, CSS, icons).
Chrome loads those files directly. There is no Vite/dev server and nothing to
keep running in the background.

Reload the extension in `chrome://extensions` only after you run `npm run build`
again (for updates). Day-to-day syncing and browsing never need npm.

## Development (optional)

Only for people changing the code. Regular students/users should ignore this.

```bash
npm install
npm run typecheck
npm run lint
npm test
npm run build        # refresh dist/ for Load unpacked
npm run dev          # optional Vite preview of the UI only — NOT how you run the extension
```

`npm run dev` is a developer convenience for UI work. It does **not** replace
loading `dist/` in Chrome, and the real extension does not talk to that server.

## Architecture

```
DATA SOURCES → adapters → raw → normalize → reconcile → canonical model
  → local storage → derived engines → UI
```

Details: [docs/architecture.md](./docs/architecture.md)

## Attribution

CourseLink adapter patterns adapted from [gryphCal](https://github.com/dawhatnow/gryphCal) (MIT).
See [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md).

## Limitations

- Live CourseLink behaviour requires a real signed-in UofG session
- Some Brightspace tools return 403/404 per course; sync continues for other tools
- Final exam dates are often absent from CourseLink — shown as unknown unless
  provided by an outline or calendar event
- PDF outlines that are scanned images may not yield extractable text

## License

MIT — see [LICENSE](./LICENSE)
