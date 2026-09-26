import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = (p: string) => fileURLToPath(new URL(p, import.meta.url));

/** Opera GX warns on Vite <link rel="modulepreload"> in extension pages (cross-world mismatch). */
function stripExtensionPreloads(): Plugin {
  return {
    name: "gryphos-strip-modulepreload",
    enforce: "post",
    transformIndexHtml(html) {
      return html
        .replace(/\s*<link[^>]*rel=["']modulepreload["'][^>]*>/gi, "")
        .replace(/\scrossorigin(?:=["'][^"']*["'])?/gi, "");
    },
  };
}

export default defineConfig({
  plugins: [react(), stripExtensionPreloads()],
  base: "./",
  resolve: {
    alias: { "@": path.resolve(__dirname, "src") },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    modulePreload: false,
    rollupOptions: {
      input: {
        app: root("app.html"),
        popup: root("popup.html"),
        panel: root("panel.html"),
      },
    },
  },
});
