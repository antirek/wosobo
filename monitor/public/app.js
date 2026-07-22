const summaryEl = document.getElementById("summary");
const metaEl = document.getElementById("meta");
const errorEl = document.getElementById("error");
const onlineBody = document.getElementById("onlineBody");
const callsBody = document.getElementById("callsBody");
const sessionsRaw = document.getElementById("sessionsRaw");
const autoRefresh = document.getElementById("autoRefresh");
const refreshBtn = document.getElementById("refreshBtn");

let timer = null;

function esc(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function pill(text, cls) {
  return `<span class="pill ${cls}">${esc(text)}</span>`;
}

function renderSummary(data) {
  const s = data.summary || {};
  const j = data.janus || {};
  const items = [
    ["Janus", j.version || "—"],
    ["Сессии", s.janusSessions ?? 0],
    ["SIP handles", s.sipHandles ?? 0],
    ["REGISTER", s.registered ?? 0],
    ["Разговоры", s.conversations ?? 0],
  ];
  summaryEl.innerHTML = items
    .map(
      ([label, value]) =>
        `<div class="stat"><div class="label">${esc(label)}</div><div class="value">${esc(value)}</div></div>`,
    )
    .join("");
}

function renderOnline(list) {
  if (!list?.length) {
    onlineBody.innerHTML = `<tr><td colspan="6" class="empty">Никто не зарегистрирован через Janus</td></tr>`;
    return;
  }
  onlineBody.innerHTML = list
    .map((h) => {
      const callCls = h.inCallLike ? "on" : "off";
      return `<tr>
        <td><strong>${esc(h.displayName || "—")}</strong></td>
        <td class="mono">${esc(h.username || "—")}</td>
        <td class="mono">${esc(h.identity || "—")}</td>
        <td>${pill(h.registrationStatus, h.registered ? "on" : "warn")}</td>
        <td>${pill(h.callStatus, callCls)}</td>
        <td class="mono">${esc(h.sessionId)} / ${esc(h.handleId)}</td>
      </tr>`;
    })
    .join("");
}

function renderCalls(list) {
  if (!list?.length) {
    callsBody.innerHTML = `<tr><td colspan="6" class="empty">Активных разговоров нет</td></tr>`;
    return;
  }
  callsBody.innerHTML = list
    .map((h) => {
      return `<tr>
        <td><strong>${esc(h.displayName || "—")}</strong></td>
        <td class="mono">${esc(h.identity || h.username || "—")}</td>
        <td class="mono">${esc(h.callee || "—")}</td>
        <td>${pill(h.callStatus, "on")}</td>
        <td>${h.established ? pill("yes", "on") : pill("no", "warn")}</td>
        <td class="mono">${esc(h.handleId)}</td>
      </tr>`;
    })
    .join("");
}

async function load() {
  errorEl.hidden = true;
  try {
    const res = await fetch("/api/overview");
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);

    renderSummary(data);
    renderOnline(data.online);
    renderCalls(data.conversations);
    sessionsRaw.textContent = JSON.stringify(data.sessions, null, 2);
    metaEl.textContent = `Обновлено: ${new Date(data.fetchedAt).toLocaleString()} · accepting sessions: ${data.janus?.acceptingNewSessions}`;
  } catch (err) {
    errorEl.hidden = false;
    errorEl.textContent = err.message || String(err);
    metaEl.textContent = "Ошибка загрузки";
  }
}

function armTimer() {
  if (timer) clearInterval(timer);
  timer = null;
  if (autoRefresh.checked) {
    timer = setInterval(load, 3000);
  }
}

refreshBtn.addEventListener("click", load);
autoRefresh.addEventListener("change", armTimer);

load();
armTimer();
