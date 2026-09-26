/**
 * Geometry-first layout: spans → lines → columns → tables → headings.
 * Do NOT treat PDF as a flat string — preserve page# / x/y / font / boxes.
 */
import type {
  BBox,
  DocumentLayout,
  LayoutColumn,
  LayoutHeading,
  LayoutLine,
  LayoutPage,
  LayoutParagraph,
  LayoutTable,
  TableCell,
  TextSpan,
} from "./types";

const Y_TOL = 3.5;
const COL_GAP_MIN = 40;

function bboxOf(spans: TextSpan[]): BBox {
  if (!spans.length) return { x: 0, y: 0, w: 0, h: 0 };
  const x0 = Math.min(...spans.map((s) => s.x));
  const y0 = Math.min(...spans.map((s) => s.y));
  const x1 = Math.max(...spans.map((s) => s.x + s.w));
  const y1 = Math.max(...spans.map((s) => s.y + s.h));
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

function joinSpans(spans: TextSpan[]): string {
  const sorted = [...spans].sort((a, b) => a.x - b.x);
  let text = "";
  let prev: TextSpan | null = null;
  for (const s of sorted) {
    if (prev) {
      const gap = s.x - (prev.x + prev.w);
      if (gap > 1.2) text += gap > 14 ? "  " : " ";
    }
    text += s.text;
    prev = s;
  }
  return text.replace(/[ \t]+/g, " ").replace(/ (\d+\s*%)/g, "  $1").trim();
}

export function spansToLines(page: number, spans: TextSpan[]): LayoutLine[] {
  const usable = spans.filter((s) => s.text.trim().length > 0);
  usable.sort((a, b) => b.y - a.y || a.x - b.x);
  const rows: TextSpan[][] = [];
  for (const s of usable) {
    const row = rows.find((r) => Math.abs(r[0].y - s.y) <= Y_TOL);
    if (row) row.push(s);
    else rows.push([s]);
  }
  const lines: LayoutLine[] = [];
  let order = 0;
  for (const row of rows) {
    row.sort((a, b) => a.x - b.x);
    const text = joinSpans(row);
    if (!text) continue;
    const bbox = bboxOf(row);
    const fontSize = row.reduce((m, s) => Math.max(m, s.fontSize), 0);
    const bold = row.some((s) => s.bold) || fontSize >= 14;
    lines.push({
      id: `line:p${page}:${order}`,
      page,
      text,
      bbox,
      spans: row,
      fontSize,
      bold,
      readingOrder: order,
      columnIndex: 0,
    });
    order += 1;
  }
  return lines;
}

/** Detect multi-column layouts from x-gap histograms. */
export function detectColumns(lines: LayoutLine[], pageWidth: number): LayoutColumn[] {
  if (lines.length < 6 || pageWidth <= 0) {
    return [{ page: lines[0]?.page ?? 1, index: 0, x0: 0, x1: pageWidth || 612 }];
  }
  const midGaps: number[] = [];
  for (const line of lines) {
    if (line.spans.length < 2) continue;
    for (let i = 1; i < line.spans.length; i++) {
      const gap = line.spans[i].x - (line.spans[i - 1].x + line.spans[i - 1].w);
      if (gap >= COL_GAP_MIN) midGaps.push(line.spans[i - 1].x + line.spans[i - 1].w + gap / 2);
    }
  }
  if (midGaps.length < 3) {
    return [{ page: lines[0].page, index: 0, x0: 0, x1: pageWidth }];
  }
  midGaps.sort((a, b) => a - b);
  // Cluster gap centers
  const clusters: number[][] = [];
  for (const g of midGaps) {
    const c = clusters.find((cl) => Math.abs(cl[0] - g) < 25);
    if (c) c.push(g);
    else clusters.push([g]);
  }
  const split = clusters
    .filter((c) => c.length >= Math.max(2, Math.floor(midGaps.length * 0.25)))
    .map((c) => c.reduce((s, v) => s + v, 0) / c.length)
    .sort((a, b) => a - b)[0];
  if (split == null || split < pageWidth * 0.25 || split > pageWidth * 0.75) {
    return [{ page: lines[0].page, index: 0, x0: 0, x1: pageWidth }];
  }
  return [
    { page: lines[0].page, index: 0, x0: 0, x1: split },
    { page: lines[0].page, index: 1, x0: split, x1: pageWidth },
  ];
}

export function assignColumns(lines: LayoutLine[], columns: LayoutColumn[]): LayoutLine[] {
  if (columns.length <= 1) return lines.map((l) => ({ ...l, columnIndex: 0 }));
  return lines.map((l) => {
    const cx = l.bbox.x + l.bbox.w / 2;
    let best = 0;
    for (const c of columns) {
      if (cx >= c.x0 && cx < c.x1) best = c.index;
    }
    return { ...l, columnIndex: best };
  });
}

/** Reading order: column-major top-to-bottom, then next column. */
export function readingOrderedLines(lines: LayoutLine[]): LayoutLine[] {
  const maxCol = Math.max(0, ...lines.map((l) => l.columnIndex));
  const out: LayoutLine[] = [];
  let order = 0;
  for (let c = 0; c <= maxCol; c++) {
    const col = lines.filter((l) => l.columnIndex === c).sort((a, b) => b.bbox.y - a.bbox.y);
    for (const l of col) {
      out.push({ ...l, readingOrder: order++ });
    }
  }
  return out;
}

export function detectHeadings(lines: LayoutLine[]): LayoutHeading[] {
  if (!lines.length) return [];
  const sizes = lines.map((l) => l.fontSize).filter((s) => s > 0).sort((a, b) => a - b);
  const median = sizes[Math.floor(sizes.length / 2)] || 11;
  const out: LayoutHeading[] = [];
  for (const l of lines) {
    const short = l.text.length < 90;
    const big = l.fontSize >= median + 2 || l.bold;
    const titleCase =
      /^[A-Z0-9]/.test(l.text) &&
      !/\d\s*%/.test(l.text) &&
      !/^(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)/i.test(l.text);
    if (short && big && titleCase) {
      const level: 1 | 2 | 3 =
        l.fontSize >= median + 5 ? 1 : l.fontSize >= median + 2 || l.bold ? 2 : 3;
      out.push({
        id: `h:${l.id}`,
        page: l.page,
        text: l.text,
        level,
        bbox: l.bbox,
        confidence: big && short ? 0.75 : 0.5,
      });
    }
  }
  return out;
}

function splitRowCells(line: LayoutLine): { texts: string[]; boxes: BBox[] } {
  const spans = [...line.spans].sort((a, b) => a.x - b.x);
  if (spans.length === 0) return { texts: [line.text], boxes: [line.bbox] };
  // Cluster by large x-gaps (table columns)
  const groups: TextSpan[][] = [[spans[0]]];
  for (let i = 1; i < spans.length; i++) {
    const prev = spans[i - 1];
    const gap = spans[i].x - (prev.x + prev.w);
    if (gap > 10) groups.push([spans[i]]);
    else groups[groups.length - 1].push(spans[i]);
  }
  if (groups.length >= 2) {
    return {
      texts: groups.map((g) => joinSpans(g)),
      boxes: groups.map((g) => bboxOf(g)),
    };
  }
  // Fallback: multi-space / pipe
  if (/\|/.test(line.text)) {
    const texts = line.text.split("|").map((c) => c.trim()).filter(Boolean);
    return { texts, boxes: texts.map(() => line.bbox) };
  }
  const parts = line.text.split(/\s{2,}/).map((c) => c.trim()).filter(Boolean);
  if (parts.length >= 2) return { texts: parts, boxes: parts.map(() => line.bbox) };
  return { texts: [line.text], boxes: [line.bbox] };
}

function isAssessHeader(cells: string[]): boolean {
  const low = cells.map((c) => c.toLowerCase()).join(" ");
  const hasComp = /\b(assessment|component|item|activity|deliverable|evaluation|description)\b/.test(low);
  const hasWeight = /\b(weight|marks?|percent|%|value)\b/.test(low);
  const hasDue = /\b(due|date|deadline|when)\b/.test(low);
  return (hasComp && hasWeight) || (hasComp && hasDue) || (hasWeight && hasDue);
}

function isScheduleHeader(cells: string[]): boolean {
  const low = cells.map((c) => c.toLowerCase()).join(" ");
  return (
    /\b(week|lecture|lab|topic|reading|zybook)\b/.test(low) &&
    (/\b(week|date|topic|chapter)\b/.test(low) || cells.length >= 3)
  );
}

/**
 * Reconstruct tables from aligned columns; merge wrapped/continuation rows;
 * stitch tables that continue across page breaks.
 */
export function reconstructTables(pages: LayoutPage[]): LayoutTable[] {
  const tables: LayoutTable[] = [];
  let pending: LayoutTable | null = null;

  for (const page of pages) {
    const lines = [...page.lines].sort((a, b) => a.readingOrder - b.readingOrder);
    let i = 0;
    while (i < lines.length) {
      const cells = splitRowCells(lines[i]);
      const headerish = isAssessHeader(cells.texts) || isScheduleHeader(cells.texts);
      if (!headerish && !(pending && cells.texts.length >= 2 && /\d/.test(lines[i].text))) {
        // If pending expects continuation across pages
        if (
          pending &&
          pending.endPage === page.page - 1 &&
          cells.texts.length >= 2 &&
          (/\d\s*%/.test(lines[i].text) || /week\s*\d+/i.test(lines[i].text))
        ) {
          // fall through to append
        } else {
          i += 1;
          continue;
        }
      }

      const headers = headerish ? cells.texts : pending?.headers ?? cells.texts;
      const kind: LayoutTable["kind"] = isScheduleHeader(headers)
        ? "schedule"
        : isAssessHeader(headers) || /\d\s*%/.test(lines[i].text)
          ? "assessment"
          : "other";
      const startIdx = headerish ? i + 1 : i;
      const rows: string[][] = [];
      const tableCells: TableCell[] = [];
      if (headerish) {
        cells.texts.forEach((t, col) => {
          tableCells.push({
            row: 0,
            col,
            text: t,
            bbox: cells.boxes[col] ?? lines[i].bbox,
            rowspan: 1,
            colspan: 1,
            isHeader: true,
          });
        });
      }

      let j = startIdx;
      let rowNum = headerish ? 1 : (pending?.rows.length ?? 0) + 1;
      while (j < Math.min(lines.length, startIdx + 50)) {
        const line = lines[j];
        if (/^total\b/i.test(line.text) && /\d\s*%/.test(line.text)) {
          const tc = splitRowCells(line);
          rows.push(tc.texts);
          break;
        }
        // Section break
        if (
          rows.length > 0 &&
          /^[A-Z][A-Za-z ]{4,40}$/.test(line.text) &&
          !/\d/.test(line.text) &&
          line.bold
        ) {
          break;
        }
        const tc = splitRowCells(line);
        if (tc.texts.length >= 2 || (/\d\s*%/.test(line.text) && tc.texts.length >= 1)) {
          // Wrapped continuation: single short cell following a row
          rows.push(tc.texts);
          tc.texts.forEach((t, col) => {
            tableCells.push({
              row: rowNum,
              col,
              text: t,
              bbox: tc.boxes[col] ?? line.bbox,
              rowspan: 1,
              colspan: 1,
              isHeader: false,
            });
          });
          rowNum += 1;
        } else if (rows.length && tc.texts.length === 1 && line.text.length < 70) {
          const last = rows[rows.length - 1];
          last[0] = `${last[0]} ${tc.texts[0]}`.trim();
          tableCells.push({
            row: rowNum - 1,
            col: 0,
            text: tc.texts[0],
            bbox: line.bbox,
            rowspan: 1,
            colspan: 1,
            isHeader: false,
            continuation: true,
          });
        } else if (rows.length >= 2) {
          break;
        }
        j += 1;
      }

      if (pending && !headerish && pending.kind === kind) {
        pending.rows.push(...rows);
        pending.cells.push(...tableCells);
        pending.endPage = page.page;
        pending.confidence = Math.min(0.95, pending.confidence + 0.05);
        i = Math.max(j, i + 1);
        if (j >= lines.length - 1 || rows.length === 0) {
          tables.push(pending);
          pending = null;
        }
        continue;
      }

      if (rows.length >= 1 || (headerish && rows.length >= 0)) {
        const allLines = lines.slice(i, Math.max(j, i + 1));
        const table: LayoutTable = {
          id: `tbl:p${page.page}:${tables.length + (pending ? 1 : 0)}`,
          page: page.page,
          endPage: page.page,
          bbox: bboxOf(allLines.flatMap((l) => l.spans)),
          headers,
          rows,
          cells: tableCells,
          confidence: headerish ? 0.85 : 0.55,
          kind,
        };
        // Keep open if last rows look truncated (no total, ends mid-list)
        const open =
          kind === "assessment" &&
          !rows.some((r) => /^total$/i.test(r[0] ?? "")) &&
          j >= lines.length - 1;
        if (open) pending = table;
        else {
          if (rows.length >= 1) tables.push(table);
          pending = null;
        }
        i = Math.max(j, i + 1);
      } else {
        i += 1;
      }
    }
  }
  if (pending && pending.rows.length) tables.push(pending);
  return tables;
}

export function linesToParagraphs(lines: LayoutLine[]): LayoutParagraph[] {
  const paras: LayoutParagraph[] = [];
  let buf: LayoutLine[] = [];
  const flush = () => {
    if (!buf.length) return;
    paras.push({
      id: `para:${buf[0].id}`,
      page: buf[0].page,
      text: buf.map((l) => l.text).join(" "),
      bbox: bboxOf(buf.flatMap((l) => l.spans)),
      lineIds: buf.map((l) => l.id),
      role: /^[-•*]/.test(buf[0].text) ? "list_item" : "body",
    });
    buf = [];
  };
  for (const l of lines) {
    if (l.bold && l.text.length < 80) {
      flush();
      paras.push({
        id: `para:${l.id}`,
        page: l.page,
        text: l.text,
        bbox: l.bbox,
        lineIds: [l.id],
        role: "heading",
      });
      continue;
    }
    if (buf.length && Math.abs(buf[buf.length - 1].bbox.y - l.bbox.y) > 18) flush();
    buf.push(l);
  }
  flush();
  return paras;
}

export function buildPageLayout(input: {
  page: number;
  width: number;
  height: number;
  spans: TextSpan[];
  images?: LayoutPage["images"];
  ocrApplied?: boolean;
  renderDataUrl?: string | null;
}): LayoutPage {
  const rawLines = spansToLines(input.page, input.spans);
  const columns = detectColumns(rawLines, input.width);
  const lined = readingOrderedLines(assignColumns(rawLines, columns));
  const headings = detectHeadings(lined);
  const paragraphs = linesToParagraphs(lined);
  const area = Math.max(1, input.width * input.height);
  const chars = input.spans.reduce((s, sp) => s + sp.text.length, 0);
  const textDensity = chars / area;
  const draft: LayoutPage = {
    page: input.page,
    width: input.width,
    height: input.height,
    spans: input.spans,
    lines: lined,
    paragraphs,
    headings,
    tables: [],
    images: input.images ?? [],
    columns,
    textDensity,
    ocrApplied: !!input.ocrApplied,
    renderDataUrl: input.renderDataUrl ?? null,
  };
  return draft;
}

export function assembleDocumentLayout(pages: LayoutPage[], method: DocumentLayout["extractionMethod"]): DocumentLayout {
  const withTables = pages.map((p) => ({ ...p }));
  const tables = reconstructTables(withTables);
  for (const t of tables) {
    const page = withTables.find((p) => p.page === t.page);
    if (page) page.tables.push(t);
    if (t.endPage !== t.page) {
      for (let p = t.page + 1; p <= t.endPage; p++) {
        const pg = withTables.find((x) => x.page === p);
        if (pg && !pg.tables.some((x) => x.id === t.id)) pg.tables.push(t);
      }
    }
  }
  const readingParts: string[] = [];
  for (const p of withTables) {
    readingParts.push(`--- page ${p.page} ---`);
    const ordered = [...p.lines].sort((a, b) => a.readingOrder - b.readingOrder);
    for (const l of ordered) readingParts.push(l.text);
  }
  return {
    pageCount: withTables.length,
    pages: withTables,
    readingText: readingParts.join("\n"),
    extractionMethod: method,
    warnings: [],
  };
}

/** Build layout from plain text (tests / HTML) with synthetic geometry. */
export function layoutFromPlainText(text: string, opts?: { twoColumn?: boolean }): DocumentLayout {
  const pagesRaw = text.split(/\n\s*---\s*page(?:\s*break)?\s*(?:\d+)?\s*---\s*\n/i);
  const pages: LayoutPage[] = [];
  pagesRaw.forEach((pageText, idx) => {
    const page = idx + 1;
    const lines = pageText.split(/\n/).map((l) => l.replace(/\s+$/g, "")).filter((l) => l.trim().length);
    const spans: TextSpan[] = [];
    let y = 750;
    const pageWidth = 612;
    for (const line of lines) {
      if (opts?.twoColumn && line.includes("||")) {
        const [left, right] = line.split("||").map((s) => s.trim());
        if (left) {
          spans.push({
            text: left,
            page,
            x: 40,
            y,
            w: Math.min(250, left.length * 5),
            h: 12,
            fontSize: 11,
            fontName: "Synth",
            bold: false,
            italic: false,
            source: "plain",
          });
        }
        if (right) {
          spans.push({
            text: right,
            page,
            x: 320,
            y,
            w: Math.min(250, right.length * 5),
            h: 12,
            fontSize: 11,
            fontName: "Synth",
            bold: false,
            italic: false,
            source: "plain",
          });
        }
      } else {
        // Preserve multi-space columns for table detection
        const parts = line.split(/(\s{2,})/);
        let x = 40;
        let buf = "";
        const flush = (gap: number) => {
          if (!buf) return;
          const bold = buf.length < 60 && buf === buf.toUpperCase() && /[A-Z]/.test(buf);
          spans.push({
            text: buf,
            page,
            x,
            y,
            w: Math.max(20, buf.length * 5),
            h: 12,
            fontSize: bold ? 14 : 11,
            fontName: "Synth",
            bold,
            italic: false,
            source: "plain",
          });
          x += buf.length * 5 + gap;
          buf = "";
        };
        for (const part of parts) {
          if (/^\s{2,}$/.test(part)) flush(Math.max(16, part.length * 4));
          else buf += part;
        }
        flush(0);
      }
      y -= 16;
    }
    pages.push(buildPageLayout({ page, width: pageWidth, height: 792, spans }));
  });
  return assembleDocumentLayout(pages, "plain");
}
