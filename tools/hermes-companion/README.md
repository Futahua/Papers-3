# Hermes phone connector ("Run on Computer" PC side)

Lets the Apers Android app find this PC and run tasks on the creator's existing
Hermes — no terminal, QR scanning, or pairing codes. Local Wi-Fi is used when
available; Tailscale carries the same encrypted pairing over mobile data.

- Vendored from [HenWorks/Hermes-agent-android-PC-companion-app](https://github.com/HenWorks/Hermes-agent-android-PC-companion-app)
  (AGPL-3.0, see `LICENSE`; vendored at upstream commit `6ce9eb4`).
- `apers_connector.py` is the Papers-specific headless launcher: adds LAN UDP
  auto-discovery (udp/48856) so the phone pairs silently, advertises
  `_hermes-handoff._tcp.` for the phone's stock rediscovery, runs tasks via the
  hermes-agent venv CLI (`hermes chat --quiet --query`) against the same
  `~/.hermes` home Papers' dashboard uses. Phone conversations resume a durable
  Hermes session instead of creating unrelated one-shot sessions.
- The phone's main Desktop destination can list real Hermes sessions, bind its
  current conversation to a selected stable session id, load the visible text
  transcript, or explicitly start a new Desktop session. These control messages
  use the existing paired NaCl-encrypted push/poll channel and never reach the
  model.
- While a phone turn is running, the connector publishes encrypted progress
  events from Hermes' own session database (thinking, tool start, and tool
  completion) before publishing the final answer. The phone acknowledges each
  event without completing the task, so long-running work no longer appears
  frozen.
- Short, clearly conversational follow-ups use a deliberately narrow direct
  route with no tool schema. Action requests, current-information questions,
  URLs, paths, and substantial prompts retain the complete configured Hermes
  toolset. This prevents casual questions from launching unsolicited file/log
  investigations without weakening actual remote work.
- New phone-started sessions use the real first prompt as their Desktop title.
  On startup, the connector repairs only untitled legacy sessions whose first
  user message contains the old `[Phone dispatch]` transport marker.
- If Tailscale is installed, the connector automatically advertises and binds
  its 100.x address as an alternate endpoint. Install and sign in to Tailscale
  on the phone once; the app then fails over between Wi-Fi and mobile data.
- NaCl-box end-to-end encryption remains in place on both routes;
  `auth.json`/`.env` never leave the PC.

Install / update on this machine:

```powershell
powershell -ExecutionPolicy Bypass -File install-connector.ps1
```

That installs the connector runtime to
`%USERPROFILE%\.hermes\mesh\{venv,companion}`, adds a logon autostart shortcut
("Hermes Connector"), and starts it immediately.

Runtime state follows Hermes itself: when `HERMES_HOME` is set, the log, trust
store, queue, and identity live under `$HERMES_HOME\mesh`; otherwise they live
under `%USERPROFILE%\.hermes\mesh`. In particular, see `connector.log` for the
service log and `peers.json` for trusted phones (remove a peer entry to un-pair).
