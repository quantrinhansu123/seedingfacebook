import unittest
from contextlib import ExitStack
from unittest.mock import patch

import app as backend


class StartupSnapshotTests(unittest.TestCase):
    def test_snapshot_loads_independent_supabase_data_and_isolates_failures(self):
        with ExitStack() as stack:
            stack.enter_context(patch.object(backend.sb, 'kv_get_many', return_value={'settings': {'interval': 5}}))
            stack.enter_context(patch.object(backend.sb, 'list_seen_post_ids', return_value={'post-1'}))
            stack.enter_context(patch.object(backend.sb, 'list_chat_ids', return_value=['123']))
            stack.enter_context(patch.object(backend.sb, 'list_groups', side_effect=RuntimeError('groups unavailable')))
            stack.enter_context(patch.object(backend.sb, 'list_classifications', return_value={'post-1': 'lead'}))
            stack.enter_context(patch.object(backend.sb, 'list_managed_channels', return_value=[{'id': 'channel-1'}]))
            stack.enter_context(patch.object(backend, '_load_business_profile_from_supabase', return_value=({}, '')))
            stack.enter_context(patch.object(backend, '_list_supabase_staff', return_value=([], '')))

            values, errors = backend._load_supabase_startup_snapshot()

        self.assertEqual(values['kv'], {'settings': {'interval': 5}})
        self.assertEqual(values['seen_ids'], {'post-1'})
        self.assertEqual(values['managed_channels'], [{'id': 'channel-1'}])
        self.assertNotIn('groups', values)
        self.assertIn('groups unavailable', errors['groups'])


if __name__ == '__main__':
    unittest.main()
