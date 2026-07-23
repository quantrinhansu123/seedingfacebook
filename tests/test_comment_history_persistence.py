import unittest
from unittest.mock import patch

import app as backend


class FakeResponse:
    status_code = 200
    text = ""

    def __init__(self, rows):
        self._rows = rows

    def json(self):
        return self._rows


class CommentHistoryPersistenceTests(unittest.TestCase):
    def _row(self, **overrides):
        row = {
            "staff_id": "sale-1",
            "staff_name": "Sale One",
            "post_id": "post-1",
            "comment_id": "comment-1",
            "comment_text": "Outbound reply",
            "status": "success",
            "error_message": "",
            "created_at": "2026-07-22T12:00:00Z",
        }
        row.update(overrides)
        return row

    def test_merge_deduplicates_local_and_supabase_timestamp_formats(self):
        local = self._row()
        remote = self._row(id=12, created_at="2026-07-22T12:00:00+00:00")

        rows = backend._merge_comment_log_rows([local], [remote])

        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["id"], 12)
        self.assertEqual(rows[0]["storage"], "supabase")

    def test_merge_keeps_unsynced_local_history(self):
        local = self._row(post_id="post-local", comment_id="local")
        remote = self._row(post_id="post-remote", comment_id="remote", id=8)

        rows = backend._merge_comment_log_rows([local], [remote])

        self.assertEqual([row["post_id"] for row in rows], ["post-local", "post-remote"])
        self.assertEqual(rows[0]["storage"], "local")
        self.assertEqual(rows[1]["storage"], "supabase")

    def test_supabase_query_is_scoped_to_staff(self):
        with patch.object(backend, "SUPABASE_URL", "https://project.supabase.co"), patch.object(
            backend,
            "SUPABASE_KEY",
            "test-key",
        ), patch.object(
            backend._req,
            "get",
            return_value=FakeResponse([self._row(id=7)]),
        ) as get_mock:
            rows, warning = backend._load_comment_logs_from_supabase("sale-1")

        self.assertEqual(warning, "")
        self.assertEqual(rows[0]["id"], 7)
        self.assertEqual(get_mock.call_args.kwargs["params"]["staff_id"], "eq.sale-1")

    def test_history_endpoint_recovers_from_empty_render_storage(self):
        remote = self._row(id=20)
        with patch.object(backend, "_comment_logs", []), patch.object(
            backend,
            "_is_admin",
            return_value=False,
        ), patch.object(
            backend,
            "_current_staff_id",
            return_value="sale-1",
        ), patch.object(
            backend,
            "_load_comment_logs_from_supabase",
            return_value=([remote], ""),
        ) as load_mock, backend.app.test_request_context("/api/comment-logs"):
            response = backend.comment_logs_get()

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.get_json()[0]["post_id"], "post-1")
        load_mock.assert_called_once_with("sale-1")


if __name__ == "__main__":
    unittest.main()
