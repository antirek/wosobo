const API_BASE = import.meta.env.VITE_MANAGE_API_BASE || "/manage-api";

/**
 * @param {string} token
 * @param {string} path
 * @param {RequestInit} [init]
 */
export async function manageFetch(token, path, init = {}) {
  const headers = new Headers(init.headers || {});
  headers.set("Authorization", `Bearer ${token}`);
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
