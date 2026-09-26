/**
 * Outline adapter — Document Intelligence pipeline for PDFs/HTML;
 * plain-text falls through layout-from-text → CourseBlueprint.
 */
import type { OutlineParseResult } from "@/domain/types";
import { parseOutlineText } from "./parse";
import { extractPdfDocument, extractPdfText, type ExtractedLine, type PdfExtractionResult } from "./pdf";
import { understandDocument, understandPlainText } from "@/documentIntelligence/pipeline";
import type { CourseBlueprint, DocumentLayout, DocumentMemoryEntry, PipelineOptions } from "@/documentIntelligence/types";

export { parseOutlineText, extractPdfText, extractPdfDocument };
export type { ExtractedLine, PdfExtractionResult };
export type { CourseBlueprint, DocumentLayout };

export interface OutlineUnderstandResult {
  text: string;
  result: OutlineParseResult;
  lines?: ExtractedLine[];
  layout?: DocumentLayout;
  blueprint?: CourseBlueprint;
  memory?: DocumentMemoryEntry;
}

export async function parseOutlineBuffer(
  buffer: ArrayBuffer,
  filename: string,
  mimeType = "",
  opts: PipelineOptions & { previousMemory?: DocumentMemoryEntry | null } = {},
): Promise<OutlineUnderstandResult> {
  const name = filename.toLowerCase();
  const type = mimeType || "";

  try {
    const understood = await understandDocument(buffer, {
      ...opts,
      filename,
      mimeType: type,
    });
    const lines: ExtractedLine[] = understood.layout.pages.flatMap((p) =>
      p.lines.map((l) => ({
        page: l.page,
        y: l.bbox.y,
        text: l.text,
        tokens: l.spans.map((s) => ({ str: s.text, x: s.x, y: s.y, w: s.w })),
      })),
    );
    const result: OutlineParseResult = {
      ...understood.blueprint.outlineParse,
      extractionIncomplete: understood.blueprint.quality.incomplete,
      qualityChecks: understood.blueprint.quality.checks,
    };
    return {
      text: understood.layout.readingText,
      result,
      lines,
      layout: understood.layout,
      blueprint: understood.blueprint,
      memory: understood.memory,
    };
  } catch {
    // Fallback: legacy PDF/text path so sync never hard-fails
    if (type === "application/pdf" || name.endsWith(".pdf")) {
      try {
        const extracted = await extractPdfDocument(buffer);
        return {
          text: extracted.text,
          lines: extracted.lines,
          result: parseOutlineText(extracted.text, { lines: extracted.lines }),
        };
      } catch {
        /* continue */
      }
    }
    const raw = new TextDecoder("utf-8", { fatal: false }).decode(buffer);
    const plain = understandPlainText(raw, { ...opts, filename });
    return {
      text: plain.layout.readingText,
      result: {
        ...plain.blueprint.outlineParse,
        extractionIncomplete: plain.blueprint.quality.incomplete,
        qualityChecks: plain.blueprint.quality.checks,
      },
      layout: plain.layout,
      blueprint: plain.blueprint,
      memory: plain.memory,
    };
  }
}

export async function parseOutlineFile(
  file:
    | File
    | {
        name: string;
        type: string;
        arrayBuffer: () => Promise<ArrayBuffer>;
        text: () => Promise<string>;
      },
  opts: PipelineOptions & { previousMemory?: DocumentMemoryEntry | null } = {},
): Promise<OutlineUnderstandResult> {
  const buf = await file.arrayBuffer();
  return parseOutlineBuffer(buf, file.name, file.type || "", opts);
}
