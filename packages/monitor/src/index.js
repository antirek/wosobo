import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const PORT = Number(process.env.PORT || 3110);
const JANUS_ADMIN_URL = (process.env.JANUS_ADMIN_URL || "http://127.0.0.1:7088/admin").replace(/\/$/, "");
const JANUS_ADMIN_SECRET = process.env.JANUS_ADMIN_SECRET || "janusoverlord";

const app = express();

function tx() {
  return `t${Date.now()}${Math.random().toString(16).slice(2, 8)}`;
}

async function janusAdmin(janus, extra = {}, urlPath = "") {
  const body = {
    janus,
    transaction: tx(),
    admin_secret: JANUS_ADMIN_SECRET,
    ...extra,
  };
  const res = await fetch(`${JANUS_ADMIN_URL}${urlPath}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (data.janus === "error") {
    const reason = data.error?.reason || JSON.stringify(data.error || data);
    throw new Error(`Janus admin: ${reason}`);
  }
  return data;
}

/**
 * @param {Record<string, unknown>} specific
 * @param {Record<string, unknown>} infoBlock
 */
function summarizeSipHandle(specific, infoBlock, sessionId, handleId) {
  const registrationStatus = String(specific.registration_status || "unknown");
  const callStatus = String(specific.call_status || "idle");
  const registered = registrationStatus === "registered";
  const inCallLike = !["idle", "registered", ""].includes(callStatus) || Number(specific.established) === 1;

  return {
    sessionId,
    handleId,
    displayName: specific.display_name ? String(specific.display_name) : null,
    username: specific.username ? String(specific.username) : null,
    authuser: specific.authuser ? String(specific.authuser) : null,
    identity: specific.identity ? String(specific.identity) : null,
    registrationStatus,
    registered,
    callStatus,
    callee: specific.callee ? String(specific.callee) : null,
    established: Number(specific.established) === 1,
    establishing: Number(specific.establishing) === 1,
    hangingup: Number(specific.hangingup) === 1,
    transport: infoBlock.session_transport || null,
    webrtcStreams: Array.isArray(infoBlock.streams) ? infoBlock.streams.length : 0,
    inCallLike,
  };
}

async function collectJanusSnapshot() {
  let info = {};
  try {
    info = await janusAdmin("info");
  } catch {
    const res = await fetch(JANUS_ADMIN_URL.replace(/\/admin$/, "/janus/info"));
    info = await res.json();
  }

  const sessionsResp = await janusAdmin("list_sessions");
  const sessionIds = sessionsResp.sessions || [];

  const sessions = [];
  const sipHandles = [];

  for (const sessionId of sessionIds) {
    const handlesResp = await janusAdmin("list_handles", { session_id: sessionId }, `/${sessionId}`);
    const handleIds = handlesResp.handles || [];
    const handles = [];

    for (const handleId of handleIds) {
      const hi = await janusAdmin(
        "handle_info",
        { session_id: sessionId, handle_id: handleId },
        `/${sessionId}/${handleId}`,
      );
      const infoBlock = hi.info || {};
      const plugin = infoBlock.plugin || null;
      const specific = infoBlock.plugin_specific || {};

      let sip = null;
      if (plugin === "janus.plugin.sip") {
        sip = summarizeSipHandle(specific, infoBlock, sessionId, handleId);
        sipHandles.push(sip);
      }

      handles.push({
        handleId,
        plugin,
        sip,
      });
    }

    sessions.push({ sessionId, handleCount: handles.length, handles });
  }

  const online = sipHandles.filter((h) => h.registered);
  const conversations = sipHandles.filter((h) => h.inCallLike);

  return {
    fetchedAt: new Date().toISOString(),
    janus: {
      name: info.name || "Janus",
      version: info.version_string || info.version || null,
      serverName: info["server-name"] || null,
      sessionCount: sessionIds.length,
      acceptingNewSessions: info["accepting-new-sessions"],
    },
    sessions,
    online,
    conversations,
    summary: {
      janusSessions: sessionIds.length,
      sipHandles: sipHandles.length,
      registered: online.length,
      conversations: conversations.length,
    },
  };
}

app.get("/api/health", (_req, res) => {
  res.json({ ok: true });
});

app.get("/api/overview", async (_req, res) => {
  try {
    res.json(await collectJanusSnapshot());
  } catch (err) {
    console.error(err);
    res.status(502).json({ error: err.message || String(err) });
  }
});

app.use(express.static(path.join(__dirname, "..", "public")));

app.listen(PORT, () => {
  console.log(`Monitor on :${PORT} (Janus-only)`);
  console.log(`Janus admin: ${JANUS_ADMIN_URL}`);
});
