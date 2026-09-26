import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: { "@": path.resolve(__dirname, "src") },
  },
  build: {
    outDir: "dist",
    emptyOutDir: false,
    lib: {
      entry: fileURLToPath(new URL("src/background/index.ts", import.meta.url)),
      name: "GryphOSBackground",
      formats: ["iife"],
      fileName: () => "background.js",
    },
  },
});
