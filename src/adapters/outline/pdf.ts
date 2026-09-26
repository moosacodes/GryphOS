/**
 * Positional PDF text extraction via pdf.js.
 * Groups glyphs by x/y into visual lines + tokens so tables survive.
 */
export interface ExtractedToken {
  str: string;
  x: number;
  y: number;
  w: number;
}

export interface ExtractedLine {
  page: number;
  y: number;
  text: string;
  tokens: ExtractedToken[];
}

export interface PdfExtractionResult {
  text: string;
  lines: ExtractedLine[];
  pageCount: number;
}

const Y_TOL = 3.5;

function normalizeUnicode(s: string): string {
  return s
    .normalize("NFKC")
    .replace(/\u00a0/g, " ")
    .replace(/\u2018|\u2019|\u201a|\u201b/g, "'")
    .replace(/\u201c|\u201d|\u201e/g, '"')
    .replace(/\u2013|\u2014|\u2212/g, "-")
    .replace(/\ufb01/g, "fi")
    .replace(/\ufb02/g, "fl")
    .replace(/\u200b|\u200c|\u200d|\ufeff/g, "");
}

function stripRepeatedHeadersFooters(lines: ExtractedLine[]): ExtractedLine[] {
  if (lines.length < 12) return lines;
  const pages = new Map<number, ExtractedLine[]>();
  for (const l of lines) {
    const arr = pages.get(l.page) ?? [];
    arr.push(l);
    pages.set(l.page, arr);
  }
  if (pages.size < 2) return lines;

  const pageLists = [...pages.values()];
  const headCounts = new Map<string, number>();
  const footCounts = new Map<string, number>();
  for (const pl of pageLists) {
    const sorted = [...pl].sort((a, b) => b.y - a.y);
    const head = sorted.slice(0, 2).map((l) => l.text.trim().toLowerCase());
    const foot = sorted.slice(-2).map((l) => l.text.trim().toLowerCase());
    for (const h of head) if (h.length > 8 && h.length < 90) headCounts.set(h, (headCounts.get(h) ?? 0) + 1);
    for (const f of foot) if (f.length > 8 && f.length < 90) footCounts.set(f, (footCounts.get(f) ?? 0) + 1);
  }
  const threshold = Math.max(2, Math.ceil(pageLists.length * 0.6));
  const ban = new Set<string>();
  for (const [t, n] of headCounts) if (n >= threshold) ban.add(t);
  for (const [t, n] of footCounts) if (n >= threshold) ban.add(t);
  // Never strip lines that look like assessment/weight content
  return lines.filter((l) => {
    const key = l.text.trim().toLowerCase();
    if (!ban.has(key)) return true;
    if (/\d\s*%|assignment|quiz|midterm|final|due\b/i.test(l.text)) return true;
    return false;
  });
}

function groupPageItems(
  page: number,
  items: Array<{ str: string; transform: number[]; width?: number }>,
): ExtractedLine[] {
  const tokens: ExtractedToken[] = [];
  for (const it of items) {
    const str = normalizeUnicode(it.str ?? "");
    if (!str) continue;
    const x = it.transform[4] ?? 0;
    const y = it.transform[5] ?? 0;
    tokens.push({ str, x, y, w: it.width ?? str.length * 4 });
  }
  tokens.sort((a, b) => b.y - a.y || a.x - b.x);

  const rows: ExtractedToken[][] = [];
  for (const tok of tokens) {
    const row = rows.find((r) => Math.abs(r[0].y - tok.y) <= Y_TOL);
    if (row) row.push(tok);
    else rows.push([tok]);
  }

  const lines: ExtractedLine[] = [];
  for (const row of rows) {
    row.sort((a, b) => a.x - b.x);
    let text = "";
    let prev: ExtractedToken | null = null;
    for (const t of row) {
      if (prev) {
        const gap = t.x - (prev.x + prev.w);
        if (gap > 1.2) text += gap > 12 ? "  " : " ";
      }
      text += t.str;
      prev = t;
    }
    text = text.replace(/[ \t]+/g, " ").replace(/ (\d+\s*%)/g, "  $1").trim();
    if (!text) continue;
    lines.push({ page, y: row[0].y, text, tokens: row });
  }
  // Reading order: top-to-bottom already (y descending), keep stable
  return lines;
}

async function loadPdfJs() {
  const pdfjs = await import("pdfjs-dist");
  if (pdfjs.GlobalWorkerOptions) {
    try {
      if (typeof chrome !== "undefined" && chrome.runtime?.getURL) {
        pdfjs.GlobalWorkerOptions.workerSrc = chrome.runtime.getURL("pdf.worker.min.mjs");
      } else {
        pdfjs.GlobalWorkerOptions.workerSrc = new URL(
          "pdfjs-dist/build/pdf.worker.min.mjs",
          import.meta.url,
        ).toString();
      }
    } catch {
      // main-thread fallback
    }
  }
  return pdfjs;
}

/** Full positional extraction: normalized text + structured lines. */
export async function extractPdfDocument(data: ArrayBuffer): Promise<PdfExtractionResult> {
  const pdfjs = await loadPdfJs();
  const doc = await pdfjs.getDocument({ data: new Uint8Array(data) }).promise;
  const allLines: ExtractedLine[] = [];

  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    const items: Array<{ str: string; transform: number[]; width?: number }> = [];
    for (const it of content.items) {
      if (!("str" in it)) continue;
      const any = it as { str: string; transform?: number[]; width?: number };
      items.push({
        str: String(any.str),
        transform: Array.isArray(any.transform) ? any.transform : [1, 0, 0, 1, 0, 0],
        width: typeof any.width === "number" ? any.width : undefined,
      });
    }
    allLines.push(...groupPageItems(i, items));
  }

  const cleaned = stripRepeatedHeadersFooters(allLines);
  // Join pages with markers so parser can respect boundaries
  const pageTexts: string[] = [];
  let curPage = -1;
  const buf: string[] = [];
  const flush = () => {
    if (buf.length) pageTexts.push(buf.join("\n"));
    buf.length = 0;
  };
  for (const l of cleaned) {
    if (l.page !== curPage) {
      flush();
      curPage = l.page;
    }
    buf.push(l.text);
  }
  flush();

  const text = pageTexts.join("\n\n--- page break ---\n\n").trim();
  if (!text) throw new Error("PDF contained no extractable text (it may be a scanned image).");
  return { text, lines: cleaned, pageCount: doc.numPages };
}

/** Back-compat: plain text only. */
export async function extractPdfText(data: ArrayBuffer): Promise<string> {
  const r = await extractPdfDocument(data);
  return r.text;
}