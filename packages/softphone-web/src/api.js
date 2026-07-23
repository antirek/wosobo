// Same-origin via Caddy (http://service/...); override with VITE_* if needed.
const API_BASE = import.meta.env.VITE_API_BASE ?? "";
const WS_BASE =
  import.meta.env.VITE_WS_BASE ??
  `${typeof location !== "undefined" && location.protocol === "https:" ? "wss" : "ws"}://${typeof location !== "undefined" ? location.host : "service"}`;

const TOKEN_KEY = "softphone.token";
const NICK_KEY = "softphone.nick";

export function normalizeNick(nick) {
  return String(nick || "")
    .trim()
    .toLowerCase();
}

export function getStoredSession() {
  const token = sessionStorage.getItem(TOKEN_KEY);
  const nick = sessionStorage.getItem(NICK_KEY);
  if (!token || !nick) return null;
  return { token, nick };
}

export function clearStoredSession() {
  sessionStorage.removeItem(TOKEN_KEY);
  sessionStorage.removeItem(NICK_KEY);
}

/** Store mint result from manage-api (no public /api/session). */
export function storeSession({ token, nick }) {
  const n = normalizeNick(nick);
  const t = String(token || "").trim();
  if (!t || !n) throw new Error("Нужны token и nick");
  sessionStorage.setItem(TOKEN_KEY, t);
  sessionStorage.setItem(NICK_KEY, n);
  return { token: t, nick: n };
}

export async function destroySession(token) {
  if (!token) return;
  try {
    await fetch(`${API_BASE}/api/session`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    });
  } catch {
    /* ignore */
  }
  clearStoredSession();
}

export function softphoneWsUrl(token, nick) {
  const q = new URLSearchParams({
    token: String(token || ""),
    nick: String(nick || ""),
  });
  return `${WS_BASE}/ws/softphone?${q}`;
}
