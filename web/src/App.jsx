import { useEffect, useMemo, useRef, useState } from "react";
import {
  clearStoredSession,
  createSession,
  destroySession,
  getStoredSession,
  normalizeNick,
} from "./api.js";
import { createRingtone } from "./ringtone.js";
import { connectSoftphone } from "./softphoneClient.js";

const STATUS_LABELS = {
  offline: "Офлайн",
  starting: "Подъём линии…",
  registering: "REGISTER…",
  registered: "На линии",
  unregistering: "Снятие с АТС…",
  reconnecting: "Переподключение…",
  error: "Ошибка",
};

const CALL_LABELS = {
  idle: "Нет звонка",
  outgoing: "Исходящий…",
  incoming: "Входящий",
  incall: "Разговор",
  "reconnecting-media": "Восстановление медиа…",
};

export default function App() {
  const stored = getStoredSession();
  const [nickInput, setNickInput] = useState(stored?.nick || "");
  const [nick, setNick] = useState(stored?.nick || "");
  const [token, setToken] = useState(stored?.token || "");
  const [status, setStatus] = useState("offline");
  const [statusDetail, setStatusDetail] = useState("");
  const [callState, setCallState] = useState("idle");
  const [callDetail, setCallDetail] = useState("");
  const [dialNumber, setDialNumber] = useState("1000");
  const [muted, setMuted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [logLines, setLogLines] = useState([]);
  const sessionRef = useRef(null);
  const remoteAudioRef = useRef(null);
  const ringtoneRef = useRef(null);

  const statusText = useMemo(() => {
    const base = STATUS_LABELS[status] || status;
    return statusDetail ? `${base}: ${statusDetail}` : base;
  }, [status, statusDetail]);

  const callText = useMemo(() => {
    const base = CALL_LABELS[callState] || callState;
    return callDetail ? `${base} (${callDetail})` : base;
  }, [callState, callDetail]);

  const isIncoming = callState === "incoming";
  const inCall =
    callState === "outgoing" ||
    callState === "incoming" ||
    callState === "incall" ||
    callState === "reconnecting-media";
  const canDial = status === "registered" && callState === "idle" && !busy;
  const showReconnect =
    Boolean(token) && (status === "offline" || status === "error" || status === "reconnecting");

  function appendLog(line) {
    const stamp = new Date().toLocaleTimeString();
    setLogLines((prev) => [`[${stamp}] ${line}`, ...prev].slice(0, 80));
  }

  function stopRingtone() {
    ringtoneRef.current?.stop();
  }

  function stopSoftphone() {
    stopRingtone();
    sessionRef.current?.destroy();
    sessionRef.current = null;
    if (remoteAudioRef.current) {
      remoteAudioRef.current.srcObject = null;
    }
    setCallState("idle");
    setCallDetail("");
    setMuted(false);
  }

  function startSoftphone(sessionToken) {
    stopSoftphone();
    sessionRef.current = connectSoftphone(
      {
        token: sessionToken,
        async refreshSession() {
          const stored = getStoredSession();
          const useNick = stored?.nick || nick;
          if (!useNick) throw new Error("нет ника для refresh");
          appendLog(`refresh session ${useNick}`);
          const data = await createSession(useNick);
          setToken(data.token);
          setNick(data.nick);
          return data.token;
        },
      },
      {
        onLog: appendLog,
        onLine(next, detail) {
          setStatus(next);
          setStatusDetail(detail || "");
          if (next === "registered" || next === "reconnecting") setError("");
        },
        onCall(next, detail, caller) {
          setCallState(next);
          setCallDetail(detail || caller || "");
          if (next === "idle" || next === "incoming") setMuted(false);
        },
        onIncoming(caller) {
          appendLog(`Входящий от ${caller}`);
        },
        onRemoteStream(stream) {
          const el = remoteAudioRef.current;
          if (!el) {
            appendLog("audio element missing");
            return;
          }
          el.muted = false;
          el.autoplay = true;
          el.volume = 1;
          if (el.srcObject !== stream) {
            el.srcObject = stream;
          }
          if (stream) {
            for (const t of stream.getAudioTracks()) {
              t.enabled = true;
              appendLog(
                `remote track ${t.id.slice(0, 8)}… muted=${t.muted} enabled=${t.enabled} state=${t.readyState}`,
              );
            }
            const tryPlay = () =>
              el
                .play()
                .then(() => appendLog("audio.play ok"))
                .catch((err) => appendLog(`audio.play: ${err.message || err}`));
            tryPlay();
            // после первых RTP track снимает muted — перезапускаем play
            for (const t of stream.getAudioTracks()) {
              t.addEventListener(
                "unmute",
                () => {
                  appendLog("track unmute → play");
                  tryPlay();
                },
                { once: true },
              );
            }
          }
        },
        onError(err) {
          setError(err.message);
        },
        onToken(nextToken) {
          setToken(nextToken);
        },
        onAuthLost() {
          appendLog("сессия истекла");
          stopSoftphone();
          clearStoredSession();
          setNick("");
          setToken("");
          setStatus("offline");
          setStatusDetail("");
        },
      },
    );
  }

  useEffect(() => {
    ringtoneRef.current = createRingtone();
    return () => {
      ringtoneRef.current?.stop();
      ringtoneRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (callState === "incoming") {
      ringtoneRef.current?.start().catch(() => {});
      return () => stopRingtone();
    }
    stopRingtone();
    return undefined;
  }, [callState]);

  useEffect(() => {
    if (token && nick) {
      startSoftphone(token);
    }
    return () => stopSoftphone();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function enterWithNick(rawNick) {
    const value = normalizeNick(rawNick);
    if (!value) {
      setError("Введите ник");
      return;
    }
    setError("");
    setBusy(true);
    stopSoftphone();
    try {
      const data = await createSession(value);
      setNick(data.nick);
      setNickInput(data.nick);
      setToken(data.token);
      setStatus("starting");
      appendLog(`Сессия ${data.nick}`);
      startSoftphone(data.token);
    } catch (err) {
      setError(err.message || String(err));
      clearStoredSession();
      setNick("");
      setToken("");
    } finally {
      setBusy(false);
    }
  }

  async function onLogout() {
    stopSoftphone();
    await destroySession(token);
    setNick("");
    setNickInput("");
    setToken("");
    setStatus("offline");
    setStatusDetail("");
    setError("");
  }

  function onCall(event) {
    event.preventDefault();
    setError("");
    sessionRef.current?.dial(dialNumber);
  }

  function onHangup() {
    setError("");
    sessionRef.current?.hangup();
  }

  function onAccept() {
    setError("");
    sessionRef.current?.accept();
  }

  function onDecline() {
    setError("");
    sessionRef.current?.decline();
  }

  function onToggleMute() {
    const next = !muted;
    sessionRef.current?.setMute(next);
    setMuted(next);
  }

  function onReconnect() {
    setError("");
    appendLog("ручной reconnect");
    sessionRef.current?.reconnectNow();
  }

  function onCopyLog() {
    const text = logLines.length ? logLines.join("\n") : "";
    if (!text) return;
    navigator.clipboard.writeText(text).then(
      () => appendLog("лог скопирован"),
      () => setError("Не удалось скопировать лог"),
    );
  }

  if (!nick || !token) {
    return (
      <div className="page">
        <header className="header">
          <h1>Softphone</h1>
          <p className="lede">Только ник. SIP-учётки задаются в Admin.</p>
        </header>

        <form
          className="card"
          onSubmit={(e) => {
            e.preventDefault();
            enterWithNick(nickInput);
          }}
        >
          <label>
            Ник
            <input
              autoFocus
              value={nickInput}
              onChange={(e) => setNickInput(e.target.value)}
              placeholder="alice"
              disabled={busy}
            />
          </label>
          {error ? <p className="error">{error}</p> : null}
          <button type="submit" disabled={busy}>
            Войти
          </button>
        </form>
      </div>
    );
  }

  return (
    <div className="page">
      <header className="header">
        <h1>Softphone</h1>
        <p className="lede">
          Пользователь: <strong>{nick}</strong>
        </p>
        <button type="button" className="linkish" onClick={onLogout}>
          Выйти
        </button>
      </header>

      <section className="card status-card">
        <div className={`pill status-${status}`}>{statusText}</div>
        {showReconnect ? (
          <button type="button" className="secondary" onClick={onReconnect} disabled={busy}>
            Подключить снова
          </button>
        ) : null}
      </section>

      {error ? (
        <section className="card">
          <p className="error">{error}</p>
        </section>
      ) : null}

      {isIncoming ? (
        <section className="card incoming-card">
          <h2>Входящий звонок</h2>
          <div className="pill call-incoming">{callText}</div>
          <p className="hint">Разрешите микрофон при ответе.</p>
          <div className="incoming-actions">
            <button type="button" className="success" onClick={onAccept}>
              Принять
            </button>
            <button type="button" className="danger" onClick={onDecline}>
              Отклонить
            </button>
          </div>
        </section>
      ) : null}

      <section className="card">
        <h2>Звонок</h2>
        <p className="hint">
          Тест: <code>1000</code> Playback, <code>1004</code> Echo, <code>1002</code> → bob.
        </p>
        <div className={`pill call-${callState}`}>{callText}</div>

        <form className="dial-row" onSubmit={onCall}>
          <label className="dial-field">
            Номер
            <input
              value={dialNumber}
              onChange={(e) => setDialNumber(e.target.value)}
              placeholder="1000"
              disabled={!canDial}
            />
          </label>
          {!inCall ? (
            <button type="submit" disabled={!canDial || !dialNumber.trim()}>
              Позвонить
            </button>
          ) : (
            <button type="button" className="danger" onClick={onHangup}>
              Сбросить
            </button>
          )}
        </form>

        {(callState === "incall" || callState === "outgoing" || callState === "reconnecting-media") && (
          <button type="button" className="secondary" onClick={onToggleMute}>
            {muted ? "Включить микрофон" : "Mute"}
          </button>
        )}

        <audio ref={remoteAudioRef} autoPlay playsInline controls style={{ width: "100%", marginTop: "0.75rem" }} />
      </section>

      <section className="card">
        <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
          <h2 style={{ margin: 0 }}>Лог</h2>
          <button type="button" className="secondary" onClick={onCopyLog} disabled={!logLines.length}>
            Копировать
          </button>
        </div>
        <pre className="log">{logLines.length ? logLines.join("\n") : "Пока пусто"}</pre>
      </section>
    </div>
  );
}
