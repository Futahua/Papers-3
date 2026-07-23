# Hermes phone connector ("Run on Computer" PC side)

Lets the Apers Android app find this PC on the same Wi-Fi and run tasks on the
creator's existing Hermes — no terminal, no QR scanning, no pairing codes.

- Vendored from [HenWorks/Hermes-agent-android-PC-companion-app](https://github.com/HenWorks/Hermes-agent-android-PC-companion-app)
  (AGPL-3.0, see `LICENSE`; vendored at upstream commit `6ce9eb4`).
- `apers_connector.py` is the Papers-specific headless launcher: adds LAN UDP
  auto-discovery (udp/48856) so the phone pairs silently, advertises
  `_hermes-handoff._tcp.` for the phone's stock rediscovery, runs tasks via the
  hermes-agent venv CLI (`hermes -z`) against the same `~/.hermes` home Papers'
  dashboard (127.0.0.1:9119) uses — it never starts a second Hermes backend.
- LAN-only; NaCl-box end-to-end encryption; `auth.json`/`.env` never leave the PC.

Install / update on this machine:

```powershell
powershell -ExecutionPolicy Bypass -File install-connector.ps1
```

That installs to `%USERPROFILE%\.hermes\mesh\{venv,companion}`, adds a logon
autostart shortcut ("Hermes Connector"), and starts it immediately. Log:
`%USERPROFILE%\.hermes\mesh\connector.log`. Trusted phones:
`%USERPROFILE%\.hermes\mesh\peers.json` (delete a line to un-pair).
