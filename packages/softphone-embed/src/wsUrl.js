/**
 * @param {string} token
 * @param {string} nick
 * @param {string} [wsBase]
 */
export function softphoneWsUrl(token, nick, wsBase) {
  const base =
    wsBase ||
    `${typeof location !== "undefined" && location.protocol === "https:" ? "wss" : "ws"}://${typeof location !== "undefined" ? location.host : "localhost"}`;
  const root = String(base).replace(/\/$/, "");
  const q = new URLSearchParams({
    token: String(token || ""),
    nick: String(nick || ""),
  });
  return `${root}/ws/softphone?${q}`;
}
