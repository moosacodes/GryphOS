import type { OutlineParseResult } from "@/domain/types";
import { parseOutlineText } from "./parse";
import { extractPdfText } from "./pdf";

export { parseOutlineText, extractPdfText };

export async function parseOutlineFile(
  file: File | { name: string; type: string; arrayBuffer: () => Promise<ArrayBuffer>; text: () => Promise<string> },
): Promise<{ text: string; result: OutlineParseResult }> {
  const name = file.name.toLowerCase();
  const type = file.type || "";
  let text: string;

  if (type === "application/pdf" || name.endsWith(".pdf")) {
    const buf = await file.arrayBuffer();
    text = await extractPdfText(buf);
  } else if (type.includes("html") || name.endsWith(".html") || name.endsWith(".htm")) {
    const raw = await file.text();
    text = raw.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ");
  } else {
    text = await file.text();
  }

  return { text, result: parseOutlineText(text) };
}
