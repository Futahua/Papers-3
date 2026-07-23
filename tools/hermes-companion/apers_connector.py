"""Apers phone connector — headless, zero-terminal launcher for the Hermes PC companion.

Runs the vendored mesh broker (HenWorks/Hermes-agent-android-PC-companion-app, AGPL-3.0,
see LICENSE) so the Apers Android app's "Run on Computer" screen can find this PC and
connect with no terminal, no QR and no typed pairing code:

- TCP broker on the fixed companion port (51379): pair / push / poll / ack /
  pull / push_session — the exact protocol the phone binary already speaks
  (4-byte framed JSON, NaCl box, pair-once trust in ~/.hermes/mesh/peers.json).
- UDP discovery responder on 48856: the phone broadcasts "APERS_MESH_DISCOVER_V1"
  on the LAN; we reply with the same JSON the pairing QR would contain
  (v1: did / pk / host / port). Receiving a probe opens the pairing window for
  180 s, so pairing is zero-touch while a phone is actively looking.
- mDNS: advertises both `_hermes-mesh._tcp.` (companion stock) and
  `_hermes-handoff._tcp.` (what the phone's stock rediscovery fallback resolves,
  TXT did=<device id>) for the same broker port.
- Tasks run through the SAME Hermes the creator already uses: the hermes-agent
  venv CLI (`hermes -z <prompt>`) against the default ~/.hermes home — the home
  Papers' 127.0.0.1:9119 dashboard uses. No second dashboard/backend is started,
  no port is taken besides the companion's own.

LAN-only. Nothing leaves the network; auth.json/.env are never read or sent
(the vendored exporter only touches state.db + memories/).

Logs to ~/.hermes/mesh/connector.log. Single instance is enforced by the fixed
TCP port (a second launch exits quietly).
"""
from __future__ import annotations

import errno
import json
import os
import socket
import sys
import threading
import time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

DISCOVERY_PORT = 48856
PROBE = b"APERS_MESH_DISCOVER_V1"
PAIR_WINDOW_SEC = 180

DEFAULT_HERMES_EXE = (
    r"D:\LapSlop brotherhood\Programs\Assistant\HermesAI\.hermes"
    r"\hermes-agent\venv\Scripts\hermes.exe"
)


def _home() -> str:
    return os.environ.get("HERMES_HOME") or os.path.expanduser("~/.hermes")


def _log_path() -> str:
    d = os.path.join(_home(), "mesh")
    os.makedirs(d, exist_ok=True)
    return os.path.join(d, "connector.log")


def _log(msg: str) -> None:
    print(time.strftime("[%Y-%m-%d %H:%M:%S] ") + msg, flush=True)


def _hermes_cmd() -> list[str]:
    exe = os.environ.get("APERS_HERMES_EXE") or DEFAULT_HERMES_EXE
    if os.path.isfile(exe):
        return [exe, "-z"]
    return ["hermes", "-z"]  # PATH fallback


def _discovery_loop(broker) -> None:
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    if sys.platform == "win32":
        s.setsockopt(socket.SOL_SOCKET, socket.SO_EXCLUSIVEADDRUSE, 1)
    else:
        s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    s.bind(("0.0.0.0", DISCOVERY_PORT))
    _log(f"discovery responder listening on udp/{DISCOVERY_PORT}")
    while True:
        try:
            data, addr = s.recvfrom(2048)
        except OSError:
            break
        if data.strip() != PROBE:
            continue
        # A phone on this LAN is actively looking: invite it. The reply is the
        # exact pairing-QR JSON (public info only — never the private key).
        broker.open_pairing(PAIR_WINDOW_SEC)
        reply = json.dumps(
            {
                "v": 1,
                "did": broker.identity.device_id,
                "pk": broker.identity.public_b64,
                "host": broker.host,
                "port": broker.port,
            },
            separators=(",", ":"),
        ).encode("utf-8")
        try:
            s.sendto(reply, addr)
            _log(f"discovery probe from {addr[0]} -> invited (pairing open {PAIR_WINDOW_SEC}s)")
        except OSError:
            pass


def _advertise_handoff_alias(broker):
    """Also advertise `_hermes-handoff._tcp.` — the service type the phone's stock
    HandoffDiscovery resolves (TXT did) when a stored host stops answering."""
    try:
        from zeroconf import ServiceInfo, Zeroconf
    except ImportError:
        return None
    zc = Zeroconf()
    st = "_hermes-handoff._tcp.local."
    info = ServiceInfo(
        st,
        f"hermes-{broker.identity.device_id}.{st}",
        addresses=[socket.inet_aton(broker.host)],
        port=broker.port,
        properties={"did": broker.identity.device_id, "ver": "1"},
    )
    zc.register_service(info)
    return zc


def main() -> int:
    # Headless logging (pythonw has no console).
    if os.environ.get("APERS_CONNECTOR_FOREGROUND") != "1":
        log = open(_log_path(), "a", encoding="utf-8", buffering=1)
        sys.stdout = log
        sys.stderr = log

    import mesh_broker as mb

    cmd = _hermes_cmd()
    try:
        broker = mb.serve(hermes_cmd=cmd)
    except OSError as e:
        if e.errno == errno.EADDRINUSE:
            _log("connector already running (companion port busy) — exiting")
            return 0
        raise

    _log(
        f"connector up: did={broker.identity.device_id} broker={broker.host}:{broker.port} "
        f"hermes={' '.join(cmd)} home={_home()}"
    )
    _advertise_handoff_alias(broker)
    threading.Thread(target=_discovery_loop, args=(broker,), daemon=True).start()

    # Optional local console (QR fallback for manual pairing). Never auto-opens
    # a browser; the URL is written to the log and ~/.hermes/mesh/console.url.
    try:
        from companion_web import serve_web

        web_host, web_port = serve_web(broker)
        url = f"http://{web_host}:{web_port}/"
        with open(os.path.join(_home(), "mesh", "console.url"), "w", encoding="utf-8") as f:
            f.write(url)
        _log(f"console (manual QR fallback): {url}")
    except Exception as e:  # noqa: BLE001 — console is optional
        _log(f"console unavailable: {e}")

    try:
        while True:
            time.sleep(3600)
    except KeyboardInterrupt:
        broker.stop()
    return 0


if __name__ == "__main__":
    sys.exit(main())
