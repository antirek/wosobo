const STYLE_ID = "wsp-softphone-styles";

const CSS = `
.wsp-root {
  position: fixed;
  z-index: 2147483000;
  right: 16px;
  bottom: 16px;
  width: min(320px, calc(100vw - 24px));
  font-family: "IBM Plex Sans", "Segoe UI", system-ui, sans-serif;
  font-size: 14px;
  line-height: 1.4;
  color: #1a242c;
  box-sizing: border-box;
}
.wsp-root *, .wsp-root *::before, .wsp-root *::after { box-sizing: border-box; }
.wsp-panel {
  background: #f7fafc;
  border: 1px solid #c5d2db;
  border-radius: 12px;
  box-shadow: 0 8px 28px rgba(26, 36, 44, 0.18);
  overflow: hidden;
}
.wsp-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 10px 12px;
  background: #e8eef2;
  border-bottom: 1px solid #c5d2db;
  cursor: move;
  user-select: none;
}
.wsp-title { font-weight: 600; font-size: 13px; margin: 0; }
.wsp-nick { color: #5a6b76; font-size: 12px; }
.wsp-body { padding: 12px; display: grid; gap: 10px; }
.wsp-pill {
  display: inline-block;
  padding: 4px 8px;
  border: 1px solid #c5d2db;
  background: #fff;
  border-radius: 6px;
  font-size: 12px;
}
.wsp-pill.wsp-ok { border-color: #0f6e56; color: #0f6e56; }
.wsp-pill.wsp-warn { border-color: #8a5a00; color: #8a5a00; }
.wsp-pill.wsp-err { border-color: #9b1c1c; color: #9b1c1c; }
.wsp-pill.wsp-incoming { border-color: #0f6e56; background: #e6f4ef; color: #0f6e56; }
.wsp-row { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
.wsp-input {
  flex: 1;
  min-width: 0;
  font: inherit;
  padding: 8px 10px;
  border: 1px solid #c5d2db;
  border-radius: 8px;
  background: #fff;
  color: #1a242c;
}
.wsp-btn {
  font: inherit;
  cursor: pointer;
  border: 1px solid #0f6e56;
  background: #0f6e56;
  color: #fff;
  padding: 8px 12px;
  border-radius: 8px;
}
.wsp-btn:disabled { opacity: 0.5; cursor: not-allowed; }
.wsp-btn.wsp-secondary {
  background: #fff;
  color: #1a242c;
  border-color: #c5d2db;
}
.wsp-btn.wsp-danger {
  background: #9b1c1c;
  border-color: #9b1c1c;
}
.wsp-btn.wsp-success {
  background: #0f6e56;
  border-color: #0f6e56;
}
.wsp-hint { margin: 0; color: #5a6b76; font-size: 12px; }
.wsp-error { margin: 0; color: #9b1c1c; font-size: 12px; }
.wsp-audio {
  position: absolute;
  width: 1px;
  height: 1px;
  opacity: 0;
  pointer-events: none;
  overflow: hidden;
}
.wsp-log-panel {
  max-height: 140px;
  overflow: auto;
  border: 1px solid #c5d2db;
  border-radius: 8px;
  background: #fff;
}
.wsp-log {
  margin: 0;
  padding: 8px;
  font-family: ui-monospace, "Cascadia Code", monospace;
  font-size: 11px;
  line-height: 1.35;
  white-space: pre-wrap;
  word-break: break-word;
}
.wsp-minimized .wsp-body { display: none; }
.wsp-toggle {
  border: none;
  background: transparent;
  color: #5a6b76;
  cursor: pointer;
  font: inherit;
  padding: 2px 6px;
}
`;

export function ensureStyles() {
  if (typeof document === "undefined") return;
  if (document.getElementById(STYLE_ID)) return;
  const el = document.createElement("style");
  el.id = STYLE_ID;
  el.textContent = CSS;
  document.head.appendChild(el);
}

export function removeStyles() {
  document.getElementById(STYLE_ID)?.remove();
}
