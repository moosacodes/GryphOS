# gryphOS

Privacy-first, local-first academic OS for University of Guelph CourseLink
(D2L Brightspace). Brave / Opera GX / Chromium.

**v2 — JARVIS for uni.** Cinematic day brief, command surface, living My Day.
Sync and document intelligence stay in the background — not a dashboard CRUD app.

No chatbot, backend, LLM, passwords, or telemetry. Uses your signed-in CourseLink
session in the same browser. All academic data stays on your device.

## Product shell

- **System Brief** — spoken-style opening: what’s live, what needs you, what’s tonight
- **Command surface** — Ctrl+K is the primary way to move (search, sync, open courses, capture)
- **Living My Day** — Right now · Next · Tonight · Coming up · Since last checked · Needs your answer
- Secondary systems (Inbox, Grades, Calendar, Courses…) live under **Systems** / commands — not a left-nav CRUD farm

## What Sync fills in (backend)

When you are signed in on CourseLink and hit **Sync**:

- Courses you select (dropbox, quizzes, grades, news, content TOC when the API allows)
- Class times from CourseLink calendar → My Day Right now / Next / Tonight
- Assessments with due dates, submission state, and grades when Brightspace returns them
- Outline discovery + document intelligence (layout PDF understanding)
- Announcements + deadline-change signals when News is readable

Honest limits: many Brightspace student routes return 403; outline downloads are often
blocked; DOCX/scans parse poorly. Empty states explain *why*.

## Install

```bash
npm install
npm run build
```

Load unpacked `dist/` in Brave / Opera GX / Chrome extensions page.

1. Sign in to [CourseLink](https://courselink.uoguelph.ca) in the **same browser**
2. Open any CourseLink page
3. Toolbar → **Open Brief** (or full app) → **Sync**
4. Read the brief — then drive the semester with **Ctrl+K**

Optional: Setup → import a timetable ICS if CourseLink calendar has no lecture/lab events.

## Development

```bash
npm run typecheck
npm run lint
npm test
npm run build
```

## Privacy

See [PRIVACY.md](./PRIVACY.md).

## Attribution

CourseLink adapter patterns adapted from [gryphCal](https://github.com/dawhatnow/gryphCal) (MIT).
See [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md).

## License

MIT — see [LICENSE](./LICENSE)
