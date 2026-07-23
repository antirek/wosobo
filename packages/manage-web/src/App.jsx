import { useCallback, useEffect, useState } from "react";
import { manageFetch, normalizeNick } from "./api.js";

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

  const load = useCallback(async (token) => {
    const data = await manageFetch(token, "/api/manage/subscribers");
    setItems(data.items || []);
  }, []);

  useEffect(() => {
    if (!authed || !apiToken) return undefined;
    const id = setInterval(() => {
      load(apiToken).catch(() => {});
    }, 3000);
    return () => clearInterval(id);
  }, [authed, apiToken, load]);

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
    setForm(EMPTY_FORM);
    setEditing(null);
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
        <h1>Manage — абоненты</h1>
        <p className="lede">SIP server — hostname с точки зрения Janus (на стенде: asterisk).</p>
        <div className="row" style={{ marginTop: "0.75rem" }}>
          <button type="button" className="secondary" onClick={() => load(apiToken)} disabled={busy}>
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
    </div>
  );
}
