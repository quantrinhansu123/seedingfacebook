"""Supabase storage layer (PostgREST over HTTPS).

Mỗi DAO ánh xạ 1-1 với một file JSON cũ trong thư mục data/:
    groups.json              -> bảng groups
    telegram_config.json     -> bảng telegram_chat_ids
    settings.json            -> bảng app_kv (key='settings')
    ai_config.json           -> bảng app_kv (key='ai_config')
    seen_posts.json          -> bảng seen_posts
    classifications.json     -> bảng classifications

Nếu env SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY chưa được set thì
`is_enabled()` trả về False, app sẽ tự fallback về JSON file.
"""

import os
import json
import time
from typing import Any, Optional
from urllib.parse import quote

import requests
from dotenv import load_dotenv

_BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
load_dotenv(os.path.join(_BASE_DIR, '.env'), override=True)


def _normalize_supabase_url(value: str) -> str:
    url = (value or '').strip().rstrip('/')
    for suffix in ('/rest/v1', '/storage/v1'):
        if url.endswith(suffix):
            return url[: -len(suffix)].rstrip('/')
    return url


SUPABASE_URL = _normalize_supabase_url(os.environ.get('SUPABASE_URL') or os.environ.get('VITE_SUPABASE_URL') or '')
SUPABASE_KEY = (
    os.environ.get('SUPABASE_SERVICE_ROLE_KEY')
    or os.environ.get('SUPABASE_ANON_KEY')
    or os.environ.get('SUPABASE_PUBLISHABLE_KEY')
    or os.environ.get('VITE_SUPABASE_PUBLISHABLE_KEY')
    or ''
)
STAFF_USERS_TABLE = os.environ.get('SUPABASE_STAFF_TABLE', 'staff_users')
MANAGED_CHANNEL_TABLE = os.environ.get('SUPABASE_CHANNEL_TABLE', 'managed_channels')
CONTENT_SCRIPT_TABLE = os.environ.get('SUPABASE_SCRIPT_TABLE', 'content_scripts')
CUSTOMER_AI_TABLE = os.environ.get('SUPABASE_CUSTOMER_AI_TABLE', 'customer_ai_settings')
CONTENT_TASK_TABLE = os.environ.get('SUPABASE_CONTENT_TASK_TABLE', 'content_tasks')
CONTENT_SCRIPT_BLOCK_TABLE = os.environ.get('SUPABASE_CONTENT_SCRIPT_BLOCK_TABLE', 'content_script_blocks')

_TIMEOUT = 30


def is_enabled() -> bool:
    return bool(SUPABASE_URL and SUPABASE_KEY)


def _headers(prefer: str = 'return=representation') -> dict:
    return {
        'apikey': SUPABASE_KEY,
        'Authorization': f'Bearer {SUPABASE_KEY}',
        'Content-Type': 'application/json',
        'Prefer': prefer,
    }


def _url(path: str) -> str:
    return f'{SUPABASE_URL}/rest/v1/{path.lstrip("/")}'


def _format_supabase_error(response: requests.Response) -> str:
    message = response.text
    code = ''
    if response.headers.get('content-type', '').startswith('application/json'):
        try:
            body = response.json()
            code = str(body.get('code') or '')
            message = body.get('message') or message
        except Exception:
            pass
    if code == '42501' or 'row-level security policy' in message.lower():
        message = (
            f'{message}. Supabase đang chặn ghi bởi RLS; chạy file SQL fix tương ứng '
            f'(ví dụ supabase_app_kv_rls_fix.sql cho app_kv) hoặc cấu hình SUPABASE_SERVICE_ROLE_KEY ở backend.'
        )
    return message[:600]


def _request(method: str, path: str, **kwargs) -> requests.Response:
    if not is_enabled():
        raise RuntimeError('Supabase chưa được cấu hình (thiếu SUPABASE_URL/KEY)')
    headers = kwargs.pop('headers', None) or _headers(kwargs.pop('prefer', 'return=representation'))
    last_err: Optional[Exception] = None
    for attempt in range(3):
        try:
            r = requests.request(method, _url(path), headers=headers, timeout=_TIMEOUT, **kwargs)
            if r.status_code >= 400:
                raise RuntimeError(f'Supabase {method} {path} {r.status_code}: {_format_supabase_error(r)}')
            return r
        except (requests.Timeout, requests.ConnectionError) as e:
            last_err = e
            continue
    raise RuntimeError(f'Supabase {method} {path} network error: {last_err}')


def ping() -> dict:
    """Kiểm tra kết nối nhanh."""
    if not is_enabled():
        return {'ok': False, 'error': 'Chưa cấu hình SUPABASE_URL/KEY'}
    try:
        r = requests.get(
            f'{SUPABASE_URL}/rest/v1/app_kv',
            headers={'apikey': SUPABASE_KEY, 'Authorization': f'Bearer {SUPABASE_KEY}'},
            params={'select': 'key', 'limit': '1'},
            timeout=_TIMEOUT,
        )
        result = {'ok': 200 <= r.status_code < 400, 'status': r.status_code}
        if r.status_code in (401, 403):
            result['error'] = 'Supabase từ chối API key hoặc key không có quyền'
        elif r.status_code >= 400:
            result['error'] = r.text[:300]
        return result
    except Exception as e:
        return {'ok': False, 'error': str(e)}


# ── groups ──────────────────────────────────────────────
def list_groups() -> list:
    r = _request('GET', 'groups?select=id,name&order=created_at.asc')
    return r.json()


def upsert_group(gid: str, name: str = '') -> None:
    _request('POST', 'groups', json=[{'id': gid, 'name': name}],
             prefer='resolution=merge-duplicates,return=minimal')


def delete_group(gid: str) -> None:
    _request('DELETE', f'groups?id=eq.{gid}', prefer='return=minimal')


# ── telegram_chat_ids ───────────────────────────────────
def list_chat_ids() -> list:
    r = _request('GET', 'telegram_chat_ids?select=chat_id&order=created_at.asc')
    return [row['chat_id'] for row in r.json()]


def add_chat_id(cid: str) -> None:
    _request('POST', 'telegram_chat_ids', json=[{'chat_id': cid}],
             prefer='resolution=ignore-duplicates,return=minimal')


def remove_chat_id(cid: str) -> None:
    _request('DELETE', f'telegram_chat_ids?chat_id=eq.{cid}', prefer='return=minimal')


# ── app_kv (settings / ai_config) ───────────────────────
def kv_get(key: str, default: Any = None) -> Any:
    r = _request('GET', f'app_kv?select=value&key=eq.{key}&limit=1')
    rows = r.json()
    return rows[0]['value'] if rows else default


def kv_get_many(keys: list[str]) -> dict[str, Any]:
    normalized = list(dict.fromkeys(str(key or '').strip() for key in keys if str(key or '').strip()))
    if not normalized:
        return {}
    encoded = ','.join(quote(key, safe='') for key in normalized)
    r = _request('GET', f'app_kv?select=key,value&key=in.({encoded})')
    return {
        str(row.get('key') or ''): row.get('value')
        for row in r.json()
        if str(row.get('key') or '')
    }


def kv_set(key: str, value: Any) -> None:
    _request('POST', 'app_kv?on_conflict=key', json=[{'key': key, 'value': value}],
             prefer='resolution=merge-duplicates,return=minimal')


# ── per-customer AI settings ───────────────────────────
def get_customer_ai_settings(staff_key: str, table: Optional[str] = None) -> Optional[dict]:
    staff_key = (staff_key or '').strip()
    if not staff_key:
        return None
    table_name = table or CUSTOMER_AI_TABLE
    r = _request(
        'GET',
        f'{table_name}?select=*&staff_key=eq.{quote(staff_key, safe="")}&limit=1',
    )
    rows = r.json()
    return rows[0] if rows else None


def upsert_customer_ai_settings(row: dict, table: Optional[str] = None) -> dict:
    table_name = table or CUSTOMER_AI_TABLE
    r = _request(
        'POST',
        f'{table_name}?on_conflict=staff_key',
        json=[row],
        prefer='resolution=merge-duplicates,return=representation',
    )
    rows = r.json()
    return rows[0] if rows else {}


# ── staff_users ─────────────────────────────────────────
def get_staff_user(username: str, table: Optional[str] = None) -> Optional[dict]:
    """Read one login user from Supabase.

    The customer-facing login is intentionally simple: one table with username
    and password columns. Cookie fields are optional and used only after login.
    """
    username = (username or '').strip().lower()
    if not username:
        return None
    table_name = table or STAFF_USERS_TABLE
    encoded = quote(username, safe='')
    r = _request('GET', f'{table_name}?select=*&username=eq.{encoded}&limit=1')
    rows = r.json()
    return rows[0] if rows else None


def get_staff_user_by_id(staff_id: str, table: Optional[str] = None) -> Optional[dict]:
    staff_id = (staff_id or '').strip()
    if not staff_id:
        return None
    table_name = table or STAFF_USERS_TABLE
    encoded = quote(staff_id, safe='')
    r = _request('GET', f'{table_name}?select=*&id=eq.{encoded}&limit=1')
    rows = r.json()
    return rows[0] if rows else None


_OPTIONAL_STAFF_JSON_COLUMNS = (
    'managed_groups',
    'facebook_cookies',
    'active_cookie_id',
)
_KNOWN_MISSING_STAFF_COLUMNS: set[str] = set()
_SENSITIVE_STAFF_READ_FIELDS = frozenset({
    'password',
    'password_hash',
    'password_salt',
})
_SENSITIVE_STAFF_WRITE_FIELDS = frozenset({
    'password_hash',
    'password_salt',
})


def _sanitize_staff_row_read(row: dict) -> dict:
    cleaned = dict(row or {})
    for key in _SENSITIVE_STAFF_READ_FIELDS:
        cleaned.pop(key, None)
    cleaned.setdefault('managed_groups', [])
    cleaned.setdefault('facebook_cookies', [])
    return cleaned


def is_missing_column_error(message: str) -> bool:
    return _is_missing_supabase_column_error(message)


def _write_staff_payload(row: dict) -> dict:
    return {k: v for k, v in (row or {}).items() if k not in _SENSITIVE_STAFF_WRITE_FIELDS}


def _is_missing_supabase_column_error(message: str) -> bool:
    text = str(message or '')
    return (
        '42703' in text
        or 'PGRST204' in text
        or ("Could not find" in text and 'column' in text.lower())
    )


def _missing_column_from_error(message: str, candidates: list[str]) -> str:
    text = str(message or '')
    for key in candidates:
        if f"'{key}'" in text or f'"{key}"' in text or f'.{key}' in text or f' {key} ' in text:
            return key
    return ''


def _drop_optional_staff_columns(payload: dict, optional_keys: list[str], error: Exception) -> tuple[dict, list[str], list[str]]:
    err = str(error)
    if not _is_missing_supabase_column_error(err):
        raise error
    remaining = list(optional_keys)
    missing = _missing_column_from_error(err, list(_OPTIONAL_STAFF_JSON_COLUMNS))
    if missing and missing in payload:
        drop_key = missing
    elif remaining:
        drop_key = remaining.pop()
    else:
        removable = [key for key in _OPTIONAL_STAFF_JSON_COLUMNS if key in payload]
        if not removable:
            raise error
        drop_key = removable[0]
    if drop_key in remaining:
        remaining.remove(drop_key)
    next_payload = dict(payload)
    next_payload.pop(drop_key, None)
    _KNOWN_MISSING_STAFF_COLUMNS.add(drop_key)
    return next_payload, remaining, [drop_key]


def _staff_write_payload(row: dict) -> tuple[dict, list[str]]:
    payload = _write_staff_payload(row)
    for column in list(_KNOWN_MISSING_STAFF_COLUMNS):
        payload.pop(column, None)
    optional_keys = [key for key in _OPTIONAL_STAFF_JSON_COLUMNS if key in payload]
    return payload, optional_keys


def _request_staff_write(method: str, path: str, row: dict, *, prefer: str = 'return=representation') -> tuple[requests.Response, list[str]]:
    payload, optional_keys = _staff_write_payload(row)
    dropped: list[str] = []
    while True:
        try:
            return _request(method, path, json=payload, prefer=prefer), dropped
        except RuntimeError as e:
            payload, optional_keys, removed = _drop_optional_staff_columns(payload, optional_keys, e)
            dropped.extend(removed)


def list_staff_users(table: Optional[str] = None) -> list:
    table_name = table or STAFF_USERS_TABLE
    try:
        r = _request(
            'GET',
            f'{table_name}?select=*&enabled=eq.true&order=created_at.asc',
        )
        return [_sanitize_staff_row_read(row) for row in r.json()]
    except RuntimeError as e:
        if not _is_missing_supabase_column_error(str(e)):
            raise
        r = _request(
            'GET',
            f'{table_name}?select=id,name,username,role,cookie,facebook_user_id,enabled,created_at,updated_at'
            '&enabled=eq.true&order=created_at.asc',
        )
        return [_sanitize_staff_row_read(row) for row in r.json()]


def insert_staff_user(row: dict, table: Optional[str] = None) -> tuple[dict, list[str]]:
    table_name = table or STAFF_USERS_TABLE
    payload, optional_keys = _staff_write_payload(row)
    dropped: list[str] = []
    while True:
        try:
            r = _request('POST', table_name, json=[payload], prefer='return=representation')
            rows = r.json()
            return (_sanitize_staff_row_read(rows[0]) if rows else {}), dropped
        except RuntimeError as e:
            payload, optional_keys, removed = _drop_optional_staff_columns(payload, optional_keys, e)
            dropped.extend(removed)


def update_staff_user(username: str, row: dict, table: Optional[str] = None) -> tuple[dict, list[str]]:
    table_name = table or STAFF_USERS_TABLE
    username = (username or '').strip().lower()
    if not username:
        return {}, []
    r, dropped = _request_staff_write(
        'PATCH',
        f'{table_name}?username=eq.{quote(username, safe="")}',
        row,
        prefer='return=representation',
    )
    rows = r.json()
    return (_sanitize_staff_row_read(rows[0]) if rows else {}), dropped


def update_staff_user_by_id(staff_id: str, row: dict, table: Optional[str] = None) -> tuple[dict, list[str]]:
    table_name = table or STAFF_USERS_TABLE
    staff_id = (staff_id or '').strip()
    if not staff_id:
        return {}, []
    r, dropped = _request_staff_write(
        'PATCH',
        f'{table_name}?id=eq.{quote(staff_id, safe="")}',
        row,
        prefer='return=representation',
    )
    rows = r.json()
    return (_sanitize_staff_row_read(rows[0]) if rows else {}), dropped


def delete_staff_user(staff_id: str = '', username: str = '', table: Optional[str] = None) -> None:
    table_name = table or STAFF_USERS_TABLE
    staff_id = (staff_id or '').strip()
    username = (username or '').strip().lower()
    if staff_id:
        r = _request('DELETE', f'{table_name}?id=eq.{quote(staff_id, safe="")}', prefer='return=representation')
        if r.json():
            return
        _request(
            'PATCH',
            f'{table_name}?id=eq.{quote(staff_id, safe="")}',
            json={'enabled': False},
            prefer='return=minimal',
        )
        return
    if username:
        r = _request('DELETE', f'{table_name}?username=eq.{quote(username, safe="")}', prefer='return=representation')
        if r.json():
            return
        _request(
            'PATCH',
            f'{table_name}?username=eq.{quote(username, safe="")}',
            json={'enabled': False},
            prefer='return=minimal',
        )
        return


# ── managed_channels ───────────────────────────────────
def list_managed_channels(table: Optional[str] = None) -> list:
    table_name = table or MANAGED_CHANNEL_TABLE
    r = _request(
        'GET',
        f'{table_name}?select=id,platform,channel_name,channel_type,link,target_id,'
        'note,created_at,updated_at&order=created_at.desc',
    )
    return r.json()


def upsert_managed_channel(row: dict, table: Optional[str] = None) -> dict:
    table_name = table or MANAGED_CHANNEL_TABLE
    r = _request(
        'POST',
        table_name,
        json=[row],
        prefer='resolution=merge-duplicates,return=representation',
    )
    rows = r.json()
    return rows[0] if rows else {}


def update_managed_channel(channel_id: str, row: dict, table: Optional[str] = None) -> dict:
    table_name = table or MANAGED_CHANNEL_TABLE
    r = _request(
        'PATCH',
        f'{table_name}?id=eq.{quote(channel_id or "", safe="")}',
        json=row,
        prefer='return=representation',
    )
    rows = r.json()
    return rows[0] if rows else {}


def delete_managed_channel(channel_id: str, table: Optional[str] = None) -> None:
    table_name = table or MANAGED_CHANNEL_TABLE
    _request('DELETE', f'{table_name}?id=eq.{quote(channel_id or "", safe="")}', prefer='return=minimal')


def _is_schema_cache_error(message: str) -> bool:
    text = str(message or '')
    return 'PGRST205' in text or 'schema cache' in text.lower()


def _request_scripts(method: str, path: str, **kwargs) -> requests.Response:
    """PostgREST đôi khi chậm cập nhật cache sau khi tạo bảng mới."""
    last_err: Optional[Exception] = None
    for attempt in range(6):
        try:
            return _request(method, path, **kwargs)
        except RuntimeError as exc:
            last_err = exc
            if _is_schema_cache_error(str(exc)) and attempt < 5:
                time.sleep(2)
                continue
            raise
    if last_err:
        raise last_err
    raise RuntimeError(f'Supabase {method} {path} failed')


# ── content_scripts ───────────────────────────────────────────────
def list_content_scripts(table: Optional[str] = None) -> list:
    table_name = table or CONTENT_SCRIPT_TABLE
    r = _request_scripts(
        'GET',
        f'{table_name}?select=id,title,platform,status,writer,script_date,blocks,'
        'created_by_staff_id,created_by_staff_name,created_at,updated_at&order=updated_at.desc',
    )
    rows = r.json()
    return [{
        'id': row.get('id'),
        'title': row.get('title'),
        'platform': row.get('platform'),
        'status': row.get('status'),
        'writer': row.get('writer'),
        'date': row.get('script_date'),
        'blocks': row.get('blocks') if isinstance(row.get('blocks'), list) else [],
        'created_by_staff_id': row.get('created_by_staff_id'),
        'created_by_staff_name': row.get('created_by_staff_name'),
        'created_at': row.get('created_at'),
        'updated_at': row.get('updated_at'),
    } for row in rows]


def sync_content_scripts(rows: list[dict], table: Optional[str] = None) -> None:
    table_name = table or CONTENT_SCRIPT_TABLE
    current = list_content_scripts(table_name)
    next_ids = {str(row.get('id') or '') for row in rows if row.get('id')}
    if rows:
        _request_scripts(
            'POST',
            table_name,
            json=rows,
            prefer='resolution=merge-duplicates,return=minimal',
        )
    for row in current:
        script_id = str(row.get('id') or '')
        if script_id and script_id not in next_ids:
            _request_scripts(
                'DELETE',
                f'{table_name}?id=eq.{quote(script_id, safe="")}',
                prefer='return=minimal',
            )


# ── content workflow: tasks + script blocks ───────────────────────
def _request_workflow(method: str, path: str, **kwargs) -> requests.Response:
    """PostgREST schema cache retry for the split content workflow tables."""
    last_err: Optional[Exception] = None
    for attempt in range(6):
        try:
            return _request(method, path, **kwargs)
        except RuntimeError as exc:
            last_err = exc
            if _is_schema_cache_error(str(exc)) and attempt < 5:
                time.sleep(2)
                continue
            raise
    if last_err:
        raise last_err
    raise RuntimeError(f'Supabase {method} {path} failed')


def list_content_tasks(table: Optional[str] = None, *, lite: bool = False) -> list:
    table_name = table or CONTENT_TASK_TABLE
    if lite:
        select = (
            'id,title,assignee_id,assignee_name,assignee_username,status,priority,due_date,'
            'script_id,platform,created_at,updated_at,started_at,submitted_at,approved_at,completed_at'
        )
    else:
        select = '*'
    r = _request_workflow(
        'GET',
        f'{table_name}?select={select}&order=updated_at.desc',
    )
    return r.json()


def get_content_task(task_id: str, table: Optional[str] = None) -> dict | None:
    task_id = str(task_id or '').strip()
    if not task_id:
        return None
    table_name = table or CONTENT_TASK_TABLE
    r = _request_workflow(
        'GET',
        f'{table_name}?id=eq.{quote(task_id, safe="")}&limit=1',
    )
    rows = r.json()
    return rows[0] if rows else None


def sync_content_tasks(rows: list[dict], table: Optional[str] = None) -> None:
    table_name = table or CONTENT_TASK_TABLE
    current = list_content_tasks(table_name)
    next_ids = {str(row.get('id') or '') for row in rows if row.get('id')}
    if rows:
        _request_workflow(
            'POST',
            table_name,
            json=rows,
            prefer='resolution=merge-duplicates,return=minimal',
        )
    for row in current:
        task_id = str(row.get('id') or '')
        if task_id and task_id not in next_ids:
            _request_workflow(
                'DELETE',
                f'{table_name}?id=eq.{quote(task_id, safe="")}',
                prefer='return=minimal',
            )


def upsert_content_task(row: dict, table: Optional[str] = None) -> dict:
    table_name = table or CONTENT_TASK_TABLE
    r = _request_workflow(
        'POST',
        f'{table_name}?on_conflict=id',
        json=[row],
        prefer='resolution=merge-duplicates,return=representation',
    )
    rows = r.json()
    return rows[0] if rows else {}


def patch_content_task(task_id: str, row: dict, table: Optional[str] = None) -> dict:
    table_name = table or CONTENT_TASK_TABLE
    r = _request_workflow(
        'PATCH',
        f'{table_name}?id=eq.{quote(task_id or "", safe="")}',
        json=row,
        prefer='return=representation',
    )
    rows = r.json()
    return rows[0] if rows else {}


def delete_content_task(task_id: str, table: Optional[str] = None) -> None:
    table_name = table or CONTENT_TASK_TABLE
    _request_workflow(
        'DELETE',
        f'{table_name}?id=eq.{quote(task_id or "", safe="")}',
        prefer='return=minimal',
    )


def list_content_script_blocks(table: Optional[str] = None) -> list:
    table_name = table or CONTENT_SCRIPT_BLOCK_TABLE
    r = _request_workflow(
        'GET',
        f'{table_name}?select=id,script_id,content_type,content,block_order,metadata&order=block_order.asc',
    )
    return r.json()


def sync_content_script_blocks(rows: list[dict], script_ids: list[str] | None = None, table: Optional[str] = None) -> None:
    table_name = table or CONTENT_SCRIPT_BLOCK_TABLE
    ids = [str(item or '').strip() for item in (script_ids or []) if str(item or '').strip()]
    if ids:
        for script_id in ids:
            _request_workflow(
                'DELETE',
                f'{table_name}?script_id=eq.{quote(script_id, safe="")}',
                prefer='return=minimal',
            )
    if rows:
        chunk = 200
        for i in range(0, len(rows), chunk):
            _request_workflow(
                'POST',
                table_name,
                json=rows[i:i + chunk],
                prefer='resolution=merge-duplicates,return=minimal',
            )


def purge_content_script_blocks(script_ids: list[str], table: Optional[str] = None) -> None:
    table_name = table or CONTENT_SCRIPT_BLOCK_TABLE
    for script_id in script_ids or []:
        sid = str(script_id or '').strip()
        if not sid:
            continue
        _request_workflow(
            'DELETE',
            f'{table_name}?script_id=eq.{quote(sid, safe="")}',
            prefer='return=minimal',
        )


# ── seen_posts ──────────────────────────────────────────
def list_seen_post_ids() -> set:
    rows: list = []
    offset = 0
    page = 1000
    while True:
        r = _request('GET',
                     f'seen_posts?select=post_id&order=post_id.asc'
                     f'&offset={offset}&limit={page}')
        batch = r.json()
        rows.extend(batch)
        if len(batch) < page:
            break
        offset += page
    return {row['post_id'] for row in rows}


def add_seen_post_ids(post_ids) -> None:
    ids = list({pid for pid in post_ids if pid})
    if not ids:
        return
    payload = [{'post_id': pid} for pid in ids]
    chunk = 500
    for i in range(0, len(payload), chunk):
        _request('POST', 'seen_posts', json=payload[i:i + chunk],
                 prefer='resolution=ignore-duplicates,return=minimal')


def upsert_posts(posts) -> None:
    """Lưu/đè metadata cho danh sách bài viết.

    Mỗi post là dict có ít nhất `id`; các trường khác (message, permalink_url,
    created_time, from.name, _group_id) được trích nếu có.
    """
    rows = []
    for p in posts or []:
        pid = p.get('id')
        if not pid:
            continue
        created = p.get('created_time') or None
        from_obj = p.get('from') or {}
        rows.append({
            'post_id': pid,
            'permalink_url': p.get('permalink_url') or None,
            'group_id': p.get('_group_id') or None,
            'author_name': (from_obj.get('name') if isinstance(from_obj, dict) else None) or None,
            'message': p.get('message') or None,
            'created_time': created,
        })
    if not rows:
        return
    chunk = 200
    for i in range(0, len(rows), chunk):
        _request('POST', 'seen_posts', json=rows[i:i + chunk],
                 prefer='resolution=merge-duplicates,return=minimal')


def list_saved_posts(limit: int = 100, group_id: Optional[str] = None) -> list:
    """Trả danh sách bài đã lưu, sắp xếp theo created_time DESC."""
    limit = max(1, min(int(limit), 500))
    params = (
        'seen_posts?select=post_id,permalink_url,group_id,author_name,message,'
        'created_time,seen_at'
        f'&order=created_time.desc.nullslast&limit={limit}'
    )
    if group_id:
        params += f'&group_id=eq.{group_id}'
    r = _request('GET', params)
    return r.json()


# ── classifications ─────────────────────────────────────
def list_classifications() -> dict:
    rows: list = []
    offset = 0
    page = 1000
    while True:
        r = _request('GET',
                     f'classifications?select=post_id,category'
                     f'&offset={offset}&limit={page}')
        batch = r.json()
        rows.extend(batch)
        if len(batch) < page:
            break
        offset += page
    return {row['post_id']: row['category'] for row in rows}


def upsert_classifications(items: dict) -> None:
    if not items:
        return
    payload = [{'post_id': pid, 'category': cat} for pid, cat in items.items() if pid]
    chunk = 500
    for i in range(0, len(payload), chunk):
        _request('POST', 'classifications', json=payload[i:i + chunk],
                 prefer='resolution=merge-duplicates,return=minimal')
