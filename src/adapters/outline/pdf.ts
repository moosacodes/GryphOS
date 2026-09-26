/**
 * Extract text from a PDF in the browser using pdf.js.
 * Works in the full app and in the CourseLink content script.
 */
export async function extractPdfText(data: ArrayBuffer): Promise<string> {
  const pdfjs = await import("pdfjs-dist");

  if (pdfjs.GlobalWorkerOptions) {
    try {
      if (typeof chrome !== "undefined" && chrome.runtime?.getURL) {
        // Stable path copied into dist/ by the build script
        pdfjs.GlobalWorkerOptions.workerSrc = chrome.runtime.getURL("pdf.worker.min.mjs");
      } else {
        pdfjs.GlobalWorkerOptions.workerSrc = new URL(
          "pdfjs-dist/build/pdf.worker.min.mjs",
          import.meta.url,
        ).toString();
      }
    } catch {
      // Worker may be unavailable; pdf.js may still parse on the main thread in some builds.
    }
  }

  const doc = await pdfjs.getDocument({ data: new Uint8Array(data) }).promise;
  const parts: string[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    const line = content.items
      .map((item) => ("str" in item ? String(item.str) : ""))
      .join(" ");
    parts.push(line);
  }
  const text = parts.join("\n").replace(/[ \t]+/g, " ").trim();
  if (!text) throw new Error("PDF contained no extractable text (it may be a scanned image).");
  return text;
}
