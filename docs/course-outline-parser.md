# Course outline parser

Deterministic multi-pass parser in `src/adapters/outline/` (no LLM):

1. **PDF extraction** (`pdf.ts`): pdf.js positional tokens grouped by x/y into visual lines; Unicode normalize; strip repeated headers/footers safely; page boundaries preserved.
2. **Normalize** text / lines
3. **Metadata** (course code, title, term)
4. **People** (instructors, TAs, office hours)
5. **Tables** (Assessment / Weight / Due columns, wrapped cells)
6. **Weight lines** (multi-space, dashes, percent on next line)
7. **Dates** (exact month-day; Week N / exam period stay approximate ? never fake exact deadlines)
8. **Grading rules** (best-N, drop-lowest) + categories
9. **Policies / schedule / textbooks**
10. **Confidence + diagnostics** with source snippets per assessment

Manual Documents import and Sync auto-discovery both call `applyOutlineDocument` so corrections rebuild the canonical model immediately.

Scanned image PDFs may fail with a clear error. DOCX is not parsed in-browser yet ? export to PDF/TXT/HTML.
