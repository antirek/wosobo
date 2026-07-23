/**
 * Простой рингтон через Web Audio API (без внешних файлов).
 * Паттерн: два коротких гудка → пауза → повтор.
 */
export function createRingtone() {
  /** @type {AudioContext | null} */
  let ctx = null;
  /** @type {ReturnType<typeof setTimeout> | null} */
  let timer = null;
  let stopped = true;

  function beep(startAt, freq, duration, gainValue = 0.12) {
    if (!ctx) return;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0, startAt);
    gain.gain.linearRampToValueAtTime(gainValue, startAt + 0.02);
    gain.gain.setValueAtTime(gainValue, startAt + duration - 0.04);
    gain.gain.linearRampToValueAtTime(0, startAt + duration);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(startAt);
    osc.stop(startAt + duration + 0.01);
  }

  function scheduleCycle() {
    if (stopped || !ctx) return;
    const t0 = ctx.currentTime + 0.02;
    // ring-ring
    beep(t0, 440, 0.35);
    beep(t0, 480, 0.35, 0.08);
    beep(t0 + 0.45, 440, 0.35);
    beep(t0 + 0.45, 480, 0.35, 0.08);
    timer = setTimeout(scheduleCycle, 2200);
  }

  async function start() {
    stop();
    stopped = false;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ctx = new AC();
    if (ctx.state === "suspended") {
      try {
        await ctx.resume();
      } catch {
        /* autoplay policy — пользователь уже кликал по странице при логине/register */
      }
    }
    scheduleCycle();
  }

  function stop() {
    stopped = true;
    if (timer != null) {
      clearTimeout(timer);
      timer = null;
    }
    if (ctx) {
      try {
        ctx.close();
      } catch {
        /* ignore */
      }
      ctx = null;
    }
  }

  return { start, stop };
}
