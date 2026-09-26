/**
 * J.A.R.V.I.S. Document Intelligence — layout, blueprint, citations, providers.
 * Product works fully without optional vision/OCR/embeddings.
 */
import type { AssessmentType, DateCertainty, OutlineParseResult } from "@/domain/types";

export interface BBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface TextSpan {
  text: string;
  page: number;
  x: number;
  y: number;
  w: number;
  h: number;
  fontSize: number;
  fontName: string;
  bold: boolean;
  italic: boolean;
  source: "pdfjs" | "ocr" | "html" | "plain";
}

export interface LayoutLine {
  id: string;
  page: number;
  text: string;
  bbox: BBox;
  spans: TextSpan[];
  fontSize: number;
  bold: boolean;
  readingOrder: number;
  columnIndex: number;
}

export interface LayoutParagraph {
  id: string;
  page: number;
  text: string;
  bbox: BBox;
  lineIds: string[];
  role: "body" | "heading" | "caption" | "list_item" | "unknown";
}

export interface LayoutHeading {
  id: string;
  page: number;
  text: string;
  level: 1 | 2 | 3;
  bbox: BBox;
  confidence: number;
}

export interface TableCell {
  row: number;
  col: number;
  text: string;
  bbox: BBox;
  rowspan: number;
  colspan: number;
  isHeader: boolean;
  continuation?: boolean;
}

export interface LayoutTable {
  id: string;
  page: number;
  /** Last page if table spans pages */
  endPage: number;
  bbox: BBox;
  headers: string[];
  rows: string[][];
  cells: TableCell[];
  confidence: number;
  kind: "assessment" | "schedule" | "other";
}

export interface LayoutImage {
  id: string;
  page: number;
  bbox: BBox;
  widthPx: number;
  heightPx: number;
  /** Decorative images are ignored for semantics */
  role: "academic" | "decorative" | "unknown";
  ocrText: string | null;
  caption: string | null;
}

export interface LayoutColumn {
  page: number;
  index: number;
  x0: number;
  x1: number;
}

export interface LayoutPage {
  page: number;
  width: number;
  height: number;
  spans: TextSpan[];
  lines: LayoutLine[];
  paragraphs: LayoutParagraph[];
  headings: LayoutHeading[];
  tables: LayoutTable[];
  images: LayoutImage[];
  columns: LayoutColumn[];
  /** Characters per page area — low density triggers selective OCR */
  textDensity: number;
  ocrApplied: boolean;
  renderDataUrl: string | null;
}

export interface DocumentLayout {
  pageCount: number;
  pages: LayoutPage[];
  /** Reading-order plain text with page markers */
  readingText: string;
  extractionMethod: "pdfjs" | "ocr" | "hybrid" | "html" | "plain";
  warnings: string[];
}

export interface SourceCitation {
  page: number | null;
  snippet: string;
  bbox: BBox | null;
  confidence: number;
  /** UI label: "View source" */
  viewLabel: string;
}

export interface FactWithCitation<T = unknown> {
  value: T;
  confidence: number;
  uncertain: boolean;
  citation: SourceCitation | null;
}

export type RelativeAnchorKind =
  | "lab_introduced"
  | "lecture_introduced"
  | "assignment_released"
  | "week_start"
  | "other";

export interface RelativeDeadlineRule {
  id: string;
  assessmentTitleHint: string;
  offsetDays: number;
  approx: boolean;
  anchorKind: RelativeAnchorKind;
  anchorLabel: string;
  raw: string;
  citation: SourceCitation | null;
  /** Filled when lab/lecture occurrence is known */
  resolvedCandidateIso: string | null;
}

export interface BlueprintAssessmentInstance {
  title: string;
  type: AssessmentType;
  /** Per-instance weight when known; else share of category */
  weightPercent: number | null;
  index: number | null;
  categoryName: string | null;
  due: {
    kind: "exact" | "range" | "week" | "relative" | "tbd" | "unknown";
    iso: string | null;
    endIso: string | null;
    label: string | null;
    weekNumber: number | null;
    relativeRuleId: string | null;
  };
  certainty: DateCertainty;
  confidence: number;
  citation: SourceCitation | null;
  sourceSnippet: string | null;
}

export interface BlueprintCategory {
  name: string;
  weightPercent: number | null;
  promisedCount: number | null;
  bestN: number | null;
  dropLowest: number;
  instanceWeight: number | null;
  citation: SourceCitation | null;
}

export interface BlueprintPerson {
  name: string;
  email: string | null;
  role: "instructor" | "ta" | "other";
  citation: SourceCitation | null;
}

export interface BlueprintScheduleEntity {
  kind: "week" | "zybook" | "midterm" | "lecture" | "lab" | "other";
  label: string;
  weekNumber: number | null;
  citation: SourceCitation | null;
}

export interface ExtractionQuality {
  score: number;
  incomplete: boolean;
  missingCategories: string[];
  checks: Array<{ id: string; ok: boolean; detail: string }>;
  contradictions: string[];
  secondPassApplied: boolean;
}

export interface CourseBlueprint {
  id: string;
  courseId: string | null;
  documentId: string | null;
  courseCode: string | null;
  courseTitle: string | null;
  term: string | null;
  /** Offered course vs student section — section may be unknown */
  offeredSectionHint: string | null;
  studentSectionNeeded: boolean;
  people: BlueprintPerson[];
  categories: BlueprintCategory[];
  instances: BlueprintAssessmentInstance[];
  relativeDeadlines: RelativeDeadlineRule[];
  scheduleEntities: BlueprintScheduleEntity[];
  officeHours: string[];
  policies: Array<{ kind: string; title: string; body: string; citation: SourceCitation | null }>;
  textbooks: string[];
  quality: ExtractionQuality;
  outlineParse: OutlineParseResult;
  layoutSummary: {
    pageCount: number;
    tableCount: number;
    imageCount: number;
    ocrPages: number;
    extractionMethod: DocumentLayout["extractionMethod"];
  };
  createdAt: string;
  contentHash: string;
}

export interface DocumentMemoryEntry {
  id: string;
  courseId: string | null;
  documentId: string;
  filename: string;
  contentHash: string;
  /** Semantic fingerprint ignoring metadata noise */
  semanticHash: string;
  blueprintId: string | null;
  qualityScore: number;
  retrievedAt: string;
  revisionOf: string | null;
  changeKind: "initial" | "semantic" | "metadata_only" | "reparse";
  notes: string | null;
}

export interface DocumentVisionRequest {
  pageImageDataUrl: string;
  page: number;
  hint?: string;
}

export interface DocumentVisionResult {
  tables: LayoutTable[];
  textBlocks: Array<{ text: string; bbox: BBox; confidence: number }>;
  notes: string[];
  uncertain: boolean;
}

export interface DocumentVisionProvider {
  readonly id: string;
  analyzePage(req: DocumentVisionRequest): Promise<DocumentVisionResult>;
}

export interface TextIntelligenceProvider {
  readonly id: string;
  enhanceFacts?(text: string): Promise<{ notes: string[]; uncertain: boolean }>;
}

export interface EmbeddingProvider {
  readonly id: string;
  embed?(texts: string[]): Promise<number[][]>;
}

export interface OcrProvider {
  readonly id: string;
  recognize(imageDataUrl: string): Promise<{ text: string; confidence: number }>;
}

export interface PipelineOptions {
  courseId?: string | null;
  documentId?: string | null;
  filename?: string;
  mimeType?: string;
  /** Never enable without explicit user opt-in */
  visionProvider?: DocumentVisionProvider | null;
  visionOptIn?: boolean;
  ocrProvider?: OcrProvider | null;
  textProvider?: TextIntelligenceProvider | null;
  renderPages?: boolean;
  labOccurrenceIsoByWeek?: Record<number, string>;
}
