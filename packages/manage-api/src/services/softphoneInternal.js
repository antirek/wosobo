/**
 * @param {{
 *   softphoneInternalUrl: string,
 *   internalToken: string,
 *   log?: (line: string) => void,
 * }} opts
 */
export function createSoftphoneInternal(opts) {
  const base = opts.softphoneInternalUrl.replace(/\/$/, "");
  const token = opts.internalToken;
  const log = opts.log || console.warn.bind(console);

  async function notifyReconcile(payload) {
    try {
      const res = await fetch(`${base}/internal/lines/reconcile`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Internal-Token": token,
        },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        log(`reconcile notify failed: ${res.status}`);
      }
    } catch (err) {
      log(`reconcile notify error: ${err?.message || err}`);
    }
  }

  /** @returns {Promise<Map<string, object>>} */
  async function fetchLineStatuses() {
    /** @type {Map<string, object>} */
    const map = new Map();
    try {
      const res = await fetch(`${base}/internal/lines`, {
        headers: { "X-Internal-Token": token },
      });
      if (!res.ok) {
        log(`line statuses fetch failed: ${res.status}`);
        return map;
      }
      const data = await res.json();
      for (const item of data.items || []) {
        if (item?.nick) map.set(item.nick, item);
      }
    } catch (err) {
      log(`line statuses fetch error: ${err?.message || err}`);
    }
    return map;
  }

  /**
   * @param {object} doc
   * @param {object} [runtime]
   * @param {(doc: object) => object} toPublic
   */
  function withRuntime(doc, runtime, toPublic) {
    const pub = toPublic(doc);
    return {
      ...pub,
      runtime: runtime
        ? {
            sipRegistered: Boolean(runtime.sipRegistered),
            lineStatus: runtime.lineStatus || "offline",
            lineDetail: runtime.lineDetail || "",
            softphoneOnline: Boolean(runtime.softphoneOnline),
            callPhase: runtime.callPhase || "idle",
          }
        : {
            sipRegistered: false,
            lineStatus: "offline",
            lineDetail: "",
            softphoneOnline: false,
            callPhase: "idle",
          },
    };
  }

  return { notifyReconcile, fetchLineStatuses, withRuntime };
}
