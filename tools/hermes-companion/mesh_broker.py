"""
mesh_broker — desktop-side mesh broker + worker (LAN-first, M1+M2).

Purpose (see android/docs/mesh-design.md): let the phone app dispatch tasks asynchronously
to the desktop hermes to run, then collect the results.
M2 single-machine case: **the broker IS the worker node itself** — phone↔desktop direct e2e
(the broker is the recipient, it does not relay-decrypt).
Multi-node relay (broker forwards to other workers without decrypting) is future work, not done here.

Reuses the handoff foundation (zero rebuild):
- pairing.py: DeviceIdentity / load_or_create_identity / box_encrypt|decrypt / build_pair_qr
- handoff_server.py: PeerStore (pairing trust) / _send_frame|_recv_frame (4-byte framing) / _local_ip

Protocol (one op per connection, following the handoff handshake+auth model):
  1. client sends {did, pk} in plaintext (hello)
  2. broker checks is_paired → {ok, proto} or {ok:false, err}
  3. client sends Box(client_sk→broker_pk)(request JSON), one of these ops:
       push  {op:"push", task:{id,prompt,created_at}}  → enqueue work; reply {ok, id}
       poll  {op:"poll"}                                → reply Box(broker_sk→client_pk)({ok, results:[...]})
       ack   {op:"ack", ids:[...]}                      → delete received results; reply {ok}
    worker thread: take a pending task → run a quiet Hermes chat query, resuming the
    canonical conversation session when present → write result to outbox.

🔴 Security: the broker binds only to specific LAN and optional private Tailscale addresses
   (not 0.0.0.0); only accepts public keys of paired nodes; payload is NaCl e2e; the payload
   never contains credentials (only the task prompt and result text). The private key never
   leaves the machine.
"""
from __future__ import annotations

import json
import os
import re
import shutil
import socket
import sys
import sqlite3
import subprocess
import threading
import time
import uuid
from dataclasses import dataclass, field
from typing import Callable, Optional

import pairing as pr
import handoff_server as hs
import desktop_export as de   # handoff: export a session into an encryptable transport bundle
import handoff_core as hc      # reverse sync (#22): phone uploads bundle → import_all idempotently merges into PC
from i18n import t            # i18n for user-facing CLI output (English fallback)

SERVICE_TYPE = "_hermes-mesh._tcp.local."
PROTO = 1
MAX_RESULT_CHARS = 64 * 1024  # per-result cap, to avoid an abnormally long output blowing up notification/transport
# Kept only to clean the titles/previews of sessions created by older companion
# versions. New phone messages are sent to Hermes verbatim, so session names stay
# useful and do not expose transport details in the Desktop sidebar.
LEGACY_MESH_TASK_MARKER = "📱 [Phone dispatch] "
CHAT_PROMPT_PREFIX = "__APERS_CHAT_V1__:"
CHAT_RESULT_PREFIX = "__APERS_CHAT_RESULT_V1__:"
CHAT_PROGRESS_PREFIX = "__APERS_PROGRESS_V1__\n"
CONTROL_LIST_CONVERSATION = "__desktop_sessions__"
CONTROL_BIND_CONVERSATION = "__desktop_bind__"
CONTROL_NEW_CONVERSATION = "__desktop_new__"
CONTROL_PORT_CONVERSATION = "__desktop_port__"
CONTROL_RENAME_CONVERSATION = "__desktop_rename__"
CONTROL_ARCHIVE_CONVERSATION = "__desktop_archive__"
CONTROL_LIST_PROMPT = "__APERS_LIST_DESKTOP_SESSIONS_V1__"
CONTROL_BIND_PROMPT = "__APERS_BIND_DESKTOP_SESSION_V1__"
CONTROL_NEW_PROMPT = "__APERS_NEW_DESKTOP_SESSION_V1__"
CONTROL_PORT_PROMPT = "__APERS_PORT_PHONE_SESSION_V1__"
CONTROL_RENAME_PROMPT = "__APERS_RENAME_DESKTOP_SESSION_V1__"
CONTROL_ARCHIVE_PROMPT = "__APERS_ARCHIVE_DESKTOP_SESSION_V1__"
CHAT_ID_RE = re.compile(r"^[A-Za-z0-9._:-]{1,160}$")
SESSION_ID_RE = re.compile(r"(?:^|\n)session_id:\s*([^\s]+)", re.IGNORECASE)
QUIET_NOISE_RE = re.compile(
    r"^(?:Warning: Unknown toolsets: .+|↪ restored workspace dir: .+)$")
# Fixed default port (⚠️ must be fixed, not random): after pairing, the phone app stores host:port
# in the peer and keeps connecting with it. If the broker picks a new port on every restart, the
# phone can't reach it (shows offline, dispatch fails). 51379 is a high port that avoids common services.
DEFAULT_PORT = 51379

_ACTION_PROMPT_RE = re.compile(
    r"\b(?:build|browse|check|connect|create|debug|delete|deploy|diagnose|"
    r"download|edit|fetch|find|fix|implement|inspect|install|look\s+up|make|"
    r"merge|open|patch|push|read|remove|rename|research|run|search|send|test|"
    r"update|upload|verify|write|work\s+on)\b",
    re.IGNORECASE,
)
_CURRENT_INFO_RE = re.compile(
    r"\b(?:current|currently|latest|live|news|online|price|score|today|"
    r"tomorrow|weather)\b",
    re.IGNORECASE,
)


def _is_direct_conversation(prompt: str) -> bool:
    """Conservatively identify short turns that should not receive tool schemas.

    Every actionable or current-information request keeps the normal full Hermes
    toolset. The direct path is intentionally narrow: casual follow-ups such as
    "why did that take 30 seconds?" avoid an unsolicited multi-tool investigation.
    """
    text = re.sub(r"\s+", " ", str(prompt or "")).strip()
    if not text or len(text) > 420:
        return False
    if any(marker in text for marker in ("```", "://", "\\", "/")):
        return False
    if _ACTION_PROMPT_RE.search(text) or _CURRENT_INFO_RE.search(text):
        return False
    lowered = text.lower()
    return (
        lowered.startswith(("why ", "how ", "explain ", "tell me "))
        or lowered in {
            "hi", "hello", "hey", "thanks", "thank you", "ok", "okay",
            "yes", "no", "good", "nice", "cool", "what do you mean",
        }
    )


def _tool_activity(tool_name: str, arguments: object = None) -> tuple[str, str]:
    """Return a compact, user-facing activity label and optional detail."""
    name = str(tool_name or "tool").strip()
    labels = {
        "search_files": "Searching files",
        "read_file": "Reading a file",
        "write_file": "Writing a file",
        "apply_patch": "Editing files",
        "terminal": "Running a command",
        "execute_command": "Running a command",
        "browser": "Using the browser",
        "web_search": "Searching the web",
        "search_web": "Searching the web",
        "load_skill": "Loading a skill",
        "delegate_task": "Delegating work",
    }
    label = labels.get(name, name.replace("_", " ").strip().capitalize())
    if not isinstance(arguments, dict):
        return label, ""
    detail = ""
    for key in ("path", "pattern", "query", "command", "url", "skill", "task"):
        value = arguments.get(key)
        if isinstance(value, str) and value.strip():
            detail = re.sub(r"\s+", " ", value).strip()
            break
    return label, detail[:180]


def _bounded_activity_value(value: object, limit: int = 2400) -> object:
    """Keep progress payloads useful without letting tool args/results flood polling."""
    try:
        encoded = json.dumps(value, ensure_ascii=False, separators=(",", ":"))
    except (TypeError, ValueError):
        return str(value)[:limit]
    if len(encoded) <= limit:
        return value
    if isinstance(value, dict):
        bounded = {}
        for key, item in value.items():
            bounded[str(key)[:80]] = (
                re.sub(r"\s+", " ", str(item)).strip()[:500])
            if len(json.dumps(
                    bounded, ensure_ascii=False, separators=(",", ":"))) >= limit:
                break
        return bounded
    return encoded[:limit]


def _bounded_tool_calls(calls: list) -> list:
    """Preserve OpenAI tool-call shape while bounding argument payloads."""
    bounded = []
    for call in calls[:16]:
        if not isinstance(call, dict):
            continue
        function = call.get("function") or {}
        raw_arguments = function.get("arguments") or "{}"
        try:
            arguments = json.loads(raw_arguments) if isinstance(
                raw_arguments, str) else raw_arguments
        except (TypeError, ValueError, json.JSONDecodeError):
            arguments = {}
        call_id = str(
            call.get("id") or call.get("call_id") or uuid.uuid4().hex)
        bounded.append({
            "id": call_id,
            "call_id": call_id,
            "type": "function",
            "function": {
                "name": str(function.get("name") or "tool")[:160],
                "arguments": json.dumps(
                    _bounded_activity_value(arguments),
                    ensure_ascii=False, separators=(",", ":")),
            },
        })
    return bounded


def _repair_legacy_phone_titles(home: str) -> int:
    """Give old marker-prefixed phone sessions a clean Desktop title.

    Only sessions with no explicit title and a first user message carrying the
    companion's former marker are touched. The original message remains intact,
    so this is a presentation repair rather than a transcript rewrite.
    """
    state_db = os.path.join(home, "state.db")
    if not os.path.isfile(state_db):
        return 0
    conn = sqlite3.connect(state_db, timeout=10)
    try:
        rows = conn.execute(
            "SELECT s.id, first_message.content "
            "FROM sessions s JOIN messages first_message ON "
            "first_message.id=("
            " SELECT m.id FROM messages m WHERE m.session_id=s.id "
            " AND m.role='user' ORDER BY m.timestamp LIMIT 1"
            ") WHERE (s.title IS NULL OR TRIM(s.title)='') "
            "AND first_message.content LIKE ?",
            (LEGACY_MESH_TASK_MARKER + "%",),
        ).fetchall()
        updates = []
        for session_id, content in rows:
            clean = re.sub(r"\s+", " ", str(content)).strip()
            clean = clean[len(LEGACY_MESH_TASK_MARKER):].lstrip()
            if clean:
                updates.append((clean[:120], session_id))
        if updates:
            with conn:
                conn.executemany(
                    "UPDATE sessions SET title=? WHERE id=?", updates)
        return len(updates)
    finally:
        conn.close()


# ── Queue store (SQLite, enough for personal scale) ─────────────────────────────

class MeshStore:
    """tasks (pending to run) + results (pending phone pickup). Single-file SQLite, shared by broker and worker."""

    def __init__(self, path: str):
        self.path = path
        d = os.path.dirname(os.path.abspath(path)) or "."
        os.makedirs(d, exist_ok=True)
        # check_same_thread=False: shared by the broker connection threads and the worker thread; serialized via _lock
        self._db = sqlite3.connect(path, check_same_thread=False)
        self._db.execute("PRAGMA journal_mode=WAL")
        self._lock = threading.Lock()
        self._init_schema()

    def _init_schema(self):
        with self._lock, self._db:
            self._db.execute(
                "CREATE TABLE IF NOT EXISTS tasks("
                "id TEXT PRIMARY KEY, from_did TEXT NOT NULL, prompt TEXT NOT NULL,"
                "status TEXT NOT NULL DEFAULT 'pending', created REAL NOT NULL,"
                "conversation_id TEXT)")
            self._db.execute(
                "CREATE TABLE IF NOT EXISTS results("
                "id TEXT PRIMARY KEY, ref TEXT NOT NULL, to_did TEXT NOT NULL,"
                "ok INTEGER NOT NULL, text TEXT NOT NULL, created REAL NOT NULL,"
                "delivered INTEGER NOT NULL DEFAULT 0, conversation_id TEXT,"
                "session_id TEXT)")
            self._db.execute(
                "CREATE TABLE IF NOT EXISTS conversations("
                "owner_did TEXT NOT NULL, conversation_id TEXT NOT NULL,"
                "session_id TEXT, created REAL NOT NULL, updated REAL NOT NULL,"
                "PRIMARY KEY(owner_did, conversation_id))")
        # migration: add the delivered column to old dbs (ignore if it already exists) → ack now marks as
        # delivered instead of deleting, so results can be retained in the console
        with self._lock:
            for statement in (
                "ALTER TABLE results ADD COLUMN delivered INTEGER NOT NULL DEFAULT 0",
                "ALTER TABLE results ADD COLUMN conversation_id TEXT",
                "ALTER TABLE results ADD COLUMN session_id TEXT",
                "ALTER TABLE tasks ADD COLUMN conversation_id TEXT",
            ):
                try:
                    with self._db:
                        self._db.execute(statement)
                except sqlite3.OperationalError:
                    pass

    def add_task(self, task_id: str, from_did: str, prompt: str,
                 conversation_id: str | None = None) -> None:
        with self._lock, self._db:
            self._db.execute(
                "INSERT OR IGNORE INTO tasks("
                "id, from_did, prompt, status, created, conversation_id"
                ") VALUES(?,?,?,'pending',?,?)",
                (task_id, from_did, prompt, time.time(), conversation_id))
            if conversation_id:
                now = time.time()
                self._db.execute(
                    "INSERT OR IGNORE INTO conversations("
                    "owner_did, conversation_id, session_id, created, updated"
                    ") VALUES(?,?,NULL,?,?)",
                    (from_did, conversation_id, now, now))

    def claim_next_task(self) -> Optional[dict]:
        """Atomically take one pending task → mark running, return {id, from_did, prompt}. None if none."""
        with self._lock, self._db:
            row = self._db.execute(
                "SELECT id, from_did, prompt, conversation_id "
                "FROM tasks WHERE status='pending' "
                "ORDER BY created LIMIT 1").fetchone()
            if not row:
                return None
            self._db.execute("UPDATE tasks SET status='running' WHERE id=?", (row[0],))
            return {
                "id": row[0],
                "from_did": row[1],
                "prompt": row[2],
                "conversation_id": row[3],
            }

    def finish_task(self, task_id: str) -> None:
        with self._lock, self._db:
            self._db.execute("UPDATE tasks SET status='done' WHERE id=?", (task_id,))

    def requeue_running(self) -> int:
        """On startup, restore tasks stuck in 'running' back to 'pending' (crash recovery for a
        mid-flight broker restart, at-least-once). Returns the number of tasks re-enqueued."""
        with self._lock, self._db:
            cur = self._db.execute("UPDATE tasks SET status='pending' WHERE status='running'")
            return cur.rowcount

    def conversation_session(self, owner_did: str,
                             conversation_id: str | None) -> str | None:
        if not conversation_id:
            return None
        with self._lock:
            row = self._db.execute(
                "SELECT session_id FROM conversations "
                "WHERE owner_did=? AND conversation_id=?",
                (owner_did, conversation_id)).fetchone()
        return row[0] if row and row[0] else None

    def set_conversation_session(self, owner_did: str, conversation_id: str | None,
                                 session_id: str | None) -> None:
        if not conversation_id:
            return
        now = time.time()
        with self._lock, self._db:
            self._db.execute(
                "INSERT INTO conversations("
                "owner_did, conversation_id, session_id, created, updated"
                ") VALUES(?,?,?,?,?) "
                "ON CONFLICT(owner_did, conversation_id) DO UPDATE SET "
                "session_id=excluded.session_id, updated=excluded.updated",
                (owner_did, conversation_id, session_id, now, now))

    def add_result(self, ref: str, to_did: str, ok: bool, text: str,
                   conversation_id: str | None = None,
                   session_id: str | None = None) -> None:
        with self._lock, self._db:
            self._db.execute(
                "INSERT INTO results("
                "id, ref, to_did, ok, text, created, conversation_id, session_id"
                ") VALUES(?,?,?,?,?,?,?,?)",
                (uuid.uuid4().hex, ref, to_did, 1 if ok else 0,
                 text[:MAX_RESULT_CHARS], time.time(), conversation_id, session_id))

    def pending_results(self, to_did: str) -> list[dict]:
        """Results pending phone pickup: return only not-yet-delivered (delivered=0) ones, to avoid duplicate notifications."""
        with self._lock, self._db:
            rows = self._db.execute(
                "SELECT id, ref, ok, text, created, conversation_id, session_id "
                "FROM results "
                "WHERE to_did=? AND delivered=0 ORDER BY created", (to_did,)).fetchall()
        return [{"id": r[0], "ref": r[1], "ok": bool(r[2]), "text": r[3],
                 "created": r[4], "conversation_id": r[5], "session_id": r[6]}
                for r in rows]

    def mark_delivered(self, ids: list[str], to_did: str) -> None:
        """Mark results as delivered (don't delete; keep them for desktop console viewing), **bound to
        owner to_did**: a paired node cannot ack/mark someone else's results. After poll these are no
        longer returned → no duplicate notifications."""
        if not ids:
            return
        with self._lock, self._db:
            self._db.executemany(
                "UPDATE results SET delivered=1 WHERE id=? AND to_did=?", [(i, to_did) for i in ids])


# ── Broker + Worker ──────────────────────────────────────────────────────────

@dataclass
class MeshBroker:
    identity: pr.DeviceIdentity
    peers: hs.PeerStore
    store: MeshStore
    # command to run a task; {prompt} is passed by the worker as an argument (no shell string concatenation, injection-safe)
    hermes_cmd: list[str] = field(
        default_factory=lambda: ["hermes", "chat", "--quiet", "--query"])
    home: Optional[str] = None
    host: str = ""          # primary advertised address (LAN by default)
    alternate_hosts: list[str] = field(default_factory=list)
    port: int = 0           # 0 = auto-select

    _sock: Optional[socket.socket] = None
    _socks: list[socket.socket] = field(default_factory=list)
    _running: bool = False
    _zc = None
    _zc_info = None
    _pairing_until: float = 0.0   # pairing-window expiry timestamp (time.time()); before this, not open

    # ---- pairing window ----
    def open_pairing(self, window_sec: int = 300) -> None:
        """Open a time-limited pairing window: during it, an unpaired node may use the pair op to join trust."""
        self._pairing_until = time.time() + window_sec

    def _pairing_open(self) -> bool:
        return time.time() < self._pairing_until

    # ---- connection handling (one op per connection) ----
    def _handle(self, conn: socket.socket):
        try:
            _peer = conn.getpeername()[0] if conn.fileno() != -1 else "?"
        except OSError:
            _peer = "?"
        try:
            hello = json.loads(hs._recv_frame(conn).decode("utf-8"))
            cdid, cpk = hello["did"], pr._b64d(hello["pk"])
            paired = self.peers.is_paired(cdid, cpk)
            # Unpaired: only allowed to continue while the pairing window is open (to run the pair op); otherwise reject.
            if not paired and not self._pairing_open():
                print(f"[mesh] ✗ rejected {_peer} did={cdid[:8]}: not paired and pairing window closed", flush=True)
                hs._send_frame(conn, json.dumps({"ok": False, "err": "not paired"}).encode())
                return
            hs._send_frame(conn, json.dumps({"ok": True, "proto": PROTO, "paired": paired}).encode())

            # Encrypted request: a successful box_decrypt(broker_sk, cpk) means the peer holds the private
            # key for cpk (authenticating that public key) and encrypted to broker_pk (proving it scanned
            # the QR to obtain the broker public key). pair establishes trust on these two points + the time window.
            req = json.loads(pr.box_decrypt(self.identity.private_key, cpk, hs._recv_frame(conn)))
            op = req.get("op")
            if op != "poll":  # poll runs every few seconds, too frequent — don't print to avoid spam; keep a diagnostic trail for other ops
                print(f"[mesh] ← {_peer} did={cdid[:8]} op={op} paired={paired}", flush=True)
            if op == "pair":
                self._op_pair(conn, cdid, cpk)
                return
            # all other ops require being paired (an open pairing window does not mean dispatch is allowed)
            if not paired:
                hs._send_frame(conn, json.dumps({"ok": False, "err": "not paired"}).encode())
                return
            if op == "push":
                self._op_push(conn, cdid, req)
            elif op == "poll":
                self._op_poll(conn, cpk, cdid)
            elif op == "ack":
                self.store.mark_delivered(list(req.get("ids", [])), cdid)  # mark delivered (don't delete), bound to authenticated identity
                hs._send_frame(conn, json.dumps({"ok": True}).encode())
            elif op == "pull":
                self._op_pull(conn, cpk, req)   # handoff: export the specified session bundle, encrypt and return
            elif op == "push_session":
                self._op_push_session(conn, req)  # reverse sync: phone uploads bundle, idempotently merge into PC
            else:
                hs._send_frame(conn, json.dumps({"ok": False, "err": f"bad op: {op}"}).encode())
        except Exception as e:  # noqa: BLE001 — a single-connection error must not take down the broker
            print(f"[mesh] ✗ connection {_peer} handling error: {type(e).__name__}: {e}", flush=True)
            try:
                hs._send_frame(conn, json.dumps({"ok": False, "err": str(e)}).encode())
            except OSError:
                pass
        finally:
            conn.close()

    def _op_pair(self, conn, cdid: str, cpk: bytes):
        """Add the phone's public key to trust (reverse pairing). Already paired → idempotent pass-through
        (re-scanning the handoff QR shouldn't fail just because the pairing window expired); if unpaired,
        it must be within the time-limited window, rejected outside it."""
        if self.peers.is_paired(cdid, cpk):
            hs._send_frame(conn, json.dumps({"ok": True, "did": self.identity.device_id}).encode())
            return
        if not self._pairing_open():
            hs._send_frame(conn, json.dumps({"ok": False, "err": "pairing window closed"}).encode())
            return
        self.peers.add(cdid, cpk)
        hs._send_frame(conn, json.dumps({"ok": True, "did": self.identity.device_id}).encode())

    def _op_push(self, conn, cdid: str, req: dict):
        task = req.get("task") or {}
        prompt = (task.get("prompt") or "").strip()
        if not prompt:
            hs._send_frame(conn, json.dumps({"ok": False, "err": "empty prompt"}).encode())
            return
        conversation_id = None
        if prompt.startswith(CHAT_PROMPT_PREFIX):
            header, separator, body = prompt.partition("\n")
            candidate = header[len(CHAT_PROMPT_PREFIX):].strip()
            if separator and CHAT_ID_RE.fullmatch(candidate):
                conversation_id = candidate
                prompt = body.strip()
            if not prompt:
                hs._send_frame(conn, json.dumps({"ok": False, "err": "empty prompt"}).encode())
                return
        tid = task.get("id") or uuid.uuid4().hex
        if self._handle_chat_control(tid, cdid, conversation_id, prompt):
            hs._send_frame(conn, json.dumps({
                "ok": True,
                "id": tid,
                "conversation_id": conversation_id,
            }).encode())
            return
        self.store.add_task(tid, cdid, prompt, conversation_id)
        hs._send_frame(conn, json.dumps({
            "ok": True,
            "id": tid,
            "conversation_id": conversation_id,
        }).encode())

    def _handle_chat_control(self, tid: str, cdid: str,
                             conversation_id: str | None, prompt: str) -> bool:
        """Handle phone session-management commands without involving the model.

        These commands still travel through the paired NaCl-encrypted push/poll
        channel. Their results use the normal chat envelope so Android's
        background worker leaves them for the WebUI to consume and acknowledge.
        """
        command, separator, raw_payload = prompt.partition("\n")
        expected = {
            CONTROL_LIST_CONVERSATION: CONTROL_LIST_PROMPT,
            CONTROL_BIND_CONVERSATION: CONTROL_BIND_PROMPT,
            CONTROL_NEW_CONVERSATION: CONTROL_NEW_PROMPT,
            CONTROL_PORT_CONVERSATION: CONTROL_PORT_PROMPT,
            CONTROL_RENAME_CONVERSATION: CONTROL_RENAME_PROMPT,
            CONTROL_ARCHIVE_CONVERSATION: CONTROL_ARCHIVE_PROMPT,
        }
        if conversation_id not in expected or command != expected[conversation_id]:
            return False
        try:
            payload = json.loads(raw_payload) if separator and raw_payload else {}
            if not isinstance(payload, dict):
                raise ValueError("control payload must be an object")
            phone_conversation = str(payload.get("conversation_id") or "")
            if not CHAT_ID_RE.fullmatch(phone_conversation):
                raise ValueError("invalid conversation_id")

            if conversation_id == CONTROL_LIST_CONVERSATION:
                result = {
                    "sessions": self._desktop_session_catalog(),
                    "selected_session_id": self.store.conversation_session(
                        cdid, phone_conversation),
                }
            elif conversation_id == CONTROL_BIND_CONVERSATION:
                session_id = str(payload.get("session_id") or "")
                if not CHAT_ID_RE.fullmatch(session_id):
                    raise ValueError("invalid session_id")
                session = self._desktop_session_history(session_id)
                if session is None:
                    raise ValueError("desktop session not found")
                self.store.set_conversation_session(
                    cdid, phone_conversation, session_id)
                result = session
            elif conversation_id == CONTROL_NEW_CONVERSATION:
                self.store.set_conversation_session(cdid, phone_conversation, None)
                result = {"conversation_id": phone_conversation, "cleared": True}
            elif conversation_id == CONTROL_PORT_CONVERSATION:
                session_id = self._port_phone_session(
                    phone_conversation, payload)
                self.store.set_conversation_session(
                    cdid, phone_conversation, session_id)
                result = self._desktop_session_history(session_id)
                if result is None:
                    raise RuntimeError("ported Desktop session could not be loaded")
            elif conversation_id == CONTROL_RENAME_CONVERSATION:
                session_id = str(payload.get("session_id") or "")
                if not CHAT_ID_RE.fullmatch(session_id):
                    raise ValueError("invalid session_id")
                title = self._rename_desktop_session(
                    session_id, payload.get("title"))
                result = {"session_id": session_id, "title": title}
            else:
                session_id = str(payload.get("session_id") or "")
                if not CHAT_ID_RE.fullmatch(session_id):
                    raise ValueError("invalid session_id")
                archived = bool(payload.get("archived", True))
                self._archive_desktop_session(session_id, archived)
                if (archived and self.store.conversation_session(
                        cdid, phone_conversation) == session_id):
                    self.store.set_conversation_session(
                        cdid, phone_conversation, None)
                result = {
                    "session_id": session_id,
                    "archived": archived,
                }
            self._add_control_result(
                tid, cdid, conversation_id, True, result)
        except Exception as exc:  # noqa: BLE001 — return a bounded control error
            self._add_control_result(
                tid, cdid, conversation_id, False, {"error": str(exc)})
        return True

    def _add_control_result(self, ref: str, to_did: str,
                            conversation_id: str, ok: bool, value: dict) -> None:
        body = json.dumps(value, ensure_ascii=False, separators=(",", ":"))
        text = f"{CHAT_RESULT_PREFIX}{conversation_id}\n{body}"
        self.store.add_result(
            ref, to_did, ok, text, conversation_id=conversation_id)

    def _desktop_session_catalog(self, limit: int = 40) -> list[dict]:
        """Return bounded, top-level Desktop session summaries from a safe snapshot."""
        home = self.home or os.path.expanduser("~/.hermes")
        state_db = os.path.join(home, "state.db")
        if not os.path.isfile(state_db):
            raise FileNotFoundError(f"state.db not found: {state_db}")
        snap = de._snapshot(state_db)
        try:
            conn = sqlite3.connect(snap)
            conn.row_factory = sqlite3.Row
            rows = conn.execute(
                "SELECT s.id, s.title, s.source, s.started_at, s.message_count, "
                "MAX(m.timestamp) AS last_active, "
                "(SELECT content FROM messages first_message "
                " WHERE first_message.session_id=s.id "
                " AND first_message.role='user' "
                " ORDER BY first_message.timestamp LIMIT 1) AS preview "
                "FROM sessions s LEFT JOIN messages m ON m.session_id=s.id "
                "WHERE COALESCE(s.archived,0)=0 "
                "AND s.parent_session_id IS NULL "
                "AND COALESCE(s.message_count,0)>0 "
                "GROUP BY s.id "
                "ORDER BY COALESCE(MAX(m.timestamp),s.started_at) DESC LIMIT ?",
                (max(1, min(limit, 80)),),
            ).fetchall()
            sessions = []
            for row in rows:
                preview = self._clean_session_text(row["preview"])
                title = self._clean_session_text(row["title"]) or preview
                sessions.append({
                    "id": row["id"],
                    "title": (title or "Untitled session")[:120],
                    "preview": preview[:220],
                    "source": row["source"] or "desktop",
                    "started_at": row["started_at"],
                    "last_active": row["last_active"] or row["started_at"],
                    "message_count": row["message_count"] or 0,
                })
            return sessions
        finally:
            try:
                conn.close()
            except UnboundLocalError:
                pass
            try:
                os.remove(snap)
            except OSError:
                pass

    def _desktop_session_history(self, session_id: str) -> dict | None:
        """Return the visible text transcript for a Desktop session chain."""
        home = self.home or os.path.expanduser("~/.hermes")
        bundle = de.export_for_handoff(
            home, session_id, source_device=self.identity.device_id,
            include_memory=False)
        if bundle is None:
            return None
        sessions = bundle.get("sessions") or []
        selected = next(
            (item for item in sessions if item.get("id") == session_id),
            sessions[0] if sessions else {})
        visible = []
        for message in sorted(
                bundle.get("messages") or [],
                key=lambda item: float(item.get("timestamp") or 0)):
            role = message.get("role")
            content = str(message.get("content") or "").strip()
            if message.get("active") == 0:
                continue
            entry = {
                "role": role,
                "content": content[:2400],
                "timestamp": message.get("timestamp") or 0,
            }
            if role == "assistant":
                raw_calls = message.get("tool_calls")
                try:
                    calls = json.loads(raw_calls) if raw_calls else []
                except (TypeError, ValueError, json.JSONDecodeError):
                    calls = []
                if isinstance(calls, list) and calls:
                    entry["tool_calls"] = _bounded_tool_calls(calls)
                reasoning = str(
                    message.get("reasoning_content")
                    or message.get("reasoning") or "").strip()
                if reasoning:
                    entry["reasoning"] = reasoning[:2400]
                if not content and not entry.get("tool_calls") and not reasoning:
                    continue
            elif role == "tool":
                call_id = str(message.get("tool_call_id") or "").strip()
                if not call_id:
                    continue
                entry["tool_call_id"] = call_id
                entry["name"] = str(message.get("tool_name") or "")[:160]
            elif role == "user":
                if not content:
                    continue
            else:
                continue
            visible.append(entry)
        visible = visible[-96:]
        while visible and visible[0].get("role") != "user":
            visible.pop(0)
        preview = next(
            (self._clean_session_text(item["content"])
             for item in visible if item["role"] == "user"), "")
        title = self._clean_session_text(selected.get("title")) or preview
        result = {
            "session": {
                "id": session_id,
                "title": (title or "Untitled session")[:120],
                "source": selected.get("source") or "desktop",
                "started_at": selected.get("started_at"),
                "last_active": visible[-1]["timestamp"] if visible else
                    selected.get("started_at"),
                "message_count": selected.get("message_count") or len(visible),
            },
            "messages": visible,
        }
        # add_result() enforces a hard character cap. Keep the JSON valid by
        # removing the oldest visible rows before it reaches that boundary
        # instead of letting add_result() truncate the serialized payload.
        budget = MAX_RESULT_CHARS - 2048
        while result["messages"] and len(json.dumps(
                result, ensure_ascii=False, separators=(",", ":"))) > budget:
            result["messages"].pop(0)
            while (result["messages"]
                   and result["messages"][0].get("role") != "user"):
                result["messages"].pop(0)
        return result

    def _rename_desktop_session(self, session_id: str, raw_title) -> str:
        """Rename a Desktop session through the same encrypted control channel."""
        title = self._clean_session_text(raw_title)[:100]
        if not title:
            raise ValueError("session title is empty")
        state_db = os.path.join(
            self.home or os.path.expanduser("~/.hermes"), "state.db")
        if not os.path.isfile(state_db):
            raise FileNotFoundError(f"state.db not found: {state_db}")
        conn = sqlite3.connect(state_db, timeout=10)
        try:
            conn.execute("BEGIN IMMEDIATE")
            updated = conn.execute(
                "UPDATE sessions SET title=? WHERE id=?",
                (title, session_id),
            ).rowcount
            if not updated:
                raise ValueError("desktop session not found")
            conn.commit()
            return title
        except Exception:
            conn.rollback()
            raise
        finally:
            conn.close()

    def _archive_desktop_session(
            self, session_id: str, archived: bool = True) -> None:
        """Archive or restore a Desktop session without invoking the model."""
        state_db = os.path.join(
            self.home or os.path.expanduser("~/.hermes"), "state.db")
        if not os.path.isfile(state_db):
            raise FileNotFoundError(f"state.db not found: {state_db}")
        conn = sqlite3.connect(state_db, timeout=10)
        try:
            conn.execute("BEGIN IMMEDIATE")
            updated = conn.execute(
                "UPDATE sessions SET archived=? WHERE id=?",
                (1 if archived else 0, session_id),
            ).rowcount
            if not updated:
                raise ValueError("desktop session not found")
            conn.commit()
        except Exception:
            conn.rollback()
            raise
        finally:
            conn.close()

    def _port_phone_session(self, phone_conversation: str,
                            payload: dict) -> str:
        """Create a normal resumable CLI session from a bounded phone transcript."""
        raw_messages = payload.get("messages")
        if not isinstance(raw_messages, list) or not raw_messages:
            raise ValueError("phone transcript is empty")
        if len(json.dumps(raw_messages, ensure_ascii=False)) > 56 * 1024:
            raise ValueError("phone transcript is too large")

        messages = []
        for raw in raw_messages[-96:]:
            if not isinstance(raw, dict):
                continue
            role = str(raw.get("role") or "")
            if role not in {"user", "assistant", "tool"}:
                continue
            content = str(raw.get("content") or "")[:12000]
            entry = {
                "role": role,
                "content": content,
                "timestamp": raw.get("timestamp"),
                "active": 1,
                "compacted": 0,
            }
            if role == "assistant":
                calls = raw.get("tool_calls")
                if isinstance(calls, list) and calls:
                    entry["tool_calls"] = json.dumps(
                        _bounded_tool_calls(calls), ensure_ascii=False)
                reasoning = str(raw.get("reasoning") or "")[:12000]
                if reasoning:
                    entry["reasoning_content"] = reasoning
                if not content and not entry.get("tool_calls") and not reasoning:
                    continue
                if content:
                    entry["finish_reason"] = "stop"
            elif role == "tool":
                call_id = str(raw.get("tool_call_id") or "")[:200]
                if not call_id:
                    continue
                entry["tool_call_id"] = call_id
                entry["tool_name"] = str(
                    raw.get("name") or raw.get("tool_name") or "")[:160]
            elif not content:
                continue
            messages.append(entry)
        while messages and messages[0]["role"] != "user":
            messages.pop(0)
        if not messages:
            raise ValueError("phone transcript has no user messages")

        home = self.home or os.path.expanduser("~/.hermes")
        state_db = os.path.join(home, "state.db")
        if not os.path.isfile(state_db):
            raise FileNotFoundError(f"state.db not found: {state_db}")
        now = time.time()
        title = self._clean_session_text(payload.get("title"))
        if not title:
            title = next((
                self._clean_session_text(item["content"])
                for item in messages if item["role"] == "user"), "")
        title = (title or "Phone conversation")[:100]
        model = str(payload.get("model") or "")[:160] or None
        workspace = str(payload.get("workspace") or "")[:1024]
        port_id = str(
            payload.get("port_id") or phone_conversation)[:160]
        if not CHAT_ID_RE.fullmatch(port_id):
            raise ValueError("invalid port_id")

        conn = sqlite3.connect(state_db, timeout=10)
        conn.row_factory = sqlite3.Row
        try:
            conn.execute("BEGIN IMMEDIATE")
            existing_rows = conn.execute(
                "SELECT id, origin_json FROM sessions "
                "WHERE origin_json IS NOT NULL "
                "ORDER BY started_at DESC LIMIT 200"
            ).fetchall()
            for existing in existing_rows:
                try:
                    origin = json.loads(existing["origin_json"] or "{}")
                except (TypeError, ValueError, json.JSONDecodeError):
                    continue
                if (origin.get("kind") == "apers_phone_port"
                        and origin.get("port_id") == port_id):
                    conn.rollback()
                    return str(existing["id"])

            session_columns = {
                row["name"] for row in conn.execute(
                    "PRAGMA table_info(sessions)").fetchall()
            }
            message_columns = {
                row["name"] for row in conn.execute(
                    "PRAGMA table_info(messages)").fetchall()
            }
            template = conn.execute(
                "SELECT * FROM sessions "
                "WHERE COALESCE(archived,0)=0 AND parent_session_id IS NULL "
                "ORDER BY started_at DESC LIMIT 1"
            ).fetchone()
            template = dict(template) if template else {}

            session_id = (
                time.strftime("%Y%m%d_%H%M%S", time.localtime(now))
                + "_" + uuid.uuid4().hex[:6])
            while conn.execute(
                    "SELECT 1 FROM sessions WHERE id=?", (session_id,)).fetchone():
                session_id = (
                    time.strftime("%Y%m%d_%H%M%S", time.localtime(now))
                    + "_" + uuid.uuid4().hex[:6])

            timestamps = []
            for index, message in enumerate(messages):
                try:
                    stamp = float(message.get("timestamp") or 0)
                except (TypeError, ValueError):
                    stamp = 0
                if stamp <= 0:
                    stamp = now - (len(messages) - index) * 0.01
                if timestamps and stamp <= timestamps[-1]:
                    stamp = timestamps[-1] + 0.001
                timestamps.append(stamp)
                message["timestamp"] = stamp

            cwd = workspace if workspace and os.path.isdir(workspace) else (
                template.get("cwd") or os.getcwd())
            session_values = {
                "id": session_id,
                "source": "cli",
                "model": model or template.get("model"),
                "model_config": template.get("model_config"),
                "system_prompt": template.get("system_prompt"),
                "started_at": timestamps[0] if timestamps else now,
                "message_count": len(messages),
                "tool_call_count": sum(
                    1 for item in messages if item.get("tool_calls")),
                "cwd": cwd,
                "billing_provider": template.get("billing_provider"),
                "billing_base_url": template.get("billing_base_url"),
                "billing_mode": template.get("billing_mode"),
                "pricing_version": template.get("pricing_version"),
                "title": title,
                "rewind_count": 0,
                "archived": 0,
                "origin_json": json.dumps({
                    "kind": "apers_phone_port",
                    "conversation_id": phone_conversation,
                    "port_id": port_id,
                }, separators=(",", ":")),
                "profile_name": template.get("profile_name"),
            }
            session_values = {
                key: value for key, value in session_values.items()
                if key in session_columns
            }
            keys = list(session_values)
            conn.execute(
                f"INSERT INTO sessions ({','.join(keys)}) "
                f"VALUES ({','.join('?' for _ in keys)})",
                [session_values[key] for key in keys],
            )
            for message in messages:
                values = {"session_id": session_id, **message}
                values = {
                    key: value for key, value in values.items()
                    if key in message_columns
                }
                keys = list(values)
                conn.execute(
                    f"INSERT INTO messages ({','.join(keys)}) "
                    f"VALUES ({','.join('?' for _ in keys)})",
                    [values[key] for key in keys],
                )
            conn.commit()
            return session_id
        except Exception:
            conn.rollback()
            raise
        finally:
            conn.close()

    @staticmethod
    def _clean_session_text(value) -> str:
        text = re.sub(r"\s+", " ", str(value or "")).strip()
        if text.startswith(LEGACY_MESH_TASK_MARKER):
            text = text[len(LEGACY_MESH_TASK_MARKER):].lstrip()
        return text

    def _op_poll(self, conn, cpk: bytes, cdid: str):
        results = self.store.pending_results(cdid)
        payload = json.dumps({"ok": True, "results": results}, ensure_ascii=False).encode("utf-8")
        # results are encrypted via Box(broker_sk→client_pk) → only that phone can decrypt + verify the source
        hs._send_frame(conn, pr.box_encrypt(self.identity.private_key, cpk, payload))

    def _op_pull(self, conn, cpk: bytes, req: dict):
        """handoff op: encrypt and return the specified session's bundle to the paired phone (reusing desktop export).

        Shares the same trust domain and connection protocol as collaboration (push/poll/ack) → one server,
        one pairing supports both handoff and collaboration. Secrets never enter the bundle (desktop_export
        only reads state.db + memories/, never touches auth.json/.env). Response protocol: {ok} frame +
        Box(bundle) frame (aligned with the phone-side pull)."""
        session_id = req.get("session_id")
        if not session_id:
            hs._send_frame(conn, json.dumps({"ok": False, "err": "no session_id"}).encode())
            return
        home = self.home or os.path.expanduser("~/.hermes")
        try:
            bundle = de.export_for_handoff(home, session_id,
                                           source_device=self.identity.device_id)
        except Exception as e:  # noqa: BLE001 — export failure (db not found / schema too old) reported honestly
            hs._send_frame(conn, json.dumps({"ok": False, "err": str(e)}).encode())
            return
        if bundle is None:
            hs._send_frame(conn, json.dumps({"ok": False, "err": "session not found"}).encode())
            return
        payload = json.dumps(bundle, ensure_ascii=False).encode("utf-8")
        hs._send_frame(conn, json.dumps({"ok": True}).encode())
        # the bundle is encrypted via Box(broker_sk→client_pk) → only that phone can decrypt + verify the source
        hs._send_frame(conn, pr.box_encrypt(self.identity.private_key, cpk, payload))

    def _op_push_session(self, conn, req: dict):
        """reverse sync op (#22): the phone uploads bundles of all its local conversations → idempotently
        merge into PC state.db + memories via import_all (by-id upsert + message natural-key dedup +
        memory append-union).

        The bundle is already inside the encrypted req (box_decrypt has decoded it, encrypted end-to-end).
        Returns {ok, stats} (same stats as handoff import). Secrets are never affected: import only writes
        state.db + memories/, never touches auth.json/.env."""
        bundle = req.get("bundle")
        if not isinstance(bundle, dict):
            hs._send_frame(conn, json.dumps({"ok": False, "err": "no bundle"}).encode())
            return
        home = self.home or os.path.expanduser("~/.hermes")
        try:
            stats = hc.import_all(home, bundle)
        except Exception as e:  # noqa: BLE001 — import failure (schema mismatch / db locked) reported honestly
            hs._send_frame(conn, json.dumps({"ok": False, "err": str(e)}).encode())
            return
        hs._send_frame(conn, json.dumps({"ok": True, "stats": stats}, ensure_ascii=False).encode())

    # ---- worker: run hermes oneshot ----
    def _worker_loop(self):
        while self._running:
            task = self.store.claim_next_task()
            if task is None:
                time.sleep(1.0)
                continue
            print(f"[mesh] ▶ received task {task['id'][:8]} from={task['from_did'][:8]}: "
                  f"{task['prompt'][:80]}  → running {' '.join(self.hermes_cmd)} …", flush=True)
            t0 = time.time()
            conversation_id = task.get("conversation_id")
            session_id = self.store.conversation_session(
                task["from_did"], conversation_id)

            def report_progress(event: dict) -> None:
                if not conversation_id:
                    return
                body = CHAT_PROGRESS_PREFIX + json.dumps(
                    event, ensure_ascii=False, separators=(",", ":"))
                self.store.add_result(
                    task["id"], task["from_did"], True,
                    f"{CHAT_RESULT_PREFIX}{conversation_id}\n{body}",
                    conversation_id=conversation_id,
                    session_id=session_id)

            ok, text, next_session_id = self._run_hermes(
                task["prompt"], session_id, report_progress)
            if ok and conversation_id and next_session_id:
                self.store.set_conversation_session(
                    task["from_did"], conversation_id, next_session_id)
            print(f"[mesh] {'✓' if ok else '✗'} task {task['id'][:8]} done ({time.time()-t0:.1f}s)"
                  f": {text[:100].replace(chr(10), ' ')}", flush=True)
            result_text = text
            if conversation_id:
                # The Android background worker must leave main-chat replies in the
                # encrypted inbox for the WebUI bridge, which owns rendering + ACK.
                result_text = f"{CHAT_RESULT_PREFIX}{conversation_id}\n{text}"
            self.store.add_result(
                task["id"], task["from_did"], ok, result_text,
                conversation_id=conversation_id,
                session_id=next_session_id or session_id)
            self.store.finish_task(task["id"])
            print(f"[mesh] ⇧ result placed in the phone inbox, waiting for the phone to poll it", flush=True)

    def _run_hermes(
        self,
        prompt: str,
        session_id: str | None = None,
        progress_callback: Callable[[dict], None] | None = None,
    ) -> tuple[bool, str, str | None]:
        env = dict(os.environ)
        if self.home:
            env["HERMES_HOME"] = self.home
        state_db = os.path.join(
            self.home or os.path.expanduser("~/.hermes"), "state.db")
        started_at = time.time()
        observed_session_id = session_id
        observed_answer = ""
        last_message_id = 0
        seen_events: set[str] = set()

        def emit(phase: str, label: str, detail: str = "",
                 tool: str = "", call_id: str = "", **extra) -> None:
            if not progress_callback:
                return
            event = {
                "phase": phase,
                "label": label,
                "detail": detail[:180],
                "tool": tool,
                "call_id": call_id,
                "elapsed": round(time.time() - started_at, 1),
                "started_at": started_at,
            }
            event.update(extra)
            progress_callback(event)

        def discover_session() -> str | None:
            nonlocal observed_session_id
            if observed_session_id or not os.path.isfile(state_db):
                return observed_session_id
            conn = None
            try:
                conn = sqlite3.connect(state_db, timeout=1)
                row = conn.execute(
                    "SELECT s.id FROM sessions s JOIN messages m "
                    "ON m.session_id=s.id WHERE s.source='cli' "
                    "AND s.started_at>=? AND m.role='user' AND m.content=? "
                    "ORDER BY s.started_at DESC LIMIT 1",
                    (started_at - 2, prompt),
                ).fetchone()
                if row:
                    observed_session_id = str(row[0])
            except sqlite3.Error:
                pass
            finally:
                if conn is not None:
                    conn.close()
            return observed_session_id

        def inspect_activity() -> None:
            nonlocal last_message_id, observed_answer
            active_session = discover_session()
            if not active_session or not os.path.isfile(state_db):
                return
            conn = None
            try:
                conn = sqlite3.connect(state_db, timeout=1)
                if last_message_id == 0:
                    baseline = conn.execute(
                        "SELECT COALESCE(MAX(id),0) FROM messages "
                        "WHERE session_id=? AND timestamp<?",
                        (active_session, started_at - 0.5),
                    ).fetchone()
                    last_message_id = int(baseline[0] if baseline else 0)
                rows = conn.execute(
                    "SELECT id, role, tool_name, tool_call_id, tool_calls, content "
                    "FROM messages WHERE session_id=? AND id>? ORDER BY id",
                    (active_session, last_message_id),
                ).fetchall()
            except sqlite3.Error:
                return
            finally:
                if conn is not None:
                    conn.close()
            for (message_id, role, tool_name, tool_call_id,
                 tool_calls, content) in rows:
                last_message_id = max(last_message_id, int(message_id))
                if role == "assistant" and tool_calls:
                    try:
                        calls = json.loads(tool_calls)
                    except (TypeError, ValueError, json.JSONDecodeError):
                        calls = []
                    for call in calls if isinstance(calls, list) else []:
                        function = call.get("function") or {}
                        name = str(function.get("name") or "tool")
                        call_key = str(
                            call.get("call_id") or call.get("id") or message_id)
                        event_key = "start:" + call_key
                        if event_key in seen_events:
                            continue
                        seen_events.add(event_key)
                        try:
                            arguments = json.loads(
                                function.get("arguments") or "{}")
                        except (TypeError, ValueError, json.JSONDecodeError):
                            arguments = {}
                        label, detail = _tool_activity(name, arguments)
                        emit(
                            "tool_started", label, detail, name, call_key,
                            args=_bounded_activity_value(arguments))
                elif role == "assistant" and str(content or "").strip():
                    observed_answer = str(content).strip()
                elif role == "tool":
                    call_key = str(tool_call_id or message_id)
                    event_key = "done:" + call_key
                    if event_key in seen_events:
                        continue
                    seen_events.add(event_key)
                    label, _ = _tool_activity(str(tool_name or "tool"))
                    emit("tool_completed", label, "", str(tool_name or ""),
                         call_key,
                         result=str(content or "")[:2400])

        try:
            cmd = self.hermes_cmd + [prompt]
            if session_id and "--query" in self.hermes_cmd:
                cmd += ["--resume", session_id]
            if _is_direct_conversation(prompt) and "--toolsets" not in self.hermes_cmd:
                # An explicit unknown toolset resolves to an empty schema in
                # Hermes. The warning is filtered from quiet output below.
                # Actionable prompts never take this path and retain every tool.
                cmd += ["--toolsets", "none"]
            emit("thinking", "Hermes is thinking")
            proc = subprocess.Popen(
                cmd, stdin=subprocess.DEVNULL,
                stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                text=True, encoding="utf-8", errors="replace", env=env)
            stdout_parts: list[str] = []
            stderr_parts: list[str] = []

            def drain(stream, destination: list[str]) -> None:
                if stream is not None:
                    destination.append(stream.read())

            stdout_thread = threading.Thread(
                target=drain, args=(proc.stdout, stdout_parts), daemon=True)
            stderr_thread = threading.Thread(
                target=drain, args=(proc.stderr, stderr_parts), daemon=True)
            stdout_thread.start()
            stderr_thread.start()
            deadline = started_at + 900
            while proc.poll() is None:
                inspect_activity()
                if time.time() >= deadline:
                    proc.kill()
                    proc.wait(timeout=5)
                    stdout_thread.join(timeout=2)
                    stderr_thread.join(timeout=2)
                    return False, "task timed out (>15 minutes)", (
                        observed_session_id or session_id)
                time.sleep(0.35)
            stdout_thread.join(timeout=2)
            stderr_thread.join(timeout=2)
            inspect_activity()
            stdout = "".join(stdout_parts)
            stderr_text = "".join(stderr_parts)
            cli_out = "\n".join(
                line for line in stdout.splitlines()
                if not QUIET_NOISE_RE.match(line.strip())
            ).strip()
            # This is the exact answer Hermes Desktop renders. Quiet CLI stdout
            # can append decorative progress after it, which is not chat text.
            out = observed_answer or cli_out
            stderr = stderr_text.strip()
            match = SESSION_ID_RE.search("\n" + stderr)
            next_session_id = (
                match.group(1) if match else observed_session_id or session_id)
            if proc.returncode != 0:
                return False, (out + "\n" + stderr).strip()[:MAX_RESULT_CHARS] \
                    or f"hermes exited {proc.returncode}", next_session_id
            return True, out or "(no output)", next_session_id
        except FileNotFoundError:
            return False, (
                f"hermes command not found: {self.hermes_cmd[0]} "
                "(ensure it's installed and on PATH)"), session_id
        except Exception as e:  # noqa: BLE001
            return False, f"execution error: {e}", session_id

    # ---- lifecycle ----
    def start(self, advertise: bool = True) -> int:
        self.host = self.host or hs._local_ip()
        requested_hosts = list(dict.fromkeys(
            [self.host] + [h for h in self.alternate_hosts if h and h != self.host]))
        bound_hosts: list[str] = []
        requested_port = self.port
        first_error: OSError | None = None
        for bind_host in requested_hosts:
            sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            try:
                if sys.platform == "win32":
                    sock.setsockopt(
                        socket.SOL_SOCKET, socket.SO_EXCLUSIVEADDRUSE, 1)
                else:
                    sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
                sock.bind((bind_host, requested_port))
                if not self._socks:
                    self.port = sock.getsockname()[1]
                    requested_port = self.port
                sock.listen(8)
                self._socks.append(sock)
                bound_hosts.append(bind_host)
            except OSError as exc:
                sock.close()
                first_error = first_error or exc
                print(f"[mesh] ! could not bind alternate endpoint {bind_host}: "
                      f"{exc}", flush=True)
        if not self._socks:
            raise first_error or OSError("no broker endpoint could be bound")
        self._sock = self._socks[0]
        self.host = bound_hosts[0]
        self.alternate_hosts = bound_hosts[1:]
        self._running = True
        requeued = self.store.requeue_running()  # crash recovery: restore tasks stuck running last time back to pending
        if requeued:
            print(f"[mesh] re-enqueued {requeued} unfinished task(s) from last time")

        def accept_loop(sock: socket.socket):
            while self._running:
                try:
                    conn, _ = sock.accept()
                except OSError:
                    break
                threading.Thread(target=self._handle, args=(conn,), daemon=True).start()

        for index, sock in enumerate(self._socks):
            threading.Thread(
                target=accept_loop, args=(sock,),
                name=f"mesh-accept-{index}", daemon=True).start()
        threading.Thread(target=self._worker_loop, name="mesh-worker", daemon=True).start()
        if advertise:
            self._advertise()
        return self.port

    def _advertise(self):
        try:
            from zeroconf import ServiceInfo, Zeroconf
        except ImportError:
            return
        self._zc = Zeroconf()
        name = f"hermes-mesh-{self.identity.device_id}.{SERVICE_TYPE}"
        self._zc_info = ServiceInfo(
            SERVICE_TYPE, name,
            addresses=[socket.inet_aton(self.host)], port=self.port,
            properties={"did": self.identity.device_id, "ver": str(PROTO)})
        self._zc.register_service(self._zc_info)

    def stop(self):
        self._running = False
        if self._zc is not None:
            try:
                self._zc.unregister_service(self._zc_info)
                self._zc.close()
            except Exception:  # noqa: BLE001
                pass
        for sock in self._socks:
            try:
                sock.close()
            except OSError:
                pass
        self._socks.clear()
        self._sock = None

    def pair_qr(self) -> str:
        """Pure pairing QR (for the phone to scan to establish trust). Reuses the handoff v1 schema."""
        return pr.build_pair_qr(
            self.identity, self.host, self.port, self.alternate_hosts)

    def handoff_qr(self, session_id: str) -> str:
        """Handoff QR: pairing info + the specified session_id. The phone's first scan both pairs and
        selects the conversation to receive. With the unified server, handoff and collaboration share
        this identity; scanning this QR both establishes trust and specifies the handoff session."""
        return pr.build_handoff_qr(
            self.identity, self.host, self.port, session_id,
            self.alternate_hosts)


# ── Standalone launch (one-line desktop command) ──────────────────────────────

_MESH_SUBDIR = "mesh"  # ~/.hermes/mesh/ (mesh identity + peer list, a trust domain separate from handoff)


def _tailscale_ipv4() -> str | None:
    """Return this machine's Tailscale IPv4 when the CLI is installed.

    This is discovery only: traffic still uses the same paired, NaCl-encrypted
    broker protocol. No Tailscale credentials are read by the companion.
    """
    candidates = [shutil.which("tailscale")]
    if sys.platform == "win32":
        candidates.append(r"C:\Program Files\Tailscale\tailscale.exe")
    for executable in dict.fromkeys(path for path in candidates if path):
        try:
            proc = subprocess.run(
                [executable, "ip", "-4"],
                capture_output=True, text=True, timeout=3)
        except (OSError, subprocess.SubprocessError):
            continue
        if proc.returncode != 0:
            continue
        for line in proc.stdout.splitlines():
            value = line.strip()
            if value.startswith("100.") and value.count(".") == 3:
                return value
    return None


def serve(home: Optional[str] = None, advertise: bool = True,
          hermes_cmd: Optional[list[str]] = None, host: str = "",
          port: int = DEFAULT_PORT) -> MeshBroker:
    home = home or os.environ.get("HERMES_HOME") or os.path.expanduser("~/.hermes")
    repaired = _repair_legacy_phone_titles(home)
    if repaired:
        print(f"[mesh] repaired {repaired} legacy phone session title(s)",
              flush=True)
    cfg = os.path.join(home, _MESH_SUBDIR)
    os.makedirs(cfg, exist_ok=True)
    identity = pr.load_or_create_identity(os.path.join(cfg, "id.key"))
    peers = hs.PeerStore(os.path.join(cfg, "peers.json"))
    store = MeshStore(os.path.join(cfg, "queue.db"))
    cmd = hermes_cmd or _default_hermes_cmd()
    # Primary address source priority: argument > MESH_HOST > auto LAN. When
    # Tailscale is available, bind it as a second endpoint and include it in the
    # same pairing record. The Android client already remembers `alts` and tries
    # the last-good address first, so Wi-Fi ↔ mobile-data transitions are automatic.
    bind_host = host or os.environ.get("MESH_HOST", "") or hs._local_ip()
    alternate_hosts: list[str] = []
    if os.environ.get("APERS_DISABLE_TAILSCALE") != "1":
        tailscale_host = _tailscale_ipv4()
        if tailscale_host and tailscale_host != bind_host:
            alternate_hosts.append(tailscale_host)
    # the port is fixed (see DEFAULT_PORT): the port stored in the phone peer must stay valid, not random.
    bind_port = port if port is not None else int(os.environ.get("MESH_PORT", DEFAULT_PORT))
    broker = MeshBroker(identity=identity, peers=peers, store=store,
                        hermes_cmd=cmd, home=home, host=bind_host,
                        alternate_hosts=alternate_hosts, port=bind_port)
    broker.start(advertise=advertise)
    return broker


def _default_hermes_cmd() -> list[str]:
    if os.environ.get("HERMES_MESH_CMD"):
        return os.environ["HERMES_MESH_CMD"].split()
    return ["hermes", "chat", "--quiet", "--query"]


def add_peer_from_phone(broker: MeshBroker, phone_did: str, phone_pk_b64: str) -> None:
    """After the phone scans the broker QR, add the phone's public key to trust (reverse pairing).
    M1: the phone-side pairing request carries its own did/pk; this function is called by the pairing flow to store it in PeerStore."""
    broker.peers.add(phone_did, pr._b64d(phone_pk_b64))


def main(argv=None) -> int:
    import argparse
    try:
        import qrcode  # optional: print a QR image in the terminal; if absent, print text only
    except ImportError:
        qrcode = None

    ap = argparse.ArgumentParser(
        prog="hermes-companion",
        description="hermes desktop companion service: collaborative dispatch (mesh) + conversation handoff, one process, one pairing")
    ap.add_argument("--home", default=None, help="HERMES_HOME (default ~/.hermes)")
    ap.add_argument("--host", default="", help="bind/QR address (cross-network: a Tailscale 100.x; default auto LAN)")
    ap.add_argument("--port", type=int, default=DEFAULT_PORT,
                    help=f"broker bind port (default fixed {DEFAULT_PORT}; fixed so the phone keeps reaching it after pairing)")
    ap.add_argument("--session", default=None,
                    help="handoff a specific session: print a handoff QR (the phone pairs + receives this conversation after scanning). Omit to print a pure pairing QR.")
    a = ap.parse_args(argv)

    broker = serve(a.home, host=a.host, port=a.port)
    broker.open_pairing(300)  # open a 5-minute pairing window at startup, so the phone can complete reverse pairing after scanning the QR
    print(t("started", id=broker.identity.device_id, bind=f"{broker.host}:{broker.port}"))
    # local browser console (North Star: zero terminal on PC) — bound to 127.0.0.1 for the local browser only, opened cross-platform via webbrowser.
    try:
        from companion_web import serve_web
        web_host, web_port = serve_web(broker)
        url = f"http://{web_host}:{web_port}/"
        print(t("console", url=url))
        import webbrowser
        webbrowser.open(url)
    except Exception as e:  # noqa: BLE001 — a console failure doesn't affect the broker itself, fall back to the terminal QR
        print(t("console_fail", err=e))

    # terminal text / ASCII QR (fallback: no GUI / over SSH)
    if a.session:
        print(t("handoff_qr", session=a.session))
        qr = broker.handoff_qr(a.session)
    else:
        print(t("pair_qr"))
        qr = broker.pair_qr()
    print(qr)
    if qrcode is not None:
        try:
            q = qrcode.QRCode(border=2, box_size=1)
            q.add_data(qr)
            q.print_ascii(invert=True)
        except Exception:  # noqa: BLE001
            pass
    print(t("running"))
    try:
        while True:
            time.sleep(3600)
    except KeyboardInterrupt:
        broker.stop()
        print("\n" + t("stopped"))
    return 0


if __name__ == "__main__":
    import sys
    sys.exit(main())
