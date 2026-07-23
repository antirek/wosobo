import { MongoClient } from "mongodb";
import { createApp } from "./app.js";
import { seedSubscribers } from "./seed.js";

const PORT = Number(process.env.PORT || 3121);
const MONGODB_URI = process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/janus_softphone";
const CORS_ORIGIN = (process.env.CORS_ORIGIN || "http://localhost:3120")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
const MANAGE_API_TOKEN = process.env.MANAGE_API_TOKEN || "";
const PHONE_SERVER_URL =
  process.env.PHONE_SERVER_URL ||
  process.env.SOFTPHONE_INTERNAL_URL ||
  "http://127.0.0.1:3101";
const INTERNAL_TOKEN = process.env.INTERNAL_TOKEN || "dev-internal-token";

if (!MANAGE_API_TOKEN) {
  console.error("MANAGE_API_TOKEN is required");
  process.exit(1);
}

const client = new MongoClient(MONGODB_URI);
await client.connect();
const db = client.db();
const subscribers = db.collection("subscribers");
const sessions = db.collection("softphone_sessions");
const callRecords = db.collection("call_records");
await subscribers.createIndex({ nick: 1 }, { unique: true });
await sessions.createIndex({ token: 1 }, { unique: true });
await sessions.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });
await callRecords.createIndex({ startedAt: -1 });
await seedSubscribers(subscribers);

const { app, softphone } = createApp({
  manageApiToken: MANAGE_API_TOKEN,
  corsOrigin: CORS_ORIGIN.length === 1 ? CORS_ORIGIN[0] : CORS_ORIGIN,
  subscribers,
  sessions,
  callRecords,
  softphoneInternalUrl: PHONE_SERVER_URL,
  internalToken: INTERNAL_TOKEN,
  sessionTtlSec: 24 * 60 * 60,
});

app.listen(PORT, () => {
  console.log(`manage-api listening on :${PORT}`);
  console.log(`OpenAPI docs: http://127.0.0.1:${PORT}/api/manage/docs`);
  softphone.notifyReconcile({ all: true });
});
