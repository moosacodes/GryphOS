import fs from "fs";
import path from "path";
const src = path.join("node_modules", "pdfjs-dist", "build", "pdf.worker.min.mjs");
const dest = path.join("dist", "pdf.worker.min.mjs");
if (!fs.existsSync(src)) {
  console.warn("pdf.worker.min.mjs not found; PDF outline parsing in content script may fail");
  process.exit(0);
}
fs.copyFileSync(src, dest);
console.log("copied", dest);
