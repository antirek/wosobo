import express from "express";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 3140);
const STATIC_ROOT = process.env.STATIC_ROOT || path.join(__dirname, "../../static");
const EMBED_DIR = path.join(STATIC_ROOT, "embed");
const MANAGE_DIR = path.join(STATIC_ROOT, "manage");

const app = express();

app.get("/health", (_req, res) => {
  res.json({ ok: true, service: "static-server" });
});

// /embed/softphone.js (+ optional .map)
app.use(
  "/embed",
  express.static(EMBED_DIR, {
    setHeaders(res, filePath) {
      if (filePath.endsWith("softphone.js") || filePath.endsWith("softphone-headless.js")) {
        res.setHeader("Cache-Control", "no-cache");
      }
    },
  }),
);

// Manage SPA (vite base: /manage/)
app.use("/manage", express.static(MANAGE_DIR, { index: "index.html" }));
app.get(/^\/manage(?:\/.*)?$/, (_req, res) => {
  res.sendFile(path.join(MANAGE_DIR, "index.html"));
});

app.listen(PORT, () => {
  console.log(`static-server on :${PORT}`);
  console.log(`  embed:  ${EMBED_DIR}`);
  console.log(`  manage: ${MANAGE_DIR}`);
});
