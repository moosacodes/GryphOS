import type { OutlineParseResult } from "@/domain/types";
import { parseOutlineText } from "./parse";
import { extractPdfDocument, extractPdfText, type ExtractedLine, type PdfExtractionResult } from "./pdf";

export { parseOutlineText, extractPdfText, extractPdfDocument };
export type { ExtractedLine, PdfExtractionResult };

export async function parseOutlineBuffer(
  buffer: ArrayBuffer,
  filename: string,
  mimeType = "",
): Promise<{ text: string; result: OutlineParseResult; lines?: ExtractedLine[] }> {
  const name = filename.toLowerCase();
  const type = mimeType || "";

  if (type === "application/pdf" || name.endsWith(".pdf")) {
    const extracted = await extractPdfDocument(buffer);
    return {
      text: extracted.text,
      lines: extracted.lines,
      result: parseOutlineText(extracted.text, { lines: extracted.lines }),
    };
  }

  const raw = new TextDecoder("utf-8", { fatal: false }).decode(buffer);
  if (type.includes("html") || name.endsWith(".html") || name.endsWith(".htm")) {
    const text = raw
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
    return { text, result: parseOutlineText(text) };
  }

  // Plain text / markdown / unknown textual
  return { text: raw, result: parseOutlineText(raw) };
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
): Promise<{ text: string; result: OutlineParseResult; lines?: ExtractedLine[] }> {
  const buf = await file.arrayBuffer();
  return parseOutlineBuffer(buf, file.name, file.type || "");
}