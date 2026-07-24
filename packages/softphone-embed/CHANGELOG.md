# Changelog — @wosobo/softphone-embed

## 0.2.0

- **Headless API:** `/embed/softphone-headless.js`, global `WosoboSoftphoneHeadless`
  - `connect({ token, nick, wsBase?, iceServers?, playRingtone?, … })`
  - methods: `dial`, `accept`, `decline`, `hangup`, `setMute`, `reconnect`, `disconnect`, `getState`
  - hidden `<audio>` for remote media; no floating UI
- Core: `iceServers` option, `getState()`, `dial`/`accept` Promise rejects on failure
- Smoke page: `/demo/headless.html`

## 0.1.0

- Initial UI embed: `WosoboSoftphone.mount`
