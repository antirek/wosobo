import { ensureStyles } from "./styles.js";

const STATUS_LABELS = {
  offline: "Офлайн",
  starting: "Подъём…",
  registering: "REGISTER…",
  registered: "На линии",
  unregistering: "Снятие…",
  reconnecting: "Переподключение…",
  error: "Ошибка",
};

const CALL_LABELS = {
  idle: "Нет звонка",
  outgoing: "Исходящий…",
  incoming: "Входящий",
  incall: "Разговор",
  "reconnecting-media": "Медиа…",
  absent: "Абонент отсутствует",
};

/**
 * Floating softphone panel (wsp-* classes).
 * @param {{ nick: string, onDial: (n: string) => void, onHangup: () => void, onAccept: () => void, onDecline: () => void, onMute: (v: boolean) => void, onReconnect: () => void, onClose: () => void }} handlers
 */
export function createFloatingUi(handlers) {
  ensureStyles();

  const root = document.createElement("div");
  root.className = "wsp-root";
  root.innerHTML = `
    <div class="wsp-panel">
      <div class="wsp-header">
        <div>
          <p class="wsp-title">Wosobo Softphone</p>
          <div class="wsp-nick"></div>
        </div>
        <div class="wsp-row">
          <button type="button" class="wsp-toggle" data-act="minimize" title="Свернуть">—</button>
          <button type="button" class="wsp-toggle" data-act="close" title="Закрыть">×</button>
        </div>
      </div>
      <div class="wsp-body">
        <div class="wsp-row">
          <span class="wsp-pill wsp-status">Офлайн</span>
          <button type="button" class="wsp-btn wsp-secondary wsp-reconnect" hidden>Снова</button>
        </div>
        <p class="wsp-error" hidden></p>
        <div class="wsp-incoming" hidden>
          <span class="wsp-pill wsp-incoming wsp-call-in">Входящий</span>
          <div class="wsp-row" style="margin-top:8px">
            <button type="button" class="wsp-btn wsp-success" data-act="accept">Принять</button>
            <button type="button" class="wsp-btn wsp-danger" data-act="decline">Отклонить</button>
          </div>
        </div>
        <div class="wsp-dial">
          <span class="wsp-pill wsp-call">Нет звонка</span>
          <div class="wsp-row" style="margin-top:8px">
            <input class="wsp-input wsp-number" value="1000" placeholder="номер" />
            <button type="button" class="wsp-btn" data-act="dial">Позвонить</button>
            <button type="button" class="wsp-btn wsp-danger" data-act="hangup" hidden>Сброс</button>
          </div>
          <button type="button" class="wsp-btn wsp-secondary wsp-mute" hidden style="margin-top:6px">Mute</button>
        </div>
        <audio class="wsp-audio" autoplay playsinline></audio>
        <p class="wsp-hint">Тест: 1000 Playback, 1004 Echo</p>
        <div class="wsp-row">
          <button type="button" class="wsp-btn wsp-secondary" data-act="toggle-log">Лог</button>
        </div>
        <div class="wsp-log-panel" hidden>
          <pre class="wsp-log"></pre>
        </div>
      </div>
    </div>
  `;

  document.body.appendChild(root);

  const nickEl = root.querySelector(".wsp-nick");
  const statusEl = root.querySelector(".wsp-status");
  const callEl = root.querySelector(".wsp-call");
  const callInEl = root.querySelector(".wsp-call-in");
  const errorEl = root.querySelector(".wsp-error");
  const incomingBox = root.querySelector(".wsp-incoming");
  const dialBox = root.querySelector(".wsp-dial");
  const numberInput = /** @type {HTMLInputElement} */ (root.querySelector(".wsp-number"));
  const dialBtn = /** @type {HTMLButtonElement} */ (root.querySelector('[data-act="dial"]'));
  const hangupBtn = /** @type {HTMLButtonElement} */ (root.querySelector('[data-act="hangup"]'));
  const muteBtn = /** @type {HTMLButtonElement} */ (root.querySelector(".wsp-mute"));
  const reconnectBtn = /** @type {HTMLButtonElement} */ (root.querySelector(".wsp-reconnect"));
  const audioEl = /** @type {HTMLAudioElement} */ (root.querySelector(".wsp-audio"));
  const logPanel = /** @type {HTMLElement} */ (root.querySelector(".wsp-log-panel"));
  const logEl = /** @type {HTMLElement} */ (root.querySelector(".wsp-log"));

  nickEl.textContent = handlers.nick || "";

  let muted = false;
  let minimized = false;
  let lineStatus = "offline";
  let callState = "idle";
  /** @type {string[]} */
  const logLines = [];
  const LOG_MAX = 80;

  function pillClass(kind) {
    statusEl.classList.remove("wsp-ok", "wsp-warn", "wsp-err");
    if (kind) statusEl.classList.add(kind);
  }

  function refreshButtons() {
    const registered = lineStatus === "registered";
    const inCall =
      callState === "outgoing" ||
      callState === "incoming" ||
      callState === "incall" ||
      callState === "reconnecting-media";
    const canDial = registered && callState === "idle";
    dialBtn.disabled = !canDial;
    numberInput.disabled = !canDial;
    hangupBtn.hidden = !inCall || callState === "incoming";
    dialBtn.hidden = inCall && callState !== "incoming";
    muteBtn.hidden = !(
      callState === "incall" ||
      callState === "outgoing" ||
      callState === "reconnecting-media"
    );
    reconnectBtn.hidden = !(
      lineStatus === "offline" ||
      lineStatus === "error" ||
      lineStatus === "reconnecting"
    );
    incomingBox.hidden = callState !== "incoming";
    dialBox.hidden = callState === "incoming";
  }

  root.addEventListener("click", (ev) => {
    const t = /** @type {HTMLElement} */ (ev.target);
    const act = t.closest("[data-act]")?.getAttribute("data-act");
    if (!act) {
      if (t === reconnectBtn || t.closest(".wsp-reconnect")) {
        handlers.onReconnect();
      }
      if (t === muteBtn || t.closest(".wsp-mute")) {
        muted = !muted;
        muteBtn.textContent = muted ? "Unmute" : "Mute";
        handlers.onMute(muted);
      }
      return;
    }
    if (act === "minimize") {
      minimized = !minimized;
      root.classList.toggle("wsp-minimized", minimized);
      return;
    }
    if (act === "close") {
      handlers.onClose();
      return;
    }
    if (act === "dial") {
      handlers.onDial(numberInput.value.trim());
      return;
    }
    if (act === "hangup") {
      handlers.onHangup();
      return;
    }
    if (act === "accept") {
      handlers.onAccept();
      return;
    }
    if (act === "decline") {
      handlers.onDecline();
      return;
    }
    if (act === "toggle-log") {
      logPanel.hidden = !logPanel.hidden;
      return;
    }
  });

  // drag (capture on header so move/up land on same element)
  const header = root.querySelector(".wsp-header");
  let drag = null;

  function endDrag(ev) {
    if (!drag) return;
    drag = null;
    try {
      if (ev?.pointerId != null) header.releasePointerCapture(ev.pointerId);
    } catch {
      /* already released */
    }
  }

  header.addEventListener("pointerdown", (ev) => {
    if (ev.button !== 0) return;
    if (/** @type {HTMLElement} */ (ev.target).closest("button")) return;
    const r = root.getBoundingClientRect();
    drag = {
      ox: ev.clientX - r.left,
      oy: ev.clientY - r.top,
      pointerId: ev.pointerId,
    };
    header.setPointerCapture(ev.pointerId);
    ev.preventDefault();
  });
  header.addEventListener("pointermove", (ev) => {
    if (!drag || ev.pointerId !== drag.pointerId) return;
    root.style.left = `${Math.max(0, ev.clientX - drag.ox)}px`;
    root.style.top = `${Math.max(0, ev.clientY - drag.oy)}px`;
    root.style.right = "auto";
    root.style.bottom = "auto";
  });
  header.addEventListener("pointerup", endDrag);
  header.addEventListener("pointercancel", endDrag);
  header.addEventListener("lostpointercapture", () => {
    drag = null;
  });

  return {
    audioEl,
    setLine(status, detail) {
      lineStatus = status;
      const label = STATUS_LABELS[status] || status;
      statusEl.textContent = detail ? `${label}: ${detail}` : label;
      if (status === "registered") pillClass("wsp-ok");
      else if (status === "error") pillClass("wsp-err");
      else if (status === "reconnecting" || status === "starting" || status === "registering")
        pillClass("wsp-warn");
      else pillClass("");
      refreshButtons();
    },
    setCall(state, detail) {
      callState = state;
      const label = CALL_LABELS[state] || state;
      const text = detail ? `${label} (${detail})` : label;
      callEl.textContent = text;
      callInEl.textContent = text;
      if (state === "idle") {
        muted = false;
        muteBtn.textContent = "Mute";
      }
      refreshButtons();
    },
    setError(message) {
      if (!message) {
        errorEl.hidden = true;
        errorEl.textContent = "";
        return;
      }
      errorEl.hidden = false;
      errorEl.textContent = message;
    },
    appendLog(line) {
      const stamp = new Date().toLocaleTimeString();
      logLines.unshift(`[${stamp}] ${line}`);
      if (logLines.length > LOG_MAX) logLines.length = LOG_MAX;
      logEl.textContent = logLines.join("\n");
    },
    destroy() {
      root.remove();
    },
  };
}
