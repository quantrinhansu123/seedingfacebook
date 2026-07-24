import unittest
from unittest.mock import Mock, patch

from core import supabase_store


class SupabaseStoreTests(unittest.TestCase):
    def test_kv_get_many_uses_one_request_and_maps_values(self):
        response = Mock()
        response.json.return_value = [
            {'key': 'settings', 'value': {'interval': 5}},
            {'key': 'ai_config', 'value': {'provider': 'gemini'}},
        ]

        with patch.object(supabase_store, '_request', return_value=response) as request_mock:
            result = supabase_store.kv_get_many(['settings', 'ai_config', 'settings'])

        self.assertEqual(
            result,
            {
                'settings': {'interval': 5},
                'ai_config': {'provider': 'gemini'},
            },
        )
        request_mock.assert_called_once_with(
            'GET',
            'app_kv?select=key,value&key=in.(settings,ai_config)',
        )

    def test_kv_get_many_skips_request_for_empty_keys(self):
        with patch.object(supabase_store, '_request') as request_mock:
            result = supabase_store.kv_get_many([])

        self.assertEqual(result, {})
        request_mock.assert_not_called()


if __name__ == '__main__':
    unittest.main()
