/** @param {string} nick */
export function normalizeNick(nick) {
  return String(nick || "")
    .trim()
    .toLowerCase();
}

/** @param {string} nick */
export function isValidNick(nick) {
  return /^[a-z0-9][a-z0-9._-]{0,31}$/.test(nick);
}
