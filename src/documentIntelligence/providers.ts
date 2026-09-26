/**
 * Optional providers — unused = fully usable product.
 * DocumentVision never runs unless visionOptIn === true.
 * AI never silently invents authoritative deadlines.
 */
import type {
  DocumentVisionProvider,
  DocumentVisionRequest,
  DocumentVisionResult,
  EmbeddingProvider,
  OcrProvider,
  TextIntelligenceProvider,
} from "./types";

export class NoopVisionProvider implements DocumentVisionProvider {
  readonly id = "noop-vision";
  async analyzePage(_req: DocumentVisionRequest): Promise<DocumentVisionResult> {
    return { tables: [], textBlocks: [], notes: ["Vision provider not configured"], uncertain: true };
  }
}

export class NoopTextIntelligenceProvider implements TextIntelligenceProvider {
  readonly id = "noop-text";
  async enhanceFacts(_text: string) {
    return { notes: [], uncertain: false };
  }
}

export class NoopEmbeddingProvider implements EmbeddingProvider {
  readonly id = "noop-embed";
  async embed(texts: string[]) {
    return texts.map(() => []);
  }
}

/** Selective OCR — only when density is low / scanned / garbled. */
export class SelectiveOcrGate {
  constructor(private provider: OcrProvider | null) {}

  shouldOcr(textDensity: number, spanCount: number, pageChars: number): boolean {
    if (!this.provider) return false;
    if (spanCount === 0 || pageChars < 40) return true;
    if (textDensity < 0.00015) return true;
    return false;
  }

  async run(imageDataUrl: string): Promise<{ text: string; confidence: number } | null> {
    if (!this.provider) return null;
    return this.provider.recognize(imageDataUrl);
  }
}

/**
 * Lazy tesseract.js OCR (browser). Safe no-op in Node tests when import fails.
 * Never used for every clean PDF — only via SelectiveOcrGate.
 */
export function createTesseractOcrProvider(): OcrProvider {
  return {
    id: "tesseract.js",
    async recognize(imageDataUrl: string) {
      try {
        // Optional peer — never bundled. Load only when OCR is actually needed.
        const dynamicImport = new Function("m", "return import(m)") as (
          m: string,
        ) => Promise<{
          createWorker?: (langs?: string) => Promise<{
            recognize: (img: string) => Promise<{ data: { text: string; confidence: number } }>;
            terminate: () => Promise<void>;
          }>;
        }>;
        const mod = await dynamicImport("tesseract.js");
        const createWorker = mod.createWorker;
        if (!createWorker) return { text: "", confidence: 0 };
        const worker = await createWorker("eng");
        try {
          const { data } = await worker.recognize(imageDataUrl);
          return { text: data.text ?? "", confidence: (data.confidence ?? 0) / 100 };
        } finally {
          await worker.terminate();
        }
      } catch {
        return { text: "", confidence: 0 };
      }
    },
  };
}

export function assertVisionAllowed(optIn: boolean | undefined): void {
  if (!optIn) {
    throw new Error("Document vision refused: explicit user opt-in required (never send docs externally by default).");
  }
}
