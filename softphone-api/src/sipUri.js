/** Нормализует SIP registrar: sip:host:port */
export function buildProxy(server) {
  let s = String(server || "").trim();
  if (!s) return "";
  if (!s.startsWith("sip:") && !s.startsWith("sips:")) {
    s = `sip:${s}`;
  }
  const withoutScheme = s.replace(/^sips?:/, "");
  if (!withoutScheme.includes(":")) {
    const scheme = s.startsWith("sips:") ? "sips" : "sip";
    s = `${scheme}:${withoutScheme}:5060`;
  }
  return s;
}

/** Собирает SIP identity: sip:user@host */
export function buildSipUsername(username, server) {
  const u = String(username || "").trim();
  if (!u) return "";
  if (u.startsWith("sip:") || u.startsWith("sips:")) {
    return u;
  }
  const proxy = buildProxy(server);
  const hostport = proxy.replace(/^sips?:/, "");
  const host = hostport.split(":")[0];
  return `sip:${u}@${host}`;
}

/** Номер или SIP URI → полный URI для INVITE */
export function buildCallUri(numberOrUri, server) {
  const raw = String(numberOrUri || "").trim();
  if (!raw) return "";
  if (raw.startsWith("sip:") || raw.startsWith("sips:")) {
    return raw;
  }
  const proxy = buildProxy(server);
  const host = proxy.replace(/^sips?:/, "").split(":")[0];
  return `sip:${raw}@${host}`;
}

export function authUserFromUsername(username) {
  return String(username || "")
    .trim()
    .replace(/^sips?:/, "")
    .split("@")[0];
}
