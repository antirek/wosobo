import cors from "cors";
import express from "express";
import { MongoClient } from "mongodb";
import { isValidNick, normalizeNick } from "./nicks.js";
import { seedSubscribers } from "./seed.js";
import { parseSipWrite, toPublic } from "./subscribers.js";

const PORT = Number(process.env.PORT || 3121);
const MONGODB_URI = process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/janus_softphone";
const CORS_ORIGIN = (process.env.CORS_ORIGIN || "http://localhost:3120")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
const ADMIN_USER = process.env.ADMIN_USER || "admin";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "admin";
const SOFTPHONE_INTERNAL_URL =
  process.env.SOFTPHONE_INTERNAL_URL || "http://127.0.0.1:3101";
const INTERNAL_TOKEN = process.env.INTERNAL_TOKEN || "dev-internal-token";

const app = express();
app.use(cors({ origin: CORS_ORIGIN.length === 1 ? CORS_ORIGIN[0] : CORS_ORIGIN }));
app.use(express.json());

const client = new MongoClient(MONGODB_URI);
await client.connect();
const db = client.db();
const subscribers = db.collection("subscribers");
await subscribers.createIndex({ nick: 1 }, { unique: true });
await seedSubscribers(subscribers);
// softphone-api мог стартовать раньше seed — подтолкнём reconcile после listen

function basicAuth(req, res, next) {
  const header = req.headers.authorization || "";
  if (!header.startsWith("Basic ")) {
    res.set("WWW-Authenticate", 'Basic realm="manage"');
    return res.status(401).json({ error: "Требуется Basic auth" });
  }
  const decoded = Buffer.from(header.slice(6), "base64").toString("utf8");
  const idx = decoded.indexOf(":");
  const user = idx >= 0 ? decoded.slice(0, idx) : "";
  const pass = idx >= 0 ? decoded.slice(idx + 1) : "";
  if (user !== ADMIN_USER || pass !== ADMIN_PASSWORD) {
    res.set("WWW-Authenticate", 'Basic realm="manage"');
    return res.status(401).json({ error: "Неверный логин или пароль" });
  }
  return next();
}

async function notifyReconcile(payload) {
  try {
    const res = await fetch(`${SOFTPHONE_INTERNAL_URL}/internal/lines/reconcile`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Internal-Token": INTERNAL_TOKEN,
      },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      console.warn(`reconcile notify failed: ${res.status}`);
    }
  } catch (err) {
    console.warn(`reconcile notify error: ${err?.message || err}`);
  }
}

/** @returns {Promise<Map<string, object>>} */
async function fetchLineStatuses() {
  /** @type {Map<string, object>} */
  const map = new Map();
  try {
    const res = await fetch(`${SOFTPHONE_INTERNAL_URL}/internal/lines`, {
      headers: { "X-Internal-Token": INTERNAL_TOKEN },
    });
    if (!res.ok) {
      console.warn(`line statuses fetch failed: ${res.status}`);
      return map;
    }
    const data = await res.json();
    for (const item of data.items || []) {
      if (item?.nick) map.set(item.nick, item);
    }
  } catch (err) {
    console.warn(`line statuses fetch error: ${err?.message || err}`);
  }
  return map;
}

function withRuntime(doc, runtime) {
  const pub = toPublic(doc);
  return {
    ...pub,
    runtime: runtime
      ? {
          sipRegistered: Boolean(runtime.sipRegistered),
          lineStatus: runtime.lineStatus || "offline",
          lineDetail: runtime.lineDetail || "",
          softphoneOnline: Boolean(runtime.softphoneOnline),
          callPhase: runtime.callPhase || "idle",
        }
      : {
          sipRegistered: false,
          lineStatus: "offline",
          lineDetail: "",
          softphoneOnline: false,
          callPhase: "idle",
        },
  };
}

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, service: "manage-api" });
});

app.get("/api/manage/subscribers", basicAuth, async (_req, res) => {
  const docs = await subscribers.find({}).sort({ nick: 1 }).toArray();
  const statuses = await fetchLineStatuses();
  res.json({ items: docs.map((doc) => withRuntime(doc, statuses.get(doc.nick))) });
});

app.get("/api/manage/subscribers/:nick", basicAuth, async (req, res) => {
  const nick = normalizeNick(req.params.nick);
  if (!isValidNick(nick)) {
    return res.status(400).json({ error: "Некорректный ник" });
  }
  const doc = await subscribers.findOne({ nick });
  if (!doc) {
    return res.status(404).json({ error: "Не найден", nick });
  }
  const statuses = await fetchLineStatuses();
  return res.json(withRuntime(doc, statuses.get(nick)));
});

app.put("/api/manage/subscribers/:nick", basicAuth, async (req, res) => {
  const nick = normalizeNick(req.params.nick);
  if (!isValidNick(nick)) {
    return res.status(400).json({ error: "Некорректный ник (латиница, цифры, ._-, 1–32)" });
  }

  const existing = await subscribers.findOne({ nick });
  const parsed = parseSipWrite(req.body, { requirePassword: !existing?.sip?.password });
  if (parsed.error) {
    return res.status(400).json({ error: parsed.error });
  }

  const displayName =
    req.body.displayName != null ? String(req.body.displayName).trim() : existing?.displayName || nick;
  const enabled = req.body.enabled != null ? Boolean(req.body.enabled) : existing?.enabled ?? true;
  const absentAnnounce =
    req.body.absentAnnounce != null
      ? Boolean(req.body.absentAnnounce)
      : Boolean(existing?.absentAnnounce);

  /** @type {Record<string, unknown>} */
  const sip = { ...(existing?.sip || {}), ...parsed.sip };
  if (!sip.password && existing?.sip?.password) {
    sip.password = existing.sip.password;
  }
  if (!sip.password) {
    return res.status(400).json({ error: "Нужен sip.password" });
  }

  const now = new Date();
  await subscribers.updateOne(
    { nick },
    {
      $set: {
        nick,
        displayName,
        enabled,
        absentAnnounce,
        sip,
        updatedAt: now,
      },
      $setOnInsert: { createdAt: now },
    },
    { upsert: true },
  );

  const doc = await subscribers.findOne({ nick });
  await notifyReconcile({ nick });
  return res.json(toPublic(doc));
});

app.patch("/api/manage/subscribers/:nick", basicAuth, async (req, res) => {
  const nick = normalizeNick(req.params.nick);
  if (!isValidNick(nick)) {
    return res.status(400).json({ error: "Некорректный ник" });
  }
  const existing = await subscribers.findOne({ nick });
  if (!existing) {
    return res.status(404).json({ error: "Не найден", nick });
  }

  /** @type {Record<string, unknown>} */
  const $set = { updatedAt: new Date() };
  if (req.body.displayName != null) {
    $set.displayName = String(req.body.displayName).trim();
  }
  if (req.body.enabled != null) {
    $set.enabled = Boolean(req.body.enabled);
  }
  if (req.body.absentAnnounce != null) {
    $set.absentAnnounce = Boolean(req.body.absentAnnounce);
  }
  if (req.body.sip && typeof req.body.sip === "object") {
    const parsed = parseSipWrite({ sip: req.body.sip }, { requirePassword: false });
    if (parsed.error) {
      return res.status(400).json({ error: parsed.error });
    }
    const sip = { ...existing.sip, ...parsed.sip };
    if (!parsed.sip.password) {
      sip.password = existing.sip.password;
    }
    $set.sip = sip;
  }

  await subscribers.updateOne({ nick }, { $set });
  const doc = await subscribers.findOne({ nick });
  await notifyReconcile({ nick });
  return res.json(toPublic(doc));
});

app.delete("/api/manage/subscribers/:nick", basicAuth, async (req, res) => {
  const nick = normalizeNick(req.params.nick);
  if (!isValidNick(nick)) {
    return res.status(400).json({ error: "Некорректный ник" });
  }
  const result = await subscribers.deleteOne({ nick });
  if (!result.deletedCount) {
    return res.status(404).json({ error: "Не найден", nick });
  }
  await notifyReconcile({ nick });
  return res.json({ ok: true });
});

app.listen(PORT, () => {
  console.log(`manage-api listening on :${PORT}`);
  notifyReconcile({ all: true });
});
