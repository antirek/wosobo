const API_BASE = import.meta.env.VITE_API_BASE || "http://localhost:3101";
const WS_BASE =
  import.meta.env.VITE_WS_BASE ||
  API_BASE.replace(/^http/, "ws");

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

export async function createSession(nick) {
  const res = await fetch(`${API_BASE}/api/session`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ nick }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || `Ошибка API ${res.status}`);
  }
  sessionStorage.setItem(TOKEN_KEY, data.token);
  sessionStorage.setItem(NICK_KEY, data.nick);
  return data;
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

export function softphoneWsUrl(token) {
  return `${WS_BASE}/ws/softphone?token=${encodeURIComponent(token)}`;
}
