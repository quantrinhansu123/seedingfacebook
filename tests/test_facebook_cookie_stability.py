import os
import tempfile
import time
import unittest
from concurrent.futures import ThreadPoolExecutor
from unittest.mock import patch

import requests

import app as backend
from core import group_api


class FakeResponse:
    def __init__(self, payload):
        self.payload = payload

    def json(self):
        return self.payload


class FacebookCookieStabilityTests(unittest.TestCase):
    def test_persisted_cookie_selects_the_matching_cookie_without_active_id_column(self):
        row = {
            'cookie': 'c_user=2; xs=new',
            'facebook_cookies': [
                {'id': 'first', 'cookie': 'c_user=1; xs=old'},
                {'id': 'second', 'cookie': 'c_user=2; xs=new'},
            ],
        }

        self.assertEqual(backend._primary_staff_cookie(row), 'c_user=2; xs=new')
        with backend.app.test_request_context('/'):
            normalized = backend._staff_with_active_cookie(row)
        self.assertEqual(normalized['active_cookie_id'], 'second')

    def test_invalidating_staff_cookie_clears_token_and_profile_caches(self):
        with tempfile.TemporaryDirectory() as token_dir:
            token_file = os.path.join(token_dir, 'staff-1__primary.txt')
            with open(token_file, 'w', encoding='utf-8') as handle:
                handle.write('old-token')

            with patch.object(backend, 'STAFF_TOKEN_DIR', token_dir), patch.object(
                backend,
                '_api_cache',
                {'group': object()},
            ), patch.object(
                backend,
                '_pages_cache',
                {'page': object()},
            ), patch.object(
                backend,
                '_fb_profile_cache',
                {'user': {'name': 'Old Name'}},
            ), patch.object(
                backend,
                '_staff_fb_display_names',
                {'staff-1': 'Old Name'},
            ):
                backend._invalidate_facebook_cache('staff-1')

                self.assertEqual(backend._api_cache, {})
                self.assertEqual(backend._pages_cache, {})
                self.assertEqual(backend._fb_profile_cache, {})
                self.assertNotIn('staff-1', backend._staff_fb_display_names)
                self.assertFalse(os.path.exists(token_file))

    def test_startup_clear_removes_all_staff_tokens(self):
        with tempfile.TemporaryDirectory() as token_dir:
            for name in ('staff-1__primary.txt', 'staff-2__cookie.txt', 'ignore.json'):
                with open(os.path.join(token_dir, name), 'w', encoding='utf-8') as handle:
                    handle.write('cached')

            with patch.object(backend, 'STAFF_TOKEN_DIR', token_dir):
                backend._clear_all_staff_access_tokens()

            self.assertFalse(os.path.exists(os.path.join(token_dir, 'staff-1__primary.txt')))
            self.assertFalse(os.path.exists(os.path.join(token_dir, 'staff-2__cookie.txt')))
            self.assertTrue(os.path.exists(os.path.join(token_dir, 'ignore.json')))

    def test_parallel_refresh_generates_one_replacement_for_a_stale_token(self):
        with tempfile.TemporaryDirectory() as token_dir:
            token_file = os.path.join(token_dir, 'token.txt')
            with open(token_file, 'w', encoding='utf-8') as handle:
                handle.write('old-token')

            def generate():
                time.sleep(0.05)
                with open(token_file, 'w', encoding='utf-8') as handle:
                    handle.write('new-token')
                return 'new-token'

            with patch.object(group_api.FacebookTokenGenerator, 'GetToken', side_effect=generate) as generator:
                with ThreadPoolExecutor(max_workers=6) as pool:
                    results = list(
                        pool.map(
                            lambda _: group_api.refresh_token(
                                'c_user=1; xs=value',
                                token_file,
                                stale_token='old-token',
                            ),
                            range(6),
                        )
                    )

            self.assertEqual(results, ['new-token'] * 6)
            self.assertEqual(generator.call_count, 1)

    def test_graph_call_retries_one_transient_network_failure(self):
        api = group_api.FacebookGroupAPI.__new__(group_api.FacebookGroupAPI)
        api.access_token = 'token'
        api.last_graph_error = ''

        with patch.object(
            group_api.requests,
            'get',
            side_effect=[
                requests.ConnectionError('temporary network error'),
                FakeResponse({'data': [{'id': 'post-1'}]}),
            ],
        ) as get_mock:
            payload = api._call('get', 'https://graph.facebook.com/test')

        self.assertEqual(payload['data'][0]['id'], 'post-1')
        self.assertEqual(get_mock.call_count, 2)

    def test_graph_permission_error_is_exposed_in_feed_report(self):
        api = group_api.FacebookGroupAPI.__new__(group_api.FacebookGroupAPI)
        api.access_token = 'token'
        api.last_graph_error = ''

        with patch.object(
            group_api.requests,
            'get',
            return_value=FakeResponse({'error': {'code': 200, 'message': 'Permissions error'}}),
        ):
            payload = api._call('get', 'https://graph.facebook.com/test')

        self.assertEqual(payload['error']['code'], 200)
        self.assertIn('Permissions error', api.last_graph_error)
        self.assertIn('#200', api.last_graph_error)

    def test_graph_368_refreshes_token_once_before_failing(self):
        api = group_api.FacebookGroupAPI.__new__(group_api.FacebookGroupAPI)
        api.access_token = 'old-token'
        api.last_graph_error = ''

        with patch.object(api, '_refresh_access_token', return_value=True) as refresh_mock:
            with patch.object(
                group_api.requests,
                'get',
                side_effect=[
                    FakeResponse({'error': {'code': 368, 'message': 'Token blocked'}}),
                    FakeResponse({'data': [{'id': 'post-1'}]}),
                ],
            ) as get_mock:
                payload = api._call('get', 'https://graph.facebook.com/test')

        self.assertEqual(payload['data'][0]['id'], 'post-1')
        self.assertEqual(get_mock.call_count, 2)
        refresh_mock.assert_called_once()


if __name__ == '__main__':
    unittest.main()
