import { softphoneWsUrl } from "./api.js";

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

/**
 * Softphone signaling + WebRTC client (no SIP credentials, no Janus WS).
 *
 * @param {{ token: string }} opts
 * @param {{
 *   onLog?: (line: string) => void,
 *   onLine?: (status: string, detail?: string) => void,
 *   onCall?: (state: string, detail?: string, caller?: string) => void,
 *   onIncoming?: (caller: string, jsep?: object) => void,
 *   onRemoteStream?: (stream: MediaStream | null) => void,
 *   onError?: (err: Error) => void,
 * }} callbacks
 */
export function connectSoftphone(opts, callbacks = {}) {
  const log = (line) => callbacks.onLog?.(line);
  let ws = null;
  let closed = false;
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

  async function ensurePc() {
    if (pc) return pc;
    pc = new RTCPeerConnection({
      iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
    });
    pc.onicecandidate = (ev) => {
      if (closed || !trickleEnabled) return;
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
      log(`pc state: ${pc?.connectionState}`);
      if (pc?.connectionState === "failed") {
        callbacks.onError?.(new Error("WebRTC connection failed (ICE)"));
      }
    };
    pc.oniceconnectionstatechange = () => {
      log(`ice: ${pc?.iceConnectionState}`);
    };
    return pc;
  }

  async function ensureMic() {
    if (localStream) return localStream;
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
    cleanupPc();
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

  function openWs() {
    const url = softphoneWsUrl(opts.token);
    log(`WS ${url.replace(/token=[^&]+/, "token=…")}`);
    ws = new WebSocket(url);
    ws.onopen = () => log("signaling connected");
    ws.onclose = (ev) => {
      log(`signaling closed ${ev.code}`);
      if (!closed) {
        callbacks.onLine?.("offline", "signaling closed");
      }
    };
    ws.onerror = () => {
      callbacks.onError?.(new Error("WebSocket error"));
    };
    ws.onmessage = async (ev) => {
      let msg;
      try {
        msg = JSON.parse(String(ev.data));
      } catch {
        return;
      }
      const type = msg.type;
      if (type === "hello") {
        if (msg.line?.status) callbacks.onLine?.(msg.line.status, msg.line.detail);
        if (msg.call?.state) callbacks.onCall?.(msg.call.state, msg.call.detail, msg.call.caller);
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
          cleanupPc();
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
        } catch (err) {
          callbacks.onError?.(err instanceof Error ? err : new Error(String(err)));
        }
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

  openWs();

  return {
    async dial(number) {
      if (phase !== "idle") {
        callbacks.onError?.(new Error("Уже есть звонок"));
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

    destroy() {
      closed = true;
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
