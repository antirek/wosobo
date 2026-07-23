import { loadWavPcm } from "./audioFile.js";
import { shouldAnnounce } from "./policy.js";
import { runAbsentAnnounce } from "./player.js";

/**
 * @param {{
 *   filePath: string,
 *   maxDurationMs: number,
 *   log?: (line: string) => void,
 * }} deps
 */
export function createAbsentAnnounceService(deps) {
  const log = deps.log || console.log.bind(console);
  const filePath = deps.filePath;
  const maxDurationMs = deps.maxDurationMs;

  /** @type {Map<string, { cancel: (reason?: string) => void, addRemoteCandidate: (c: object | null) => void }>} */
  const active = new Map();

  /** @type {{ samples: Int16Array, sampleRate: number, channelCount: number } | null} */
  let cachedAudio = null;
  let cachedError = null;

  function loadAudio() {
    if (cachedAudio) return cachedAudio;
    if (cachedError) throw cachedError;
    try {
      cachedAudio = loadWavPcm(filePath);
      return cachedAudio;
    } catch (err) {
      cachedError = err instanceof Error ? err : new Error(String(err));
      throw cachedError;
    }
  }

  return {
    /** @param {{ absentAnnounce?: boolean } | null | undefined} subscriber */
    isEnabledFor(subscriber) {
      return Boolean(subscriber?.absentAnnounce);
    },

    isActive(nick) {
      return active.has(nick);
    },

    /**
     * @param {{
     *   nick: string,
     *   subscriber: object,
     *   softphoneOnline: boolean,
     *   jsepOffer: object,
     *   sendAccept: (jsep: object) => void,
     *   sendHangup: () => void,
     *   sendTrickle: (candidate: object | null) => void,
     *   onFinished: (reason: string) => void,
     * }} ctx
     */
    async tryHandleIncoming(ctx) {
      if (
        !shouldAnnounce({
          subscriber: ctx.subscriber,
          softphoneOnline: ctx.softphoneOnline,
          jsepOffer: ctx.jsepOffer,
        })
      ) {
        return false;
      }
      if (active.has(ctx.nick)) {
        log(`[${ctx.nick}] absent already active`);
        return false;
      }

      let audio;
      try {
        audio = loadAudio();
      } catch (err) {
        log(`[${ctx.nick}] absent wav: ${err.message || err}`);
        return false;
      }

      log(`[${ctx.nick}] absent announce start`);
      const handle = await runAbsentAnnounce({
        nick: ctx.nick,
        jsepOffer: ctx.jsepOffer,
        audio,
        maxDurationMs,
        log,
        sendAccept: ctx.sendAccept,
        sendHangup: ctx.sendHangup,
        sendTrickle: ctx.sendTrickle,
        onFinished: (reason) => {
          active.delete(ctx.nick);
          ctx.onFinished(reason);
        },
      });
      active.set(ctx.nick, handle);
      return true;
    },

    /** @param {string} nick @param {string} [reason] */
    cancel(nick, reason = "cancel") {
      const h = active.get(nick);
      if (!h) return;
      h.cancel(reason);
    },

    /** @param {string} nick @param {object | null} candidate */
    addRemoteCandidate(nick, candidate) {
      active.get(nick)?.addRemoteCandidate(candidate);
    },
  };
}
