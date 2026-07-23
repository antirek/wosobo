import { normalizeNick } from "./nicks.js";

const SEED = [
  {
    nick: "alice",
    displayName: "Alice",
    enabled: true,
    sip: { server: "asterisk", username: "1001", password: "pass1001", transport: "udp" },
  },
  {
    nick: "bob",
    displayName: "Bob",
    enabled: true,
    sip: { server: "asterisk", username: "1002", password: "pass1002", transport: "udp" },
  },
];

/** @param {import('mongodb').Collection} col */
export async function seedSubscribers(col) {
  const now = new Date();
  for (const item of SEED) {
    const nick = normalizeNick(item.nick);
    const existing = await col.findOne({ nick });
    if (existing) continue;
    await col.insertOne({
      nick,
      displayName: item.displayName,
      enabled: item.enabled,
      absentAnnounce: Boolean(item.absentAnnounce),
      sip: item.sip,
      createdAt: now,
      updatedAt: now,
    });
    console.log(`Seeded subscriber ${nick}`);
  }
}
