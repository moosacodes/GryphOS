/**
 * pdf.js positional extraction → TextSpan[] with font size/style + page dimensions.
 * Selective OCR when density is low. Optional vision only with opt-in.
 */
import {
  assembleDocumentLayout,
  buildPageLayout,
  layoutFromPlainText,
} from "./layout";
import {
  SelectiveOcrGate,
  assertVisionAllowed,
  createTesseractOcrProvider,
} from "./providers";
import type {
  DocumentLayout,
  DocumentVisionProvider,
  LayoutImage,
  OcrProvider,
  TextSpan,
} from "./types";

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
      /* main-thread */
    }
  }
  return pdfjs;
}

function fontFlags(fontName: string): { bold: boolean; italic: boolean } {
  const n = fontName.toLowerCase();
  return {
    bold: /bold|black|heavy|semibold|demi/i.test(n),
    italic: /italic|oblique/i.test(n),
  };
}

export async function extractPdfLayout(
  data: ArrayBuffer,
  opts: {
    ocrProvider?: OcrProvider | null;
    visionProvider?: DocumentVisionProvider | null;
    visionOptIn?: boolean;
    renderPages?: boolean;
  } = {},
): Promise<DocumentLayout> {
  const pdfjs = await loadPdfJs();
  const doc = await pdfjs.getDocument({ data: new Uint8Array(data) }).promise;
  const ocrGate = new SelectiveOcrGate(
    opts.ocrProvider === undefined ? null : opts.ocrProvider,
  );
  const pages = [];
  let usedOcr = false;
  const warnings: string[] = [];

  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const viewport = page.getViewport({ scale: 1 });
    const content = await page.getTextContent();
    const spans: TextSpan[] = [];
    for (const it of content.items) {
      if (!("str" in it)) continue;
      const any = it as {
        str: string;
        transform?: number[];
        width?: number;
        height?: number;
        fontName?: string;
      };
      const str = normalizeUnicode(String(any.str ?? ""));
      if (!str) continue;
      const tr = Array.isArray(any.transform) ? any.transform : [1, 0, 0, 1, 0, 0];
      const fontSize = Math.hypot(tr[2] ?? 0, tr[3] ?? 0) || Math.abs(tr[0] ?? 11) || 11;
      const fontName = any.fontName ?? "";
      const flags = fontFlags(fontName);
      spans.push({
        text: str,
        page: i,
        x: tr[4] ?? 0,
        y: tr[5] ?? 0,
        w: typeof any.width === "number" ? any.width : str.length * fontSize * 0.5,
        h: typeof any.height === "number" ? any.height : fontSize,
        fontSize,
        fontName,
        bold: flags.bold,
        italic: flags.italic,
        source: "pdfjs",
      });
    }

    let renderDataUrl: string | null = null;
    const images: LayoutImage[] = [];
    const draft = buildPageLayout({
      page: i,
      width: viewport.width,
      height: viewport.height,
      spans,
    });

    const needOcr = ocrGate.shouldOcr(draft.textDensity, spans.length, spans.reduce((s, x) => s + x.text.length, 0));
    if ((needOcr || opts.renderPages) && typeof document !== "undefined") {
      try {
        const scale = 1.5;
        const vp = page.getViewport({ scale });
        const canvas = document.createElement("canvas");
        canvas.width = vp.width;
        canvas.height = vp.height;
        const ctx = canvas.getContext("2d");
        if (ctx) {
          const task = page.render({ canvasContext: ctx, viewport: vp });
          await task.promise;
          renderDataUrl = canvas.toDataURL("image/png");
        }
      } catch {
        warnings.push(`Page ${i}: canvas render unavailable`);
      }
    }

    let ocrApplied = false;
    if (needOcr && renderDataUrl) {
      const provider = opts.ocrProvider ?? createTesseractOcrProvider();
      const gate = new SelectiveOcrGate(provider);
      const ocr = await gate.run(renderDataUrl);
      if (ocr && ocr.text.trim().length > 20) {
        ocrApplied = true;
        usedOcr = true;
        // Merge OCR lines as plain spans at synthetic positions
        const lines = ocr.text.split(/\n/).map((l) => l.trim()).filter(Boolean);
        let y = viewport.height - 40;
        for (const line of lines) {
          spans.push({
            text: line,
            page: i,
            x: 40,
            y,
            w: Math.min(viewport.width - 80, line.length * 6),
            h: 12,
            fontSize: 11,
            fontName: "OCR",
            bold: false,
            italic: false,
            source: "ocr",
          });
          y -= 14;
        }
        images.push({
          id: `img:ocr:${i}`,
          page: i,
          bbox: { x: 0, y: 0, w: viewport.width, h: viewport.height },
          widthPx: Math.round(viewport.width),
          heightPx: Math.round(viewport.height),
          role: "academic",
          ocrText: ocr.text.slice(0, 20_000),
          caption: null,
        });
      }
    }

    if (opts.visionOptIn && opts.visionProvider && renderDataUrl && (needOcr || draft.tables.length === 0 && draft.textDensity < 0.0002)) {
      try {
        assertVisionAllowed(opts.visionOptIn);
        const vision = await opts.visionProvider.analyzePage({
          pageImageDataUrl: renderDataUrl,
          page: i,
          hint: "course outline tables",
        });
        if (vision.uncertain) warnings.push(`Page ${i}: vision marked uncertain`);
        for (const tb of vision.textBlocks) {
          spans.push({
            text: tb.text,
            page: i,
            x: tb.bbox.x,
            y: tb.bbox.y,
            w: tb.bbox.w,
            h: tb.bbox.h,
            fontSize: 11,
            fontName: "Vision",
            bold: false,
            italic: false,
            source: "ocr",
          });
        }
      } catch (e) {
        warnings.push(`Page ${i}: vision skipped (${String((e as Error).message ?? e)})`);
      }
    }

    pages.push(
      buildPageLayout({
        page: i,
        width: viewport.width,
        height: viewport.height,
        spans,
        images,
        ocrApplied,
        renderDataUrl,
      }),
    );
  }

  const layout = assembleDocumentLayout(pages, usedOcr ? "hybrid" : "pdfjs");
  layout.warnings.push(...warnings);
  if (!layout.readingText.trim()) {
    layout.warnings.push("PDF contained little/no extractable text — may be scanned; OCR attempted if available.");
  }
  return layout;
}

export function layoutFromHtml(html: string): DocumentLayout {
  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<\/tr>/gi, "\n")
    .replace(/<\/(div|h\d|li|td|th)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, "  ")
    .trim();
  const layout = layoutFromPlainText(text);
  return { ...layout, extractionMethod: "html" };
}
