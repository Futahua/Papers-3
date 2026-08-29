import os
import sqlite3
import tempfile
import unittest
from types import SimpleNamespace
from unittest import mock

import handoff_core
import mesh_broker


class TypedTimelineExportTest(unittest.TestCase):
    def test_read_projection_preserves_identity_without_changing_handoff_default(self):
        with tempfile.TemporaryDirectory() as temp:
            db_path = os.path.join(temp, "state.db")
            conn = sqlite3.connect(db_path)
            conn.executescript("""
                CREATE TABLE sessions (
                    id TEXT PRIMARY KEY,
                    parent_session_id TEXT
                );
                CREATE TABLE messages (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    session_id TEXT,
                    role TEXT,
                    content TEXT,
                    timestamp REAL,
                    display_kind TEXT,
                    display_metadata TEXT
                );
                INSERT INTO sessions VALUES ('session-1', NULL);
                INSERT INTO messages (
                    session_id, role, content, timestamp, display_kind, display_metadata
                ) VALUES (
                    'session-1', 'user', 'wake', 123,
                    'delegate_wave_wake', '{"event_id":"wake_123","source":"delegate-wave"}'
                );
            """)
            conn.commit()
            row_id = conn.execute("SELECT id FROM messages").fetchone()[0]
            conn.close()

            ordinary = handoff_core.export_session(db_path, "session-1")
            self.assertNotIn("id", ordinary["messages"][0])
            self.assertNotIn("row_id", ordinary["messages"][0])

            timeline = handoff_core.export_session(
                db_path, "session-1", include_message_row_ids=True)
            message = timeline["messages"][0]
            self.assertEqual(message["row_id"], row_id)
            self.assertEqual(message["display_kind"], "delegate_wave_wake")
            self.assertEqual(
                message["display_metadata"],
                '{"event_id":"wake_123","source":"delegate-wave"}')
            self.assertNotIn("id", message)

    def test_desktop_history_forwards_typed_timeline_fields(self):
        broker = object.__new__(mesh_broker.MeshBroker)
        broker.home = "unused"
        broker.identity = SimpleNamespace(device_id="pc-a")
        metadata = '{"event_id":"wake_123","source":"delegate-wave"}'
        bundle = {
            "sessions": [{"id": "session-1", "title": "Proof", "source": "desktop"}],
            "messages": [{
                "row_id": 106,
                "session_id": "session-1",
                "role": "user",
                "content": "[delegate-wave-wake:wake_123]",
                "timestamp": 123,
                "display_kind": "delegate_wave_wake",
                "display_metadata": metadata,
            }],
        }
        with mock.patch.object(mesh_broker.de, "export_for_handoff", return_value=bundle) as export:
            result = broker._desktop_session_history("session-1")
        export.assert_called_once_with(
            "unused", "session-1", source_device="pc-a",
            include_memory=False, include_message_row_ids=True)
        message = result["messages"][0]
        self.assertEqual(message["row_id"], 106)
        self.assertEqual(message["display_kind"], "delegate_wave_wake")
        self.assertEqual(message["display_metadata"], metadata)


if __name__ == "__main__":
    unittest.main()
