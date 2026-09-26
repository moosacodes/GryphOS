# Course outline parser

Deterministic parser in `src/adapters/outline/parse.ts`:

- heading / section detection
- weight line regexes
- date recognition (exact month-day or approximate Week N)
- instructor / TA / office hours / textbooks / policies heuristics
- confidence score from structural completeness

PDF text extraction uses `pdfjs-dist` locally. Scanned image PDFs may fail
with a clear error. No LLM API is used.
