# gryphOS

Privacy-first, local-first academic OS for University of Guelph CourseLink
(D2L Brightspace). Brave / Opera GX / Chromium.

No chatbot, backend, LLM, passwords, or telemetry. Uses your signed-in CourseLink
session in the same browser. All academic data stays on your device.

## What works after Sync (v1.8)

When you are signed in on CourseLink and hit **Sync**:

- **Courses** you select (dropbox, quizzes, grades, news, content TOC when the API allows)
- **Class times** from CourseLink calendar lecture/lab events → My Day Right now / Next / Tonight
- **Assessments** with due dates, submission state, and grades when Brightspace returns them
- **Outline discovery** — finds + parses syllabus PDFs/HTML when downloadable; applies blueprints
  into assessments/policies. Status per course is honest (`parsed` / `found` / `blocked` / `none`)
- **Announcements** + deadline-change signals when News is readable
- **My Day** timeline: Right now · Next · Tonight · Coming up · Since last checked · Needs your answer
- **Assessment / course workspaces** with linked content, clarifications, and feedback when present
- **Inbox** for real changes (deadline moves, new items, document versions)
- **Local search** across what Sync actually stored

Honest limits: many Brightspace student routes return 403; outline file download is often blocked
even when Content UI shows the PDF; DOCX/scanned PDFs parse poorly; final exam dates appear only if
outline/calendar provides them. Empty states explain *why* (signed out, no calendar events, outline
blocked) instead of pretending features work.

## Install

```bash
npm install
npm run build
```

Load unpacked `dist/` in Brave / Opera GX / Chrome extensions page.

1. Sign in to [CourseLink](https://courselink.uoguelph.ca) in the **same browser**
2. Open any CourseLink page
3. Toolbar → **Open panel** (or full app) → **Sync**
4. Open **My Day** — you should see class times and deadlines from real data

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
