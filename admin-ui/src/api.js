const API_BASE = import.meta.env.VITE_ADMIN_API_BASE || "/admin-api";

function authHeader(user, pass) {
  return `Basic ${btoa(`${user}:${pass}`)}`;
}

/**
 * @param {string} user
 * @param {string} pass
 * @param {string} path
 * @param {RequestInit} [init]
 */
export async function adminFetch(user, pass, path, init = {}) {
  const headers = new Headers(init.headers || {});
  headers.set("Authorization", authHeader(user, pass));
  if (init.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  const res = await fetch(`${API_BASE}${path}`, { ...init, headers });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || `HTTP ${res.status}`);
  }
  return data;
}

export function normalizeNick(nick) {
  return String(nick || "")
    .trim()
    .toLowerCase();
}
