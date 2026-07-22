import { JanusSession } from "./janusClient.js";
import { authUserFromUsername, buildCallUri, buildProxy, buildSipUsername } from "./sipUri.js";

/**
 * @typedef {object} Subscriber
 * @property {string} nick
 * @property {string} [displayName]
 * @property {boolean} enabled
 * @property {{ server: string, username: string, password: string, authuser?: string }} sip
 */

/**
 * Manages server-owned Janus SIP handles + softphone WSS bindings.
 */
export class LineManager {
  /**
   * @param {{
   *   janusWsUrl: string,
   *   getSubscriber: (nick: string) => Promise<Subscriber | null>,
   *   listEnabled: () => Promise<Subscriber[]>,
   *   onLog?: (line: string) => void,
   * }} opts
   */
  constructor(opts) {
    this.janusWsUrl = opts.janusWsUrl;
    this.getSubscriber = opts.getSubscriber;
    this.listEnabled = opts.listEnabled;
    this.onLog = opts.onLog || console.log.bind(console);
    /** @type {Map<string, Line>} */
    this.lines = new Map();
    this.pollTimer = null;
  }

  startPolling(ms = 3000) {
    this.stopPolling();
    this.pollTimer = setInterval(() => {
      this.reconcileAll().catch((err) => this.onLog(`poll reconcile: ${err.message || err}`));
    }, ms);
  }

  stopPolling() {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  async boot() {
    const all = await this.listEnabled();
    this.onLog(`boot: ${all.length} enabled subscriber(s)`);
    for (const sub of all) {
      await this.ensureLine(sub).catch((err) => {
        this.onLog(`boot ${sub.nick}: ${err.message || err}`);
      });
    }
  }

  async reconcileAll() {
    const enabled = await this.listEnabled();
    const enabledNicks = new Set(enabled.map((s) => s.nick));
    for (const nick of [...this.lines.keys()]) {
      if (!enabledNicks.has(nick)) {
        await this.stopLine(nick);
      }
    }
    for (const sub of enabled) {
      await this.ensureLine(sub);
    }
  }

  /** @param {string} nick */
  async reconcileNick(nick) {
    const sub = await this.getSubscriber(nick);
    if (!sub || !sub.enabled) {
      await this.stopLine(nick);
      return;
    }
    await this.ensureLine(sub, { forceReregister: true });
  }

  /**
   * @param {Subscriber} sub
   * @param {{ forceReregister?: boolean }} [opts]
   */
  async ensureLine(sub, opts = {}) {
    let line = this.lines.get(sub.nick);
    if (!line) {
      line = new Line(sub.nick, this);
      this.lines.set(sub.nick, line);
    }
    line.subscriber = sub;
    await line.start(opts.forceReregister);
  }

  /** @param {string} nick */
  async stopLine(nick) {
    const line = this.lines.get(nick);
    if (!line) return;
    this.lines.delete(nick);
    await line.destroy();
  }

  /** @param {string} nick */
  getLine(nick) {
    return this.lines.get(nick) || null;
  }

  /** Snapshot for admin: SIP line + softphone presence */
  listStatuses() {
    return [...this.lines.values()].map((line) => line.toStatus());
  }
}

class Line {
  /**
   * @param {string} nick
   * @param {LineManager} manager
   */
  constructor(nick, manager) {
    this.nick = nick;
    this.manager = manager;
    /** @type {Subscriber | null} */
    this.subscriber = null;
    /** @type {JanusSession | null} */
    this.session = null;
    this.handleId = null;
    /** @type {import('ws').WebSocket | null} */
    this.softphoneWs = null;
    /** @type {'starting'|'registering'|'registered'|'offline'|'reconnecting'|'error'|'unregistering'} */
    this.lineStatus = "offline";
    this.lineDetail = "";
    /** @type {'idle'|'outgoing'|'incoming'|'incall'} */
    this.callPhase = "idle";
    this.callDetail = "";
    this.caller = "";
    /** @type {object | null} */
    this.pendingIncomingJsep = null;
    this.starting = false;
    this.wantUp = true;
    this.reconnectTimer = null;
    this.reconnectAttempt = 0;
  }

  log(msg) {
    this.manager.onLog(`[${this.nick}] ${msg}`);
  }

  toStatus() {
    const softphoneOnline = Boolean(this.softphoneWs && this.softphoneWs.readyState === 1);
    return {
      nick: this.nick,
      sipRegistered: this.lineStatus === "registered",
      lineStatus: this.lineStatus,
      lineDetail: this.lineDetail || "",
      softphoneOnline,
      callPhase: this.callPhase,
    };
  }

  /**
   * @param {boolean} [forceReregister]
   */
  async start(forceReregister = false) {
    this.wantUp = true;
    if (this.starting) return;
    if (this.session && this.handleId && this.lineStatus === "registered" && !forceReregister) {
      return;
    }
    this.starting = true;
    try {
      await this._connectAndRegister();
    } finally {
      this.starting = false;
    }
  }

  async _connectAndRegister() {
    this._clearReconnect();
    await this._teardownJanus({ unregister: false });
    this._setLine("starting");
    try {
      const session = new JanusSession(this.manager.janusWsUrl, {
        onLog: (l) => this.log(l),
      });
      session.onEvent((msg) => this._onJanusEvent(msg));
      await session.connect();
      await session.create();
      const handleId = await session.attach("janus.plugin.sip");
      this.session = session;
      this.handleId = handleId;
      this._setLine("registering");
      this._sendRegister();
    } catch (err) {
      this.log(`start error: ${err.message || err}`);
      this._setLine("error", String(err.message || err));
      this._scheduleReconnect(String(err.message || err));
    }
  }

  _sendRegister() {
    if (!this.session || !this.handleId || !this.subscriber?.sip) return;
    const sip = this.subscriber.sip;
    const proxy = buildProxy(sip.server);
    const username = buildSipUsername(sip.username, sip.server);
    const authuser = sip.authuser || authUserFromUsername(sip.username);
    /** @type {Record<string, unknown>} */
    const register = {
      request: "register",
      username,
      authuser,
      secret: sip.password,
      proxy,
      display_name: this.subscriber.displayName || this.nick,
    };
    this.session.sendMessageFire(this.handleId, register);
  }

  _scheduleReconnect(reason) {
    if (!this.wantUp) return;
    this._clearReconnect();
    this.reconnectAttempt += 1;
    const delay = Math.min(15000, 1500 * 2 ** Math.min(this.reconnectAttempt - 1, 4));
    this._setLine("reconnecting", reason || `попытка ${this.reconnectAttempt}`);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.start(true).catch((err) => this.log(`reconnect: ${err.message || err}`));
    }, delay);
  }

  _clearReconnect() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  /**
   * @param {import('ws').WebSocket} ws
   * @returns {{ ok: true } | { ok: false, code: string, message: string }}
   */
  attachSoftphone(ws) {
    if (this.softphoneWs && this.softphoneWs !== ws && this.softphoneWs.readyState === 1) {
      return {
        ok: false,
        code: "already_connected",
        message: "Уже открыта другая вкладка",
      };
    }
    this.softphoneWs = ws;
    this._sendToSoftphone({
      type: "hello",
      nick: this.nick,
      line: { status: this.lineStatus, detail: this.lineDetail || undefined },
      call: {
        state: this.callPhase,
        detail: this.callDetail || undefined,
        caller: this.caller || undefined,
      },
    });
    return { ok: true };
  }

  /** @param {import('ws').WebSocket} ws */
  detachSoftphone(ws) {
    if (this.softphoneWs !== ws) return;
    this.softphoneWs = null;
    if (this.callPhase !== "idle") {
      this.log("softphone gone during call — hangup");
      this._hangupSip();
      this._resetCall();
    }
  }

  /** @param {object} msg */
  handleSoftphoneMessage(msg) {
    const type = msg?.type;
    if (type === "ping") {
      this._sendToSoftphone({ type: "pong" });
      return;
    }
    if (type === "dial") {
      this._dial(msg);
      return;
    }
    if (type === "accept") {
      this._accept(msg);
      return;
    }
    if (type === "decline") {
      this._decline();
      return;
    }
    if (type === "hangup") {
      this._hangupFromClient();
      return;
    }
    if (type === "trickle") {
      if (this.session && this.handleId) {
        this.session.trickle(this.handleId, msg.candidate ?? null);
      }
      return;
    }
    if (type === "jsep" && msg.jsep) {
      // rare path — ignore if not in call setup
      return;
    }
    this._sendToSoftphone({
      type: "error",
      code: "unknown_type",
      message: `Unknown type: ${type}`,
    });
  }

  /** @param {object} msg */
  _dial(msg) {
    if (!this.session || !this.handleId || !this.subscriber?.sip) {
      this._sendToSoftphone({ type: "error", code: "no_line", message: "Линия не готова" });
      return;
    }
    if (this.lineStatus !== "registered") {
      this._sendToSoftphone({ type: "error", code: "not_registered", message: "Нет REGISTER" });
      return;
    }
    if (this.callPhase !== "idle") {
      this._sendToSoftphone({ type: "error", code: "busy", message: "Уже есть звонок" });
      return;
    }
    const jsep = msg.jsep;
    if (!jsep?.sdp) {
      this._sendToSoftphone({ type: "error", code: "no_jsep", message: "Нужен jsep offer" });
      return;
    }
    const uri = buildCallUri(msg.number, this.subscriber.sip.server);
    if (!uri) {
      this._sendToSoftphone({ type: "error", code: "bad_number", message: "Укажите номер" });
      return;
    }
    this.callPhase = "outgoing";
    this.callDetail = uri;
    this._sendCall({ state: "outgoing", detail: uri });
    this.session.sendMessageFire(
      this.handleId,
      { request: "call", uri, autoaccept_reinvites: false },
      jsep,
    );
  }

  /** @param {object} msg */
  _accept(msg) {
    if (this.callPhase !== "incoming" || !this.session || !this.handleId) {
      this._sendToSoftphone({ type: "error", code: "no_incoming", message: "Нет входящего" });
      return;
    }
    if (!msg.jsep?.sdp) {
      this._sendToSoftphone({ type: "error", code: "no_jsep", message: "Нужен jsep answer" });
      return;
    }
    this.callPhase = "incall";
    this.pendingIncomingJsep = null;
    this._sendCall({ state: "incall", caller: this.caller });
    this.session.sendMessageFire(
      this.handleId,
      { request: "accept", autoaccept_reinvites: false },
      msg.jsep,
    );
  }

  _decline() {
    if (this.callPhase !== "incoming") {
      this._hangupFromClient();
      return;
    }
    try {
      this.session?.sendMessageFire(this.handleId, { request: "decline" });
    } catch {
      /* ignore */
    }
    this._resetCall();
  }

  _hangupFromClient() {
    this._hangupSip();
    this._resetCall();
  }

  _hangupSip() {
    try {
      this.session?.sendMessageFire(this.handleId, { request: "hangup" });
    } catch {
      /* ignore */
    }
  }

  _resetCall() {
    this.callPhase = "idle";
    this.callDetail = "";
    this.caller = "";
    this.pendingIncomingJsep = null;
    this._sendCall({ state: "idle" });
  }

  /** @param {object} msg */
  _onJanusEvent(msg) {
    if (msg.janus === "_disconnected") {
      this.log("Janus disconnected");
      this.session = null;
      this.handleId = null;
      if (this.callPhase !== "idle") this._resetCall();
      this._scheduleReconnect("janus disconnected");
      return;
    }

    if (msg.janus === "trickle") {
      const cand = msg.candidate;
      if (cand?.completed) {
        this._sendToSoftphone({ type: "trickle", candidate: null });
      } else if (cand) {
        this._sendToSoftphone({
          type: "trickle",
          candidate: {
            candidate: cand.candidate,
            sdpMid: cand.sdpMid,
            sdpMLineIndex: cand.sdpMLineIndex,
            usernameFragment: cand.usernameFragment,
          },
        });
      }
      return;
    }

    if (msg.janus === "media") {
      const line = `janus media type=${msg.type} receiving=${msg.receiving}`;
      this.log(line);
      this._sendToSoftphone({ type: "log", message: line });
      return;
    }

    if (msg.janus === "webrtcup") {
      this.log("janus webrtcup");
      this._sendToSoftphone({ type: "log", message: "janus webrtcup" });
      return;
    }

    if (msg.janus === "slowlink") {
      return;
    }

    if (msg.janus === "hangup") {
      this.log("Janus webrtc hangup");
      this._resetCall();
      return;
    }

    const data = msg.plugindata?.data;
    if (!data) return;

    if (data.error || data.error_code) {
      const detail = data.error || `code ${data.error_code}`;
      this.log(`plugin error: ${detail}`);
      if (this.callPhase !== "idle") {
        this._resetCall();
        this._sendToSoftphone({ type: "error", code: "sip_error", message: String(detail) });
      } else {
        this._setLine("error", String(detail));
      }
      return;
    }

    const result = data.result;
    if (!result) return;
    const event = result.event;
    const jsep = msg.jsep;

    if (event === "registering") {
      this._setLine("registering");
    } else if (event === "registered") {
      this.reconnectAttempt = 0;
      this._setLine("registered");
      this.log(`registered ${result.username || ""}`);
    } else if (event === "registration_failed") {
      const detail = result.reason || result.code || "registration_failed";
      this._setLine("error", String(detail));
      this._scheduleReconnect(String(detail));
    } else if (event === "unregistered") {
      if (this.wantUp) {
        this._scheduleReconnect("unregistered");
      } else {
        this._setLine("offline");
      }
    } else if (event === "incomingcall") {
      this._onIncoming(result, jsep);
    } else if (event === "calling") {
      if (this.callPhase === "outgoing") {
        this._sendCall({ state: "outgoing", detail: result.username || this.callDetail });
      }
    } else if (event === "ringing" || event === "proceeding") {
      if (this.callPhase === "outgoing") {
        this._sendCall({ state: "outgoing", detail: "ringing" });
      }
    } else if (event === "progress") {
      if (this.callPhase === "outgoing") {
        this._sendCall({ state: "outgoing", detail: "early media" });
      }
      if (jsep) this._sendToSoftphone({ type: "jsep", jsep });
    } else if (event === "accepted") {
      if (this.callPhase === "outgoing" || this.callPhase === "incall") {
        this.callPhase = "incall";
        this._sendCall({ state: "incall", detail: result.username || "" });
      }
      if (jsep) this._sendToSoftphone({ type: "jsep", jsep });
    } else if (event === "hangup") {
      const reason = result.reason || (result.code != null ? String(result.code) : "");
      this.log(`remote hangup ${reason}`);
      this._resetCall();
      if (reason) {
        this._sendCall({ state: "idle", detail: reason });
      }
    }
  }

  /**
   * @param {object} result
   * @param {object | undefined} jsep
   */
  _onIncoming(result, jsep) {
    if (this.callPhase !== "idle") {
      this.session?.sendMessageFire(this.handleId, { request: "decline", code: 486 });
      return;
    }
    if (!this.softphoneWs || this.softphoneWs.readyState !== 1) {
      this.log("incoming without softphone — 486");
      this.session?.sendMessageFire(this.handleId, { request: "decline", code: 486 });
      return;
    }
    const caller = result.username || result.displayname || "unknown";
    this.callPhase = "incoming";
    this.caller = caller;
    this.pendingIncomingJsep = jsep || null;
    this._sendCall({ state: "incoming", caller });
    /** @type {Record<string, unknown>} */
    const payload = { type: "incoming", caller };
    if (jsep) payload.jsep = jsep;
    this._sendToSoftphone(payload);
  }

  /**
   * @param {string} status
   * @param {string} [detail]
   */
  _setLine(status, detail = "") {
    this.lineStatus = status;
    this.lineDetail = detail;
    this._sendToSoftphone({
      type: "line",
      status,
      detail: detail || undefined,
    });
  }

  /** @param {{ state: string, detail?: string, caller?: string }} p */
  _sendCall(p) {
    this.callPhase = /** @type {any} */ (p.state);
    if (p.detail != null) this.callDetail = p.detail;
    if (p.caller != null) this.caller = p.caller;
    this._sendToSoftphone({
      type: "call",
      state: p.state,
      detail: p.detail,
      caller: p.caller,
    });
  }

  /** @param {object} obj */
  _sendToSoftphone(obj) {
    if (!this.softphoneWs || this.softphoneWs.readyState !== 1) return;
    try {
      this.softphoneWs.send(JSON.stringify(obj));
    } catch (err) {
      this.log(`ws send: ${err.message || err}`);
    }
  }

  /**
   * @param {{ unregister: boolean }} opts
   */
  async _teardownJanus(opts) {
    const session = this.session;
    const handleId = this.handleId;
    this.session = null;
    this.handleId = null;
    if (session && handleId && opts.unregister) {
      try {
        session.sendMessageFire(handleId, { request: "unregister" });
      } catch {
        /* ignore */
      }
    }
    if (session) {
      try {
        await session.destroy();
      } catch {
        /* ignore */
      }
    }
  }

  async destroy() {
    this.wantUp = false;
    this._clearReconnect();
    if (this.callPhase !== "idle") {
      this._hangupSip();
      this._resetCall();
    }
    this._setLine("unregistering");
    await this._teardownJanus({ unregister: true });
    this._setLine("offline");
    if (this.softphoneWs && this.softphoneWs.readyState === 1) {
      try {
        this.softphoneWs.close(4000, "line stopped");
      } catch {
        /* ignore */
      }
    }
    this.softphoneWs = null;
  }
}
