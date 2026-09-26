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
   (Opera GX → Settings → Advanced → **Privacy & security** / extensions settings,
   or the prompt on the extensions page — wording varies by version)
4. **Load unpacked** → select this repo's `dist/` folder
5. Pin gryphOS from the extensions sidebar if you like

**Chrome (optional)**

Same steps at `chrome://extensions` → Developer mode → Load unpacked → `dist/`.

### 3. Sync with CourseLink

1. Sign in to [CourseLink](https://courselink.uoguelph.ca) **in the same browser**
2. Open any CourseLink page (`/d2l/...`)
3. Click **Sync** in the gryphOS popup (or in the full app)

You can close the terminal after step 1. The `dist/` folder is a complete
Manifest V3 extension. Brave/Opera/Chrome load those files directly — no Vite
server and nothing to keep running.

Reload the extension on the extensions page only after you run `npm run build`
again (for code updates). Day-to-day syncing never needs npm.

## Development (optional)

Only for people changing the code. Regular users should ignore this.

```bash
npm install
npm run typecheck
npm run lint
npm test
npm run build        # refresh dist/ for Load unpacked
npm run dev          # optional Vite UI preview — NOT how you run the extension
```

`npm run dev` does **not** replace loading `dist/` in Brave/Opera/Chrome.

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

- Live CourseLink behaviour requires a real signed-in UofG session **in the same browser** that has gryphOS installed
- Some Brightspace tools return 403/404 per course; sync continues for other tools
- Final exam dates are often absent from CourseLink — shown as unknown unless
  provided by an outline or calendar event
- PDF outlines that are scanned images may not yield extractable text
- Opera GX must allow installing Chromium/unpacked extensions (Developer mode);
  if Load unpacked is missing, enable Chromium extension support in Opera settings
- Not built or tested for Firefox or Safari (different extension APIs)

## License

MIT — see [LICENSE](./LICENSE)
