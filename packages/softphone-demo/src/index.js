import cors from "cors";
import express from "express";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 3130);
const MANAGE_API_URL = (process.env.MANAGE_API_URL || "http://127.0.0.1:3121").replace(/\/$/, "");
const MANAGE_API_TOKEN = process.env.MANAGE_API_TOKEN || "";
const CORS_ORIGIN = (process.env.CORS_ORIGIN || "*")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

if (!MANAGE_API_TOKEN) {
  console.error("MANAGE_API_TOKEN is required (demo host backend mint)");
  process.exit(1);
}

function normalizeNick(nick) {
  return String(nick || "")
    .trim()
    .toLowerCase();
}

function isValidNick(nick) {
  return /^[a-z0-9][a-z0-9._-]{0,31}$/.test(nick);
}

const app = express();
app.use(
  cors({
    origin: CORS_ORIGIN.length === 1 ? CORS_ORIGIN[0] : CORS_ORIGIN,
  }),
);
app.use(express.json());

app.get("/health", (_req, res) => {
  res.json({ ok: true, service: "softphone-demo" });
});

/**
 * Example host backend: mint softphone session via manage-api.
 * Browser never sees MANAGE_API_TOKEN.
 */
app.post("/session", async (req, res) => {
  const nick = normalizeNick(req.body?.nick);
  if (!isValidNick(nick)) {
    return res.status(400).json({ error: "Некорректный ник" });
  }

  try {
    const upstream = await fetch(
      `${MANAGE_API_URL}/api/manage/subscribers/${encodeURIComponent(nick)}/session`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${MANAGE_API_TOKEN}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          ttlSec: Number(req.body?.ttlSec) || 24 * 60 * 60,
        }),
      },
    );
    const data = await upstream.json().catch(() => ({}));
    if (!upstream.ok) {
      return res.status(upstream.status).json({
        error: data.error || `manage-api ${upstream.status}`,
        nick,
      });
    }
    return res.json({
      token: data.token,
      nick: data.nick,
      expiresAt: data.expiresAt,
    });
  } catch (err) {
    console.error("mint failed", err);
    return res.status(502).json({ error: err.message || String(err) });
  }
});

app.use(express.static(path.join(__dirname, "../public")));

app.listen(PORT, () => {
  console.log(`softphone-demo on :${PORT}`);
  console.log(`Manage mint via ${MANAGE_API_URL} (token hidden from browser)`);
});
