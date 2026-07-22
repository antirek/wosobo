import { randomBytes } from "crypto";
import cors from "cors";
import express from "express";
import http from "http";
import { MongoClient } from "mongodb";
import { WebSocketServer } from "ws";
import { LineManager } from "./lineManager.js";

const PORT = Number(process.env.PORT || 3101);
const MONGODB_URI = process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/janus_softphone";
const CORS_ORIGIN = process.env.CORS_ORIGIN || "http://localhost:3100";
const JANUS_WS_URL = process.env.JANUS_WS_URL || "ws://127.0.0.1:8188";
const INTERNAL_TOKEN = process.env.INTERNAL_TOKEN || "dev-internal-token";
const SESSION_TTL_MS = Number(process.env.SESSION_TTL_MS || 24 * 60 * 60 * 1000);

const app = express();
app.use(cors({ origin: CORS_ORIGIN }));
app.use(express.json());

const client = new MongoClient(MONGODB_URI);
await client.connect();
const db = client.db();
const subscribers = db.collection("subscribers");

/** @type {Map<string, { token: string, nick: string, createdAt: number, expiresAt: number }>} */
const sessions = new Map();

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

function getSession(token) {
  if (!token) return null;
  const s = sessions.get(token);
  if (!s) return null;
  if (Date.now() > s.expiresAt) {
    sessions.delete(token);
    return null;
  }
  return s;
}

function requireInternal(req, res, next) {
  if (req.headers["x-internal-token"] !== INTERNAL_TOKEN) {
    return res.status(403).json({ error: "Forbidden" });
  }
  return next();
}

const lineManager = new LineManager({
  janusWsUrl: JANUS_WS_URL,
  async getSubscriber(nick) {
    const doc = await subscribers.findOne({ nick });
    if (!doc) return null;
    return {
      nick: doc.nick,
      displayName: doc.displayName || doc.nick,
      enabled: Boolean(doc.enabled),
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
        sip: d.sip,
      }));
  },
  onLog: (line) => console.log(line),
});

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, service: "softphone-api" });
});

app.post("/api/session", async (req, res) => {
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
  const createdAt = Date.now();
  const expiresAt = createdAt + SESSION_TTL_MS;
  sessions.set(token, { token, nick, createdAt, expiresAt });
  return res.json({ token, nick, expiresAt });
});

app.delete("/api/session", (req, res) => {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (token) sessions.delete(token);
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

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: "/ws/softphone" });

wss.on("connection", async (ws, req) => {
  try {
    const url = new URL(req.url || "", "http://localhost");
    const token = url.searchParams.get("token") || "";
    const session = getSession(token);
    if (!session) {
      ws.send(JSON.stringify({ type: "error", code: "unauthorized", message: "Нет сессии" }));
      ws.close(4001, "unauthorized");
      return;
    }

    const line = lineManager.getLine(session.nick);
    if (!line) {
      // try ensure once
      const sub = await lineManager.getSubscriber(session.nick);
      if (sub?.enabled) {
        await lineManager.ensureLine(sub);
      }
    }
    const live = lineManager.getLine(session.nick);
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

server.listen(PORT, async () => {
  console.log(`softphone-api listening on :${PORT}`);
  console.log(`Janus WS: ${JANUS_WS_URL}`);
  try {
    await lineManager.boot();
  } catch (err) {
    console.error("boot error", err);
  }
  lineManager.startPolling(3000);
});
