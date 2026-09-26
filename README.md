# gryphOS

Privacy-first, local-first academic operating system for University of Guelph
students using CourseLink (D2L Brightspace).

gryphOS discovers courses, deadlines, grades, and related academic information
from your existing CourseLink browser session, reconciles it with imported
course outlines, and presents a unified semester dashboard — without a chatbot,
backend, or telemetry.

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

## Install (Chrome)

1. `npm install`
2. `npm run build`
3. Open `chrome://extensions`
4. Enable **Developer mode**
5. **Load unpacked** → select the `dist/` folder
6. Sign in to [CourseLink](https://courselink.uoguelph.ca), open any CourseLink page, click **Sync** in the popup or app

## Development

```bash
npm install
npm run dev          # Vite UI (extension APIs limited outside Chrome)
npm run typecheck
npm run lint
npm test
npm run build        # produces loadable MV3 extension in dist/
```

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
