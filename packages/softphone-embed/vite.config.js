import { defineConfig } from "vite";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  build: {
    lib: {
      entry: resolve(__dirname, "src/index.js"),
      name: "WosoboSoftphone",
      formats: ["iife"],
      fileName: () => "softphone.js",
    },
    outDir: "dist",
    emptyOutDir: true,
    sourcemap: true,
    minify: true,
  },
});
