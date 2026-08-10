import unittest
from unittest.mock import Mock, patch

import app as backend


class FlowLeadSyncTests(unittest.TestCase):
    def test_flow_lead_row_maps_owner_and_flow_columns(self):
        source = {
            'lead_key': 'lead-1',
            'lead_source': 'commented_post',
            'post_url': 'https://facebook.com/posts/1',
            'customer_name': 'Khách A',
            'customer_phone': '0901234567',
            'contact_status': 'has_phone',
            'created_by_staff_id': 'sale-source-id',
            'created_by_staff_name': 'Trần Thế Tài',
            'created_by_staff_username': 'tai.tt',
            'raw_lead': {
                'created_by_staff_id': 'sale-source-id',
                'processed_by_staff_id': 'sale-source-id',
            },
        }
        owner_map = {
            'username:tai.tt': {
                'id': 'flow-user-id',
                'name': 'Trần Thế Tài',
                'username': 'tai.tt',
            },
        }

        row = backend._flow_lead_row(source, owner_map)

        self.assertEqual(row['created_by_staff_id'], 'flow-user-id')
        self.assertEqual(row['phu_trach'], 'flow-user-id')
        self.assertEqual(row['raw_lead']['processed_by_staff_id'], 'flow-user-id')
        self.assertEqual(row['ho_ten'], 'Khách A')
        self.assertEqual(row['so_dien_thoai'], '0901234567')
        self.assertEqual(row['nguon'], 'commented_post')
        self.assertEqual(row['anh_nhu_cau_url'], 'https://facebook.com/posts/1')
        self.assertEqual(row['trang_thai'], 'qualified')
        self.assertTrue(row['hop_le'])

    def test_sync_deduplicates_rows_and_upserts_by_lead_key(self):
        response = Mock(status_code=201)
        rows = [
            {'lead_key': 'lead-1', 'customer_name': 'Bản cũ'},
            {'lead_key': 'lead-1', 'customer_name': 'Bản mới'},
            {'lead_key': 'lead-2', 'customer_name': 'Lead 2'},
        ]

        with (
            patch.object(backend, 'SUPABASE_URL', 'https://source.supabase.co'),
            patch.object(backend, 'FLOW_SUPABASE_URL', 'https://target.supabase.co'),
            patch.object(backend, 'FLOW_SUPABASE_KEY', 'publishable-key'),
            patch.object(backend, 'FLOW_SUPABASE_SYNC_ENABLED', True),
            patch.object(backend, '_flow_owner_map', return_value=({}, '')),
            patch.object(backend._req, 'post', return_value=response) as post,
        ):
            ok, error, count = backend._sync_lead_rows_to_flow(rows)

        self.assertTrue(ok)
        self.assertEqual(error, '')
        self.assertEqual(count, 2)
        payload = post.call_args.kwargs['json']
        self.assertEqual({row['lead_key'] for row in payload}, {'lead-1', 'lead-2'})
        lead_one = next(row for row in payload if row['lead_key'] == 'lead-1')
        self.assertEqual(lead_one['customer_name'], 'Bản mới')
        self.assertIn('on_conflict=lead_key', post.call_args.args[0])

    def test_sync_is_disabled_when_source_and_target_are_the_same(self):
        with (
            patch.object(backend, 'SUPABASE_URL', 'https://same.supabase.co'),
            patch.object(backend, 'FLOW_SUPABASE_URL', 'https://same.supabase.co/'),
            patch.object(backend, 'FLOW_SUPABASE_KEY', 'publishable-key'),
            patch.object(backend, 'FLOW_SUPABASE_SYNC_ENABLED', True),
        ):
            self.assertFalse(backend._flow_lead_sync_enabled())


if __name__ == '__main__':
    unittest.main()
