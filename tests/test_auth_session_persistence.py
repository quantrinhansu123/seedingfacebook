import unittest
from datetime import timedelta
from unittest.mock import patch

import app as backend


class AuthSessionPersistenceTests(unittest.TestCase):
    STAFF = {
        'id': 'staff-1',
        'name': 'Test Staff',
        'username': 'test.staff',
        'role': 'staff',
        'enabled': True,
    }

    def test_logged_in_staff_uses_a_persistent_session(self):
        with backend.app.test_request_context('/'):
            backend._set_logged_in_staff(self.STAFF)

            self.assertTrue(backend.session.permanent)
            self.assertEqual(backend.session['staff_id'], 'staff-1')
            self.assertEqual(backend.session['staff_username'], 'test.staff')

    def test_persistent_session_lifetime_is_thirty_days(self):
        self.assertEqual(backend.app.permanent_session_lifetime, timedelta(days=30))

    def test_login_cookie_survives_browser_restart_and_restores_auth(self):
        client = backend.app.test_client()
        with (
            patch.object(backend, '_find_local_staff', return_value=self.STAFF),
            patch.object(backend, '_verify_password', return_value=True),
            patch.object(backend, '_staff_accounts', return_value=[self.STAFF]),
            patch.object(backend, '_prefetch_facebook_display_name'),
            patch.object(backend, '_invalidate_facebook_cache'),
        ):
            login_response = client.post(
                '/api/auth/login',
                json={'username': 'test.staff', 'password': 'secret'},
            )

            self.assertEqual(login_response.status_code, 200)
            self.assertTrue(login_response.get_json()['ok'])
            session_cookie = login_response.headers.get('Set-Cookie', '')
            self.assertIn('Expires=', session_cookie)
            self.assertIn('HttpOnly', session_cookie)
            self.assertIn('SameSite=Lax', session_cookie)

            status_response = client.get('/api/auth/status')
            status = status_response.get_json()
            self.assertEqual(status_response.status_code, 200)
            self.assertTrue(status['authenticated'])
            self.assertEqual(status['staff']['id'], 'staff-1')

    def test_auth_status_upgrades_an_existing_session_cookie(self):
        client = backend.app.test_client()
        with client.session_transaction() as stored_session:
            stored_session['staff_id'] = 'staff-1'
            stored_session['staff_username'] = 'test.staff'

        with patch.object(backend, '_staff_accounts', return_value=[self.STAFF]):
            response = client.get('/api/auth/status')

        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.get_json()['authenticated'])
        self.assertIn('Expires=', response.headers.get('Set-Cookie', ''))
        with client.session_transaction() as stored_session:
            self.assertTrue(stored_session.permanent)

    def test_logout_clears_persistent_session(self):
        client = backend.app.test_client()
        with client.session_transaction() as stored_session:
            stored_session.permanent = True
            stored_session['staff_id'] = 'staff-1'
            stored_session['staff_username'] = 'test.staff'

        with patch.object(backend, '_invalidate_facebook_cache'):
            logout_response = client.post('/api/auth/logout')

        self.assertEqual(logout_response.status_code, 200)
        self.assertIn('Expires=Thu, 01 Jan 1970', logout_response.headers.get('Set-Cookie', ''))
        with client.session_transaction() as stored_session:
            self.assertNotIn('staff_id', stored_session)
            self.assertFalse(stored_session)

    def test_protected_api_marks_missing_app_session_as_auth_required(self):
        client = backend.app.test_client()
        with patch.object(backend, '_setup_required', return_value=False):
            response = client.get('/api/settings')

        self.assertEqual(response.status_code, 401)
        self.assertTrue(response.get_json()['auth_required'])

    def test_auth_status_keeps_session_when_supabase_restore_temporarily_fails(self):
        client = backend.app.test_client()
        with client.session_transaction() as stored_session:
            stored_session.permanent = True
            stored_session['staff_id'] = 'staff-1'
            stored_session['staff_username'] = 'test.staff'
            stored_session['staff_source'] = 'supabase'

        with (
            patch.object(backend, '_staff_accounts', return_value=[]),
            patch.object(backend, '_load_supabase_staff', return_value=({}, 'connection timeout')),
        ):
            response = client.get('/api/auth/status')

        payload = response.get_json()
        self.assertEqual(response.status_code, 503)
        self.assertEqual(response.headers['Retry-After'], '3')
        self.assertTrue(payload['auth_recovery_pending'])
        self.assertNotIn('auth_required', payload)
        with client.session_transaction() as stored_session:
            self.assertEqual(stored_session['staff_id'], 'staff-1')

    def test_protected_api_does_not_expire_session_on_supabase_timeout(self):
        client = backend.app.test_client()
        with client.session_transaction() as stored_session:
            stored_session.permanent = True
            stored_session['staff_id'] = 'staff-1'
            stored_session['staff_username'] = 'test.staff'
            stored_session['staff_source'] = 'supabase'

        with (
            patch.object(backend, '_setup_required', return_value=False),
            patch.object(backend, '_staff_accounts', return_value=[]),
            patch.object(backend, '_load_supabase_staff', return_value=({}, 'connection timeout')),
        ):
            response = client.get('/api/settings')

        payload = response.get_json()
        self.assertEqual(response.status_code, 503)
        self.assertTrue(payload['auth_recovery_pending'])
        self.assertNotIn('auth_required', payload)


if __name__ == '__main__':
    unittest.main()
