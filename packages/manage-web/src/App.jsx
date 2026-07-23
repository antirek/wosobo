import { useCallback, useEffect, useState } from "react";
import { manageFetch, mintSession, normalizeNick } from "./api.js";

const AUTH_KEY = "manage.apiToken";

const EMPTY_FORM = {
  nick: "",
  displayName: "",
  enabled: true,
  absentAnnounce: false,
  server: "asterisk",
  username: "",
  password: "",
};

export default function App() {
  const [apiToken, setApiToken] = useState("");
  const [authed, setAuthed] = useState(false);
  const [items, setItems] = useState([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [editing, setEditing] = useState(null);
  /** @type {[{ nick: string, token: string, expiresAt: number } | null, Function]} */
  const [minted, setMinted] = useState(null);
  const [mintBusyNick, setMintBusyNick] = useState("");
  const [copied, setCopied] = useState(false);
  /** @type {['subscribers' | 'calls', Function]} */
  const [tab, setTab] = useState("subscribers");
  const [calls, setCalls] = useState([]);
  const [callsTotal, setCallsTotal] = useState(0);
  const [callsOffset, setCallsOffset] = useState(0);
  const CALLS_LIMIT = 50;

  const load = useCallback(async (token) => {
    const data = await manageFetch(token, "/api/manage/subscribers");
    setItems(data.items || []);
  }, []);

  const loadCalls = useCallback(
    async (token, offset = 0) => {
      const q = new URLSearchParams({
        limit: String(CALLS_LIMIT),
        offset: String(offset),
      });
      const data = await manageFetch(token, `/api/manage/calls?${q}`);
      setCalls(data.items || []);
      setCallsTotal(Number(data.total) || 0);
      setCallsOffset(Number(data.offset) || offset);
    },
    [],
  );

  useEffect(() => {
    if (!authed || !apiToken) return undefined;
    if (tab === "subscribers") {
      const id = setInterval(() => {
        load(apiToken).catch(() => {});
      }, 3000);
      return () => clearInterval(id);
    }
    const id = setInterval(() => {
      loadCalls(apiToken, callsOffset).catch(() => {});
    }, 5000);
    return () => clearInterval(id);
  }, [authed, apiToken, load, loadCalls, tab, callsOffset]);

  useEffect(() => {
    try {
      const stored = sessionStorage.getItem(AUTH_KEY);
      if (!stored) return;
      setApiToken(stored);
      setBusy(true);
      load(stored)
        .then(() => setAuthed(true))
        .catch(() => sessionStorage.removeItem(AUTH_KEY))
        .finally(() => setBusy(false));
    } catch {
      /* ignore */
    }
  }, [load]);

  async function onLogin(e) {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      await load(apiToken);
      sessionStorage.setItem(AUTH_KEY, apiToken);
      setAuthed(true);
    } catch (err) {
      setError(err.message || String(err));
    } finally {
      setBusy(false);
    }
  }

  function onLogout() {
    sessionStorage.removeItem(AUTH_KEY);
    setAuthed(false);
    setItems([]);
    setCalls([]);
    setForm(EMPTY_FORM);
    setEditing(null);
    setMinted(null);
    setTab("subscribers");
  }

  async function switchTab(next) {
    setTab(next);
    setError("");
    if (next === "calls" && apiToken) {
      try {
        await loadCalls(apiToken, 0);
      } catch (err) {
        setError(err.message || String(err));
      }
    }
  }

  function formatDuration(sec) {
    const s = Math.max(0, Number(sec) || 0);
    const m = Math.floor(s / 60);
    const r = s % 60;
    return `${m}:${String(r).padStart(2, "0")}`;
  }

  async function onMintToken(item) {
    setError("");
    setCopied(false);
    setMintBusyNick(item.nick);
    try {
      const data = await mintSession(apiToken, item.nick);
      setMinted({
        nick: data.nick,
        token: data.token,
        expiresAt: data.expiresAt,
      });
    } catch (err) {
      setError(err.message || String(err));
    } finally {
      setMintBusyNick("");
    }
  }

  async function copyMintedToken() {
    if (!minted?.token) return;
    try {
      await navigator.clipboard.writeText(minted.token);
      setCopied(true);
    } catch {
      setError("Не удалось скопировать token");
    }
  }

  function startEdit(item) {
    setEditing(item.nick);
    setForm({
      nick: item.nick,
      displayName: item.displayName || "",
      enabled: item.enabled,
      absentAnnounce: Boolean(item.absentAnnounce),
      server: item.sip?.server || "asterisk",
      username: item.sip?.username || "",
      password: "",
    });
  }

  function startCreate() {
    setEditing(null);
    setForm(EMPTY_FORM);
  }

  async function onSave(e) {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      const nick = normalizeNick(form.nick);
      const body = {
        displayName: form.displayName || nick,
        enabled: Boolean(form.enabled),
        absentAnnounce: Boolean(form.absentAnnounce),
        sip: {
          server: form.server.trim(),
          username: form.username.trim(),
        },
      };
      if (form.password) {
        body.sip.password = form.password;
      }
      if (!editing && !form.password) {
        throw new Error("Для нового абонента нужен SIP password");
      }
      await manageFetch(apiToken, `/api/manage/subscribers/${encodeURIComponent(nick)}`, {
        method: "PUT",
        body: JSON.stringify(body),
      });
      await load(apiToken);
      startCreate();
    } catch (err) {
      setError(err.message || String(err));
    } finally {
      setBusy(false);
    }
  }

  async function onToggle(item) {
    setError("");
    setBusy(true);
    try {
      await manageFetch(apiToken, `/api/manage/subscribers/${encodeURIComponent(item.nick)}`, {
        method: "PATCH",
        body: JSON.stringify({ enabled: !item.enabled }),
      });
      await load(apiToken);
    } catch (err) {
      setError(err.message || String(err));
    } finally {
      setBusy(false);
    }
  }

  async function onDelete(item) {
    if (!confirm(`Удалить ${item.nick}?`)) return;
    setError("");
    setBusy(true);
    try {
      await manageFetch(apiToken, `/api/manage/subscribers/${encodeURIComponent(item.nick)}`, {
        method: "DELETE",
      });
      await load(apiToken);
      if (editing === item.nick) startCreate();
    } catch (err) {
      setError(err.message || String(err));
    } finally {
      setBusy(false);
    }
  }

  if (!authed) {
    return (
      <div className="page">
        <header className="header">
          <h1>Manage</h1>
          <p className="lede">Ники и SIP-привязки к PBX. API token (MANAGE_API_TOKEN).</p>
        </header>
        <form className="card" onSubmit={onLogin}>
          <label>
            API token
            <input
              type="password"
              value={apiToken}
              onChange={(e) => setApiToken(e.target.value)}
              placeholder="dev-manage-token"
              autoFocus
              autoComplete="off"
            />
          </label>
          {error ? <p className="error">{error}</p> : null}
          <button type="submit" disabled={busy || !apiToken.trim()}>
            Войти
          </button>
        </form>
      </div>
    );
  }

  return (
    <div className="page">
      <header className="header">
        <h1>Manage</h1>
        <p className="lede">SIP server — hostname с точки зрения Janus (на стенде: asterisk).</p>
        <div className="tabs" style={{ marginTop: "0.75rem" }}>
          <button
            type="button"
            className={tab === "subscribers" ? "" : "secondary"}
            onClick={() => switchTab("subscribers")}
          >
            Абоненты
          </button>
          <button
            type="button"
            className={tab === "calls" ? "" : "secondary"}
            onClick={() => switchTab("calls")}
          >
            Звонки
          </button>
        </div>
        <div className="row" style={{ marginTop: "0.75rem" }}>
          <button
            type="button"
            className="secondary"
            onClick={() =>
              tab === "calls"
                ? loadCalls(apiToken, callsOffset).catch((e) => setError(e.message))
                : load(apiToken)
            }
            disabled={busy}
          >
            Обновить
          </button>
          <a className="secondary" href="/manage-api/api/manage/docs" target="_blank" rel="noreferrer">
            OpenAPI
          </a>
          <button type="button" className="secondary" onClick={onLogout}>
            Выйти
          </button>
        </div>
      </header>

      {error ? (
        <section className="card">
          <p className="error">{error}</p>
        </section>
      ) : null}

      {tab === "calls" ? (
        <section className="card">
          <h2>Звонки</h2>
          <p className="hint">
            CDR (TTL 2 дня). Время — локаль браузера. Стр. {Math.floor(callsOffset / CALLS_LIMIT) + 1} ·{" "}
            {callsTotal} всего · авто ~5 с
          </p>
          <table>
            <thead>
              <tr>
                <th>Время</th>
                <th>Ник</th>
                <th></th>
                <th>Peer</th>
                <th>Длит.</th>
                <th>Статус</th>
                <th>Cause</th>
              </tr>
            </thead>
            <tbody>
              {calls.map((c) => (
                <tr key={c.id}>
                  <td>
                    {c.startedAt ? new Date(c.startedAt).toLocaleString() : "—"}
                    {!c.endedAt ? (
                      <>
                        <br />
                        <span className="hint">идёт</span>
                      </>
                    ) : null}
                  </td>
                  <td>
                    <strong>{c.nick}</strong>
                  </td>
                  <td>{c.direction === "in" ? "←" : "→"}</td>
                  <td>{c.peer}</td>
                  <td>{formatDuration(c.durationSec)}</td>
                  <td>
                    <span className="badge on">{c.status}</span>
                  </td>
                  <td>
                    <span className="hint">{c.hangupCause || "—"}</span>
                  </td>
                </tr>
              ))}
              {!calls.length ? (
                <tr>
                  <td colSpan={7} className="hint">
                    Пока нет записей — сделайте тестовый звонок.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
          <div className="row" style={{ marginTop: "0.75rem" }}>
            <button
              type="button"
              className="secondary"
              disabled={callsOffset <= 0 || busy}
              onClick={() => {
                const next = Math.max(0, callsOffset - CALLS_LIMIT);
                loadCalls(apiToken, next).catch((e) => setError(e.message));
              }}
            >
              ← Назад
            </button>
            <button
              type="button"
              className="secondary"
              disabled={callsOffset + CALLS_LIMIT >= callsTotal || busy}
              onClick={() => {
                const next = callsOffset + CALLS_LIMIT;
                loadCalls(apiToken, next).catch((e) => setError(e.message));
              }}
            >
              Вперёд →
            </button>
          </div>
        </section>
      ) : (
        <>
      {minted ? (
        <section className="card mint-card">
          <h2>Session token — {minted.nick}</h2>
          <p className="hint">
            TTL до {new Date(minted.expiresAt).toLocaleString()}. Вставьте в Softphone (ник + token).
          </p>
          <code className="token-box">{minted.token}</code>
          <div className="row">
            <button type="button" onClick={copyMintedToken}>
              {copied ? "Скопировано" : "Копировать token"}
            </button>
            <a
              className="secondary"
              href={`/demo/`}
              target="_blank"
              rel="noreferrer"
            >
              Открыть Softphone
            </a>
            <button type="button" className="secondary" onClick={() => setMinted(null)}>
              Закрыть
            </button>
          </div>
        </section>
      ) : null}

      <section className="card">
        <h2>Список</h2>
        <p className="hint">SIP registered / Softphone online — live из phone-server (обновление ~3 с).</p>
        <table>
          <thead>
            <tr>
              <th>Ник</th>
              <th>SIP учётная</th>
              <th>Enabled</th>
              <th>SIP на АТС</th>
              <th>Softphone</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {items.map((item) => {
              const rt = item.runtime || {};
              const sipOk = Boolean(rt.sipRegistered);
              const uiOnline = Boolean(rt.softphoneOnline);
              const canMint = item.enabled && item.sip?.passwordSet;
              return (
                <tr key={item.nick}>
                  <td>
                    <strong>{item.nick}</strong>
                    {item.displayName ? (
                      <>
                        <br />
                        <span className="hint">{item.displayName}</span>
                      </>
                    ) : null}
                  </td>
                  <td>
                    {item.sip?.username}@{item.sip?.server}
                    <br />
                    <span className="hint">{item.sip?.passwordSet ? "password set" : "no password"}</span>
                  </td>
                  <td>
                    <span className={`badge ${item.enabled ? "on" : "off"}`}>
                      {item.enabled ? "enabled" : "disabled"}
                    </span>
                  </td>
                  <td>
                    <span className={`badge ${sipOk ? "on" : "off"}`}>
                      {sipOk ? "registered" : rt.lineStatus || "offline"}
                    </span>
                    {rt.lineDetail && !sipOk ? (
                      <>
                        <br />
                        <span className="hint">{rt.lineDetail}</span>
                      </>
                    ) : null}
                    {rt.callPhase && rt.callPhase !== "idle" ? (
                      <>
                        <br />
                        <span className="hint">call: {rt.callPhase}</span>
                      </>
                    ) : null}
                  </td>
                  <td>
                    <span className={`badge ${uiOnline ? "on" : "off"}`}>
                      {uiOnline ? "online" : "offline"}
                    </span>
                    {item.absentAnnounce ? (
                      <>
                        <br />
                        <span className="hint">offline → announce</span>
                      </>
                    ) : null}
                  </td>
                  <td>
                    <div className="row">
                      <button
                        type="button"
                        className="secondary"
                        onClick={() => onMintToken(item)}
                        disabled={busy || !canMint || mintBusyNick === item.nick}
                        title={canMint ? "Mint softphone session" : "Нужны enabled + SIP password"}
                      >
                        {mintBusyNick === item.nick ? "…" : "Token"}
                      </button>
                      <button type="button" className="secondary" onClick={() => startEdit(item)} disabled={busy}>
                        Изменить
                      </button>
                      <button type="button" className="secondary" onClick={() => onToggle(item)} disabled={busy}>
                        {item.enabled ? "Disable" : "Enable"}
                      </button>
                      <button type="button" className="danger" onClick={() => onDelete(item)} disabled={busy}>
                        Удалить
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
            {!items.length ? (
              <tr>
                <td colSpan={6} className="hint">
                  Пусто — создайте абонента или дождитесь seed (alice/bob).
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </section>

      <section className="card">
        <div className="row" style={{ justifyContent: "space-between" }}>
          <h2 style={{ margin: 0 }}>{editing ? `Редактирование: ${editing}` : "Новый абонент"}</h2>
          {editing ? (
            <button type="button" className="secondary" onClick={startCreate}>
              Сброс формы
            </button>
          ) : null}
        </div>
        <p className="hint">
          При редактировании оставьте пароль пустым, чтобы не менять. Softphone видит только ник — SIP сюда.
        </p>
        <form onSubmit={onSave}>
          <div className="grid2">
            <label>
              Ник
              <input
                value={form.nick}
                onChange={(e) => setForm((f) => ({ ...f, nick: e.target.value }))}
                disabled={Boolean(editing) || busy}
                placeholder="alice"
                required
              />
            </label>
            <label>
              Display name
              <input
                value={form.displayName}
                onChange={(e) => setForm((f) => ({ ...f, displayName: e.target.value }))}
                disabled={busy}
                placeholder="Alice"
              />
            </label>
            <label>
              SIP server
              <input
                value={form.server}
                onChange={(e) => setForm((f) => ({ ...f, server: e.target.value }))}
                disabled={busy}
                placeholder="asterisk"
                required
              />
            </label>
            <label>
              SIP username (extension)
              <input
                value={form.username}
                onChange={(e) => setForm((f) => ({ ...f, username: e.target.value }))}
                disabled={busy}
                placeholder="1001"
                required
              />
            </label>
            <label>
              SIP password
              <input
                type="password"
                value={form.password}
                onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
                disabled={busy}
                placeholder={editing ? "оставить прежний" : "pass1001"}
              />
            </label>
            <label>
              Enabled
              <select
                value={form.enabled ? "1" : "0"}
                onChange={(e) => setForm((f) => ({ ...f, enabled: e.target.value === "1" }))}
                disabled={busy}
              >
                <option value="1">да</option>
                <option value="0">нет</option>
              </select>
            </label>
            <label>
              Offline → «абонент отсутствует»
              <select
                value={form.absentAnnounce ? "1" : "0"}
                onChange={(e) => setForm((f) => ({ ...f, absentAnnounce: e.target.value === "1" }))}
                disabled={busy}
              >
                <option value="0">нет (486)</option>
                <option value="1">да (проиграть фразу)</option>
              </select>
            </label>
          </div>
          <button type="submit" disabled={busy}>
            Сохранить
          </button>
        </form>
      </section>
        </>
      )}
    </div>
  );
}
