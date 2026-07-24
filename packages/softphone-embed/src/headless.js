import { connectSoftphone } from "./softphoneClient.js";
import { createRingtone } from "./ringtone.js";

/**
 * @typedef {{
 *   token: string,
 *   nick: string,
 *   wsBase?: string,
 *   iceServers?: RTCIceServer[],
 *   playRingtone?: boolean,
 *   onReady?: () => void,
 *   onLine?: (status: string, detail?: string) => void,
 *   onCall?: (state: string, detail?: string, caller?: string) => void,
 *   onIncoming?: (caller: string, meta?: { jsep?: object }) => void,
 *   onRemoteStream?: (stream: MediaStream | null) => void,
 *   onAuthLost?: () => void,
 *   onError?: (err: Error) => void,
 *   onLog?: (line: string) => void,
 * }} ConnectOptions
 */

/** @type {{
 *   session: ReturnType<typeof connectSoftphone>,
 *   audioEl: HTMLAudioElement,
 *   ringtone: ReturnType<typeof createRingtone> | null,
 * } | null} */
let active = null;

function normalizeNick(nick) {
  return String(nick || "")
    .trim()
    .toLowerCase();
}

function ensureHiddenAudio() {
  const el = document.createElement("audio");
  el.autoplay = true;
  el.setAttribute("playsinline", "");
  el.setAttribute("aria-hidden", "true");
  el.style.cssText = "position:fixed;width:0;height:0;opacity:0;pointer-events:none;";
  document.documentElement.appendChild(el);
  return el;
}

/**
 * Headless softphone: WSS + WebRTC, no floating UI.
 * Singleton — повторный connect() заменяет предыдущий.
 * @param {ConnectOptions} opts
 */
function connect(opts) {
  if (!opts?.token || !opts?.nick) {
    throw new Error("WosoboSoftphoneHeadless.connect: нужны token и nick");
  }
  if (typeof window !== "undefined" && !window.isSecureContext) {
    throw new Error("WosoboSoftphoneHeadless: нужен secure context (HTTPS или localhost)");
  }

  disconnect();

  const nick = normalizeNick(opts.nick);
  const token = String(opts.token).trim();
  const playRingtone = Boolean(opts.playRingtone);
  const ringtone = playRingtone ? createRingtone() : null;
  const audioEl = ensureHiddenAudio();

  const session = connectSoftphone(
    {
      token,
      nick,
      wsBase: opts.wsBase,
      iceServers: opts.iceServers,
    },
    {
      onLog(line) {
        opts.onLog?.(line);
      },
      onLine(status, detail) {
        opts.onLine?.(status, detail);
      },
      onCall(state, detail, caller) {
        if (ringtone) {
          if (state === "incoming") {
            ringtone.start().catch(() => {});
          } else {
            ringtone.stop();
          }
        }
        opts.onCall?.(state, detail, caller);
      },
      onIncoming(caller, jsep) {
        opts.onIncoming?.(caller, jsep ? { jsep } : undefined);
      },
      onRemoteStream(stream) {
        audioEl.srcObject = stream;
        if (stream) {
          audioEl.play().catch(() => {});
        }
        opts.onRemoteStream?.(stream);
      },
      onError(err) {
        opts.onError?.(err);
      },
      onAuthLost() {
        opts.onAuthLost?.();
      },
    },
  );

  active = { session, audioEl, ringtone };
  opts.onReady?.();

  return {
    dial(number) {
      return session.dial(number);
    },
    accept() {
      return session.accept();
    },
    decline() {
      session.decline();
    },
    hangup() {
      session.hangup();
    },
    setMute(muted) {
      session.setMute(muted);
    },
    reconnect() {
      session.reconnectNow();
    },
    disconnect,
    getState() {
      return session.getState();
    },
  };
}

function disconnect() {
  if (!active) return;
  try {
    active.ringtone?.stop();
  } catch {
    /* ignore */
  }
  try {
    active.session.destroy();
  } catch {
    /* ignore */
  }
  try {
    active.audioEl.srcObject = null;
    active.audioEl.remove();
  } catch {
    /* ignore */
  }
  active = null;
}

const WosoboSoftphoneHeadless = {
  connect,
  disconnect,
  version: "0.2.0",
};

export default WosoboSoftphoneHeadless;
