/**
 * Extract text from a PDF in the browser using pdf.js.
 * Falls back with a clear error if the PDF cannot be parsed.
 */
export async function extractPdfText(data: ArrayBuffer): Promise<string> {
  const pdfjs = await import("pdfjs-dist");
  // Vite will bundle the worker; set a CDN-free data worker when available.
  if (pdfjs.GlobalWorkerOptions && !pdfjs.GlobalWorkerOptions.workerSrc) {
    try {
      pdfjs.GlobalWorkerOptions.workerSrc = new URL(
        "pdfjs-dist/build/pdf.worker.min.mjs",
        import.meta.url,
      ).toString();
    } catch {
      // Worker may be unavailable in some extension contexts; pdf.js can still parse small docs.
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
