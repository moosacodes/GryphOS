# Sources

## CourseLink / Brightspace

Adapter: `src/adapters/courselink` (+ `api.extras.ts` for deep LE routes).

Uses the student session on `https://courselink.uoguelph.ca` (content script matches the whole origin so session cookies apply on Sync).

See **[brightspace-capabilities.md](./brightspace-capabilities.md)** for the full endpoint audit (status, shape, usable/not).

Deep sync (`src/sync/courseDeep.ts`) reconstructs:

- Dropbox + mysubmissions + feedback (when exposed)
- Quizzes + attempts (when exposed)
- Grade objects, my values, **categories**, unmatched items
- News → structured announcement facts
- Calendar events
- Content TOC/root → modules/topics/files (download, hash, classify, library)
- Discussions forums/topics/**posts** with staff role classification
- Checklists / groups (diagnostic)
- External tools (Zybooks Q1–Q6 style entities)
- Entity links (HAS_SPEC, CHANGES_DEADLINE_OF, CLARIFIES, …)
- Source coverage diagnostics + API exploration log

## Course outlines (auto + manual)

**Automatic (every Sync):** content TOC/Structure, overview, news candidates; PDF/text parse when downloadable.

**Limitation:** Brightspace sometimes returns 403 on topic file download even when Content UI can open the file. Status shows `blocked`; Documents import remains available. We never invent data.

## UofG public dates

Seeded reference dates in `src/adapters/uofg/academicDates.ts` — not required for core CourseLink sync.
