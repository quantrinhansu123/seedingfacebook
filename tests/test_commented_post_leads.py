import unittest
from unittest.mock import patch

import app as backend


class CommentedPostLeadTests(unittest.TestCase):
    def _log(self, staff_id="sale-1", comment_id="comment-1", status="success"):
        return {
            "staff_id": staff_id,
            "staff_name": "Sale One",
            "staff_username": "sale01",
            "post_id": "post-123",
            "group_id": "group-9",
            "post_url": "https://facebook.com/post-123",
            "comment_text": "Please contact our business at 0986070286",
            "comment_id": comment_id,
            "status": status,
            "created_at": "2026-07-22T12:00:00Z",
        }

    @patch.object(backend, "_save_leads_to_supabase", return_value=(True, ""))
    @patch.object(backend, "_merge_leads_into_memory")
    def test_same_staff_and_post_use_one_stable_key(self, merge_mock, _save_mock):
        first, _, _ = backend._upsert_lead_from_comment_log(
            self._log(comment_id="comment-1"),
            {"platform": "facebook", "customer_name": "Customer"},
        )
        second, _, _ = backend._upsert_lead_from_comment_log(
            self._log(comment_id="comment-2"),
            {"platform": "facebook", "customer_name": "Customer"},
        )

        self.assertEqual(first["lead_key"], second["lead_key"])
        self.assertEqual(second["comment_id"], "comment-2")
        self.assertEqual(merge_mock.call_count, 2)

    @patch.object(backend, "_save_leads_to_supabase", return_value=(True, ""))
    @patch.object(backend, "_merge_leads_into_memory")
    def test_different_staff_get_different_leads(self, _merge_mock, _save_mock):
        first, _, _ = backend._upsert_lead_from_comment_log(self._log(staff_id="sale-1"))
        second, _, _ = backend._upsert_lead_from_comment_log(self._log(staff_id="sale-2"))

        self.assertNotEqual(first["lead_key"], second["lead_key"])
        self.assertEqual(first["processed_by_staff_id"], "sale-1")
        self.assertEqual(second["processed_by_staff_id"], "sale-2")

    def test_supabase_row_keeps_comment_owner_during_admin_backfill(self):
        lead = backend._lead_from_comment_log(self._log(staff_id="sale-1"))
        with patch.object(
            backend,
            "_current_staff",
            return_value={"id": "admin-1", "name": "Admin", "username": "admin"},
        ):
            row = backend._lead_to_supabase_row(lead)

        self.assertEqual(row["created_by_staff_id"], "sale-1")
        self.assertEqual(row["created_by_staff_name"], "Sale One")
        self.assertEqual(row["created_by_staff_username"], "sale01")

    @patch.object(backend, "_save_leads_to_supabase", return_value=(True, ""))
    @patch.object(backend, "_merge_leads_into_memory")
    def test_reconcile_backfills_unique_missing_staff_posts(self, merge_mock, save_mock):
        first = self._log(staff_id="sale-1", comment_id="comment-1")
        duplicate = self._log(staff_id="sale-1", comment_id="comment-2")
        second_staff = self._log(staff_id="sale-2", comment_id="comment-3")
        existing = backend._lead_from_comment_log(first)

        with patch.object(backend, "_deleted_lead_keys", set()):
            result, error = backend._reconcile_commented_post_leads(
                [first, duplicate, second_staff],
                {"post-123": [existing]},
            )

        self.assertEqual(error, "")
        self.assertEqual(result["candidate_count"], 2)
        self.assertEqual(result["existing_count"], 1)
        self.assertEqual(result["created_count"], 1)
        self.assertEqual(merge_mock.call_args.args[0][0]["processed_by_staff_id"], "sale-2")
        self.assertEqual(save_mock.call_args.args[0][0]["processed_by_staff_id"], "sale-2")

    @patch.object(backend, "_save_leads_to_supabase")
    @patch.object(backend, "_merge_leads_into_memory")
    def test_failed_comment_does_not_create_lead(self, merge_mock, save_mock):
        lead, ok, error = backend._upsert_lead_from_comment_log(self._log(status="failed"))

        self.assertEqual(lead, {})
        self.assertTrue(ok)
        self.assertEqual(error, "")
        merge_mock.assert_not_called()
        save_mock.assert_not_called()

    @patch.object(backend, "_save_leads_to_supabase", return_value=(True, ""))
    @patch.object(backend, "_merge_leads_into_memory")
    def test_outbound_staff_phone_is_not_customer_phone(self, _merge_mock, _save_mock):
        lead, _, _ = backend._upsert_lead_from_comment_log(
            self._log(),
            {"platform": "facebook", "customer_name": "Customer", "customer_need": "Needs product advice"},
        )

        self.assertEqual(lead["phone"], "")
        self.assertEqual(lead["phones"], [])

    def test_non_admin_only_sees_owned_leads(self):
        leads = {
            "post-1": [{"processed_by_staff_id": "sale-1", "lead_key": "one"}],
            "post-2": [{"processed_by_staff_id": "sale-2", "lead_key": "two"}],
        }
        with patch.object(backend, "_is_admin", return_value=False), patch.object(
            backend,
            "_current_staff",
            return_value={"id": "sale-1", "name": "Sale One", "username": "sale01"},
        ):
            filtered = backend._filter_leads_for_current_staff(leads)

        self.assertEqual(list(filtered), ["post-1"])

    def test_successful_comment_log_creates_lead(self):
        lead = {"lead_key": "stable-key"}
        with patch.object(
            backend,
            "_current_staff",
            return_value={"id": "sale-1", "name": "Sale One", "username": "sale01"},
        ), patch.object(backend, "_save_comment_logs"), patch.object(
            backend,
            "_save_comment_log_to_supabase",
            return_value=(True, ""),
        ), patch.object(
            backend,
            "_upsert_lead_from_comment_log",
            return_value=(lead, True, ""),
        ) as upsert_mock:
            log = backend._record_comment_log(
                "post-123",
                "group-9",
                "https://facebook.com/post-123",
                "Outbound reply",
                "page-1",
                "success",
                lead_context={"customer_name": "Customer"},
            )

        upsert_mock.assert_called_once()
        self.assertEqual(log["lead_key"], "stable-key")
        self.assertEqual(log["lead_storage"], "supabase")

    def test_failed_comment_log_does_not_create_lead(self):
        with patch.object(
            backend,
            "_current_staff",
            return_value={"id": "sale-1", "name": "Sale One", "username": "sale01"},
        ), patch.object(backend, "_save_comment_logs"), patch.object(
            backend,
            "_save_comment_log_to_supabase",
            return_value=(True, ""),
        ), patch.object(backend, "_upsert_lead_from_comment_log") as upsert_mock:
            backend._record_comment_log(
                "post-123",
                "group-9",
                "https://facebook.com/post-123",
                "Outbound reply",
                "page-1",
                "failed",
                error_message="Facebook rejected the comment",
            )

        upsert_mock.assert_not_called()


if __name__ == "__main__":
    unittest.main()
