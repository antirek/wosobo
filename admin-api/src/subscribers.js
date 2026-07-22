/**
 * @param {import('mongodb').Collection} col
 * @param {Record<string, unknown>} doc
 */
export function toPublic(doc) {
  if (!doc) return null;
  const sip = doc.sip || {};
  return {
    nick: doc.nick,
    displayName: doc.displayName || "",
    enabled: Boolean(doc.enabled),
    sip: {
      server: sip.server || "",
      username: sip.username || "",
      authuser: sip.authuser || null,
      transport: sip.transport || "udp",
      passwordSet: Boolean(sip.password),
    },
    createdAt: doc.createdAt || null,
    updatedAt: doc.updatedAt || null,
  };
}

/**
 * @param {unknown} body
 * @param {{ requirePassword?: boolean }} [opts]
 */
export function parseSipWrite(body, opts = {}) {
  const requirePassword = opts.requirePassword !== false;
  const sipIn = body?.sip && typeof body.sip === "object" ? body.sip : body;
  const server = String(sipIn?.server || "").trim();
  const username = String(sipIn?.username || "").trim();
  const passwordRaw = sipIn?.password;
  const password = passwordRaw == null ? undefined : String(passwordRaw);
  const authuser = sipIn?.authuser != null ? String(sipIn.authuser).trim() || null : null;
  const transport = String(sipIn?.transport || "udp").trim() || "udp";

  if (!server || !username) {
    return { error: "Нужны sip.server и sip.username" };
  }
  if (requirePassword && (!password || !password.length)) {
    return { error: "Нужен sip.password" };
  }

  /** @type {Record<string, unknown>} */
  const sip = { server, username, transport };
  if (authuser) sip.authuser = authuser;
  if (password && password.length) sip.password = password;

  return { sip };
}
