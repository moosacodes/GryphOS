declare module "tesseract.js" {
  export function createWorker(langs?: string): Promise<{
    recognize: (img: string) => Promise<{ data: { text: string; confidence: number } }>;
    terminate: () => Promise<void>;
  }>;
}
