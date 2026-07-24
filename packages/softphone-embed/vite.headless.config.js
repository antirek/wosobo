import { defineConfig } from "vite";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  build: {
    lib: {
      entry: resolve(__dirname, "src/headless.js"),
      name: "WosoboSoftphoneHeadless",
      formats: ["iife"],
      fileName: () => "softphone-headless.js",
    },
    outDir: "dist",
    emptyOutDir: false,
    sourcemap: true,
    minify: true,
  },
});
