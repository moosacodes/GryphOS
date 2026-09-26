/**
 * End-to-end document intelligence pipeline.
 * Layout first → selective OCR → optional vision (opt-in) → semantics → blueprint.
 */
import { layoutFromPlainText } from "./layout";
import { extractPdfLayout, layoutFromHtml } from "./pdfLayout";
import { buildCourseBlueprint } from "./semantics";
import { rememberDocument } from "./memory";
import type {
  CourseBlueprint,
  DocumentLayout,
  DocumentMemoryEntry,
  PipelineOptions,
} from "./types";

export interface PipelineResult {
  layout: DocumentLayout;
  blueprint: CourseBlueprint;
  memory: DocumentMemoryEntry;
}

export async function understandDocument(
  buffer: ArrayBuffer,
  opts: PipelineOptions & {
    previousMemory?: DocumentMemoryEntry | null;
  } = {},
): Promise<PipelineResult> {
  const filename = opts.filename ?? "document";
  const mime = (opts.mimeType ?? "").toLowerCase();
  const name = filename.toLowerCase();

  let layout: DocumentLayout;
  if (mime.includes("pdf") || name.endsWith(".pdf")) {
    layout = await extractPdfLayout(buffer, {
      ocrProvider: opts.ocrProvider ?? null,
      visionProvider: opts.visionOptIn ? opts.visionProvider ?? null : null,
      visionOptIn: !!opts.visionOptIn,
      renderPages: opts.renderPages,
    });
  } else if (mime.includes("html") || name.endsWith(".html") || name.endsWith(".htm")) {
    const raw = new TextDecoder("utf-8", { fatal: false }).decode(buffer);
    layout = layoutFromHtml(raw);
  } else {
    const raw = new TextDecoder("utf-8", { fatal: false }).decode(buffer);
    layout = layoutFromPlainText(raw);
  }

  if (!layout.readingText.trim() && layout.extractionMethod === "pdfjs") {
    layout.warnings.push("Empty extract — scanned PDF without OCR text");
  }

  const documentId = opts.documentId ?? `doc:${filename}`;
  const blueprint = buildCourseBlueprint(layout, {
    courseId: opts.courseId,
    documentId,
    labOccurrenceIsoByWeek: opts.labOccurrenceIsoByWeek,
  });

  const memory = rememberDocument({
    courseId: opts.courseId ?? null,
    documentId,
    filename,
    contentHash: blueprint.contentHash,
    blueprint,
    previous: opts.previousMemory ?? null,
  });

  return { layout, blueprint, memory };
}

export function understandPlainText(
  text: string,
  opts: PipelineOptions & { previousMemory?: DocumentMemoryEntry | null; twoColumn?: boolean } = {},
): PipelineResult {
  const layout = layoutFromPlainText(text, { twoColumn: opts.twoColumn });
  const documentId = opts.documentId ?? `doc:text`;
  const blueprint = buildCourseBlueprint(layout, {
    courseId: opts.courseId,
    documentId,
    labOccurrenceIsoByWeek: opts.labOccurrenceIsoByWeek,
  });
  const memory = rememberDocument({
    courseId: opts.courseId ?? null,
    documentId,
    filename: opts.filename ?? "outline.txt",
    contentHash: blueprint.contentHash,
    blueprint,
    previous: opts.previousMemory ?? null,
  });
  return { layout, blueprint, memory };
}
