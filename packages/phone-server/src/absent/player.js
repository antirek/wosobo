import wrtc from "@roamhq/wrtc";

const { RTCPeerConnection, nonstandard } = wrtc;
const { RTCAudioSource } = nonstandard;

const TARGET_RATE = 48000;
const FRAME_MS = 10;
const TRAIL_SILENCE_MS = 400;

/**
 * @param {RTCPeerConnection} pc
 * @param {number} [timeoutMs]
 */
function waitIceGatheringComplete(pc, timeoutMs = 2500) {
  if (pc.iceGatheringState === "complete") return Promise.resolve();
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
 * Linear resample mono s16 → TARGET_RATE.
 * @param {Int16Array} samples
 * @param {number} sampleRate
 * @param {number} channelCount
 */
function toMono48k(samples, sampleRate, channelCount) {
  const mono =
    channelCount === 1
      ? samples
      : (() => {
          const out = new Int16Array(Math.floor(samples.length / channelCount));
          for (let i = 0; i < out.length; i++) {
            let sum = 0;
            for (let c = 0; c < channelCount; c++) sum += samples[i * channelCount + c];
            out[i] = (sum / channelCount) | 0;
          }
          return out;
        })();

  if (sampleRate === TARGET_RATE) return mono;
  const outLen = Math.floor((mono.length * TARGET_RATE) / sampleRate);
  const out = new Int16Array(outLen);
  const ratio = sampleRate / TARGET_RATE;
  for (let i = 0; i < outLen; i++) {
    const src = i * ratio;
    const i0 = Math.floor(src);
    const i1 = Math.min(i0 + 1, mono.length - 1);
    const frac = src - i0;
    out[i] = (mono[i0] * (1 - frac) + mono[i1] * frac) | 0;
  }
  return out;
}

/**
 * @param {{
 *   nick: string,
 *   jsepOffer: object,
 *   audio: { samples: Int16Array, sampleRate: number, channelCount: number },
 *   maxDurationMs: number,
 *   log: (line: string) => void,
 *   sendAccept: (jsep: object) => void,
 *   sendHangup: () => void,
 *   sendTrickle: (candidate: object | null) => void,
 *   onFinished: (reason: string) => void,
 * }} opts
 */
export async function runAbsentAnnounce(opts) {
  const {
    nick,
    jsepOffer,
    audio,
    maxDurationMs,
    log,
    sendAccept,
    sendHangup,
    sendTrickle,
    onFinished,
  } = opts;

  let finished = false;
  let remoteHungup = false;
  /** @type {ReturnType<typeof setTimeout> | null} */
  let playTimer = null;
  /** @type {ReturnType<typeof setTimeout> | null} */
  let maxTimer = null;
  /** @type {RTCPeerConnection | null} */
  let pc = null;
  /** @type {InstanceType<typeof RTCAudioSource> | null} */
  let source = null;

  const pcm = toMono48k(audio.samples, audio.sampleRate, audio.channelCount);
  const frameSamples = TARGET_RATE / 100; // 480
  const silence = new Int16Array(frameSamples);
  let offset = 0;
  /** @type {'silence'|'file'|'trail'} */
  let phase = "silence";
  let trailLeft = Math.ceil(TRAIL_SILENCE_MS / FRAME_MS);
  let framesSent = 0;
  let fileFramesSent = 0;
  let nextDue = 0;

  const finish = (reason, { hangup = true } = {}) => {
    if (finished) return;
    finished = true;
    if (playTimer) {
      clearTimeout(playTimer);
      playTimer = null;
    }
    if (maxTimer) {
      clearTimeout(maxTimer);
      maxTimer = null;
    }
    log(`[${nick}] absent frames sent=${framesSent} file=${fileFramesSent}`);
    try {
      if (hangup && !remoteHungup) sendHangup();
    } catch {
      /* ignore */
    }
    try {
      pc?.close();
    } catch {
      /* ignore */
    }
    pc = null;
    source = null;
    log(`[${nick}] absent finished: ${reason}`);
    onFinished(reason);
  };

  const pushSilence = () => {
    if (!source) return;
    source.onData({
      samples: silence.slice(),
      sampleRate: TARGET_RATE,
      bitsPerSample: 16,
      channelCount: 1,
      numberOfFrames: frameSamples,
    });
    framesSent += 1;
  };

  const pushFileFrame = () => {
    if (!source) return;
    if (offset >= pcm.length) {
      phase = "trail";
      pushSilence();
      return;
    }
    const n = Math.min(frameSamples, pcm.length - offset);
    const chunk = new Int16Array(frameSamples);
    chunk.set(pcm.subarray(offset, offset + n));
    offset += n;
    source.onData({
      samples: chunk,
      sampleRate: TARGET_RATE,
      bitsPerSample: 16,
      channelCount: 1,
      numberOfFrames: frameSamples,
    });
    framesSent += 1;
    fileFramesSent += 1;
  };

  const tick = () => {
    if (finished || !source) return;
    if (phase === "silence") {
      pushSilence();
    } else if (phase === "file") {
      pushFileFrame();
    } else {
      trailLeft -= 1;
      pushSilence();
      if (trailLeft <= 0) {
        finish("completed");
        return;
      }
    }
    nextDue += FRAME_MS;
    const delay = Math.max(0, nextDue - Date.now());
    playTimer = setTimeout(tick, delay);
  };

  const startPump = () => {
    if (playTimer || finished) return;
    nextDue = Date.now();
    tick();
  };

  const startFile = () => {
    if (finished || phase === "file" || phase === "trail") return;
    phase = "file";
    log(`[${nick}] absent playback file (${TARGET_RATE}Hz, ${pcm.length} samples)`);
    if (!maxTimer) {
      maxTimer = setTimeout(() => finish("timeout"), maxDurationMs);
    }
  };

  const api = {
    addRemoteCandidate(candidate) {
      if (!pc || finished) return;
      if (!candidate) return;
      pc.addIceCandidate(candidate).catch((err) => {
        log(`[${nick}] absent addIceCandidate: ${err.message || err}`);
      });
    },
    cancel(reason = "cancel") {
      remoteHungup = reason === "remote hangup";
      finish(reason, { hangup: reason !== "remote hangup" });
    },
  };

  try {
    pc = new RTCPeerConnection({ iceServers: [] });
    source = new RTCAudioSource();
    const track = source.createTrack();
    pc.addTrack(track);

    // Keep encoder fed from the first moment (silence), otherwise early RTP may be empty.
    startPump();

    pc.onicecandidate = (ev) => {
      if (finished) return;
      if (!ev.candidate) {
        sendTrickle(null);
        return;
      }
      const c = ev.candidate;
      sendTrickle({
        candidate: c.candidate,
        sdpMid: c.sdpMid,
        sdpMLineIndex: c.sdpMLineIndex,
        usernameFragment: c.usernameFragment,
      });
    };

    pc.onconnectionstatechange = () => {
      const st = pc?.connectionState;
      log(`[${nick}] absent pc=${st}`);
      if (st === "connected") startFile();
      if (st === "failed") finish("pc-failed");
    };

    pc.oniceconnectionstatechange = () => {
      const st = pc?.iceConnectionState;
      log(`[${nick}] absent ice=${st}`);
      if (st === "connected" || st === "completed") startFile();
    };

    await pc.setRemoteDescription({
      type: jsepOffer.type || "offer",
      sdp: jsepOffer.sdp,
    });
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    await waitIceGatheringComplete(pc);
    const finalDesc = pc.localDescription || answer;
    const sdp = finalDesc.sdp || "";
    const dir = (sdp.match(/^a=(sendrecv|sendonly|recvonly|inactive)/m) || [])[1] || "?";
    const codec = (sdp.match(/^a=rtpmap:(\d+) ([^\s/]+)/m) || []).slice(1).join(" ") || "?";
    log(`[${nick}] absent answer dir=${dir} codec=${codec} sdp=${sdp.length}b`);
    sendAccept({ type: finalDesc.type, sdp, trickle: true });

    // Fallback if connected/ice events are late on some stacks
    setTimeout(() => startFile(), 1200);
  } catch (err) {
    log(`[${nick}] absent error: ${err.message || err}`);
    finish("error");
  }

  return api;
}
