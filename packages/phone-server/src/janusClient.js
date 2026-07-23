import WebSocket from "ws";
import { randomUUID } from "crypto";

const KEEP_ALIVE_MS = 10000;

/**
 * Minimal Janus WebSocket session client (JSON protocol).
 */
export class JanusSession {
  /**
   * @param {string} url
   * @param {{ onLog?: (line: string) => void }} [opts]
   */
  constructor(url, opts = {}) {
    this.url = url;
    this.onLog = opts.onLog || (() => {});
    /** @type {WebSocket | null} */
    this.ws = null;
    this.sessionId = null;
    /** @type {Map<string, { resolve: Function, reject: Function, timer: NodeJS.Timeout }>} */
    this.pending = new Map();
    /** @type {((msg: object) => void) | null} */
    this.eventHandler = null;
    /** @type {ReturnType<typeof setInterval> | null} */
    this.keepAliveTimer = null;
    this.closed = false;
  }

  /**
   * @param {(msg: object) => void} handler
   */
  onEvent(handler) {
    this.eventHandler = handler;
  }

  async connect() {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) return;
    this.closed = false;
    await new Promise((resolve, reject) => {
      const ws = new WebSocket(this.url, "janus-protocol");
      this.ws = ws;
      ws.on("open", () => resolve());
      ws.on("error", (err) => reject(err));
      ws.on("close", () => {
        this._failAll(new Error("Janus WS closed"));
        this._stopKeepAlive();
        if (!this.closed && this.eventHandler) {
          this.eventHandler({ janus: "_disconnected" });
        }
      });
      ws.on("message", (data) => this._onMessage(String(data)));
    });
  }

  /**
   * @returns {Promise<number>}
   */
  async create() {
    const msg = await this._request({ janus: "create" });
    this.sessionId = msg.data.id;
    this._startKeepAlive();
    return this.sessionId;
  }

  /**
   * @param {string} plugin
   * @returns {Promise<number>}
   */
  async attach(plugin) {
    const msg = await this._request({
      janus: "attach",
      plugin,
      session_id: this.sessionId,
    });
    return msg.data.id;
  }

  /**
   * @param {number} handleId
   * @param {object} body
   * @param {object} [jsep]
   */
  async sendMessage(handleId, body, jsep) {
    /** @type {Record<string, unknown>} */
    const payload = {
      janus: "message",
      session_id: this.sessionId,
      handle_id: handleId,
      body,
    };
    if (jsep) payload.jsep = jsep;
    return this._request(payload);
  }

  /**
   * Fire-and-forget message (acks may come as events).
   * @param {number} handleId
   * @param {object} body
   * @param {object} [jsep]
   */
  sendMessageFire(handleId, body, jsep) {
    /** @type {Record<string, unknown>} */
    const payload = {
      janus: "message",
      transaction: randomUUID(),
      session_id: this.sessionId,
      handle_id: handleId,
      body,
    };
    if (jsep) payload.jsep = jsep;
    this._sendRaw(payload);
  }

  /**
   * @param {number} handleId
   * @param {object | null} candidate
   */
  trickle(handleId, candidate) {
    /** @type {Record<string, unknown>} */
    const payload = {
      janus: "trickle",
      transaction: randomUUID(),
      session_id: this.sessionId,
      handle_id: handleId,
    };
    if (candidate == null) {
      payload.candidate = { completed: true };
    } else {
      payload.candidate = candidate;
    }
    this._sendRaw(payload);
  }

  async destroy() {
    this.closed = true;
    this._stopKeepAlive();
    if (this.ws && this.ws.readyState === WebSocket.OPEN && this.sessionId) {
      try {
        this._sendRaw({
          janus: "destroy",
          transaction: randomUUID(),
          session_id: this.sessionId,
        });
      } catch {
        /* ignore */
      }
    }
    try {
      this.ws?.close();
    } catch {
      /* ignore */
    }
    this.ws = null;
    this.sessionId = null;
    this._failAll(new Error("destroyed"));
  }

  _startKeepAlive() {
    this._stopKeepAlive();
    this.keepAliveTimer = setInterval(() => {
      if (!this.sessionId || !this.ws || this.ws.readyState !== WebSocket.OPEN) return;
      this._sendRaw({
        janus: "keepalive",
        transaction: randomUUID(),
        session_id: this.sessionId,
      });
    }, KEEP_ALIVE_MS);
  }

  _stopKeepAlive() {
    if (this.keepAliveTimer) {
      clearInterval(this.keepAliveTimer);
      this.keepAliveTimer = null;
    }
  }

  _sendRaw(obj) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error("Janus WS not open");
    }
    this.ws.send(JSON.stringify(obj));
  }

  /**
   * @param {Record<string, unknown>} obj
   */
  _request(obj) {
    const transaction = randomUUID();
    const payload = { ...obj, transaction };
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(transaction);
        reject(new Error(`Janus request timeout: ${obj.janus}`));
      }, 15000);
      this.pending.set(transaction, { resolve, reject, timer });
      try {
        this._sendRaw(payload);
      } catch (err) {
        clearTimeout(timer);
        this.pending.delete(transaction);
        reject(err);
      }
    });
  }

  _failAll(err) {
    for (const [, p] of this.pending) {
      clearTimeout(p.timer);
      p.reject(err);
    }
    this.pending.clear();
  }

  /** @param {string} raw */
  _onMessage(raw) {
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch {
      this.onLog(`bad janus json: ${raw.slice(0, 200)}`);
      return;
    }

    const transaction = msg.transaction;
    if (transaction && this.pending.has(transaction)) {
      const p = this.pending.get(transaction);
      this.pending.delete(transaction);
      clearTimeout(p.timer);
      if (msg.janus === "error") {
        p.reject(new Error(msg.error?.reason || msg.error || "janus error"));
      } else if (msg.janus === "ack") {
        // plugin may follow with event; resolve ack for fire-and-forget style
        p.resolve(msg);
      } else {
        p.resolve(msg);
      }
      // events with same transaction still useful — fall through for plugin data on success+plugindata
      if (msg.janus !== "event" && !msg.plugindata) {
        return;
      }
    }

    if (msg.janus === "ack" || msg.janus === "success" || msg.janus === "pong") {
      return;
    }

    this.eventHandler?.(msg);
  }
}
