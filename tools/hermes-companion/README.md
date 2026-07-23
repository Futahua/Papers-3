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
