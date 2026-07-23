import { softphoneWsUrl } from "./api.js";

const PING_MS = 20_000;
const ICE_DISCONNECT_MS = 5_000;
const ICE_RESTART_TIMEOUT_MS = 12_000;
const BACKOFF_MS = [1000, 2000, 5000, 10_000, 30_000];
/**
 * @param {RTCPeerConnection} pc
 * @param {number} [timeoutMs]
 */
function waitIceGatheringComplete(pc, timeoutMs = 2500) {
  if (pc.iceGatheringState === "complete") {
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    const done = () => {
      pc.removeEventListener("icegatheringstatechange", onChange);
      clearTimeout(timer);
      resolve();
    };
    const onChange = () => {
      if (pc.iceGatheringState === "complete") done();
    };
    const timer = setTimeout(done, timeoutMs);
    pc.addEventListener("icegatheringstatechange", onChange);
  });
}

function jitteredDelay(ms) {
  return ms + Math.floor(Math.random() * Math.min(400, ms * 0.2));
}

/**
 * Softphone signaling + WebRTC client (no SIP credentials, no Janus WS).
 *
 * @param {{
 *   token: string,
 *   nick: string,
 *   refreshSession?: () => Promise<string>,
 * }} opts
 * @param {{
 *   onLog?: (line: string) => void,
 *   onLine?: (status: string, detail?: string) => void,
 *   onCall?: (state: string, detail?: string, caller?: string) => void,
 *   onIncoming?: (caller: string, jsep?: object) => void,
 *   onRemoteStream?: (stream: MediaStream | null) => void,
 *   onError?: (err: Error) => void,
 *   onAuthLost?: () => void,
 *   onToken?: (token: string) => void,
 * }} callbacks
 */
export function connectSoftphone(opts, callbacks = {}) {
  const log = (line) => callbacks.onLog?.(line);
  let currentToken = opts.token;
  let currentNick = opts.nick;
  /** @type {WebSocket | null} */
  let ws = null;
  let wantConnected = true;
  let closed = false;
  let reconnectAttempt = 0;
  let sessionRefreshInFlight = false;
  /** @type {ReturnType<typeof setTimeout> | null} */
  let reconnectTimer = null;
  /** @type {ReturnType<typeof setInterval> | null} */
  let pingTimer = null;
  /** @type {ReturnType<typeof setTimeout> | null} */
  let iceDisconnectTimer = null;
  /** @type {ReturnType<typeof setTimeout> | null} */
  let iceRestartTimer = null;
  let iceRestartTried = false;
  let iceRestartInFlight = false;
  /** @type {RTCPeerConnection | null} */
  let pc = null;
  /** @type {MediaStream | null} */
  let localStream = null;
  /** @type {MediaStream | null} */
  let remoteStream = null;
  let muted = false;
  /** @type {'idle'|'outgoing'|'incoming'|'incall'} */
  let phase = "idle";
  /** @type {object | null} */
  let pendingOffer = null;
  /** @type {RTCIceCandidateInit[]} */
  let pendingRemoteCandidates = [];
  /** Не шлём trickle, пока Janus не получил SDP */
  let trickleEnabled = false;

  function send(obj) {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify(obj));
  }

  function clearRemote() {
    remoteStream = null;
    callbacks.onRemoteStream?.(null);
  }

  function stopPing() {
    if (pingTimer) {
      clearInterval(pingTimer);
      pingTimer = null;
    }
  }

  function startPing() {
    stopPing();
    pingTimer = setInterval(() => {
      send({ type: "ping" });
    }, PING_MS);
  }

  function clearReconnectTimer() {
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
  }

  function clearIceDisconnectTimer() {
    if (iceDisconnectTimer) {
      clearTimeout(iceDisconnectTimer);
      iceDisconnectTimer = null;
    }
  }

  function clearIceRestartTimer() {
    if (iceRestartTimer) {
      clearTimeout(iceRestartTimer);
      iceRestartTimer = null;
    }
  }

  function localCallCleanup(reason) {
    clearIceDisconnectTimer();
    clearIceRestartTimer();
    iceRestartInFlight = false;
    iceRestartTried = false;
    if (phase === "idle" && !pc) return;
    log(`local call cleanup${reason ? `: ${reason}` : ""}`);
    phase = "idle";
    pendingOffer = null;
    cleanupPc();
    callbacks.onCall?.("idle", reason);
  }

  function hangupDueToMedia(reason) {
    const msg = reason || "Связь потеряна";
    log(msg);
    send({ type: "hangup" });
    localCallCleanup(msg);
    callbacks.onError?.(new Error(msg));
  }

  /**
   * One ICE restart per call via Janus SIP `update`.
   * @returns {Promise<boolean>} true if restart was started
   */
  async function tryIceRestart(reason) {
    if (iceRestartTried || iceRestartInFlight) return false;
    if (phase !== "incall" && phase !== "outgoing") return false;
    if (!pc || !ws || ws.readyState !== WebSocket.OPEN) return false;

    iceRestartTried = true;
    iceRestartInFlight = true;
    clearIceDisconnectTimer();
    log(`ICE restart: ${reason || "media recovery"}`);
    callbacks.onCall?.("reconnecting-media", reason || "ICE restart");

    clearIceRestartTimer();
    iceRestartTimer = setTimeout(() => {
      iceRestartTimer = null;
      if (iceRestartInFlight) {
        iceRestartInFlight = false;
        hangupDueToMedia("Связь потеряна (ICE restart timeout)");
      }
    }, ICE_RESTART_TIMEOUT_MS);

    try {
      trickleEnabled = false;
      pendingRemoteCandidates = [];
      const offer = await pc.createOffer({ iceRestart: true, offerToReceiveAudio: true });
      await pc.setLocalDescription(offer);
      const jsep = await finalizeLocalJsep(offer);
      send({ type: "update", jsep });
      trickleEnabled = true;
      return true;
    } catch (err) {
      iceRestartInFlight = false;
      clearIceRestartTimer();
      log(`ICE restart failed: ${err.message || err}`);
      hangupDueToMedia("Связь потеряна (ICE restart failed)");
      return false;
    }
  }

  function onMediaAtRisk(reason) {
    if (phase !== "incall" && phase !== "outgoing") return;
    if (iceRestartInFlight) return;
    tryIceRestart(reason).then((started) => {
      if (!started && (phase === "incall" || phase === "outgoing")) {
        hangupDueToMedia(reason || "Связь потеряна");
      }
    });
  }

  function onMediaRecovered() {
    clearIceDisconnectTimer();
    if (iceRestartInFlight) {
      iceRestartInFlight = false;
      clearIceRestartTimer();
      log("ICE recovered after restart");
      phase = "incall";
      callbacks.onCall?.("incall", "media ok");
    }
  }

  async function ensurePc() {
    if (pc) return pc;
    pc = new RTCPeerConnection({
      iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
    });
    pc.onicecandidate = (ev) => {
      if (closed || !trickleEnabled || ws?.readyState !== WebSocket.OPEN) return;
      if (!ev.candidate) {
        send({ type: "trickle", candidate: null });
        return;
      }
      const c = ev.candidate.toJSON();
      send({
        type: "trickle",
        candidate: {
          candidate: c.candidate,
          sdpMid: c.sdpMid,
          sdpMLineIndex: c.sdpMLineIndex,
          usernameFragment: c.usernameFragment,
        },
      });
    };
    pc.ontrack = (ev) => {
      if (closed) return;
      const track = ev.track;
      if (!track || track.kind !== "audio") return;
      log(`ontrack audio streams=${ev.streams?.length || 0} muted=${track.muted}`);

      const stream = ev.streams?.[0] || new MediaStream([track]);
      remoteStream = stream;
      if (!stream.getAudioTracks().includes(track)) {
        stream.addTrack(track);
      }

      const pushStream = () => callbacks.onRemoteStream?.(remoteStream);
      track.onunmute = () => {
        log(`remote track unmuted`);
        pushStream();
      };
      track.onmute = () => {
        log(`remote track muted again`);
      };
      pushStream();
    };
    pc.onconnectionstatechange = () => {
      const state = pc?.connectionState;
      log(`pc state: ${state}`);
      if (state === "connected") {
        onMediaRecovered();
        return;
      }
      if (state === "failed") {
        onMediaAtRisk("WebRTC failed");
      }
    };
    pc.oniceconnectionstatechange = () => {
      const state = pc?.iceConnectionState;
      log(`ice: ${state}`);
      if (state === "connected" || state === "completed") {
        onMediaRecovered();
        return;
      }
      if (state === "failed") {
        onMediaAtRisk("ICE failed");
        return;
      }
      if (state === "disconnected") {
        clearIceDisconnectTimer();
        iceDisconnectTimer = setTimeout(() => {
          iceDisconnectTimer = null;
          if (
            pc &&
            (pc.iceConnectionState === "disconnected" || pc.iceConnectionState === "failed")
          ) {
            onMediaAtRisk("ICE disconnected");
          }
        }, ICE_DISCONNECT_MS);
      }
    };
    return pc;
  }

  async function ensureMic() {
    if (localStream) return localStream;
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error(
        "Микрофон недоступен: откройте softphone по https://service/softphone/ или http://localhost/softphone/ (нужен secure context)",
      );
    }
    localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    return localStream;
  }

  async function addLocalAudio() {
    const stream = await ensureMic();
    const peer = await ensurePc();
    for (const track of stream.getAudioTracks()) {
      const existing = peer.getSenders().find((s) => s.track?.kind === "audio");
      if (existing) {
        await existing.replaceTrack(track);
      } else {
        peer.addTrack(track, stream);
      }
      track.enabled = !muted;
    }
  }

  function cleanupPc() {
    clearIceDisconnectTimer();
    clearIceRestartTimer();
    iceRestartInFlight = false;
    trickleEnabled = false;
    pendingRemoteCandidates = [];
    try {
      pc?.getSenders().forEach((s) => {
        try {
          s.track?.stop();
        } catch {
          /* ignore */
        }
      });
      pc?.close();
    } catch {
      /* ignore */
    }
    pc = null;
    if (localStream) {
      for (const t of localStream.getTracks()) t.stop();
      localStream = null;
    }
    clearRemote();
  }

  function resetCallLocal() {
    phase = "idle";
    pendingOffer = null;
    iceRestartTried = false;
    iceRestartInFlight = false;
    cleanupPc();
  }

  /** Answer remote SIP re-INVITE */
  async function answerUpdatingCall(jsepOffer) {
    try {
      log("answering remote re-INVITE");
      trickleEnabled = false;
      await ensurePc();
      if (jsepOffer) await applyRemoteJsep(jsepOffer);
      const peer = await ensurePc();
      const answer = await peer.createAnswer();
      await peer.setLocalDescription(answer);
      const jsep = await finalizeLocalJsep(answer);
      send({ type: "update", jsep });
      trickleEnabled = true;
      phase = "incall";
      callbacks.onCall?.("incall", "re-INVITE ok");
    } catch (err) {
      callbacks.onError?.(err instanceof Error ? err : new Error(String(err)));
      hangupDueToMedia("Не удалось ответить на re-INVITE");
    }
  }

  /** @param {RTCIceCandidateInit | null | undefined} candidate */
  async function addRemoteCandidate(candidate) {
    if (!candidate || candidate.completed) return;
    const peer = await ensurePc();
    if (!peer.remoteDescription) {
      pendingRemoteCandidates.push(candidate);
      return;
    }
    try {
      await peer.addIceCandidate(candidate);
    } catch (err) {
      log(`addIceCandidate: ${err.message || err}`);
    }
  }

  async function flushRemoteCandidates() {
    const peer = pc;
    if (!peer?.remoteDescription) return;
    const queued = pendingRemoteCandidates;
    pendingRemoteCandidates = [];
    for (const c of queued) {
      try {
        await peer.addIceCandidate(c);
      } catch (err) {
        log(`flush candidate: ${err.message || err}`);
      }
    }
  }

  async function applyRemoteJsep(jsep) {
    if (!jsep?.sdp) return;
    const peer = await ensurePc();
    const desc = {
      type: jsep.type || "answer",
      sdp: jsep.sdp,
    };
    if (peer.signalingState === "stable" && peer.remoteDescription && desc.type === "answer") {
      log(`skip duplicate remote answer (already ${peer.remoteDescription.type})`);
      return;
    }
    const dir = (desc.sdp.match(/^a=(sendrecv|sendonly|recvonly|inactive)/m) || [])[1] || "?";
    log(`setRemoteDescription ${desc.type} (${desc.sdp.length} bytes) state=${peer.signalingState} dir=${dir}`);
    await peer.setRemoteDescription(desc);
    await flushRemoteCandidates();
  }

  async function finalizeLocalJsep(local) {
    const peer = await ensurePc();
    await waitIceGatheringComplete(peer);
    const finalDesc = peer.localDescription || local;
    log(`ICE gathering=${peer.iceGatheringState}, local sdp ${finalDesc.sdp?.length || 0} bytes`);
    return {
      type: finalDesc.type,
      sdp: finalDesc.sdp,
      trickle: true,
    };
  }

  async function handleIncoming(caller, jsep) {
    phase = "incoming";
    pendingOffer = jsep || null;
    pendingRemoteCandidates = [];
    trickleEnabled = false;
    callbacks.onIncoming?.(caller, jsep);
    callbacks.onCall?.("incoming", undefined, caller);
  }

  function scheduleReconnect(reason) {
    if (!wantConnected || closed) return;
    clearReconnectTimer();
    const idx = Math.min(reconnectAttempt, BACKOFF_MS.length - 1);
    const delay = jitteredDelay(BACKOFF_MS[idx]);
    reconnectAttempt += 1;
    callbacks.onLine?.("reconnecting", reason || `попытка ${reconnectAttempt}`);
    log(`WSS reconnect in ${delay}ms (${reason || "retry"} #${reconnectAttempt})`);
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      if (!wantConnected || closed) return;
      openWs();
    }, delay);
  }

  async function refreshSessionAndReconnect() {
    if (!wantConnected || closed) return;
    if (!opts.refreshSession) {
      wantConnected = false;
      callbacks.onError?.(new Error("Сессия истекла — войдите снова"));
      callbacks.onAuthLost?.();
      callbacks.onLine?.("offline", "unauthorized");
      return;
    }
    if (sessionRefreshInFlight) return;
    sessionRefreshInFlight = true;
    callbacks.onLine?.("reconnecting", "обновление сессии");
    log("session unauthorized → refresh token");
    try {
      const newToken = await opts.refreshSession();
      if (!newToken) throw new Error("empty token");
      currentToken = newToken;
      callbacks.onToken?.(newToken);
      reconnectAttempt = 0;
      scheduleReconnect("session refreshed");
    } catch (err) {
      log(`session refresh failed: ${err.message || err}`);
      wantConnected = false;
      callbacks.onError?.(new Error("Сессия истекла — войдите снова"));
      callbacks.onAuthLost?.();
      callbacks.onLine?.("offline", "unauthorized");
    } finally {
      sessionRefreshInFlight = false;
    }
  }

  function openWs() {
    if (!wantConnected || closed) return;
    clearReconnectTimer();
    stopPing();

    const prev = ws;
    ws = null;
    if (prev) {
      try {
        prev.onopen = null;
        prev.onclose = null;
        prev.onerror = null;
        prev.onmessage = null;
        prev.close();
      } catch {
        /* ignore */
      }
    }

    const url = softphoneWsUrl(currentToken, currentNick);
    log(`WS ${url.replace(/token=[^&]+/, "token=…")}`);
    const socket = new WebSocket(url);
    ws = socket;

    socket.onopen = () => {
      if (ws !== socket) return;
      log("signaling connected");
      reconnectAttempt = 0;
      startPing();
    };

    socket.onclose = (ev) => {
      if (ws !== socket && ws !== null) return;
      stopPing();
      ws = null;
      log(`signaling closed ${ev.code} ${ev.reason || ""}`.trim());

      localCallCleanup("signaling closed");

      if (!wantConnected || closed) {
        callbacks.onLine?.("offline", "signaling closed");
        return;
      }

      if (ev.code === 4001) {
        refreshSessionAndReconnect();
        return;
      }

      if (ev.code === 4003) {
        wantConnected = false;
        callbacks.onError?.(new Error("Уже открыта другая вкладка softphone"));
        callbacks.onLine?.("offline", ev.reason || `closed ${ev.code}`);
        return;
      }

      // 4002 no_line — API ещё поднимает REGISTER после рестарта
      scheduleReconnect(ev.reason || `code ${ev.code}`);
    };

    socket.onerror = () => {
      if (ws !== socket) return;
      log("WebSocket error");
    };

    socket.onmessage = async (ev) => {
      if (ws !== socket) return;
      let msg;
      try {
        msg = JSON.parse(String(ev.data));
      } catch {
        return;
      }
      const type = msg.type;
      if (type === "hello") {
        if (msg.line?.status) callbacks.onLine?.(msg.line.status, msg.line.detail);
        if (msg.call?.state) {
          phase = msg.call.state;
          callbacks.onCall?.(msg.call.state, msg.call.detail, msg.call.caller);
          if (msg.call.state === "idle") {
            pendingOffer = null;
            cleanupPc();
          }
        }
        return;
      }
      if (type === "line") {
        callbacks.onLine?.(msg.status, msg.detail);
        return;
      }
      if (type === "call") {
        phase = msg.state;
        callbacks.onCall?.(msg.state, msg.detail, msg.caller);
        if (msg.state === "idle") {
          pendingOffer = null;
          iceRestartTried = false;
          iceRestartInFlight = false;
          cleanupPc();
        } else if (msg.state === "incall" && iceRestartInFlight) {
          // server confirmed update finished; wait for ICE connected for full clear
          log("call incall during ICE restart");
        }
        return;
      }
      if (type === "incoming") {
        await handleIncoming(msg.caller || "unknown", msg.jsep);
        return;
      }
      if (type === "jsep") {
        try {
          await applyRemoteJsep(msg.jsep);
          if (iceRestartInFlight) {
            log("got remote jsep during ICE restart");
          }
        } catch (err) {
          callbacks.onError?.(err instanceof Error ? err : new Error(String(err)));
        }
        return;
      }
      if (type === "updatingcall") {
        await answerUpdatingCall(msg.jsep);
        return;
      }
      if (type === "trickle") {
        await addRemoteCandidate(msg.candidate);
        return;
      }
      if (type === "error") {
        callbacks.onError?.(new Error(msg.message || msg.code || "error"));
        return;
      }
      if (type === "log") {
        log(msg.message || "");
        return;
      }
      if (type === "pong") return;
    };
  }

  function onBrowserOnline() {
    if (!wantConnected || closed) return;
    log("browser online");
    if (!ws || ws.readyState === WebSocket.CLOSING || ws.readyState === WebSocket.CLOSED) {
      clearReconnectTimer();
      reconnectAttempt = 0;
      openWs();
    }
  }

  function onBrowserOffline() {
    log("browser offline");
    callbacks.onLine?.("reconnecting", "нет сети");
  }

  function onVisibility() {
    if (document.visibilityState !== "visible") return;
    if (!wantConnected || closed) return;
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      log("tab visible → ensure WSS");
      clearReconnectTimer();
      openWs();
    } else {
      send({ type: "ping" });
    }
  }

  openWs();
  window.addEventListener("online", onBrowserOnline);
  window.addEventListener("offline", onBrowserOffline);
  document.addEventListener("visibilitychange", onVisibility);

  return {
    async dial(number) {
      if (phase !== "idle") {
        callbacks.onError?.(new Error("Уже есть звонок"));
        return;
      }
      if (!ws || ws.readyState !== WebSocket.OPEN) {
        callbacks.onError?.(new Error("Нет signaling — ждём переподключения"));
        return;
      }
      try {
        phase = "outgoing";
        callbacks.onCall?.("outgoing", number);
        pendingRemoteCandidates = [];
        trickleEnabled = false;
        await addLocalAudio();
        const peer = await ensurePc();
        const offer = await peer.createOffer({ offerToReceiveAudio: true });
        await peer.setLocalDescription(offer);
        const jsep = await finalizeLocalJsep(offer);
        send({ type: "dial", number, jsep });
        trickleEnabled = true;
      } catch (err) {
        resetCallLocal();
        callbacks.onCall?.("idle");
        callbacks.onError?.(err instanceof Error ? err : new Error(String(err)));
      }
    },

    async accept() {
      if (phase !== "incoming") {
        callbacks.onError?.(new Error("Нет входящего"));
        return;
      }
      try {
        trickleEnabled = false;
        await addLocalAudio();
        const peer = await ensurePc();
        let localJsep;
        if (pendingOffer) {
          await applyRemoteJsep(pendingOffer);
          localJsep = await peer.createAnswer();
        } else {
          localJsep = await peer.createOffer({ offerToReceiveAudio: true });
        }
        await peer.setLocalDescription(localJsep);
        const jsep = await finalizeLocalJsep(localJsep);
        phase = "incall";
        send({ type: "accept", jsep });
        trickleEnabled = true;
        callbacks.onCall?.("incall");
        pendingOffer = null;
      } catch (err) {
        send({ type: "decline" });
        resetCallLocal();
        callbacks.onCall?.("idle");
        callbacks.onError?.(err instanceof Error ? err : new Error(String(err)));
      }
    },

    decline() {
      send({ type: "decline" });
      resetCallLocal();
      callbacks.onCall?.("idle");
    },

    hangup() {
      send({ type: "hangup" });
      resetCallLocal();
      callbacks.onCall?.("idle");
    },

    setMute(next) {
      muted = Boolean(next);
      if (localStream) {
        for (const t of localStream.getAudioTracks()) {
          t.enabled = !muted;
        }
      }
    },

    /** Manual resume after give-up / user request */
    reconnectNow() {
      if (closed) return;
      wantConnected = true;
      clearReconnectTimer();
      reconnectAttempt = 0;
      callbacks.onLine?.("reconnecting", "вручную");
      openWs();
    },

    destroy() {
      closed = true;
      wantConnected = false;
      clearReconnectTimer();
      stopPing();
      clearIceDisconnectTimer();
      clearIceRestartTimer();
      window.removeEventListener("online", onBrowserOnline);
      window.removeEventListener("offline", onBrowserOffline);
      document.removeEventListener("visibilitychange", onVisibility);
      try {
        if (phase !== "idle") send({ type: "hangup" });
      } catch {
        /* ignore */
      }
      resetCallLocal();
      try {
        ws?.close();
      } catch {
        /* ignore */
      }
      ws = null;
    },
  };
}
