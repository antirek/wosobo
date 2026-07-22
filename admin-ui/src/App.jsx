import { useCallback, useEffect, useState } from "react";
import { adminFetch, normalizeNick } from "./api.js";

const AUTH_KEY = "admin.basic";

const EMPTY_FORM = {
  nick: "",
  displayName: "",
  enabled: true,
  server: "asterisk",
  username: "",
  password: "",
};

export default function App() {
  const [user, setUser] = useState("");
  const [pass, setPass] = useState("");
  const [authed, setAuthed] = useState(false);
  const [items, setItems] = useState([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [editing, setEditing] = useState(null);

  const load = useCallback(async (u, p) => {
    const data = await adminFetch(u, p, "/api/admin/subscribers");
    setItems(data.items || []);
  }, []);

  useEffect(() => {
    if (!authed || !user) return undefined;
    const id = setInterval(() => {
      load(user, pass).catch(() => {});
    }, 3000);
    return () => clearInterval(id);
  }, [authed, user, pass, load]);

  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(AUTH_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (parsed?.user && parsed?.pass) {
        setUser(parsed.user);
        setPass(parsed.pass);
        setBusy(true);
        load(parsed.user, parsed.pass)
          .then(() => setAuthed(true))
          .catch(() => sessionStorage.removeItem(AUTH_KEY))
          .finally(() => setBusy(false));
      }
    } catch {
      /* ignore */
    }
  }, [load]);

  async function onLogin(e) {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      await load(user, pass);
      sessionStorage.setItem(AUTH_KEY, JSON.stringify({ user, pass }));
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
      await adminFetch(user, pass, `/api/admin/subscribers/${encodeURIComponent(nick)}`, {
        method: "PUT",
        body: JSON.stringify(body),
      });
      await load(user, pass);
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
      await adminFetch(user, pass, `/api/admin/subscribers/${encodeURIComponent(item.nick)}`, {
        method: "PATCH",
        body: JSON.stringify({ enabled: !item.enabled }),
      });
      await load(user, pass);
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
      await adminFetch(user, pass, `/api/admin/subscribers/${encodeURIComponent(item.nick)}`, {
        method: "DELETE",
      });
      await load(user, pass);
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
          <h1>Admin</h1>
          <p className="lede">Ники и SIP-привязки к PBX. Basic auth.</p>
        </header>
        <form className="card" onSubmit={onLogin}>
          <label>
            Логин
            <input value={user} onChange={(e) => setUser(e.target.value)} placeholder="admin" autoFocus />
          </label>
          <label>
            Пароль
            <input
              type="password"
              value={pass}
              onChange={(e) => setPass(e.target.value)}
              placeholder="admin"
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
        <h1>Admin — абоненты</h1>
        <p className="lede">SIP server — hostname с точки зрения Janus (на стенде: asterisk).</p>
        <div className="row" style={{ marginTop: "0.75rem" }}>
          <button type="button" className="secondary" onClick={() => load(user, pass)} disabled={busy}>
            Обновить
          </button>
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
        <p className="hint">SIP registered / Softphone online — live из softphone-api (обновление ~3 с).</p>
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
          </div>
          <button type="submit" disabled={busy}>
            Сохранить
          </button>
        </form>
      </section>
    </div>
  );
}
