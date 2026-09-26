export type * from "./types";
export {
  spansToLines,
  detectColumns,
  assignColumns,
  readingOrderedLines,
  detectHeadings,
  reconstructTables,
  buildPageLayout,
  assembleDocumentLayout,
  layoutFromPlainText,
} from "./layout";
export { extractPdfLayout, layoutFromHtml } from "./pdfLayout";
export { expandInstances, parseCategoryExpansion } from "./instances";
export {
  extractRelativeDeadlineRules,
  resolveRelativeCandidate,
  applyLabOccurrences,
} from "./relativeDeadlines";
export { scoreExtraction, secondPassBlueprint } from "./quality";
export { buildCourseBlueprint } from "./semantics";
export { rememberDocument, semanticFingerprint, shouldRebuildFromRevision } from "./memory";
export { materialLinksFromBlueprint } from "./materialLinks";
export { understandDocument, understandPlainText } from "./pipeline";
export type { PipelineResult } from "./pipeline";
export {
  NoopVisionProvider,
  NoopTextIntelligenceProvider,
  NoopEmbeddingProvider,
  SelectiveOcrGate,
  createTesseractOcrProvider,
  assertVisionAllowed,
} from "./providers";
