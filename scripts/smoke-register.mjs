/**
 * Smoke-test: Janus HTTP API → SIP REGISTER → Asterisk 1001
 * Usage: node scripts/smoke-register.mjs
 */
const JANUS = process.env.JANUS_HTTP || "http://localhost:8088/janus";

async function janus(path, body) {
  const res = await fetch(`${JANUS}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...body, transaction: `t${Date.now()}${Math.random()}` }),
  });
  const data = await res.json();
  if (data.janus === "error") {
    throw new Error(JSON.stringify(data.error || data));
  }
  return data;
}

async function poll(sessionId, handleId, tries = 20) {
  for (let i = 0; i < tries; i++) {
    const res = await fetch(`${JANUS}/${sessionId}?maxev=1&rid=${Date.now()}`, {
      method: "GET",
    });
    const data = await res.json();
    if (data.janus === "event" || data.plugindata) {
      return data;
    }
    // long-poll may return keepalive / timeout empty-ish
    if (data.janus === "success" && !data.plugindata) {
      await new Promise((r) => setTimeout(r, 200));
      continue;
    }
    if (data.plugindata || data.janus === "event") return data;
    await new Promise((r) => setTimeout(r, 300));
  }
  return null;
}

const created = await janus("", { janus: "create" });
const sessionId = created.data.id;
console.log("session", sessionId);

const attached = await janus(`/${sessionId}`, {
  janus: "attach",
  plugin: "janus.plugin.sip",
});
const handleId = attached.data.id;
console.log("handle", handleId);

const registerMsg = await janus(`/${sessionId}/${handleId}`, {
  janus: "message",
  body: {
    request: "register",
    username: "sip:1001@asterisk",
    authuser: "1001",
    secret: "pass1001",
    proxy: "sip:asterisk:5060",
    display_name: "smoke",
  },
});
console.log("register ack", JSON.stringify(registerMsg.plugindata || registerMsg, null, 2));

// Wait for async registered event
let registered = false;
for (let i = 0; i < 15; i++) {
  const ev = await poll(sessionId, handleId);
  console.log("event", JSON.stringify(ev?.plugindata || ev, null, 2));
  const result = ev?.plugindata?.data?.result;
  if (result?.event === "registered") {
    registered = true;
    break;
  }
  if (result?.event === "registration_failed") {
    console.error("FAILED", result);
    process.exit(1);
  }
}

if (!registered) {
  console.error("No registered event received");
  process.exit(1);
}
console.log("OK: registered (check Asterisk contacts before destroy)");
await janus(`/${sessionId}`, { janus: "destroy" });
console.log("session destroyed");
