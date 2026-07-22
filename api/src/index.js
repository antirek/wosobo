import cors from "cors";
import express from "express";
import { MongoClient } from "mongodb";

const PORT = Number(process.env.PORT || 3101);
const MONGODB_URI = process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/janus_softphone";
const CORS_ORIGIN = process.env.CORS_ORIGIN || "http://localhost:3100";

/** @param {string} nick */
export function normalizeNick(nick) {
  return String(nick || "")
    .trim()
    .toLowerCase();
}

function isValidNick(nick) {
  return /^[a-z0-9][a-z0-9._-]{0,31}$/.test(nick);
}

function sanitizeSip(body) {
  const server = String(body?.server || "").trim();
  const username = String(body?.username || "").trim();
  const password = String(body?.password ?? "");
  if (!server || !username || !password) {
    return null;
  }
  return { server, username, password };
}

const app = express();
app.use(cors({ origin: CORS_ORIGIN }));
app.use(express.json());

const client = new MongoClient(MONGODB_URI);
await client.connect();
const db = client.db();
const users = db.collection("users");
await users.createIndex({ nick: 1 }, { unique: true });

app.get("/api/health", (_req, res) => {
  res.json({ ok: true });
});

app.get("/api/users/:nick/sip", async (req, res) => {
  const nick = normalizeNick(req.params.nick);
  if (!isValidNick(nick)) {
    return res.status(400).json({ error: "Некорректный ник" });
  }

  const user = await users.findOne({ nick }, { projection: { _id: 0, sip: 1, nick: 1 } });
  if (!user?.sip) {
    return res.status(404).json({ error: "SIP-настройки не найдены", nick });
  }

  return res.json({ nick, sip: user.sip });
});

app.put("/api/users/:nick/sip", async (req, res) => {
  const nick = normalizeNick(req.params.nick);
  if (!isValidNick(nick)) {
    return res.status(400).json({ error: "Некорректный ник (латиница, цифры, ._-, 1–32 символа)" });
  }

  const sip = sanitizeSip(req.body);
  if (!sip) {
    return res.status(400).json({ error: "Нужны поля server, username, password" });
  }

  await users.updateOne(
    { nick },
    {
      $set: {
        nick,
        sip,
        updatedAt: new Date(),
      },
      $setOnInsert: { createdAt: new Date() },
    },
    { upsert: true },
  );

  return res.json({ nick, sip });
});

app.listen(PORT, () => {
  console.log(`API listening on :${PORT}`);
});
