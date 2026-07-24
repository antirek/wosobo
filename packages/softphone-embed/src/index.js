import { connectSoftphone } from "./softphoneClient.js";
import { createRingtone } from "./ringtone.js";
import { ensureStyles, removeStyles } from "./styles.js";
import { createFloatingUi } from "./ui.js";

/**
 * @typedef {{
 *   token: string,
 *   nick: string,
 *   wsBase?: string,
 *   onLine?: (status: string, detail?: string) => void,
 *   onCall?: (state: string, detail?: string, caller?: string) => void,
 *   onIncoming?: (caller: string) => void,
 *   onError?: (err: Error) => void,
 *   onLog?: (line: string) => void,
 *   onAuthLost?: () => void,
 *   onReady?: () => void,
 * }} MountOptions
 */

/** @type {{ session: ReturnType<typeof connectSoftphone> | null, ui: ReturnType<typeof createFloatingUi> | null, ringtone: ReturnType<typeof createRingtone> | null } | null} */
let active = null;

function normalizeNick(nick) {
  return String(nick || "")
    .trim()
    .toLowerCase();
}

/**
 * Mount floating softphone widget and connect signaling.
 * @param {MountOptions} opts
 */
function mount(opts) {
  if (!opts?.token || !opts?.nick) {
    throw new Error("WosoboSoftphone.mount: нужны token и nick");
  }
  if (typeof window !== "undefined" && !window.isSecureContext) {
    throw new Error("WosoboSoftphone: нужен secure context (HTTPS или localhost)");
  }

  unmount();
  ensureStyles();

  const nick = normalizeNick(opts.nick);
  const token = String(opts.token).trim();
  const ringtone = createRingtone();

  const ui = createFloatingUi({
    nick,
    onDial(number) {
      void active?.session?.dial(number).catch(() => {});
    },
    onHangup() {
      active?.session?.hangup();
    },
    onAccept() {
      void active?.session?.accept().catch(() => {});
    },
    onDecline() {
      active?.session?.decline();
    },
    onMute(v) {
      active?.session?.setMute(v);
    },
    onReconnect() {
      active?.session?.reconnectNow();
    },
    onClose() {
      unmount();
    },
  });

  ui.setLine("starting");

  const session = connectSoftphone(
    { token, nick, wsBase: opts.wsBase },
    {
      onLog(line) {
        ui.appendLog(line);
        opts.onLog?.(line);
      },
      onLine(status, detail) {
        ui.setLine(status, detail);
        if (status === "registered" || status === "reconnecting") ui.setError("");
        opts.onLine?.(status, detail);
      },
      onCall(state, detail, caller) {
        ui.setCall(state, detail || caller);
        if (state === "incall" || state === "accepting" || state === "idle") {
          ui.setError("");
        }
        if (state === "incoming") {
          ringtone.start().catch(() => {});
        } else {
          ringtone.stop();
        }
        opts.onCall?.(state, detail, caller);
      },
      onIncoming(caller) {
        opts.onIncoming?.(caller);
      },
      onRemoteStream(stream) {
        const el = ui.audioEl;
        el.srcObject = stream;
        if (stream) {
          el.play().catch(() => {});
        }
      },
      onError(err) {
        ui.setError(err.message || String(err));
        ui.appendLog(`error ${err.message || err}`);
        opts.onError?.(err);
      },
      onAuthLost() {
        ui.setError("Сессия истекла — mint новый token");
        ui.setLine("offline", "unauthorized");
        ui.appendLog("auth lost");
        opts.onAuthLost?.();
      },
    },
  );

  active = { session, ui, ringtone };
  ui.appendLog(`mounted ${nick}`);
  opts.onReady?.();
  return {
    unmount,
    reconnect() {
      session.reconnectNow();
    },
  };
}

function unmount() {
  if (!active) {
    removeStyles();
    return;
  }
  try {
    active.ringtone?.stop();
  } catch {
    /* ignore */
  }
  try {
    active.session?.destroy();
  } catch {
    /* ignore */
  }
  try {
    active.ui?.destroy();
  } catch {
    /* ignore */
  }
  active = null;
  removeStyles();
}

function reconnect() {
  active?.session?.reconnectNow();
}

const WosoboSoftphone = {
  mount,
  unmount,
  reconnect,
  version: "0.2.0",
};

export default WosoboSoftphone;
