import { randomBytes } from "crypto";
import cors from "cors";
import express from "express";
import http from "http";
import { MongoClient } from "mongodb";
import { WebSocketServer } from "ws";
import { LineManager } from "./lineManager.js";
import { createAbsentAnnounceService } from "./absent/index.js";

const PORT = Number(process.env.PORT || 3101);
const WS_PORT = Number(process.env.WS_PORT || 3102);
const MONGODB_URI = process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/janus_softphone";
const CORS_ORIGIN = (process.env.CORS_ORIGIN || "http://localhost:3100")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
const JANUS_WS_URL = process.env.JANUS_WS_URL || "ws://127.0.0.1:8188";
const INTERNAL_TOKEN = process.env.INTERNAL_TOKEN || "dev-internal-token";
const SESSION_TTL_MS = Number(process.env.SESSION_TTL_MS || 24 * 60 * 60 * 1000);
const ABSENT_ANNOUNCE_FILE = process.env.ABSENT_ANNOUNCE_FILE || "/app/media/absent.wav";
const ABSENT_ANNOUNCE_MAX_SEC = Number(process.env.ABSENT_ANNOUNCE_MAX_SEC || 30);

const app = express();
app.use(cors({ origin: CORS_ORIGIN.length === 1 ? CORS_ORIGIN[0] : CORS_ORIGIN }));
app.use(express.json());

const client = new MongoClient(MONGODB_URI);
await client.connect();
const db = client.db();
const subscribers = db.collection("subscribers");
const sessionsCol = db.collection("softphone_sessions");

await sessionsCol.createIndex({ token: 1 }, { unique: true });
// Mongo TTL: expiresAt must be Date
await sessionsCol.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });

function normalizeNick(nick) {
  return String(nick || "")
    .trim()
    .toLowerCase();
}

function isValidNick(nick) {
  return /^[a-z0-9][a-z0-9._-]{0,31}$/.test(nick);
}

function createToken() {
  return randomBytes(24).toString("hex");
}

/**
 * @param {string} token
 * @returns {Promise<{ token: string, nick: string, createdAt: number, expiresAt: number } | null>}
 */
async function getSession(token) {
  if (!token) return null;
  const doc = await sessionsCol.findOne({ token });
  if (!doc) return null;
  const expiresAtMs =
    doc.expiresAt instanceof Date ? doc.expiresAt.getTime() : Number(doc.expiresAt);
  if (!expiresAtMs || Date.now() > expiresAtMs) {
    await sessionsCol.deleteOne({ token }).catch(() => {});
    return null;
  }
  return {
    token: doc.token,
    nick: doc.nick,
    createdAt: doc.createdAt instanceof Date ? doc.createdAt.getTime() : Number(doc.createdAt),
    expiresAt: expiresAtMs,
  };
}

function requireInternal(req, res, next) {
  if (req.headers["x-internal-token"] !== INTERNAL_TOKEN) {
    return res.status(403).json({ error: "Forbidden" });
  }
  return next();
}

const absentAnnounce = createAbsentAnnounceService({
  filePath: ABSENT_ANNOUNCE_FILE,
  maxDurationMs: ABSENT_ANNOUNCE_MAX_SEC * 1000,
  log: (line) => console.log(line),
});

const lineManager = new LineManager({
  janusWsUrl: JANUS_WS_URL,
  absentAnnounce,
  async getSubscriber(nick) {
    const doc = await subscribers.findOne({ nick });
    if (!doc) return null;
    return {
      nick: doc.nick,
      displayName: doc.displayName || doc.nick,
      enabled: Boolean(doc.enabled),
      absentAnnounce: Boolean(doc.absentAnnounce),
      sip: doc.sip,
    };
  },
  async listEnabled() {
    const docs = await subscribers.find({ enabled: true }).toArray();
    return docs
      .filter((d) => d.sip?.server && d.sip?.username && d.sip?.password)
      .map((d) => ({
        nick: d.nick,
        displayName: d.displayName || d.nick,
        enabled: true,
        absentAnnounce: Boolean(d.absentAnnounce),
        sip: d.sip,
      }));
  },
  onLog: (line) => console.log(line),
});

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, service: "phone-server" });
});

app.post("/api/session", async (req, res) => {
  try {
    const nick = normalizeNick(req.body?.nick);
    if (!isValidNick(nick)) {
      return res.status(400).json({ error: "Некорректный ник" });
    }
    const doc = await subscribers.findOne({ nick });
    if (!doc || !doc.enabled) {
      return res.status(404).json({ error: "Абонент не найден или отключён", nick });
    }
    if (!doc.sip?.password) {
      return res.status(404).json({ error: "Абонент без SIP-привязки", nick });
    }

    const token = createToken();
    const createdAt = new Date();
    const expiresAt = new Date(createdAt.getTime() + SESSION_TTL_MS);
    await sessionsCol.insertOne({ token, nick, createdAt, expiresAt });
    return res.json({ token, nick, expiresAt: expiresAt.getTime() });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: err.message || String(err) });
  }
});

app.delete("/api/session", async (req, res) => {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (token) {
    await sessionsCol.deleteOne({ token }).catch(() => {});
  }
  return res.json({ ok: true });
});

app.get("/internal/lines", requireInternal, (_req, res) => {
  res.json({ items: lineManager.listStatuses() });
});

app.post("/internal/lines/reconcile", requireInternal, async (req, res) => {
  try {
    if (req.body?.all) {
      await lineManager.reconcileAll();
    } else if (req.body?.nick) {
      await lineManager.reconcileNick(normalizeNick(req.body.nick));
    } else {
      await lineManager.reconcileAll();
    }
    return res.json({ ok: true });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: err.message || String(err) });
  }
});

const apiServer = http.createServer(app);
const wsServer = http.createServer((_req, res) => {
  res.writeHead(426, { "Content-Type": "text/plain" });
  res.end("Upgrade Required — WebSocket only");
});
const wss = new WebSocketServer({ server: wsServer, path: "/ws/softphone" });

wss.on("connection", async (ws, req) => {
  try {
    const url = new URL(req.url || "", "http://localhost");
    const token = url.searchParams.get("token") || "";
    const session = await getSession(token);
    if (!session) {
      ws.send(JSON.stringify({ type: "error", code: "unauthorized", message: "Нет сессии" }));
      ws.close(4001, "unauthorized");
      return;
    }

    let live = lineManager.getLine(session.nick);
    if (!live) {
      const sub = await lineManager.getSubscriber(session.nick);
      if (sub?.enabled) {
        await lineManager.ensureLine(sub);
      }
      live = lineManager.getLine(session.nick);
    }
    if (!live) {
      ws.send(
        JSON.stringify({
          type: "error",
          code: "no_line",
          message: "Линия ещё не поднята",
        }),
      );
      ws.close(4002, "no_line");
      return;
    }

    const attached = live.attachSoftphone(ws);
    if (!attached.ok) {
      ws.send(
        JSON.stringify({
          type: "error",
          code: attached.code,
          message: attached.message,
        }),
      );
      ws.close(4003, attached.code);
      return;
    }

    ws.on("message", (data) => {
      let msg;
      try {
        msg = JSON.parse(String(data));
      } catch {
        ws.send(JSON.stringify({ type: "error", code: "bad_json", message: "Invalid JSON" }));
        return;
      }
      live.handleSoftphoneMessage(msg);
    });

    ws.on("close", () => {
      live.detachSoftphone(ws);
    });
  } catch (err) {
    console.error("ws connection error", err);
    try {
      ws.close();
    } catch {
      /* ignore */
    }
  }
});

async function bootLines() {
  try {
    await lineManager.boot();
  } catch (err) {
    console.error("boot error", err);
  }
  lineManager.startPolling(3000);
}

apiServer.listen(PORT, () => {
  console.log(`phone-server HTTP (internal API) on :${PORT}`);
});

wsServer.listen(WS_PORT, async () => {
  console.log(`phone-server WebSocket (external) on :${WS_PORT} path /ws/softphone`);
  console.log(`Janus WS: ${JANUS_WS_URL}`);
  console.log(`Session TTL: ${SESSION_TTL_MS}ms (Mongo softphone_sessions)`);
  console.log(`Absent announce file: ${ABSENT_ANNOUNCE_FILE}`);
  await bootLines();
});
