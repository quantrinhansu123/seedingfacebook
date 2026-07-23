import os
import json
import threading
import time as time_module
import base64
from concurrent.futures import ThreadPoolExecutor, as_completed
import re
import uuid
import hashlib
import secrets
import requests as _req
from html import unescape
from datetime import datetime, time, timezone, timedelta
from email.utils import parsedate_to_datetime
from urllib.parse import parse_qsl, quote, urlencode, urlsplit, urlunsplit
from xml.etree import ElementTree as ET
from zoneinfo import ZoneInfo
from dotenv import load_dotenv
from flask import Flask, jsonify, render_template, request, session, copy_current_request_context, has_request_context
from flask_cors import CORS
from werkzeug.utils import secure_filename

from core.group_api import FacebookGroupAPI, load_token, load_cookie, refresh_token, friendly_graph_error, GRAPH_URL, FB_CLIENT_ID
from core.token_gen import FacebookTokenGenerator
from core.ai_classifier import AIClassifier, DEFAULT_MODEL, DEFAULT_API_KEY, DEFAULT_CATEGORIES, PROVIDERS, extract_phones, normalize_phone
from core import supabase_store as sb

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(BASE_DIR, 'data')


def _configure_stdio_utf8() -> None:
    """Windows console defaults to cp1252; unicode logs must not crash requests."""
    import sys
    for stream_name in ('stdout', 'stderr'):
        stream = getattr(sys, stream_name, None)
        if stream and hasattr(stream, 'reconfigure'):
            try:
                stream.reconfigure(encoding='utf-8', errors='replace')
            except Exception:
                pass


_configure_stdio_utf8()
load_dotenv(os.path.join(BASE_DIR, '.env'), override=True)
RUNTIME_DATA_DIR = os.environ.get('RUNTIME_DATA_DIR') or ('/tmp/fb-moni' if os.environ.get('VERCEL') else DATA_DIR)

SEEN_FILE = os.path.join(DATA_DIR, 'seen_posts.json')
TG_CONFIG_FILE = os.path.join(DATA_DIR, 'telegram_config.json')
GROUPS_FILE = os.path.join(DATA_DIR, 'groups.json')
SETTINGS_FILE = os.path.join(DATA_DIR, 'settings.json')
AI_CONFIG_FILE = os.path.join(DATA_DIR, 'ai_config.json')
CLASSIFICATIONS_FILE = os.path.join(DATA_DIR, 'classifications.json')
LEADS_FILE = os.path.join(DATA_DIR, 'leads.json')
DELETED_LEADS_FILE = os.path.join(DATA_DIR, 'deleted_lead_keys.json')
REPLY_SUGGESTIONS_FILE = os.path.join(DATA_DIR, 'reply_suggestions.json')
BUSINESS_PROFILE_FILE = os.path.join(DATA_DIR, 'business_profile.json')
STAFF_COOKIES_FILE = os.path.join(DATA_DIR, 'staff_cookies.json')
STAFF_TOKEN_DIR = os.path.join(RUNTIME_DATA_DIR, 'staff_tokens')
COMMENT_LOGS_FILE = os.path.join(DATA_DIR, 'comment_logs.json')
COMMENT_SUMMARIES_FILE = os.path.join(DATA_DIR, 'comment_summaries.json')
POST_COMMENTS_FILE = os.path.join(DATA_DIR, 'post_comments.json')
MANAGED_CHANNELS_FILE = os.path.join(DATA_DIR, 'managed_channels.json')
TIKTOK_CONFIG_FILE = os.path.join(DATA_DIR, 'tiktok_config.json')
CONTENT_PIPELINE_FILE = os.path.join(DATA_DIR, 'content_pipeline.json')
COMMENT_TEMPLATES_FILE = os.path.join(DATA_DIR, 'comment_templates.json')
COMMENT_TAGS_FILE = os.path.join(DATA_DIR, 'comment_tags.json')
COMMENT_TAG_ASSIGNMENTS_FILE = os.path.join(DATA_DIR, 'comment_tag_assignments.json')
COMMENT_INBOX_WORKFLOW_FILE = os.path.join(DATA_DIR, 'comment_inbox_workflow.json')
COMMENT_MANUAL_PHONES_FILE = os.path.join(DATA_DIR, 'comment_manual_phones.json')
SCRIPTS_FILE = os.path.join(DATA_DIR, 'content_scripts.json')
CONTENT_TASKS_FILE = os.path.join(DATA_DIR, 'content_tasks.json')
CONTENT_STUDIO_SETUP_FILE = os.path.join(DATA_DIR, 'content_studio_setup.json')
CONTENT_TECHNIQUES_FILE = os.path.join(DATA_DIR, 'content_techniques.json')
CONTENT_SCRIPTS_MISSING_HINT = (
    'Chưa có bảng content_scripts. Mở Supabase → SQL Editor → '
    'chạy file supabase_content_scripts.sql (không chạy toàn bộ supabase_schema.sql).'
)
CONTENT_SCRIPTS_CACHE_HINT = (
    'Bảng content_scripts đã có trong DB nhưng Supabase API chưa cập nhật cache. '
    'Trong SQL Editor chạy: NOTIFY pgrst, \'reload schema\'; '
    'hoặc vào Settings → API → Reload schema, đợi 30 giây rồi F5 trang Kịch bản. '
    'Kiểm tra .env trùng project: xhesagiugewwtuedxyxo.'
)
CONTENT_SCRIPTS_RLS_HINT = (
    'Bảng content_scripts đang bật RLS và chặn ghi. '
    'Chạy file supabase_content_scripts_rls_fix.sql trong Supabase SQL Editor, '
    'đợi 10 giây rồi F5 trang Kịch bản.'
)
CONTENT_WORKFLOW_MISSING_HINT = (
    'Chưa có bảng content_tasks/content_script_blocks. Mở Supabase → SQL Editor → '
    'chạy file supabase_content_workflow.sql rồi reload trang.'
)
CONTENT_WORKFLOW_RLS_HINT = (
    'Bảng workflow content đang bị RLS chặn ghi. Chạy lại file supabase_content_workflow.sql '
    'trong Supabase SQL Editor, đợi 10 giây rồi F5.'
)

BOT_TOKEN = os.environ.get('TG_BOT_TOKEN', '')
DEFAULT_GROUP = os.environ.get('DEFAULT_GROUP', '3809441172650624')
PORT = int(os.environ.get('PORT', 5000))
SCHEDULED_POST_WORKER_INTERVAL_SECONDS = int(os.environ.get('SCHEDULED_POST_WORKER_INTERVAL_SECONDS', '30') or '30')
WEB_UI_URL = (os.environ.get('WEB_UI_URL') or 'http://localhost:3000').rstrip('/')
USE_LEGACY_UI = os.environ.get('USE_LEGACY_UI', '').lower() in ('1', 'true', 'yes')


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
    or os.environ.get('VITE_SUPABASE_PUBLISHABLE_KEY', '')
)
SUPABASE_REPLY_TABLE = os.environ.get('SUPABASE_REPLY_TABLE', 'ai_reply_suggestions')
SUPABASE_PROFILE_TABLE = os.environ.get('SUPABASE_PROFILE_TABLE', 'business_profiles')
SUPABASE_COMMENT_LOG_TABLE = os.environ.get('SUPABASE_COMMENT_LOG_TABLE', 'comment_logs')
SUPABASE_COMMENT_SUMMARY_TABLE = os.environ.get('SUPABASE_COMMENT_SUMMARY_TABLE', 'post_comment_summaries')
SUPABASE_POST_COMMENT_TABLE = os.environ.get('SUPABASE_POST_COMMENT_TABLE', 'post_comments')
SUPABASE_LEAD_TABLE = os.environ.get('SUPABASE_LEAD_TABLE', 'leads')
SUPABASE_STAFF_TABLE = os.environ.get('SUPABASE_STAFF_TABLE', 'staff_users')
SUPABASE_CHANNEL_TABLE = os.environ.get('SUPABASE_CHANNEL_TABLE', 'managed_channels')
SUPABASE_SCRIPT_TABLE = os.environ.get('SUPABASE_SCRIPT_TABLE', 'content_scripts')
SUPABASE_CUSTOMER_AI_TABLE = os.environ.get('SUPABASE_CUSTOMER_AI_TABLE', 'customer_ai_settings')
SUPABASE_CONTENT_TASK_TABLE = os.environ.get('SUPABASE_CONTENT_TASK_TABLE', 'content_tasks')
SUPABASE_CONTENT_SCRIPT_BLOCK_TABLE = os.environ.get('SUPABASE_CONTENT_SCRIPT_BLOCK_TABLE', 'content_script_blocks')
SUPABASE_COMMENT_IMAGE_BUCKET = os.environ.get('SUPABASE_COMMENT_IMAGE_BUCKET', 'comment-images')
SUPABASE_POST_MEDIA_BUCKET = os.environ.get('SUPABASE_POST_MEDIA_BUCKET', SUPABASE_COMMENT_IMAGE_BUCKET)
APP_TIMEZONE = os.environ.get('APP_TIMEZONE', 'Asia/Ho_Chi_Minh')


def _supabase_project_ref() -> str:
    host = urlsplit((SUPABASE_URL or '').rstrip('/')).netloc
    return host.split('.')[0] if host else ''


def _supabase_key_source() -> str:
    if os.environ.get('SUPABASE_SERVICE_ROLE_KEY'):
        return 'service_role'
    if os.environ.get('SUPABASE_ANON_KEY'):
        return 'anon'
    if os.environ.get('SUPABASE_PUBLISHABLE_KEY'):
        return 'publishable'
    if os.environ.get('VITE_SUPABASE_PUBLISHABLE_KEY'):
        return 'vite_publishable'
    return 'missing'


def _supabase_debug_context(table: str = '') -> str:
    project = _supabase_project_ref() or 'missing-url'
    target = f', table={table}' if table else ''
    return f'backend Supabase project={project}, key={_supabase_key_source()}{target}'


def _app_timezone():
    try:
        return ZoneInfo(APP_TIMEZONE)
    except Exception:
        try:
            return ZoneInfo('Asia/Ho_Chi_Minh')
        except Exception:
            return timezone(timedelta(hours=7))
TIKTOK_COOKIE = os.environ.get('TIKTOK_COOKIE', '')
TIKTOK_PLAYWRIGHT_ENABLED = os.environ.get('TIKTOK_PLAYWRIGHT_ENABLED', '').lower() in ('1', 'true', 'yes', 'on')
TIKTOK_PLAYWRIGHT_HEADLESS = os.environ.get('TIKTOK_PLAYWRIGHT_HEADLESS', 'false').lower() in ('1', 'true', 'yes', 'on')
TIKTOK_PLAYWRIGHT_USER_DATA_DIR = os.environ.get(
    'TIKTOK_PLAYWRIGHT_USER_DATA_DIR',
    os.path.join(RUNTIME_DATA_DIR, 'playwright', 'tiktok-profile'),
)
TIKTOK_PLAYWRIGHT_TIMEOUT_MS = int(os.environ.get('TIKTOK_PLAYWRIGHT_TIMEOUT_MS', '60000') or 60000)
TIKTOK_PLAYWRIGHT_WORKER_URL = (os.environ.get('TIKTOK_PLAYWRIGHT_WORKER_URL') or '').rstrip('/')
TIKTOK_PLAYWRIGHT_WORKER_KEY = os.environ.get('TIKTOK_PLAYWRIGHT_WORKER_KEY', '')
SIMPLE_LOGIN_ONLY = os.environ.get('SIMPLE_LOGIN_ONLY', 'true').lower() not in ('0', 'false', 'no')
MAX_COMMENT_IMAGE_BYTES = int(os.environ.get('MAX_COMMENT_IMAGE_BYTES', 8 * 1024 * 1024))
MAX_POST_MEDIA_BYTES = int(os.environ.get('MAX_POST_MEDIA_BYTES', 50 * 1024 * 1024))
ALLOWED_COMMENT_IMAGE_TYPES = {
    'image/jpeg': '.jpg',
    'image/png': '.png',
    'image/webp': '.webp',
    'image/gif': '.gif',
}
ALLOWED_POST_MEDIA_TYPES = {
    **ALLOWED_COMMENT_IMAGE_TYPES,
    'video/mp4': '.mp4',
    'video/quicktime': '.mov',
}

app = Flask(__name__, template_folder='views')
app.secret_key = os.environ.get('APP_SECRET_KEY', 'fb-moni-local-dev-secret-change-me')
app.config.update(
    SESSION_COOKIE_HTTPONLY=True,
    SESSION_COOKIE_SAMESITE='Lax',
    SESSION_COOKIE_SECURE=os.environ.get('FLASK_ENV') == 'production' or bool(os.environ.get('RENDER')),
)

_cors_origins = [
    o.strip()
    for o in os.environ.get(
        'CORS_ORIGINS',
        r'http://localhost:3000,http://127.0.0.1:3000,https://.*\.vercel\.app',
    ).split(',')
    if o.strip()
]
CORS(app, resources={r'/api/*': {'origins': _cors_origins, 'supports_credentials': True}})

# ── State ──────────────────────────────────────────────
_api_cache: dict = {}
_seen_ids: set = set()
_tg_chat_ids: list = []
_pages_cache: dict = {}  # {page_id: {name, access_token}}
_groups: list = []       # [{id, name}]
_settings: dict = {}    # {auto_refresh, interval}
_ai_config: dict = {}   # {provider, model, keys, auto_classify, categories}
_classifications: dict = {}  # {post_id: category}
_leads: dict = {}       # {post_id: [lead]}
_deleted_lead_keys: set[str] = set()
_reply_suggestions: dict = {}  # {post_id: latest suggestion}
_business_profile: dict = {}  # {business_name, phone, address, why_choose_us, extra_notes}
_staff_cookies: dict = {}  # {active_staff_id, staff: [{id, name, cookie, enabled}]}
_session_staff_cache: dict = {}  # server-only cache for Supabase staff cookies
_fb_profile_cache: dict = {}  # facebook_user_id -> {ok, name, id, error, ts}
_staff_fb_display_names: dict = {}  # staff_id -> facebook display name
_staff_list_cache: dict = {'rows': None, 'warning': '', 'at': 0.0}
_STAFF_LIST_CACHE_TTL = 20
_comment_logs: list = []
_comment_summaries: dict = {}
_post_comments: list = []
_managed_channels: list = []
_managed_channels_remote_at: float = 0.0
_MANAGED_CHANNELS_REFRESH_TTL = 30
_tiktok_config: dict = {}
_content_pipeline: dict = {}
_comment_templates: list = []
_comment_tags: list = []
_comment_tag_assignments: dict = {}
_comment_inbox_workflow: dict = {}
_comment_manual_phones: dict = {}
_runtime_staff_context = threading.local()
_scheduled_posts_lock = threading.Lock()


def _default_business_profile() -> dict:
    return {
        'business_name': '',
        'phone': '',
        'address': '',
        'why_choose_us': '',
        'extra_notes': '',
    }


USE_SUPABASE = sb.is_enabled()


def _read_json(path, default):
    try:
        with open(path, 'r', encoding='utf-8') as f:
            return json.load(f)
    except Exception:
        return default


def _write_json(path, data):
    try:
        with open(path, 'w', encoding='utf-8') as f:
            json.dump(data, f, ensure_ascii=False)
    except Exception:
        pass


def _default_ai_config():
    return {
        'provider': 'gemini',
        'model': DEFAULT_MODEL,
        'keys': {'gemini': DEFAULT_API_KEY, 'openai': '', 'groq': '', 'claude': ''},
        'auto_classify': False,
        'categories': DEFAULT_CATEGORIES,
    }


def _default_staff_cookies() -> dict:
    return {'active_staff_id': '', 'staff': []}


def _default_tiktok_config() -> dict:
    return {'cookie': '', 'updated_at': '', 'updated_by': ''}


def _default_content_pipeline() -> dict:
    return {
        'sources': [
            {'id': 'techcrunch', 'name': 'TechCrunch', 'type': 'rss', 'rss_url': 'https://techcrunch.com/feed/', 'active': True},
            {'id': 'crunchbase', 'name': 'Crunchbase News', 'type': 'rss', 'rss_url': 'https://news.crunchbase.com/feed/', 'active': True},
            {'id': 'techstartups', 'name': 'TechStartups', 'type': 'rss', 'rss_url': 'https://techstartups.com/feed/', 'active': True},
        ],
        'articles': [],
        'posts': [],
    }


def _default_content_studio_setup() -> dict:
    return {
        'sections': {
            'opening': {
                'label': 'HOOK',
                'name': 'Hook',
                'description': 'Tối đa 3 dòng',
                'rule': 'Hook phải thu hút, rõ chủ đề và tối đa 3 dòng.',
            },
            'body': {
                'label': 'BODY',
                'name': 'Body',
                'description': 'Rõ ý chính',
                'rule': 'Triển khai nội dung chính mạch lạc, dễ hiểu, bám đúng sản phẩm và khách hàng.',
            },
            'ending': {
                'label': 'CTA',
                'name': 'CTA',
                'description': 'Chốt hành động',
                'rule': 'CTA phải tự nhiên, không bịa ưu đãi hoặc cam kết.',
            },
        },
    }


def _default_content_techniques() -> list[dict]:
    return [
        {
            'id': 'pas',
            'name': 'PAS',
            'content': (
                'Problem: nêu rõ vấn đề hoặc nỗi đau khách đang gặp. '
                'Agitate: khuếch đại hậu quả nếu không giải quyết, tạo cảm giác cấp bách. '
                'Solution: giới thiệu sản phẩm/dịch vụ như giải pháp trực tiếp cho vấn đề đó.'
            ),
            'created_at': 'system',
            'updated_at': 'system',
            'system': True,
        },
        {
            'id': 'aida',
            'name': 'AIDA',
            'content': (
                'Attention: mở đầu gây chú ý. Interest: nêu lợi ích/vấn đề liên quan. '
                'Desire: làm rõ mong muốn và lý do nên chọn. Action: kêu gọi hành động cụ thể.'
            ),
            'created_at': 'system',
            'updated_at': 'system',
            'system': True,
        },
        {
            'id': 'bab',
            'name': 'BAB',
            'content': (
                'Before: mô tả tình trạng hiện tại khó khăn hoặc thiếu sót. '
                'After: vẽ bức tranh tích cực sau khi giải quyết. '
                'Bridge: sản phẩm/dịch vụ là cầu nối giúp chuyển từ Before sang After.'
            ),
            'created_at': 'system',
            'updated_at': 'system',
            'system': True,
        },
        {
            'id': 'storytelling',
            'name': 'Storytelling',
            'content': (
                'Mở bằng tình huống hoặc câu chuyện có nhân vật dễ đồng cảm. '
                'Đưa vào xung đột/thử thách để tạo kịch tính. '
                'Kết bằng bài học và liên hệ tự nhiên tới sản phẩm/dịch vụ.'
            ),
            'created_at': 'system',
            'updated_at': 'system',
            'system': True,
        },
        {
            'id': 'social-proof',
            'name': 'Social Proof',
            'content': (
                'Dùng review, testimonial, số liệu hoặc case study để tăng độ tin cậy. '
                'Nêu số người/khách hàng đã tin dùng hoặc kết quả đạt được. '
                'Giảm rủi ro bằng bằng chứng xã hội trước khi kêu gọi hành động.'
            ),
            'created_at': 'system',
            'updated_at': 'system',
            'system': True,
        },
    ]


def _default_comment_templates() -> list[dict]:
    return [
        {
            'id': 'need',
            'trigger': 'nhucau',
            'title': 'Hỏi nhu cầu',
            'text': 'Em chào anh/chị, mình cần hỗ trợ nội dung nào ạ? Anh/chị gửi thêm yêu cầu để bên em tư vấn đúng hơn nhé.',
            'created_at': 'system',
            'system': True,
        },
        {
            'id': 'price',
            'trigger': 'baogia',
            'title': 'Báo giá',
            'text': 'Em đã nhận thông tin. Anh/chị cho em xin nhu cầu cụ thể và số lượng/khối lượng để bên em báo giá chính xác ạ.',
            'created_at': 'system',
            'system': True,
        },
        {
            'id': 'phone',
            'trigger': 'sdt',
            'title': 'Xin SĐT',
            'text': 'Anh/chị để lại SĐT hoặc nhắn inbox giúp em, sale bên em sẽ liên hệ tư vấn nhanh ạ.',
            'created_at': 'system',
            'system': True,
        },
        {
            'id': 'address',
            'trigger': 'diachi',
            'title': 'Gửi địa chỉ',
            'text': 'Dạ anh/chị ghé trực tiếp theo địa chỉ bên em hoặc để lại SĐT, sale sẽ gửi vị trí và tư vấn chi tiết ạ.',
            'created_at': 'system',
            'system': True,
        },
    ]


def _default_comment_tags() -> list[dict]:
    return [
        {'id': 'hot', 'label': 'Nóng', 'icon': '🔥', 'color': 'red', 'system': True},
        {'id': 'closed', 'label': 'Đã chốt', 'icon': '💰', 'color': 'green', 'system': True},
        {'id': 'need', 'label': 'Có nhu cầu', 'icon': '🎯', 'color': 'blue', 'system': True},
        {'id': 'price', 'label': 'Hỏi giá', 'icon': '❔', 'color': 'yellow', 'system': True},
        {'id': 'review', 'label': 'Xem xét', 'icon': '🔎', 'color': 'slate', 'system': True},
        {'id': 'vip', 'label': 'VIP', 'icon': '⭐', 'color': 'amber', 'system': True},
    ]


def _hash_password(password: str, salt: str = None) -> tuple[str, str]:
    salt = salt or secrets.token_hex(16)
    digest = hashlib.pbkdf2_hmac('sha256', password.encode('utf-8'), salt.encode('utf-8'), 120000)
    return salt, digest.hex()


def _verify_password(password: str, salt: str, digest: str) -> bool:
    if not password or not salt or not digest:
        return False
    _, candidate = _hash_password(password, salt)
    return secrets.compare_digest(candidate, digest)


def _load_state():
    global _seen_ids, _tg_chat_ids, _groups, _settings, _ai_config, _classifications, _leads, _deleted_lead_keys, _reply_suggestions, _business_profile, _staff_cookies, _comment_logs, _comment_summaries, _post_comments, _managed_channels, _managed_channels_remote_at, _tiktok_config, _content_pipeline, _comment_templates, _comment_tags, _comment_tag_assignments, _comment_inbox_workflow, _comment_manual_phones
    try:
        os.makedirs(DATA_DIR, exist_ok=True)
    except OSError as e:
        print(f'[storage] data dir is read-only, using Supabase/runtime storage: {e}')
    try:
        os.makedirs(STAFF_TOKEN_DIR, exist_ok=True)
    except OSError as e:
        print(f'[storage] token dir unavailable, token cache disabled: {e}')

    loaded_from_supabase = False
    if USE_SUPABASE:
        try:
            _seen_ids = set(sb.list_seen_post_ids())
            _tg_chat_ids = sb.list_chat_ids() or ['7129448686']
            _groups = sb.list_groups() or [{'id': DEFAULT_GROUP, 'name': ''}]
            _settings = sb.kv_get('settings', None) or {'auto_refresh': True, 'interval': 5}
            _ai_config = sb.kv_get('ai_config', None) or _default_ai_config()
            _tiktok_config = {**_default_tiktok_config(), **(sb.kv_get('tiktok_config', None) or {})}
            _classifications = sb.list_classifications()
            try:
                remote_channels = sb.list_managed_channels(SUPABASE_CHANNEL_TABLE)
                local_channels = _read_json(MANAGED_CHANNELS_FILE, [])
                _managed_channels = _merge_managed_channels_remote(remote_channels, local_channels)
                _managed_channels_remote_at = time_module.monotonic()
            except Exception as e:
                print(f'[supabase] load managed_channels failed, fallback file: {e}')
                _managed_channels = _read_json(MANAGED_CHANNELS_FILE, [])
            _leads = _read_json(LEADS_FILE, {})
            _reply_suggestions = _read_json(REPLY_SUGGESTIONS_FILE, {})
            loaded_profile = _read_json(BUSINESS_PROFILE_FILE, {})
            _business_profile = {**_default_business_profile(), **loaded_profile}
            profile_sb, _ = _load_business_profile_from_supabase()
            if profile_sb:
                _business_profile = {**_business_profile, **profile_sb}
            print('[supabase] state loaded from Supabase')
            loaded_from_supabase = True
        except Exception as e:
            print(f'[supabase] load failed, fallback file: {e}')

    if not loaded_from_supabase:
        _seen_ids = set(_read_json(SEEN_FILE, []))
        cfg = _read_json(TG_CONFIG_FILE, {})
        _tg_chat_ids = cfg.get('chat_ids') or ([cfg['chat_id']] if cfg.get('chat_id') else ['7129448686'])
        _groups = _read_json(GROUPS_FILE, [{'id': DEFAULT_GROUP, 'name': ''}])
        _settings = _read_json(SETTINGS_FILE, {'auto_refresh': True, 'interval': 5})
        _ai_config = _read_json(AI_CONFIG_FILE, _default_ai_config())
        _tiktok_config = {**_default_tiktok_config(), **_read_json(TIKTOK_CONFIG_FILE, {})}
        _classifications = _read_json(CLASSIFICATIONS_FILE, {})
        _managed_channels = _read_json(MANAGED_CHANNELS_FILE, [])
        _leads = _read_json(LEADS_FILE, {})
        _reply_suggestions = _read_json(REPLY_SUGGESTIONS_FILE, {})
        loaded_profile = _read_json(BUSINESS_PROFILE_FILE, {})
        _business_profile = {**_default_business_profile(), **loaded_profile}

    loaded_staff = _read_json(STAFF_COOKIES_FILE, _default_staff_cookies())
    _staff_cookies = {**_default_staff_cookies(), **loaded_staff}
    if not isinstance(_staff_cookies.get('staff'), list):
        _staff_cookies['staff'] = []
    changed_staff = False
    for item in _staff_cookies['staff']:
        if 'role' not in item:
            item['role'] = 'staff'
            changed_staff = True
        if 'username' not in item:
            item['username'] = re.sub(r'\W+', '_', (item.get('name') or item.get('id') or '')).strip('_').lower()
            changed_staff = True
    if _staff_cookies['staff'] and not any(item.get('role') == 'admin' for item in _staff_cookies['staff']):
        _staff_cookies['staff'][0]['role'] = 'admin'
        changed_staff = True
    if changed_staff:
        _save_staff_cookies()
    _hydrate_staff_accounts_from_supabase()

    _comment_logs = _read_json(COMMENT_LOGS_FILE, [])
    if not isinstance(_comment_logs, list):
        _comment_logs = []
    _comment_summaries = _read_json(COMMENT_SUMMARIES_FILE, {})
    if not isinstance(_comment_summaries, dict):
        _comment_summaries = {}
    _post_comments = _read_json(POST_COMMENTS_FILE, [])
    if not isinstance(_post_comments, list):
        _post_comments = []
    if not isinstance(_managed_channels, list):
        _managed_channels = []
    if not isinstance(_tiktok_config, dict):
        _tiktok_config = _default_tiktok_config()
    loaded_pipeline = _read_json(CONTENT_PIPELINE_FILE, {})
    if USE_SUPABASE:
        try:
            loaded_pipeline = sb.kv_get('content_pipeline', loaded_pipeline) or loaded_pipeline
        except Exception as e:
            print(f'[supabase] load content_pipeline failed, fallback file: {e}')
    default_pipeline = _default_content_pipeline()
    loaded_sources = loaded_pipeline.get('sources') if isinstance(loaded_pipeline.get('sources'), list) else default_pipeline['sources']
    sources = [
        source for source in loaded_sources
        if not (
            str(source.get('id') or '').lower() == 'a16z'
            and 'a16z.com/feed' in str(source.get('rss_url') or source.get('url') or '')
        )
    ]
    if not sources:
        sources = default_pipeline['sources']
    _content_pipeline = {
        'sources': sources,
        'articles': loaded_pipeline.get('articles') if isinstance(loaded_pipeline.get('articles'), list) else [],
        'posts': loaded_pipeline.get('posts') if isinstance(loaded_pipeline.get('posts'), list) else [],
    }
    loaded_templates = _read_json(COMMENT_TEMPLATES_FILE, [])
    loaded_tags = _read_json(COMMENT_TAGS_FILE, [])
    loaded_tag_assignments = _read_json(COMMENT_TAG_ASSIGNMENTS_FILE, {})
    loaded_inbox_workflow = _read_json(COMMENT_INBOX_WORKFLOW_FILE, {})
    loaded_manual_phones = _read_json(COMMENT_MANUAL_PHONES_FILE, {})
    if USE_SUPABASE:
        try:
            loaded_templates = sb.kv_get('comment_templates', loaded_templates) or loaded_templates
        except Exception as e:
            print(f'[supabase] load comment_templates failed, fallback file: {e}')
        try:
            loaded_tags = sb.kv_get('comment_tags', loaded_tags) or loaded_tags
        except Exception as e:
            print(f'[supabase] load comment_tags failed, fallback file: {e}')
        try:
            loaded_tag_assignments = sb.kv_get('comment_tag_assignments', loaded_tag_assignments) or loaded_tag_assignments
        except Exception as e:
            print(f'[supabase] load comment_tag_assignments failed, fallback file: {e}')
        try:
            loaded_inbox_workflow = sb.kv_get('comment_inbox_workflow', loaded_inbox_workflow) or loaded_inbox_workflow
        except Exception as e:
            print(f'[supabase] load comment_inbox_workflow failed, fallback file: {e}')
        try:
            loaded_manual_phones = sb.kv_get('comment_manual_phones', loaded_manual_phones) or loaded_manual_phones
        except Exception as e:
            print(f'[supabase] load comment_manual_phones failed, fallback file: {e}')
    _comment_templates = _merge_system_rows(_default_comment_templates(), loaded_templates if isinstance(loaded_templates, list) else [])
    _comment_tags = _merge_system_rows(_default_comment_tags(), loaded_tags if isinstance(loaded_tags, list) else [])
    _comment_tag_assignments = loaded_tag_assignments if isinstance(loaded_tag_assignments, dict) else {}
    _comment_inbox_workflow = loaded_inbox_workflow if isinstance(loaded_inbox_workflow, dict) else {}
    _comment_manual_phones = loaded_manual_phones if isinstance(loaded_manual_phones, dict) else {}
    raw_deleted = _read_json(DELETED_LEADS_FILE, [])
    _deleted_lead_keys = {
        str(item).strip()
        for item in (raw_deleted if isinstance(raw_deleted, list) else [])
        if str(item or '').strip()
    }
    _backfill_channel_assigned_staff_ids()


def _merge_managed_channels_remote(remote_rows: list, local_rows: list | None = None) -> list[dict]:
    local_rows = local_rows if isinstance(local_rows, list) else []
    local_by_id = {
        str(item.get('id') or '').strip(): item
        for item in local_rows
        if str(item.get('id') or '').strip()
    }
    merged: list[dict] = []
    seen: set[str] = set()
    for row in remote_rows or []:
        if not isinstance(row, dict):
            continue
        channel_id = str(row.get('id') or '').strip()
        if not channel_id:
            continue
        local = local_by_id.get(channel_id) or {}
        assigned = _normalize_assigned_staff_ids(local.get('assigned_staff_ids'))
        if not assigned:
            assigned = _normalize_assigned_staff_ids(row.get('assigned_staff_ids'))
        merged.append({
            **local,
            **row,
            'assigned_staff_ids': assigned,
        })
        seen.add(channel_id)
    for channel_id, local in local_by_id.items():
        if channel_id in seen:
            continue
        merged.append(local)
    return merged


def _save_seen(new_posts=None):
    """Lưu file seen_posts.json và đẩy metadata bài viết mới lên Supabase.

    `new_posts` là list dict bài mới (đã có `_group_id`, `permalink_url`...).
    """
    _write_json(SEEN_FILE, list(_seen_ids))
    if USE_SUPABASE and new_posts:
        try:
            sb.upsert_posts(new_posts)
        except Exception as e:
            print(f'[supabase] save_seen failed: {e}')


def _save_tg():
    _write_json(TG_CONFIG_FILE, {'chat_ids': _tg_chat_ids})


def _save_groups():
    _write_json(GROUPS_FILE, _groups)


def _save_settings():
    _write_json(SETTINGS_FILE, _settings)
    if USE_SUPABASE:
        try:
            sb.kv_set('settings', _settings)
        except Exception as e:
            print(f'[supabase] save_settings failed: {e}')


def _save_ai_config():
    _write_json(AI_CONFIG_FILE, _ai_config)
    if USE_SUPABASE:
        try:
            sb.kv_set('ai_config', _ai_config)
        except Exception as e:
            print(f'[supabase] save_ai_config failed: {e}')


def _save_tiktok_config():
    _write_json(TIKTOK_CONFIG_FILE, _tiktok_config)
    if USE_SUPABASE:
        try:
            sb.kv_set('tiktok_config', _tiktok_config)
        except Exception as e:
            print(f'[supabase] save_tiktok_config failed: {e}')


def _save_content_pipeline():
    _write_json(CONTENT_PIPELINE_FILE, _content_pipeline)
    if USE_SUPABASE:
        try:
            sb.kv_set('content_pipeline', _content_pipeline)
        except Exception as e:
            print(f'[supabase] save content_pipeline failed: {e}')


def _merge_system_rows(defaults: list[dict], rows: list[dict]) -> list[dict]:
    by_id: dict[str, dict] = {}
    for row in defaults + (rows or []):
        if not isinstance(row, dict):
            continue
        row_id = str(row.get('id') or row.get('trigger') or uuid.uuid4().hex[:10]).strip()
        if not row_id:
            continue
        by_id[row_id] = {**row, 'id': row_id}
    return list(by_id.values())


def _save_comment_templates():
    _write_json(COMMENT_TEMPLATES_FILE, _comment_templates)
    if USE_SUPABASE:
        try:
            sb.kv_set('comment_templates', _comment_templates)
        except Exception as e:
            print(f'[supabase] save comment_templates failed: {e}')


def _save_comment_tags():
    _write_json(COMMENT_TAGS_FILE, _comment_tags)
    if USE_SUPABASE:
        try:
            sb.kv_set('comment_tags', _comment_tags)
        except Exception as e:
            print(f'[supabase] save comment_tags failed: {e}')


def _save_comment_tag_assignments():
    _write_json(COMMENT_TAG_ASSIGNMENTS_FILE, _comment_tag_assignments)
    if USE_SUPABASE:
        try:
            sb.kv_set('comment_tag_assignments', _comment_tag_assignments)
        except Exception as e:
            print(f'[supabase] save comment_tag_assignments failed: {e}')


def _save_comment_inbox_workflow():
    _write_json(COMMENT_INBOX_WORKFLOW_FILE, _comment_inbox_workflow)
    if USE_SUPABASE:
        try:
            sb.kv_set('comment_inbox_workflow', _comment_inbox_workflow)
        except Exception as e:
            print(f'[supabase] save comment_inbox_workflow failed: {e}')


def _save_comment_manual_phones():
    _write_json(COMMENT_MANUAL_PHONES_FILE, _comment_manual_phones)
    if USE_SUPABASE:
        try:
            sb.kv_set('comment_manual_phones', _comment_manual_phones)
        except Exception as e:
            print(f'[supabase] save comment_manual_phones failed: {e}')


def _normalize_phones_list(values) -> list[str]:
    seen: set[str] = set()
    phones: list[str] = []
    for item in values or []:
        phone = normalize_phone(str(item or ''))
        if phone and phone not in seen:
            seen.add(phone)
            phones.append(phone)
    return phones


def _manual_phones_for_comment(row: dict) -> list[str]:
    cid = str(row.get('comment_id') or '').strip()
    entry = _comment_manual_phones.get(cid) if cid else None
    if isinstance(entry, str):
        return _normalize_phones_list([entry])
    if isinstance(entry, dict):
        return _normalize_phones_list(entry.get('phones') or ([entry.get('phone')] if entry.get('phone') else []))
    return _normalize_phones_list(row.get('manual_phones') or ([row.get('manual_phone')] if row.get('manual_phone') else []))


def _resolve_comment_phones(row: dict) -> tuple[str, list[str], list[str]]:
    manual_phones = _manual_phones_for_comment(row)
    auto_phones = extract_phones(row.get('message') or '')
    seen: set[str] = set()
    phones: list[str] = []
    for phone in manual_phones + auto_phones:
        if phone and phone not in seen:
            seen.add(phone)
            phones.append(phone)
    return phones[0] if phones else '', phones, manual_phones


def _workflow_lists() -> tuple[list[str], list[str]]:
    processed: list[str] = []
    starred: list[str] = []
    for comment_id, state in (_comment_inbox_workflow or {}).items():
        if not isinstance(state, dict):
            continue
        cid = str(comment_id or '').strip()
        if not cid:
            continue
        if state.get('processed'):
            processed.append(cid)
        if state.get('starred'):
            starred.append(cid)
    return processed, starred


def _strip_html(text: str, limit: int = 600) -> str:
    text = re.sub(r'<[^>]+>', ' ', text or '')
    text = unescape(re.sub(r'\s+', ' ', text)).strip()
    return text[:limit].rstrip() + ('...' if len(text) > limit else '')


def _pipeline_article_id(url: str, title: str = '') -> str:
    seed = (url or title or str(uuid.uuid4())).strip()
    return hashlib.sha1(seed.encode('utf-8')).hexdigest()[:12]


def _pipeline_post_id(article_id: str, fmt: str) -> str:
    return hashlib.sha1(f'{article_id}|{fmt}|{datetime.utcnow().isoformat()}'.encode('utf-8')).hexdigest()[:12]


def _parse_iso_datetime(value: str):
    value = str(value or '').strip()
    if not value:
        return None
    try:
        if value.endswith('Z'):
            value = value[:-1] + '+00:00'
        dt = datetime.fromisoformat(value)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=_app_timezone())
        return dt.astimezone(timezone.utc)
    except Exception:
        return None


def _pipeline_post_message(post: dict) -> str:
    return '\n\n'.join([str(post.get('content') or '').strip(), str(post.get('hashtags') or '').strip()]).strip()


_VIDEO_EXT_RE = re.compile(r'\.(mp4|mov|m4v|webm|avi|mkv|flv|wmv|3gp|ogv)(\?|$)', re.I)

# Only direct video files can be sent to Facebook Graph /videos as native uploads.
# YouTube/TikTok/Facebook watch URLs must be posted as link previews; treating
# them as native file_url makes Graph fail.
def _is_direct_video_url(url: str) -> bool:
    url = (url or '').strip()
    return bool(url and _VIDEO_EXT_RE.search(url))

def _page_token_from_cache(page_id: str) -> str:
    global _pages_cache
    page_id = str(page_id or '').strip()
    if not page_id:
        return ''
    cached = (_pages_cache.get(page_id) or {}).get('access_token') or ''
    if cached:
        return cached
    pages, _, _ = _load_facebook_pages_for_active_cookie()
    for p in pages:
        if p.get('id'):
            prev = _pages_cache.get(str(p.get('id'))) or {}
            _pages_cache[str(p.get('id'))] = {
                'name': p.get('name', '') or prev.get('name', ''),
                'access_token': p.get('access_token', '') or prev.get('access_token', ''),
            }
    return (_pages_cache.get(page_id) or {}).get('access_token') or ''


def _extract_post_media(post: dict) -> tuple[str, str]:
    media_url = str(post.get('media_url') or post.get('image_url') or post.get('article_url') or '').strip()
    native_video_url = str(post.get('native_video_url') or '').strip()
    if not native_video_url and media_url and _is_direct_video_url(media_url):
        native_video_url = media_url
        media_url = ''
    return media_url, native_video_url


def _extract_media_urls(body: dict) -> list[str]:
    candidates = [
        body.get('media_urls'),
        body.get('image_urls'),
        body.get('photo_urls'),
        body.get('attachments'),
        body.get('media_url_native'),
        body.get('image_url_native'),
    ]
    urls: list[str] = []
    for value in candidates:
        if not value:
            continue
        if isinstance(value, str):
            items = value.replace(',', '\n').splitlines()
        elif isinstance(value, list):
            items = []
            for item in value:
                if isinstance(item, dict):
                    items.append(item.get('url') or item.get('image_url') or item.get('media_url') or '')
                else:
                    items.append(item)
        else:
            continue
        for item in items:
            url = str(item or '').strip()
            if url and url not in urls:
                urls.append(url)
    return urls


def _publish_content_pipeline_post(post: dict, targets: list[dict], dry_run: bool = False) -> dict:
    message = _pipeline_post_message(post)
    if not message:
        return {'ok': False, 'error': 'Bản nháp chưa có nội dung', 'results': []}
    media_url, native_video_url = _extract_post_media(post)
    media_urls = _extract_media_urls(post)
    results = []
    ok_count = 0
    for target in targets:
        target_type = str((target or {}).get('type') or '').strip().lower()
        target_id = str((target or {}).get('id') or '').strip()
        target_name = str((target or {}).get('name') or '').strip()
        delivery = 'native_media' if media_urls else ('native_video' if native_video_url else ('link_preview' if media_url else 'text'))
        try:
            if dry_run:
                ok_count += 1
                results.append({
                    'ok': True,
                    'dry_run': True,
                    'type': target_type or 'group',
                    'id': target_id,
                    'name': target_name,
                    'delivery': delivery,
                    'message_preview': message[:240],
                    'media_url': media_url,
                    'media_urls': media_urls,
                    'native_video_url': native_video_url,
                })
                continue
            if target_type == 'page':
                page_token = _page_token_from_cache(target_id)
                if not page_token:
                    raise RuntimeError('Không lấy được Page token')
                result = get_api(DEFAULT_GROUP).create_page_post(
                    target_id,
                    message,
                    page_token,
                    '' if media_urls else media_url,
                    '' if media_urls else native_video_url,
                    media_urls=media_urls,
                )
            else:
                if not target_id:
                    raise RuntimeError('Thiếu group_id')
                page_id = str((target or {}).get('page_id') or '').strip()
                page_token = _page_token_from_cache(page_id) if page_id else None
                result = get_api(target_id).create_post(
                    message,
                    page_token,
                    '' if media_urls else media_url,
                    '' if media_urls else native_video_url,
                    media_urls=media_urls,
                )
            delivery = (result or {}).get('_delivery') or delivery
            if result and result.get('id'):
                ok_count += 1
                results.append({
                    'ok': True,
                    'type': target_type or 'group',
                    'id': target_id,
                    'name': target_name,
                    'post_id': result.get('id'),
                    'delivery': delivery,
                    'native_video_error': (result or {}).get('_native_video_error'),
                })
            else:
                fb_error = (result or {}).get('error') or {}
                err = fb_error.get('error_user_msg') or fb_error.get('message') or 'Lỗi không xác định'
                results.append({
                    'ok': False,
                    'type': target_type or 'group',
                    'id': target_id,
                    'name': target_name,
                    'error': err,
                    'delivery': delivery,
                    'native_video_error': (result or {}).get('_native_video_error'),
                })
        except Exception as e:
            results.append({'ok': False, 'type': target_type or 'group', 'id': target_id, 'name': target_name, 'error': str(e), 'delivery': delivery})
    return {'ok': ok_count > 0, 'success_count': ok_count, 'failed_count': len(results) - ok_count, 'results': results}


def _rss_child_text(item, names: tuple[str, ...]) -> str:
    for name in names:
        node = item.find(name)
        if node is not None and node.text:
            return node.text.strip()
    for child in list(item):
        tag = child.tag.split('}', 1)[-1]
        if tag in names and child.text:
            return child.text.strip()
    return ''


def _fetch_pipeline_rss(source: dict, limit: int = 12) -> list[dict]:
    url = source.get('rss_url') or source.get('url')
    if not url:
        return []
    resp = _req.get(
        url,
        headers={'User-Agent': 'Mozilla/5.0 Seeding Fsolution/1.0'},
        timeout=15,
    )
    resp.raise_for_status()
    root = ET.fromstring(resp.content)
    items = root.findall('.//item') or root.findall('.//{http://www.w3.org/2005/Atom}entry')
    rows = []
    for item in items[:limit]:
        title = _rss_child_text(item, ('title',))
        link = _rss_child_text(item, ('link',))
        if not link:
            link_node = item.find('{http://www.w3.org/2005/Atom}link')
            link = link_node.attrib.get('href', '') if link_node is not None else ''
        summary = _strip_html(_rss_child_text(item, ('description', 'summary', 'content', 'encoded')), 700)
        published = _rss_child_text(item, ('pubDate', 'published', 'updated'))
        published_at = datetime.utcnow().isoformat(timespec='seconds') + 'Z'
        if published:
            try:
                published_at = parsedate_to_datetime(published).astimezone(timezone.utc).isoformat()
            except Exception:
                published_at = published
        article_id = _pipeline_article_id(link, title)
        if title and link:
            rows.append({
                'id': article_id,
                'source_id': source.get('id') or '',
                'source_name': source.get('name') or 'RSS',
                'source_type': source.get('type') or 'rss',
                'title': _strip_html(title, 220),
                'url': link,
                'summary': summary,
                'published_at': published_at,
                'status': 'new',
                'created_at': datetime.utcnow().isoformat(timespec='seconds') + 'Z',
            })
    return rows


def _pipeline_write_article(article: dict, fmt: str) -> dict:
    fmt_label = {
        'pov': 'góc nhìn chuyên gia, có quan điểm rõ',
        'info': 'bản tin ngắn, dễ hiểu',
        'case': 'case study ứng dụng thực tế',
        'howto': 'hướng dẫn từng bước',
    }.get(fmt, 'bài social ngắn')
    fallback = (
        f"{article.get('title', 'Tin mới')}\n\n"
        f"{article.get('summary', '')}\n\n"
        "Góc nhìn vận hành: chọn ý chính, liên hệ tới nhu cầu khách hàng và chốt bằng một câu hỏi mở để kéo tương tác."
    ).strip()
    hashtags = '#STReal #Marketing #AIContent'
    classifier = _get_classifier()
    if classifier.api_key:
        prompt = f"""Bạn là content marketer tiếng Việt cho Seeding Fsolution.

Viết lại tin sau thành một bài đăng Facebook/LinkedIn chuyên nghiệp.
- Format: {fmt_label}
- Giọng văn: rõ ràng, thực tế, không phóng đại.
- Có hook mở đầu, 3-5 ý chính, CTA nhẹ ở cuối.
- Không bịa số liệu ngoài dữ liệu.

TIÊU ĐỀ: {article.get('title', '')}
TÓM TẮT: {article.get('summary', '')}
LINK GỐC: {article.get('url', '')}

Trả về JSON object:
{{"content":"nội dung bài đăng", "hashtags":"3-6 hashtag liên quan"}}
CHỈ trả về JSON."""
        try:
            payload = json.loads(re.sub(r'^```(?:json)?|```$', '', classifier._call_api(prompt).strip(), flags=re.I | re.M).strip())
            content = str(payload.get('content') or '').strip()
            ai_hashtags = str(payload.get('hashtags') or '').strip()
            if content:
                return {'content': content, 'hashtags': ai_hashtags or hashtags, 'ai_error': ''}
        except Exception as e:
            return {'content': fallback, 'hashtags': hashtags, 'ai_error': str(e)}
    return {'content': fallback, 'hashtags': hashtags, 'ai_error': 'Chưa cấu hình API key AI'}


def _save_classifications(new_items=None):
    _write_json(CLASSIFICATIONS_FILE, _classifications)
    if USE_SUPABASE and new_items:
        try:
            sb.upsert_classifications(new_items)
        except Exception as e:
            print(f'[supabase] save_classifications failed: {e}')


def _save_leads():
    _write_json(LEADS_FILE, _leads)


_LEAD_NEED_KEYWORDS = [
    'tôi cần', 'nhu cầu', 'cần hỗ trợ', 'cần xây dựng', 'cần tool', 'cần phần mềm',
    'tìm đơn vị làm', 'tìm người làm', 'cần đơn vị', 'cần làm',
]
_LEAD_PLATFORM_KEYWORDS = [
    'appsheet', 'app sheet', 'google sheet', 'webapp', 'web app', 'phần mềm', 'excel',
]
_LEAD_BUSINESS_MODULES = [
    'bán hàng', 'khách hàng', 'crm', 'sale', 'vận đơn', 'quản lý đơn', 'hàng hóa',
    'marketing', 'kế toán', 'thuế', 'nhân sự', 'chấm công', 'kho', 'thiết bị',
    'quản lý kho', 'quản lý vận tải',
]
_LEAD_LEVELS = [
    ('cold', 'Lead lạnh', 0, 10),
    ('interest', 'Lead quan tâm', 11, 30),
    ('warm', 'Lead ấm', 31, 60),
    ('hot', 'Lead nóng', 61, 90),
    ('vip', 'Lead rất nóng', 91, 999),
]


def _lead_text_blob(lead: dict) -> str:
    parts = [
        lead.get('need'), lead.get('comment_text'), lead.get('evidence'),
        lead.get('product_or_service'), lead.get('budget'), lead.get('urgency'),
    ]
    return ' '.join(str(item or '').strip() for item in parts if str(item or '').strip()).lower()


def _lead_first_match(text: str, keywords: list[str]) -> str:
    for kw in keywords:
        if kw in text:
            return kw
    return ''


def _score_lead(lead: dict) -> tuple[int, dict]:
    text = _lead_text_blob(lead)
    score = 0
    breakdown: list[str] = []
    if _lead_first_match(text, _LEAD_NEED_KEYWORDS):
        score += 10
        breakdown.append('Từ khóa nhu cầu +10')
    if 'báo giá' in text or 'bao gia' in text:
        score += 20
        breakdown.append('Báo giá +20')
    phone = str(lead.get('phone') or '').strip()
    phones = lead.get('phones') if isinstance(lead.get('phones'), list) else []
    if phone or phones:
        score += 30
        breakdown.append('SĐT +30')
    if re.search(r'trong tháng|trong tuần|tuần này|tháng này|deadline|hạn chót|triển khai trong', text):
        score += 20
        breakdown.append('Deadline +20')
    if re.search(r'gấp|khẩn|urgent|asap|triển khai gấp', text):
        score += 25
        breakdown.append('Yêu cầu gấp +25')
    if re.search(r'ngân sách|budget|triệu|tỷ|chi phí', text) or str(lead.get('budget') or '').strip():
        score += 25
        breakdown.append('Ngân sách +25')
    platform_tag = _lead_first_match(text, _LEAD_PLATFORM_KEYWORDS)
    business_module = _lead_first_match(text, _LEAD_BUSINESS_MODULES)
    if platform_tag or business_module:
        score += 30
        breakdown.append('Matching solution +30')
    fields = {
        'matched_keyword': _lead_first_match(text, _LEAD_NEED_KEYWORDS),
        'platform_tag': platform_tag,
        'business_module': business_module,
    }
    return score, {**fields, 'score_breakdown': breakdown}


def _lead_level_from_score(score: int) -> tuple[str, str]:
    for level_id, label, low, high in _LEAD_LEVELS:
        if low <= score <= high:
            return level_id, label
    return 'cold', 'Lead lạnh'


def _lead_key(lead: dict) -> str:
    base = '|'.join([
        str(lead.get('platform') or lead.get('source_platform') or ''),
        str(lead.get('post_id') or ''),
        str(lead.get('comment_id') or lead.get('source_id') or ''),
        str(lead.get('phone') or lead.get('customer_phone') or ''),
    ]).strip('|')
    if not base:
        base = json.dumps(lead, ensure_ascii=False, sort_keys=True)
    return hashlib.sha1(base.encode('utf-8')).hexdigest()


def _normalise_lead(lead: dict, post_id: str = '') -> dict:
    if not isinstance(lead, dict):
        lead = {}
    phones = lead.get('phones') if isinstance(lead.get('phones'), list) else []
    phone = str(lead.get('phone') or lead.get('customer_phone') or (phones[0] if phones else '') or '').strip()
    if phone and phone not in phones:
        phones = [phone, *phones]
    phones = [str(item).strip() for item in phones if str(item or '').strip()]
    pid = str(lead.get('post_id') or post_id or '').strip()
    lead_source = str(lead.get('lead_source') or lead.get('source') or '').strip() or ('comment' if lead.get('comment_id') else 'post')
    platform = str(lead.get('platform') or lead.get('source_platform') or '').strip().lower()
    if not platform:
        platform = 'tiktok' if str(pid).startswith('tiktok_') else 'facebook'
    comment_author = str(lead.get('comment_author') or lead.get('author_name') or '').strip()
    comment_text = str(
        lead.get('comment_text')
        or lead.get('comment_message')
        or lead.get('message')
        or ''
    ).strip()
    comment_id = str(lead.get('comment_id') or lead.get('source_id') or '').strip()
    if comment_id and (not comment_author or not comment_text):
        for row in _post_comments:
            if str(row.get('comment_id') or '') != comment_id:
                continue
            if not comment_author:
                comment_author = str(row.get('author_name') or '').strip()
            if not comment_text:
                comment_text = str(row.get('message') or '').strip()
            break
    if lead_source == 'comment':
        if not comment_author:
            comment_author = str(lead.get('name') or lead.get('customer_name') or 'Ẩn danh').strip()
        if not comment_text:
            comment_text = str(lead.get('evidence') or lead.get('need') or lead.get('customer_need') or '').strip()
    base = {
        **lead,
        'lead_key': str(lead.get('lead_key') or _lead_key({**lead, 'post_id': pid, 'phone': phone})),
        'platform': platform,
        'post_id': pid,
        'group_id': str(lead.get('group_id') or '').strip(),
        'post_url': str(lead.get('post_url') or '').strip(),
        'comment_id': comment_id,
        'comment_url': str(lead.get('comment_url') or '').strip(),
        'source': lead_source,
        'source_id': str(lead.get('source_id') or lead.get('comment_id') or pid).strip(),
        'name': str(lead.get('name') or lead.get('customer_name') or comment_author or 'Ẩn danh').strip(),
        'comment_author': comment_author,
        'comment_text': comment_text,
        'phone': phone,
        'phones': phones,
        'need': str(lead.get('need') or lead.get('customer_need') or lead.get('evidence') or '').strip(),
        'intent': str(lead.get('intent') or 'phone_comment').strip(),
        'product_or_service': str(lead.get('product_or_service') or '').strip(),
        'location': str(lead.get('location') or '').strip(),
        'budget': str(lead.get('budget') or '').strip(),
        'urgency': str(lead.get('urgency') or 'medium').strip(),
        'contact_status': 'has_phone' if phone else str(lead.get('contact_status') or 'no_phone'),
        'confidence': float(lead.get('confidence') or (0.95 if phone else 0.6)),
        'evidence': str(lead.get('evidence') or '').strip(),
        'assigned_sale': str(lead.get('assigned_sale') or lead.get('sale_owner') or '').strip(),
        'crm_status': str(lead.get('crm_status') or '').strip(),
        'processed_at': str(lead.get('processed_at') or '').strip(),
        'processed_by': str(lead.get('processed_by') or lead.get('processed_by_staff_name') or '').strip(),
        'processed_by_staff_id': str(lead.get('processed_by_staff_id') or '').strip(),
    }
    score_val = lead.get('score')
    if score_val is None:
        score_val, score_fields = _score_lead(base)
    else:
        _, score_fields = _score_lead(base)
        score_val = int(score_val)
    level_id, level_label = _lead_level_from_score(int(score_val))
    crm_status = base.get('crm_status') or ('Lead mới' if int(score_val) > 10 else 'Theo dõi')
    return {
        **base,
        **score_fields,
        'score': int(score_val),
        'lead_level': level_id,
        'lead_level_label': level_label,
        'crm_status': crm_status,
    }


def _merge_leads_into_memory(leads: list[dict]) -> int:
    global _leads
    changed = 0
    dirty = False
    for lead in leads or []:
        row = _normalise_lead(lead)
        pid = row.get('post_id')
        if not pid:
            continue
        bucket = _leads.setdefault(pid, [])
        existing = {str(item.get('lead_key') or _lead_key(item)): idx for idx, item in enumerate(bucket)}
        key = str(row.get('lead_key'))
        if key in _deleted_lead_keys:
            continue
        public_row = {k: v for k, v in row.items() if k != 'raw_lead'}
        if key in existing:
            next_row = {**bucket[existing[key]], **public_row}
            if next_row != bucket[existing[key]]:
                bucket[existing[key]] = next_row
                dirty = True
        else:
            bucket.append(public_row)
            changed += 1
            dirty = True
    if dirty:
        _save_leads()
    return changed


def _delete_lead_from_memory(post_id: str, lead_key: str) -> bool:
    global _leads
    key = str(lead_key or '').strip()
    if not key:
        return False
    pid = str(post_id or '').strip()

    def _without_key(bucket: list) -> list:
        return [item for item in bucket if str(item.get('lead_key') or _lead_key(item)) != key]

    if pid:
        bucket = _leads.get(pid)
        if not bucket:
            return False
        next_bucket = _without_key(bucket)
        if len(next_bucket) == len(bucket):
            return False
        if next_bucket:
            _leads[pid] = next_bucket
        else:
            _leads.pop(pid, None)
        _save_leads()
        return True

    removed = False
    for pid_key, bucket in list(_leads.items()):
        next_bucket = _without_key(bucket)
        if len(next_bucket) == len(bucket):
            continue
        removed = True
        if next_bucket:
            _leads[pid_key] = next_bucket
        else:
            _leads.pop(pid_key, None)
    if removed:
        _save_leads()
    return removed


def _delete_lead_from_supabase(lead_key: str) -> tuple[bool, str, int]:
    key = str(lead_key or '').strip()
    if not key:
        return False, 'Thiếu lead_key', 0
    if not SUPABASE_URL or not SUPABASE_KEY:
        return True, '', 0
    try:
        resp = _req.delete(
            f"{SUPABASE_URL.rstrip('/')}/rest/v1/{SUPABASE_LEAD_TABLE}?lead_key=eq.{quote(key)}",
            headers={
                'apikey': SUPABASE_KEY,
                'Authorization': f'Bearer {SUPABASE_KEY}',
                'Prefer': 'return=representation',
            },
            timeout=30,
        )
        if resp.status_code == 200:
            try:
                rows = resp.json()
                count = len(rows) if isinstance(rows, list) else 0
                return True, '', count
            except Exception:
                return True, '', 0
        if resp.status_code == 204:
            return True, '', 1
        if resp.headers.get('content-type', '').startswith('application/json'):
            try:
                return False, (resp.json().get('message') or resp.text)[:300], 0
            except Exception:
                pass
        return False, resp.text[:300], 0
    except Exception as e:
        return False, str(e)[:300], 0


def _save_deleted_lead_keys():
    _write_json(DELETED_LEADS_FILE, sorted(_deleted_lead_keys))


def _mark_lead_deleted(lead_key: str) -> None:
    global _deleted_lead_keys
    key = str(lead_key or '').strip()
    if not key or key in _deleted_lead_keys:
        return
    _deleted_lead_keys.add(key)
    _save_deleted_lead_keys()


def _filter_deleted_leads(leads: dict) -> dict:
    if not _deleted_lead_keys:
        return leads
    filtered: dict[str, list] = {}
    for post_id, items in (leads or {}).items():
        bucket = [
            item for item in (items or [])
            if str(item.get('lead_key') or _lead_key(item)) not in _deleted_lead_keys
        ]
        if bucket:
            filtered[post_id] = bucket
    return filtered


def _lead_exists_in_supabase(lead_key: str) -> bool:
    key = str(lead_key or '').strip()
    if not key or not SUPABASE_URL or not SUPABASE_KEY:
        return False
    try:
        resp = _req.get(
            f"{SUPABASE_URL.rstrip('/')}/rest/v1/{SUPABASE_LEAD_TABLE}",
            headers={'apikey': SUPABASE_KEY, 'Authorization': f'Bearer {SUPABASE_KEY}'},
            params={'select': 'lead_key', 'lead_key': f'eq.{key}', 'limit': '1'},
            timeout=15,
        )
        if resp.status_code not in (200, 206):
            return False
        return bool(resp.json())
    except Exception:
        return False


def _lead_exists_anywhere(post_id: str, lead_key: str) -> bool:
    key = str(lead_key or '').strip()
    if not key:
        return False
    pid = str(post_id or '').strip()
    buckets = [_leads.get(pid)] if pid else list(_leads.values())
    for bucket in buckets:
        for item in bucket or []:
            if str(item.get('lead_key') or _lead_key(item)) == key:
                return True
    return _lead_exists_in_supabase(key)


def _delete_single_lead(post_id: str, lead_key: str) -> dict:
    key = str(lead_key or '').strip()
    removed_local = _delete_lead_from_memory(post_id, key)
    supabase_ok, supabase_error, deleted_remote = _delete_lead_from_supabase(key)
    _mark_lead_deleted(key)
    payload: dict = {}
    if removed_local and not supabase_ok and supabase_error:
        payload['warning'] = f'Đã xoá local, Supabase chưa xoá được: {supabase_error}'
    elif not removed_local and deleted_remote <= 0:
        payload['storage'] = 'hidden'
        if supabase_error:
            payload['warning'] = f'Đã ẩn lead; Supabase chưa xoá được: {supabase_error}'
    elif not removed_local and deleted_remote > 0:
        payload['storage'] = 'supabase'
    return payload


def _lead_to_supabase_row(lead: dict) -> dict:
    row = _normalise_lead(lead)
    staff = _current_staff()
    now = datetime.utcnow().isoformat(timespec='seconds') + 'Z'
    return {
        'lead_key': row.get('lead_key'),
        'platform': row.get('platform'),
        'lead_source': row.get('source'),
        'source_id': row.get('source_id'),
        'post_id': row.get('post_id'),
        'group_id': row.get('group_id'),
        'post_url': row.get('post_url'),
        'comment_id': row.get('comment_id'),
        'comment_url': row.get('comment_url'),
        'customer_name': row.get('name'),
        'customer_phone': row.get('phone'),
        'phones': row.get('phones') or [],
        'customer_need': row.get('need'),
        'intent': row.get('intent'),
        'product_or_service': row.get('product_or_service'),
        'location': row.get('location'),
        'budget': row.get('budget'),
        'urgency': row.get('urgency'),
        'contact_status': row.get('contact_status'),
        'confidence': row.get('confidence'),
        'evidence': row.get('evidence'),
        'raw_lead': row,
        'created_by_staff_id': staff.get('id', ''),
        'created_by_staff_name': staff.get('name', ''),
        'created_by_staff_username': staff.get('username', ''),
        'created_at': row.get('created_at') or now,
        'updated_at': now,
    }


def _save_leads_to_supabase(leads: list[dict]) -> tuple[bool, str]:
    if not leads:
        return True, ''
    if not SUPABASE_URL or not SUPABASE_KEY:
        return False, 'Chưa cấu hình Supabase'
    rows_by_key = {}
    for lead in leads:
        row = _lead_to_supabase_row(lead)
        if row.get('lead_key'):
            rows_by_key[row['lead_key']] = row
    rows = list(rows_by_key.values())
    if not rows:
        return True, ''
    headers = {
        'apikey': SUPABASE_KEY,
        'Authorization': f'Bearer {SUPABASE_KEY}',
        'Content-Type': 'application/json',
        'Prefer': 'resolution=merge-duplicates,return=minimal',
    }
    try:
        for i in range(0, len(rows), 200):
            resp = _req.post(
                f"{SUPABASE_URL.rstrip('/')}/rest/v1/{SUPABASE_LEAD_TABLE}?on_conflict=lead_key",
                headers=headers,
                json=rows[i:i + 200],
                timeout=30,
            )
            if resp.status_code not in (200, 201, 204):
                if resp.headers.get('content-type', '').startswith('application/json'):
                    try:
                        return False, (resp.json().get('message') or resp.text)[:300]
                    except Exception:
                        pass
                return False, resp.text[:300]
        return True, ''
    except Exception as e:
        return False, str(e)[:300]


def _supabase_lead_row_to_public(row: dict) -> dict:
    raw = row.get('raw_lead') if isinstance(row.get('raw_lead'), dict) else {}
    return {
        **raw,
        'id': row.get('id'),
        'lead_key': row.get('lead_key'),
        'platform': row.get('platform') or raw.get('platform') or '',
        'source': row.get('lead_source') or raw.get('source') or '',
        'source_id': row.get('source_id') or raw.get('source_id') or '',
        'post_id': row.get('post_id') or raw.get('post_id') or '',
        'group_id': row.get('group_id') or raw.get('group_id') or '',
        'post_url': row.get('post_url') or raw.get('post_url') or '',
        'comment_id': row.get('comment_id') or raw.get('comment_id') or '',
        'comment_url': row.get('comment_url') or raw.get('comment_url') or '',
        'name': row.get('customer_name') or raw.get('name') or 'Ẩn danh',
        'phone': row.get('customer_phone') or raw.get('phone') or '',
        'phones': row.get('phones') or raw.get('phones') or [],
        'need': row.get('customer_need') or raw.get('need') or '',
        'intent': row.get('intent') or raw.get('intent') or '',
        'product_or_service': row.get('product_or_service') or raw.get('product_or_service') or '',
        'location': row.get('location') or raw.get('location') or '',
        'budget': row.get('budget') or raw.get('budget') or '',
        'urgency': row.get('urgency') or raw.get('urgency') or '',
        'contact_status': row.get('contact_status') or raw.get('contact_status') or '',
        'confidence': row.get('confidence') or raw.get('confidence') or 0,
        'evidence': row.get('evidence') or raw.get('evidence') or '',
        'comment_author': raw.get('comment_author') or row.get('comment_author') or '',
        'comment_text': raw.get('comment_text') or row.get('comment_text') or '',
        'created_at': row.get('created_at') or raw.get('created_at') or '',
        'processed_at': raw.get('processed_at') or row.get('processed_at') or '',
        'processed_by': raw.get('processed_by') or row.get('processed_by_staff_name') or row.get('created_by_staff_name') or '',
        'processed_by_staff_id': raw.get('processed_by_staff_id') or row.get('created_by_staff_id') or '',
        'created_by_staff_id': row.get('created_by_staff_id') or raw.get('created_by_staff_id') or '',
        'created_by_staff_name': row.get('created_by_staff_name') or raw.get('created_by_staff_name') or '',
        'created_by_staff_username': row.get('created_by_staff_username') or raw.get('created_by_staff_username') or '',
        'score': raw.get('score') if raw.get('score') is not None else row.get('score'),
        'lead_level': raw.get('lead_level') or '',
        'lead_level_label': raw.get('lead_level_label') or '',
        'crm_status': raw.get('crm_status') or '',
    }


def _public_leads_dict(leads: dict) -> dict:
    grouped: dict[str, list] = {}
    for post_id, items in (leads or {}).items():
        bucket = [
            _normalise_lead({**item, 'post_id': str(item.get('post_id') or post_id or '').strip()})
            for item in (items or [])
        ]
        if bucket:
            grouped[str(post_id)] = bucket
    return _filter_deleted_leads(grouped)


def _filter_leads_for_current_staff(leads: dict) -> dict:
    if _is_admin():
        return leads
    staff = _current_staff()
    staff_id = str(staff.get('id') or '').strip()
    staff_name = str(staff.get('name') or '').strip().lower()
    staff_username = str(staff.get('username') or '').strip().lower()
    if not staff_id:
        return {}
    filtered: dict[str, list] = {}
    for post_id, items in (leads or {}).items():
        owned = []
        for item in items or []:
            owner_ids = {
                str(item.get('processed_by_staff_id') or '').strip(),
                str(item.get('created_by_staff_id') or '').strip(),
            }
            assigned_sale = str(item.get('assigned_sale') or '').strip().lower()
            if staff_id in owner_ids or assigned_sale in {staff_name, staff_username}:
                owned.append(item)
        if owned:
            filtered[post_id] = owned
    return filtered


def _load_leads_from_supabase(limit: int = 3000) -> tuple[dict, str]:
    if not SUPABASE_URL or not SUPABASE_KEY:
        return {}, 'Chưa cấu hình Supabase'
    try:
        resp = _req.get(
            f"{SUPABASE_URL.rstrip('/')}/rest/v1/{SUPABASE_LEAD_TABLE}",
            headers={'apikey': SUPABASE_KEY, 'Authorization': f'Bearer {SUPABASE_KEY}'},
            params={
                'select': '*',
                'order': 'created_at.desc',
                'limit': str(max(1, min(int(limit or 3000), 5000))),
            },
            timeout=30,
        )
        if resp.status_code not in (200, 206):
            return {}, resp.text[:300]
        grouped: dict[str, list] = {}
        for row in resp.json() or []:
            lead = _supabase_lead_row_to_public(row)
            pid = str(lead.get('post_id') or '')
            if pid:
                grouped.setdefault(pid, []).append(lead)
        return grouped, ''
    except Exception as e:
        return {}, str(e)[:300]


def _comment_rows_to_phone_leads(rows: list[dict]) -> list[dict]:
    leads: list[dict] = []
    for row in rows or []:
        message = str(row.get('message') or '').strip()
        _, phones, _ = _resolve_comment_phones(row)
        if not phones:
            continue
        public = _public_comment_row(row)
        post_id = str(row.get('post_id') or '')
        platform = str(row.get('source') or '').lower() or ('tiktok' if post_id.startswith('tiktok_') else 'facebook')
        leads.append(_normalise_lead({
            'platform': platform,
            'source': 'comment',
            'source_id': row.get('comment_id') or '',
            'comment_id': row.get('comment_id') or '',
            'post_id': post_id,
            'group_id': row.get('group_id') or '',
            'post_url': row.get('post_url') or '',
            'comment_url': public.get('comment_url') or row.get('post_url') or '',
            'name': row.get('author_name') or 'Ẩn danh',
            'comment_author': row.get('author_name') or 'Ẩn danh',
            'comment_text': message,
            'phone': phones[0],
            'phones': phones,
            'need': message[:220],
            'intent': 'phone_comment',
            'contact_status': 'has_phone',
            'confidence': 0.95,
            'evidence': message[:300],
        }))
    return leads


def _sync_phone_leads_from_comment_rows(rows: list[dict]) -> tuple[int, str]:
    leads = _comment_rows_to_phone_leads(rows)
    if not leads:
        return 0, ''
    changed = _merge_leads_into_memory(leads)
    ok, error = _save_leads_to_supabase(leads)
    return changed, '' if ok else error


def _save_reply_suggestions():
    _write_json(REPLY_SUGGESTIONS_FILE, _reply_suggestions)


def _save_staff_cookies():
    _write_json(STAFF_COOKIES_FILE, _staff_cookies)


def _save_comment_logs():
    _write_json(COMMENT_LOGS_FILE, _comment_logs[-1000:])


def _save_comment_summaries():
    _write_json(COMMENT_SUMMARIES_FILE, _comment_summaries)


def _save_post_comments():
    _write_json(POST_COMMENTS_FILE, _post_comments[-5000:])


def _save_managed_channels():
    _write_json(MANAGED_CHANNELS_FILE, _managed_channels)


def _extract_cookie_user(cookie: str) -> str:
    match = re.search(r'(?:^|;\s*)c_user=([^;]+)', cookie or '')
    return match.group(1) if match else ''


def _extract_cookie_value(cookie: str, name: str) -> str:
    match = re.search(rf'(?:^|;\s*){re.escape(name)}=([^;]+)', cookie or '')
    return match.group(1) if match else ''


def _mask_cookie(cookie: str) -> str:
    if not cookie:
        return ''
    c_user = _extract_cookie_user(cookie)
    if c_user:
        return f'c_user={c_user}; ...'
    return cookie[:8] + '...' + cookie[-6:] if len(cookie) > 18 else '***'


def _mask_tiktok_cookie(cookie: str) -> str:
    if not cookie:
        return ''
    for key in ('sessionid', 'sid_tt', 'tt_csrf_token', 'msToken'):
        value = _extract_cookie_value(cookie, key)
        if value:
            return f'{key}={value[:6]}...{value[-4:]}' if len(value) > 12 else f'{key}=***'
    return cookie[:10] + '...' + cookie[-6:] if len(cookie) > 20 else '***'


TIKTOK_LOGIN_COOKIE_KEYS = ('sessionid', 'sessionid_ss', 'sid_tt', 'sid_guard', 'uid_tt', 'uid_tt_ss')


def _has_tiktok_login_cookie(cookie: str) -> bool:
    return any(_extract_cookie_value(cookie, key) for key in TIKTOK_LOGIN_COOKIE_KEYS)


def _tiktok_cookie_login_message(cookie: str) -> str:
    if not cookie:
        return 'Chưa có TikTok cookie.'
    if _has_tiktok_login_cookie(cookie):
        return 'Cookie có session đăng nhập TikTok. Nếu vẫn lỗi, phiên đăng nhập đã hết hạn hoặc TikTok chặn thao tác.'
    return 'Cookie TikTok thiếu session đăng nhập như sessionid/sid_tt. Hãy đăng nhập TikTok rồi copy cookie đầy đủ từ tiktok.com.'


def _friendly_tiktok_publish_error(message: str) -> str:
    text = str(message or '').strip()
    lower = text.lower()
    if any(token in lower for token in ('đăng nhập', 'login', 'expired', 'session', 'hết hạn')):
        return 'Cookie TikTok đã hết hạn hoặc chưa phải cookie của tài khoản đang đăng nhập. Mở tiktok.com, đăng nhập lại rồi copy cookie đầy đủ vào menu Cooki.'
    return text or 'TikTok không nhận bình luận'


def _configured_tiktok_cookie() -> str:
    return str((_tiktok_config or {}).get('cookie') or TIKTOK_COOKIE or '').strip()


def _public_tiktok_config() -> dict:
    cookie = _configured_tiktok_cookie()
    source = 'web' if str((_tiktok_config or {}).get('cookie') or '').strip() else ('env' if TIKTOK_COOKIE else '')
    return {
        'has_cookie': bool(cookie),
        'has_login_cookie': _has_tiktok_login_cookie(cookie),
        'cookie_masked': _mask_tiktok_cookie(cookie),
        'source': source,
        'updated_at': (_tiktok_config or {}).get('updated_at') or '',
        'updated_by': (_tiktok_config or {}).get('updated_by') or '',
        'can_manage': _is_admin(),
    }


def _normalize_staff_managed_groups(raw) -> list[dict]:
    if raw is None:
        return []
    if isinstance(raw, str):
        text = raw.strip()
        if not text:
            return []
        try:
            raw = json.loads(text)
        except json.JSONDecodeError:
            return []
    if isinstance(raw, dict):
        raw = raw.get('groups') or raw.get('items') or []
    if not isinstance(raw, list):
        return []
    rows = []
    for item in raw:
        if isinstance(item, str):
            gid = item.strip()
            if gid:
                rows.append({'id': gid, 'name': ''})
            continue
        if not isinstance(item, dict):
            continue
        gid = str(item.get('id') or item.get('group_id') or '').strip()
        name = str(item.get('name') or item.get('group_name') or '').strip()
        platform = str(item.get('platform') or '').strip()
        channel_type = str(item.get('channel_type') or item.get('type') or '').strip()
        if gid or name:
            row = {'id': gid, 'name': name}
            if platform:
                row['platform'] = platform
            if channel_type:
                row['channel_type'] = channel_type
            rows.append(row)
    return rows


def _channel_type_bucket(value: str) -> str:
    text = str(value or '').strip().lower()
    if text in ('page', 'fanpage', 'trang'):
        return 'page'
    if text in ('nhóm', 'nhom', 'group'):
        return 'group'
    if text == 'video':
        return 'video'
    return text


def _managed_group_item_key(item: dict) -> str:
    platform = str(item.get('platform') or '').strip().lower()
    ctype = _channel_type_bucket(item.get('channel_type') or item.get('type'))
    gid = str(item.get('id') or item.get('group_id') or '').strip()
    name = str(item.get('name') or item.get('group_name') or '').strip().lower()
    return f'{platform}|{ctype}|{gid}|{name}'


def _merge_managed_groups(*parts) -> list[dict]:
    by_key: dict[str, dict] = {}
    for raw in parts:
        for item in _normalize_staff_managed_groups(raw):
            key = _managed_group_item_key(item)
            by_key[key] = {**by_key.get(key, {}), **item}
    return list(by_key.values())


def _staff_identity_key(item: dict) -> str:
    username = str(item.get('username') or '').strip().lower()
    if username:
        return f'user:{username}'
    staff_id = str(item.get('id') or '').strip()
    return f'id:{staff_id}' if staff_id else ''


def _find_local_staff_account(staff_id: str, hint: dict | None = None) -> dict | None:
    token = str(staff_id or '').strip()
    if not token:
        return None
    token_lower = token.lower()
    accounts = _staff_accounts()
    for item in accounts:
        if str(item.get('id') or '').strip() == token:
            return item
        if token_lower and str(item.get('username') or '').strip().lower() == token_lower:
            return item
    hint = hint or {}
    hint_user = str(hint.get('username') or '').strip().lower()
    if hint_user:
        for item in accounts:
            if str(item.get('username') or '').strip().lower() == hint_user:
                return item
    return None


def _staff_wanted_keys(wanted_ids) -> set[str]:
    keys: set[str] = set()
    for raw in wanted_ids or []:
        token = str(raw or '').strip()
        if not token:
            continue
        row = _find_local_staff_account(token)
        if row:
            identity = _staff_identity_key(row)
            if identity:
                keys.add(identity)
            sid = str(row.get('id') or '').strip()
            if sid:
                keys.add(f'id:{sid}')
            user = str(row.get('username') or '').strip().lower()
            if user:
                keys.add(f'user:{user}')
        else:
            keys.add(f'id:{token}')
            keys.add(f'user:{token.lower()}')
    return keys


def _staff_row_in_wanted(staff_row: dict, wanted_keys: set[str]) -> bool:
    identity = _staff_identity_key(staff_row)
    if identity and identity in wanted_keys:
        return True
    sid = str(staff_row.get('id') or '').strip()
    if sid and f'id:{sid}' in wanted_keys:
        return True
    user = str(staff_row.get('username') or '').strip().lower()
    if user and f'user:{user}' in wanted_keys:
        return True
    return False


def _staff_managed_groups_snapshot(staff_id: str, fallback: dict | None = None) -> list[dict]:
    staff_id = str(staff_id or '').strip()
    fallback = fallback or {}
    local = _find_local_staff_account(staff_id, fallback) if staff_id else None
    return _merge_managed_groups(
        (local or {}).get('managed_groups'),
        fallback.get('managed_groups'),
    )


def _channel_assigned_staff_ids(channel_row: dict) -> list[str]:
    stored = _normalize_assigned_staff_ids(channel_row.get('assigned_staff_ids'))
    if stored:
        return stored
    return [
        str(item.get('id') or '').strip()
        for item in _channel_assigned_staff_public(channel_row)
        if str(item.get('id') or '').strip()
    ]


def _canonical_staff_id(staff_id: str, hint: dict | None = None) -> str:
    token = str(staff_id or '').strip()
    if not token:
        return ''
    local = _find_local_staff_account(token, hint)
    return str((local or hint or {}).get('id') or token).strip()


def _staff_display_entries(staff_ids: list[str], staff_rows: list | None = None) -> list[dict]:
    wanted_keys = _staff_wanted_keys(staff_ids)
    if not wanted_keys:
        return []
    rows = []
    for staff_row in staff_rows or _all_staff_rows_for_assignment():
        if not _staff_row_in_wanted(staff_row, wanted_keys):
            continue
        rows.append({
            'id': staff_row.get('id', ''),
            'name': staff_row.get('name', ''),
            'username': staff_row.get('username', ''),
            'role': staff_row.get('role', 'staff'),
        })
    return rows


def _groups_from_other_assigned_channels(staff_id: str, *, exclude_channel_id: str = '') -> list[dict]:
    staff_keys = _staff_wanted_keys([staff_id])
    if not staff_keys:
        return []
    groups: list[dict] = []
    for channel in _managed_channels:
        channel_id = str(channel.get('id') or '').strip()
        if exclude_channel_id and channel_id == exclude_channel_id:
            continue
        assigned_ids = _channel_assigned_staff_ids(channel)
        if not assigned_ids:
            continue
        assigned_keys = _staff_wanted_keys(assigned_ids)
        if not staff_keys.intersection(assigned_keys):
            continue
        entry = _managed_group_from_channel(channel)
        if entry.get('id') or entry.get('name'):
            groups.append(entry)
    return groups


def _managed_groups_signature(groups: list[dict]) -> list[str]:
    return sorted(_managed_group_item_key(item) for item in _normalize_staff_managed_groups(groups))


def _set_channel_assigned_staff_ids(channel_id: str, staff_ids: list[str]) -> None:
    global _managed_channels
    channel_id = str(channel_id or '').strip()
    if not channel_id:
        return
    canonical: list[str] = []
    seen: set[str] = set()
    for raw_id in staff_ids or []:
        cid = _canonical_staff_id(str(raw_id or '').strip())
        if not cid or cid in seen:
            continue
        seen.add(cid)
        canonical.append(cid)
    now = datetime.utcnow().isoformat(timespec='seconds') + 'Z'
    updated = False
    for index, item in enumerate(_managed_channels):
        if str(item.get('id') or '').strip() != channel_id:
            continue
        _managed_channels[index] = {**item, 'assigned_staff_ids': canonical, 'updated_at': now}
        updated = True
        break
    if updated:
        _save_managed_channels()


def _backfill_channel_assigned_staff_ids() -> None:
    global _managed_channels
    changed = False
    for index, item in enumerate(_managed_channels):
        if _normalize_assigned_staff_ids(item.get('assigned_staff_ids')):
            continue
        inferred = _channel_assigned_staff_ids(item)
        if not inferred:
            continue
        _managed_channels[index] = {**item, 'assigned_staff_ids': inferred}
        changed = True
    if changed:
        _save_managed_channels()


def _assign_staff_to_channel(channel_row: dict, staff_ids: list[str], *, merge: bool = True) -> str:
    wanted = {str(item or '').strip() for item in (staff_ids or []) if str(item or '').strip()}
    if merge:
        current = _channel_assigned_staff_public(channel_row)
        wanted |= {str(item.get('id') or '').strip() for item in current if item.get('id')}
    return _sync_channel_staff_assignments(channel_row, list(wanted))


def _is_facebook_group_managed(item: dict) -> bool:
    platform = str(item.get('platform') or '').strip().lower()
    ctype = str(item.get('channel_type') or item.get('type') or '').strip().lower()
    if platform and platform != 'facebook':
        return False
    if ctype and ctype not in ('nhóm', 'nhom', 'group', ''):
        return False
    return bool(str(item.get('id') or item.get('group_id') or '').strip())


def _staff_allowed_group_ids():
    """None = admin (all groups). Otherwise set of group IDs staff may access."""
    if _is_admin():
        return None
    staff = _current_staff()
    if not staff:
        return set()
    managed = _current_staff_managed_groups()
    allowed = {
        str(item.get('id') or '').strip()
        for item in managed
        if _is_facebook_group_managed(item)
    }
    allowed.discard('')
    return allowed


def _current_staff_managed_groups() -> list[dict]:
    staff_id = str(_current_staff_id() or '').strip()
    if not staff_id:
        return []
    for row in _all_staff_rows_for_assignment():
        if str(row.get('id') or '').strip() == staff_id:
            return _normalize_staff_managed_groups(row.get('managed_groups'))
    return _normalize_staff_managed_groups(_current_staff().get('managed_groups'))


def _filter_group_ids_for_staff(group_ids: list) -> list:
    if _is_admin():
        return group_ids
    managed = _current_staff_managed_groups()
    if not managed:
        return []
    kept = []
    for gid in group_ids:
        gid = str(gid or '').strip()
        if not gid:
            continue
        entry = {'id': gid, 'platform': 'facebook', 'channel_type': 'nhóm'}
        if any(_managed_group_matches(entry, item) for item in managed):
            kept.append(gid)
    return kept


def _mask_proxy_url(url: str) -> str:
    text = str(url or '').strip()
    if not text:
        return ''
    return re.sub(r'(:)([^:@/]+)(@)', r':***\3', text, count=1)


def _normalize_staff_facebook_cookies(raw, fallback_cookie: str = '') -> list[dict]:
    if raw is None:
        raw = []
    if isinstance(raw, str):
        text = raw.strip()
        if not text:
            raw = []
        else:
            try:
                raw = json.loads(text)
            except json.JSONDecodeError:
                raw = []
    if isinstance(raw, dict):
        raw = raw.get('facebook_cookies') or raw.get('cookies') or raw.get('items') or []
    if not isinstance(raw, list):
        raw = []
    rows = []
    for index, item in enumerate(raw):
        if isinstance(item, str):
            cookie = item.strip()
            if cookie:
                rows.append({
                    'id': uuid.uuid4().hex[:10],
                    'label': f'Cookie {index + 1}',
                    'cookie': cookie,
                    'facebook_user_id': _extract_cookie_user(cookie),
                })
            continue
        if not isinstance(item, dict):
            continue
        cookie = str(item.get('cookie') or item.get('value') or '').strip()
        label = str(item.get('label') or item.get('name') or '').strip()
        cookie_id = str(item.get('id') or '').strip() or uuid.uuid4().hex[:10]
        if cookie:
            rows.append({
                'id': cookie_id,
                'label': label or f'Cookie {len(rows) + 1}',
                'cookie': cookie,
                'facebook_user_id': str(item.get('facebook_user_id') or _extract_cookie_user(cookie) or ''),
                'facebook_name': str(item.get('facebook_name') or item.get('name_fb') or '').strip(),
            })
    fallback = str(fallback_cookie or '').strip()
    if not rows and fallback:
        rows.append({
            'id': 'primary',
            'label': 'Cookie chính',
            'cookie': fallback,
            'facebook_user_id': _extract_cookie_user(fallback),
        })
    return rows


def _primary_staff_cookie(row: dict) -> str:
    cookies = _normalize_staff_facebook_cookies(row.get('facebook_cookies'), row.get('cookie', ''))
    active_id = str(row.get('active_cookie_id') or '').strip()
    if active_id:
        for item in cookies:
            if item.get('id') == active_id and item.get('cookie'):
                return item['cookie']
    for item in cookies:
        if item.get('cookie'):
            return item['cookie']
    return str(row.get('cookie') or '').strip()


def _sync_staff_cookie_fields(row: dict) -> dict:
    cookies = _normalize_staff_facebook_cookies(row.get('facebook_cookies'), row.get('cookie', ''))
    primary = _primary_staff_cookie({**row, 'facebook_cookies': cookies})
    row['facebook_cookies'] = cookies
    row['cookie'] = primary
    if primary:
        row['facebook_user_id'] = _extract_cookie_user(primary)
    return row


def _merge_staff_facebook_cookies(incoming_raw, existing_row: dict) -> list[dict]:
    existing = _normalize_staff_facebook_cookies(
        existing_row.get('facebook_cookies'),
        existing_row.get('cookie', ''),
    )
    if incoming_raw is None:
        return existing
    existing_by_id = {str(item.get('id') or ''): item for item in existing}
    incoming = _normalize_staff_facebook_cookies(incoming_raw, '')
    merged = []
    for item in incoming:
        cookie = str(item.get('cookie') or '').strip()
        cookie_id = str(item.get('id') or '').strip()
        existing_item = existing_by_id.get(cookie_id, {}) if cookie_id else {}
        if not cookie and cookie_id and cookie_id in existing_by_id:
            cookie = str(existing_item.get('cookie') or '').strip()
        if cookie:
            cookie_changed = bool(existing_item) and cookie != str(existing_item.get('cookie') or '').strip()
            actual_user_id = _extract_cookie_user(cookie)
            previous_user_id = str(existing_item.get('facebook_user_id') or _extract_cookie_user(existing_item.get('cookie', '')) or '').strip()
            incoming_user_id = str(item.get('facebook_user_id') or '').strip()
            facebook_name = str(item.get('facebook_name') or '').strip()
            if cookie_changed or (actual_user_id and incoming_user_id and actual_user_id != incoming_user_id) or (actual_user_id and previous_user_id and actual_user_id != previous_user_id):
                facebook_name = ''
            merged.append({
                **item,
                'cookie': cookie,
                'facebook_user_id': actual_user_id,
                'facebook_name': facebook_name,
            })
    return merged if merged else existing


def _combine_staff_facebook_cookies(*rows: dict) -> list[dict]:
    combined: dict[str, dict] = {}
    order: list[str] = []
    for row in rows:
        if not row:
            continue
        for item in _normalize_staff_facebook_cookies(row.get('facebook_cookies'), row.get('cookie', '')):
            cookie = str(item.get('cookie') or '').strip()
            if not cookie:
                continue
            cookie_id = str(item.get('id') or '').strip() or uuid.uuid4().hex[:10]
            if cookie_id not in combined:
                order.append(cookie_id)
            combined[cookie_id] = {**combined.get(cookie_id, {}), **item, 'id': cookie_id, 'cookie': cookie}
    return [combined[cookie_id] for cookie_id in order]


def _supabase_staff_write_warning(dropped: list[str]) -> str:
    if not dropped:
        return ''
    labels = {
        'facebook_cookies': 'facebook_cookies (nhiều cookie FB)',
        'managed_groups': 'managed_groups (nhóm quản lý)',
        'active_cookie_id': 'active_cookie_id',
    }
    missing = ', '.join(labels.get(key, key) for key in dropped)
    return (
        f'Supabase thiếu cột {missing}. '
        'Chạy file supabase_staff_facebook_cookies_patch.sql và supabase_staff_managed_groups_patch.sql '
        'trong Supabase SQL Editor rồi lưu lại.'
    )


def _sanitize_staff_cookie_rows(cookies: list[dict]) -> tuple[list[dict], str]:
    valid: list[dict] = []
    warnings: list[str] = []
    for item in cookies:
        cookie = str(item.get('cookie') or '').strip()
        if not cookie:
            continue
        if 'c_user=' not in cookie:
            label = str(item.get('label') or 'Cookie').strip() or 'Cookie'
            warnings.append(f'{label}: bỏ qua vì thiếu c_user')
            continue
        valid.append(item)
    return valid, ' | '.join(warnings)


def _staff_with_active_cookie(staff: dict) -> dict:
    if not staff:
        return {}
    merged = dict(staff)
    session_active_id = session.get('active_cookie_id') if has_request_context() else ''
    active_id = str(session_active_id or merged.get('active_cookie_id') or '').strip()
    if active_id:
        merged['active_cookie_id'] = active_id
    return merged


def _is_invalid_facebook_display_name(raw: str) -> bool:
    text = str(raw or '').strip().lower()
    if not text:
        return True
    if text in ('facebook', 'log in', 'login', 'đăng nhập', 'đăng nhập facebook'):
        return True
    if 'đăng nhập' in text and 'facebook' in text:
        return True
    if 'log in' in text and 'facebook' in text:
        return True
    if text.startswith('facebook id '):
        return True
    return False


def _decode_facebook_name(raw: str) -> str:
    text = unescape(str(raw or '').strip())
    if not text:
        return ''
    try:
        if '\\u' in text or '\\x' in text:
            text = text.encode('utf-8').decode('unicode_escape')
    except Exception:
        pass
    text = re.sub(r'\s*[\|\-–]\s*Facebook.*$', '', text, flags=re.I).strip()
    if _is_invalid_facebook_display_name(text):
        return ''
    return text


def _facebook_cookie_headers(cookie: str) -> dict:
    return {
        'cookie': cookie,
        'user-agent': (
            'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) '
            'AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1'
        ),
        'accept-language': 'vi-VN,vi;q=0.9,en;q=0.8',
        'accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    }


def _parse_facebook_name_from_html(html: str, user_id: str) -> str:
    if not html:
        return ''
    patterns = (
        rf'"USER_ID":"{re.escape(user_id)}","NAME":"([^"]+)"',
        rf'"actorID":"{re.escape(user_id)}","name":"([^"]+)"',
        rf'"entity_id":"{re.escape(user_id)}","name":"([^"]+)"',
        rf'"userID":"{re.escape(user_id)}","name":"([^"]+)"',
        rf'"id":"{re.escape(user_id)}","name":"([^"]+)"',
        r'id="cover-name"[^>]*>([^<]+)<',
        r'class="[^"]*profileName[^"]*"[^>]*>([^<]+)<',
        r'"SHORT_NAME":"([^"]+)"',
        r'property="og:title"\s+content="([^"]+)"',
        r'<title>([^<|]+)',
        r'<strong[^>]*>([^<]{2,80})</strong>',
    )
    for pattern in patterns:
        match = re.search(pattern, html, flags=re.I | re.S)
        if not match:
            continue
        name = _decode_facebook_name(match.group(1))
        if name:
            return name
    return ''


def _extract_facebook_page_id_from_href(href: str) -> str:
    href = unescape(str(href or '')).replace('\\/', '/')
    if not href:
        return ''
    patterns = (
        r'[?&]id=(\d{10,20})',
        r'/profile\.php\?id=(\d{10,20})',
        r'/pages/[^/?#]+/(\d{10,20})',
        r'facebook\.com/(?:pages/[^/?#]+/)?(\d{10,20})(?:[/?#]|$)',
    )
    for pattern in patterns:
        match = re.search(pattern, href, flags=re.I)
        if match:
            return match.group(1)
    return ''


def _clean_facebook_page_name(raw: str) -> str:
    text = unescape(re.sub(r'<[^>]+>', ' ', str(raw or '')))
    text = re.sub(r'\s+', ' ', text).strip()
    text = re.sub(r'\s*[\|\-–]\s*Facebook.*$', '', text, flags=re.I).strip()
    blocked = {
        'facebook',
        'fanpage',
        'pages',
        'page',
        'trang',
        'thích',
        'theo dõi',
        'follow',
        'like',
        'xem thêm',
        'see more',
    }
    if not text or text.lower() in blocked:
        return ''
    if len(text) > 120:
        return ''
    return text


def _fetch_facebook_pages_from_cookie_html(cookie: str) -> tuple[list[dict], str]:
    cookie = str(cookie or '').strip()
    if not cookie:
        return [], 'Chưa có cookie Facebook đang active.'
    urls = [
        'https://www.facebook.com/pages/?category=your_pages',
        'https://m.facebook.com/pages/?category=your_pages',
        'https://mbasic.facebook.com/pages/?category=your_pages',
        'https://www.facebook.com/bookmarks/pages',
        'https://m.facebook.com/bookmarks/pages',
    ]
    headers = _facebook_cookie_headers(cookie)
    pages_by_id: dict[str, dict] = {}
    current_user_id = _extract_cookie_user(cookie)
    last_error = ''

    for url in urls:
        try:
            resp = _req.get(url, headers=headers, timeout=18, allow_redirects=True)
            html = resp.text or ''
            if resp.status_code >= 400:
                last_error = f'Facebook HTML {resp.status_code}'
                continue
            if '/login' in resp.url.lower() or 'đăng nhập' in html[:900].lower() or '<title>log in' in html[:900].lower():
                last_error = 'Cookie Facebook bị chuyển về trang đăng nhập.'
                continue

            # Prefer explicit JSON-like page objects when Facebook embeds them.
            for match in re.finditer(
                r'"(?:id|pageID|page_id|profile_id|profile_plus_id)"\s*:\s*"(\d{10,20})".{0,500}?"(?:name|title|profile_name)"\s*:\s*"([^"]{2,160})"',
                html,
                flags=re.I | re.S,
            ):
                page_id = match.group(1)
                name = _clean_facebook_page_name(_decode_facebook_name(match.group(2)))
                if page_id == current_user_id:
                    continue
                if page_id and name:
                    pages_by_id[page_id] = {
                        'id': page_id,
                        'name': name,
                        'access_token': '',
                        'source': 'cookie_html',
                    }

            for match in re.finditer(
                r'"(?:name|title|profile_name)"\s*:\s*"([^"]{2,160})".{0,500}?"(?:id|pageID|page_id|profile_id|profile_plus_id)"\s*:\s*"(\d{10,20})"',
                html,
                flags=re.I | re.S,
            ):
                name = _clean_facebook_page_name(_decode_facebook_name(match.group(1)))
                page_id = match.group(2)
                if page_id == current_user_id:
                    continue
                if page_id and name:
                    pages_by_id[page_id] = {
                        'id': page_id,
                        'name': name,
                        'access_token': '',
                        'source': 'cookie_html',
                    }

            for match in re.finditer(r'<a\b[^>]*href=["\']([^"\']+)["\'][^>]*>(.*?)</a>', html, flags=re.I | re.S):
                href = unescape(match.group(1))
                label = _clean_facebook_page_name(match.group(2))
                if not label:
                    continue
                page_id = _extract_facebook_page_id_from_href(href)
                if not page_id:
                    continue
                if page_id == current_user_id:
                    continue
                if any(word in label.lower() for word in ('quảng cáo', 'ads manager', 'business suite', 'meta business')):
                    continue
                pages_by_id[page_id] = {
                    'id': page_id,
                    'name': label,
                    'access_token': '',
                    'source': 'cookie_html',
                }
        except Exception as e:
            last_error = str(e)[:180]

    pages = list(pages_by_id.values())
    pages.sort(key=lambda item: item.get('name') or item.get('id') or '')
    warning = ''
    if pages:
        warning = 'Đồng bộ Page bằng cookie HTML nên có thể chưa có Page token để đăng/đọc bài Page. Nếu đăng Page lỗi, hãy cập nhật cookie admin Page hoặc thêm Page thủ công.'
    elif last_error:
        warning = last_error
    return pages, warning


def _load_facebook_pages_for_active_cookie() -> tuple[list[dict], str, str]:
    """Return pages, warning, source. Graph is preferred because it includes Page tokens."""
    global _pages_cache
    graph_pages: list[dict] = []
    graph_error = ''
    try:
        api = get_api(DEFAULT_GROUP)
        graph_pages = api.get_pages() or []
        graph_error = getattr(api, 'last_graph_error', '') or ''
    except Exception as e:
        graph_error = str(e)[:240]
    if graph_pages:
        _pages_cache = {
            str(p.get('id') or ''): {'name': p.get('name', ''), 'access_token': p.get('access_token', '')}
            for p in graph_pages
            if p.get('id')
        }
        return graph_pages, '', 'facebook_graph'

    html_pages, html_warning = _fetch_facebook_pages_from_cookie_html(_active_cookie())
    if html_pages:
        # Preserve any token already cached, but allow HTML-discovered Pages to appear in the UI.
        for page in html_pages:
            page_id = str(page.get('id') or '')
            cached = _pages_cache.get(page_id) or {}
            _pages_cache[page_id] = {
                'name': page.get('name', '') or cached.get('name', ''),
                'access_token': cached.get('access_token', '') or page.get('access_token', ''),
            }
        warning = html_warning or 'Graph không trả Page; đã lấy Page bằng cookie HTML.'
        if graph_error:
            warning = f'{warning} Graph: {graph_error}'
        return html_pages, warning, 'cookie_html'

    warning = graph_error or html_warning or 'Không tìm thấy Page nào từ Graph hoặc cookie HTML.'
    return [], warning, 'none'


def _remember_facebook_display_name(staff: dict, name: str) -> None:
    text = str(name or '').strip()
    if not text:
        return
    staff_id = str(staff.get('id') or '')
    if staff_id:
        _staff_fb_display_names[staff_id] = text
    try:
        session['facebook_display_name'] = text
    except Exception:
        pass


def _cached_facebook_display_name(staff: dict, user_id: str = '') -> str:
    staff_id = str(staff.get('id') or '')
    if staff_id and _staff_fb_display_names.get(staff_id):
        cached_name = str(_staff_fb_display_names[staff_id] or '').strip()
        if not _is_invalid_facebook_display_name(cached_name):
            return cached_name
    try:
        cached = str(session.get('facebook_display_name') or '').strip()
        if cached and not _is_invalid_facebook_display_name(cached):
            return cached
    except Exception:
        pass
    if user_id:
        cached = _fb_profile_cache.get(user_id)
        if cached and cached.get('name'):
            name = str(cached.get('name') or '').strip()
            if not _is_invalid_facebook_display_name(name):
                return name
    cookies = _normalize_staff_facebook_cookies(staff.get('facebook_cookies'), staff.get('cookie', ''))
    active_id = str(staff.get('active_cookie_id') or '').strip()
    for item in cookies:
        if active_id and str(item.get('id') or '') != active_id:
            continue
        name = str(item.get('facebook_name') or '').strip()
        if name and not _is_invalid_facebook_display_name(name):
            return name
    for item in cookies:
        name = str(item.get('facebook_name') or '').strip()
        if name and not _is_invalid_facebook_display_name(name):
            return name
    return ''


def _prefetch_facebook_display_name(staff: dict) -> None:
    cookie = _primary_staff_cookie(staff)
    if not cookie:
        return
    user_id = _extract_cookie_user(cookie)
    if not user_id or _cached_facebook_display_name(staff, user_id):
        return

    def _job():
        profile = _fetch_facebook_profile(cookie, allow_token=False, fast=True)
        if not profile.get('ok'):
            profile = _fetch_facebook_profile(cookie, allow_token=True, fast=False)
        if profile.get('ok') and profile.get('name'):
            _staff_fb_display_names[str(staff.get('id') or '')] = profile['name']

    threading.Thread(target=_job, daemon=True).start()


def _fetch_facebook_profile(cookie: str, *, allow_token: bool = True, fast: bool = False) -> dict:
    user_id = _extract_cookie_user(cookie)
    if not user_id:
        return {'ok': False, 'name': '', 'id': '', 'error': 'Cookie thiếu c_user'}
    cached = _fb_profile_cache.get(user_id)
    if cached and (time_module.time() - float(cached.get('ts') or 0)) < 3600:
        return {k: cached[k] for k in ('ok', 'name', 'id', 'error') if k in cached}

    try:
        scrape_urls = (
            f'https://mbasic.facebook.com/profile.php?id={user_id}',
            f'https://m.facebook.com/profile.php?id={user_id}',
        ) if fast else (
            f'https://mbasic.facebook.com/profile.php?id={user_id}',
            f'https://m.facebook.com/profile.php?id={user_id}',
            f'https://www.facebook.com/profile.php?id={user_id}',
            'https://www.facebook.com/me',
            'https://www.facebook.com/',
        )
        req_timeout = 4 if fast else 8
        for url in scrape_urls:
            resp = _req.get(
                url,
                headers=_facebook_cookie_headers(cookie),
                timeout=req_timeout,
                allow_redirects=True,
            )
            if 'login.php' in (resp.url or '').lower():
                continue
            html = resp.text or ''
            if re.search(r'login_form|name="pass"|id="loginform"|"login":\s*true', html, flags=re.I):
                continue
            name = _parse_facebook_name_from_html(html, user_id)
            if name:
                result = {'ok': True, 'name': name, 'id': user_id, 'error': ''}
                _fb_profile_cache[user_id] = {**result, 'ts': time_module.time()}
                return result
    except Exception:
        pass

    if fast or not allow_token:
        return {'ok': False, 'name': '', 'id': user_id, 'error': 'Không đọc được tên Facebook'}

    token_file = _staff_token_file(_current_staff_id() or 'default', cookie=cookie)
    token = FacebookTokenGenerator(FB_CLIENT_ID, cookie, token_file).GetToken()
    if token:
        try:
            resp = _req.get(
                f'{GRAPH_URL}/me',
                params={'fields': 'id,name', 'access_token': token},
                timeout=12,
            )
            data = resp.json()
            if data.get('name'):
                result = {
                    'ok': True,
                    'name': str(data.get('name') or '').strip(),
                    'id': str(data.get('id') or user_id),
                    'error': '',
                }
                _fb_profile_cache[user_id] = {**result, 'ts': time_module.time()}
                return result
            error = data.get('error', {}).get('message') or 'Không đọc được tên Facebook'
            return {'ok': False, 'name': '', 'id': user_id, 'error': error}
        except Exception as exc:
            return {'ok': False, 'name': '', 'id': user_id, 'error': friendly_graph_error(exc)}

    return {'ok': False, 'name': '', 'id': user_id, 'error': 'Không đọc được tên Facebook'}


def _prepare_staff_facebook_cookies_for_save(cookies: list[dict], *, fetch_names: bool = False) -> list[dict]:
    prepared = []
    for item in cookies:
        row = dict(item)
        cookie_val = str(row.get('cookie') or '').strip()
        if not cookie_val:
            continue
        if not row.get('facebook_user_id'):
            row['facebook_user_id'] = _extract_cookie_user(cookie_val)
        prepared.append(row)
    if fetch_names and prepared:
        return _enrich_staff_facebook_cookies_with_names(prepared, fast=True)
    return prepared


def _enrich_staff_facebook_cookies_with_names(cookies: list[dict], *, fast: bool = False) -> list[dict]:
    enriched = []
    profile_cache: dict[str, dict] = {}
    for item in cookies:
        row = dict(item)
        cookie_val = str(row.get('cookie') or '').strip()
        fb_name = str(row.get('facebook_name') or '').strip()
        fb_id = str(row.get('facebook_user_id') or _extract_cookie_user(cookie_val) or '')
        if _is_invalid_facebook_display_name(fb_name):
            fb_name = ''
        if cookie_val and not fb_name:
            cache_key = fb_id or cookie_val[:24]
            if cache_key not in profile_cache:
                profile_cache[cache_key] = _fetch_facebook_profile(cookie_val, fast=fast)
            profile = profile_cache[cache_key]
            if profile.get('ok'):
                row['facebook_name'] = profile.get('name', '')
                row['facebook_user_id'] = profile.get('id') or fb_id
        enriched.append(row)
    return enriched


def _persist_facebook_cookie_names(staff: dict, cookies: list[dict]) -> None:
    global _staff_cookies
    staff_id = str(staff.get('id') or '')
    if not staff_id or not cookies:
        return
    normalized = _normalize_staff_facebook_cookies(cookies, staff.get('cookie', ''))
    changed = False
    merged = []
    for item in normalized:
        row = dict(item)
        if row.get('cookie') and row.get('facebook_name'):
            changed = True
        merged.append(row)
    if not changed:
        return
    now = datetime.utcnow().isoformat(timespec='seconds') + 'Z'
    remote_row = {'facebook_cookies': merged, 'updated_at': now}
    if USE_SUPABASE:
        try:
            _, _dropped = sb.update_staff_user_by_id(staff_id, remote_row, SUPABASE_STAFF_TABLE)
        except Exception:
            pass
    local_target = next((entry for entry in _staff_accounts() if entry.get('id') == staff_id), None)
    if local_target:
        local_target['facebook_cookies'] = merged
        local_target['updated_at'] = now
        _save_staff_cookies()
    token = session.get('staff_cache_token', '')
    if token and token in _session_staff_cache:
        cached = dict(_session_staff_cache[token])
        cached['facebook_cookies'] = merged
        _session_staff_cache[token] = cached


def _facebook_cookie_context_payload(staff: dict, *, resolve_name: bool = False, force_refresh: bool = False) -> dict:
    staff = _staff_with_active_cookie(staff)
    cookies = _normalize_staff_facebook_cookies(staff.get('facebook_cookies'), staff.get('cookie', ''))
    active_id = str(staff.get('active_cookie_id') or '').strip()
    if not active_id and cookies:
        active_id = str(cookies[0].get('id') or '')
    profile_cache: dict[str, dict] = {}
    items = []
    updated_cookies = []
    for item in cookies:
        cookie_id = str(item.get('id') or '')
        cookie_val = str(item.get('cookie') or '').strip()
        fb_id = str(item.get('facebook_user_id') or _extract_cookie_user(cookie_val) or '')
        fb_name = str(item.get('facebook_name') or '').strip()
        if _is_invalid_facebook_display_name(fb_name):
            fb_name = ''
        if not fb_name:
            fb_name = _cached_facebook_display_name(staff, fb_id)
        if _is_invalid_facebook_display_name(fb_name):
            fb_name = ''
        should_resolve = resolve_name and cookie_val and (
            cookie_id == active_id or force_refresh
        ) and (not fb_name or force_refresh)
        if should_resolve:
            cache_key = fb_id or cookie_id
            if cache_key not in profile_cache:
                profile = _fetch_facebook_profile(cookie_val, allow_token=False, fast=not force_refresh)
                if not profile.get('ok'):
                    profile = _fetch_facebook_profile(cookie_val, allow_token=True, fast=False)
                profile_cache[cache_key] = profile
            profile = profile_cache[cache_key]
            if profile.get('ok') and profile.get('name'):
                fb_name = profile.get('name', '')
                _remember_facebook_display_name(staff, fb_name)
        updated_cookies.append({**item, 'facebook_name': fb_name})
        items.append({
            'id': cookie_id,
            'label': item.get('label', ''),
            'facebook_user_id': fb_id,
            'facebook_name': fb_name,
            'cookie_masked': _mask_cookie(cookie_val),
            'active': cookie_id == active_id,
        })
    if resolve_name:
        _persist_facebook_cookie_names(staff, updated_cookies)
    active_item = next((row for row in items if row.get('active')), items[0] if items else {})
    active_name = active_item.get('facebook_name', '') or _cached_facebook_display_name(staff, active_item.get('facebook_user_id', ''))
    if _is_invalid_facebook_display_name(active_name):
        active_name = ''
    payload = {
        'ok': True,
        'active_cookie_id': active_id,
        'active_facebook_name': active_name,
        'active_facebook_user_id': active_item.get('facebook_user_id', ''),
        'cookies': items,
    }
    if resolve_name and not active_name:
        payload['error'] = 'Không đọc được tên Facebook. Cookie có thể hết hạn — lấy cookie mới từ Chrome.'
    return payload


def _persist_active_cookie_choice(staff: dict, cookie_id: str, cookie: str) -> None:
    global _staff_cookies
    staff_id = str(staff.get('id') or '')
    if not staff_id:
        return
    session['active_cookie_id'] = cookie_id
    now = datetime.utcnow().isoformat(timespec='seconds') + 'Z'
    remote_row = {
        'active_cookie_id': cookie_id,
        'cookie': cookie,
        'facebook_user_id': _extract_cookie_user(cookie),
        'updated_at': now,
    }
    if USE_SUPABASE:
        try:
            _, _dropped = sb.update_staff_user_by_id(staff_id, remote_row, SUPABASE_STAFF_TABLE)
        except Exception:
            pass
    local_target = next((item for item in _staff_accounts() if item.get('id') == staff_id), None)
    if local_target:
        local_target['active_cookie_id'] = cookie_id
        local_target['cookie'] = cookie
        local_target['facebook_user_id'] = _extract_cookie_user(cookie)
        local_target['updated_at'] = now
        local_target['facebook_cookies'] = _normalize_staff_facebook_cookies(
            local_target.get('facebook_cookies'),
            cookie,
        )
        _save_staff_cookies()
    token = session.get('staff_cache_token', '')
    if token and token in _session_staff_cache:
        cached = dict(_session_staff_cache[token])
        cached.update(remote_row)
        cached['active_cookie_id'] = cookie_id
        cached['facebook_cookies'] = _normalize_staff_facebook_cookies(
            cached.get('facebook_cookies'),
            cookie,
        )
        _session_staff_cache[token] = cached
    _invalidate_facebook_cache(staff_id)


def _public_staff_cookie(row: dict) -> dict:
    row = _sync_staff_cookie_fields(_staff_with_active_cookie(dict(row or {})))
    cookie = row.get('cookie', '')
    cookies = row.get('facebook_cookies') or []
    active_id = str(row.get('active_cookie_id') or '').strip()
    if not active_id and cookies:
        active_id = str(cookies[0].get('id') or '')
    return {
        'id': row.get('id', ''),
        'name': row.get('name', ''),
        'username': row.get('username', ''),
        'role': row.get('role', 'staff'),
        'cookie_masked': _mask_cookie(cookie),
        'facebook_user_id': row.get('facebook_user_id') or _extract_cookie_user(cookie),
        'active_cookie_id': active_id,
        'active_facebook_name': next(
            (str(item.get('facebook_name') or '') for item in cookies if str(item.get('id') or '') == active_id),
            str(cookies[0].get('facebook_name') or '') if cookies else '',
        ) or _cached_facebook_display_name(row, row.get('facebook_user_id') or _extract_cookie_user(cookie)),
        'facebook_cookies': [
            {
                'id': item.get('id', ''),
                'label': item.get('label', ''),
                'cookie': item.get('cookie', ''),
                'cookie_masked': _mask_cookie(item.get('cookie', '')),
                'facebook_user_id': item.get('facebook_user_id') or _extract_cookie_user(item.get('cookie', '')),
                'facebook_name': item.get('facebook_name', ''),
            }
            for item in cookies
        ],
        'managed_groups': _normalize_staff_managed_groups(row.get('managed_groups')),
        'enabled': bool(row.get('enabled', True)),
        'created_at': row.get('created_at', ''),
        'updated_at': row.get('updated_at', ''),
    }


def _staff_accounts() -> list:
    return _staff_cookies.get('staff') or []


def _as_enabled(value) -> bool:
    if value is None:
        return True
    if isinstance(value, bool):
        return value
    if isinstance(value, str):
        return value.strip().lower() not in ('0', 'false', 'no', 'off', 'disabled')
    return bool(value)


def _normalize_supabase_staff(row: dict) -> dict:
    username = str(row.get('username') or row.get('account') or row.get('login') or '').strip().lower()
    name = str(row.get('name') or row.get('staff_name') or username or 'Nhân sự').strip()
    cookie = str(row.get('cookie') or row.get('facebook_cookie') or row.get('fb_cookie') or '').strip()
    role = str(row.get('role') or '').strip().lower()
    if not role:
        role = 'admin' if row.get('is_admin') is True else 'staff'
    return {
        'id': str(row.get('id') or username or uuid.uuid4().hex[:12]),
        'name': name,
        'username': username,
        'cookie': cookie,
        'role': role,
        'enabled': _as_enabled(row.get('enabled', True)),
        'facebook_user_id': str(row.get('facebook_user_id') or _extract_cookie_user(cookie) or ''),
        'managed_groups': _normalize_staff_managed_groups(row.get('managed_groups')),
        'facebook_cookies': _normalize_staff_facebook_cookies(row.get('facebook_cookies'), cookie),
        'active_cookie_id': str(row.get('active_cookie_id') or '').strip(),
        'created_at': row.get('created_at', ''),
        'updated_at': row.get('updated_at', ''),
        '_auth_source': 'supabase',
    }


def _plain_password_from_row(row: dict) -> str:
    for key in ('password', 'pass', 'plain_password', 'mat_khau'):
        value = row.get(key)
        if value is not None:
            return str(value)
    return ''


def _supabase_password_matches(row: dict, password: str) -> bool:
    digest = row.get('password_hash') or row.get('pass_hash')
    salt = row.get('password_salt') or row.get('salt')
    if digest and salt and _verify_password(password, str(salt), str(digest)):
        return True
    plain = _plain_password_from_row(row)
    return bool(plain) and secrets.compare_digest(plain, password)


def _find_local_staff(username: str) -> dict:
    username = (username or '').strip().lower()
    return next((item for item in _staff_accounts()
                 if item.get('enabled', True) and item.get('username') == username), {})


def _load_supabase_staff(username: str) -> tuple[dict, str]:
    if not USE_SUPABASE:
        return {}, ''
    try:
        row = sb.get_staff_user(username, SUPABASE_STAFF_TABLE)
        return row or {}, ''
    except Exception as e:
        return {}, str(e)


def _load_supabase_staff_by_id(staff_id: str) -> tuple[dict, str]:
    if not USE_SUPABASE:
        return {}, ''
    try:
        row = sb.get_staff_user_by_id(staff_id, SUPABASE_STAFF_TABLE)
        return row or {}, ''
    except Exception as e:
        return {}, str(e)


def _upsert_staff_list_cache_row(row: dict) -> None:
    global _staff_list_cache
    normalized = _normalize_supabase_staff(row)
    key = normalized.get('id') or normalized.get('username')
    if not key:
        return
    rows = list(_staff_list_cache.get('rows') or [])
    replaced = False
    for index, item in enumerate(rows):
        item_key = item.get('id') or item.get('username')
        if item_key == key:
            rows[index] = normalized
            replaced = True
            break
    if not replaced:
        rows.append(normalized)
    _staff_list_cache = {
        'rows': rows,
        'warning': str(_staff_list_cache.get('warning') or ''),
        'at': time_module.monotonic(),
    }


def _remove_staff_list_cache_row(staff_id: str = '', username: str = '') -> None:
    global _staff_list_cache
    rows = list(_staff_list_cache.get('rows') or [])
    if not rows:
        return
    staff_id = str(staff_id or '').strip()
    username = str(username or '').strip().lower()

    def _should_remove(item: dict) -> bool:
        if staff_id and str(item.get('id') or '') == staff_id:
            return True
        if username and str(item.get('username') or '').strip().lower() == username:
            return True
        return False

    filtered = [item for item in rows if not _should_remove(item)]
    if len(filtered) != len(rows):
        _staff_list_cache = {
            'rows': filtered,
            'warning': str(_staff_list_cache.get('warning') or ''),
            'at': time_module.monotonic(),
        }


def _schedule_staff_cookie_name_refresh(staff_id: str, cookies: list[dict]) -> None:
    staff_id = str(staff_id or '').strip()
    if not staff_id:
        return
    pending = [
        item for item in cookies
        if str(item.get('cookie') or '').strip() and not str(item.get('facebook_name') or '').strip()
    ]
    if not pending:
        return

    def _job():
        try:
            enriched = _enrich_staff_facebook_cookies_with_names(pending, fast=True)
            if not any(str(item.get('facebook_name') or '').strip() for item in enriched):
                return
            merged = _merge_staff_facebook_cookies(enriched, {'id': staff_id, 'facebook_cookies': cookies})
            _persist_facebook_cookie_names({'id': staff_id}, merged)
            _upsert_staff_list_cache_row({'id': staff_id, 'facebook_cookies': merged})
        except Exception:
            pass

    threading.Thread(target=_job, daemon=True).start()


def _list_supabase_staff() -> tuple[list, str]:
    if not USE_SUPABASE:
        return [], ''
    global _staff_list_cache
    now = time_module.monotonic()
    cached_rows = _staff_list_cache.get('rows')
    if cached_rows is not None and now - float(_staff_list_cache.get('at') or 0) < _STAFF_LIST_CACHE_TTL:
        return cached_rows, ''
    try:
        rows = [_normalize_supabase_staff(row) for row in sb.list_staff_users(SUPABASE_STAFF_TABLE)]
        _staff_list_cache = {'rows': rows, 'warning': '', 'at': now}
        return rows, ''
    except Exception as e:
        warning = str(e)
        if cached_rows is not None:
            return cached_rows, ''
        return [], warning


def _invalidate_staff_list_cache() -> None:
    global _staff_list_cache, _staff_assignment_cache
    _staff_list_cache = {'rows': None, 'warning': '', 'at': 0.0}
    _staff_assignment_cache = {'rows': None, 'at': 0.0}


def _hydrate_staff_accounts_from_supabase() -> None:
    global _staff_cookies
    if not USE_SUPABASE:
        return
    try:
        remote_rows, warning = _list_supabase_staff()
        if warning:
            print(f'[supabase] hydrate staff warning: {warning}')
        if not remote_rows:
            return
        local_map: dict[str, dict] = {}
        for item in _staff_accounts():
            for key in (str(item.get('id') or '').strip(), str(item.get('username') or '').strip().lower()):
                if key:
                    local_map[key] = item
        merged_list: list[dict] = []
        seen_keys: set[str] = set()
        for remote in remote_rows:
            key = str(remote.get('id') or remote.get('username') or '').strip()
            username_key = str(remote.get('username') or '').strip().lower()
            if not key:
                continue
            local = local_map.get(key) or local_map.get(username_key) or {}
            row = {
                **local,
                **remote,
                'managed_groups': _merge_managed_groups(local.get('managed_groups'), remote.get('managed_groups')),
            }
            if local.get('password_hash') and local.get('password_salt'):
                row['password_salt'] = local['password_salt']
                row['password_hash'] = local['password_hash']
            merged_list.append(row)
            seen_keys.add(key)
            if username_key:
                seen_keys.add(username_key)
        for key, item in local_map.items():
            if key in seen_keys:
                continue
            if _as_enabled(item.get('enabled', True)):
                merged_list.append(item)
        _staff_cookies['staff'] = merged_list
    except Exception as e:
        print(f'[supabase] hydrate staff accounts failed: {e}')


def _staff_list_after_change() -> tuple[list, str]:
    _invalidate_staff_list_cache()
    return _merged_public_staff_rows(refresh_remote=True)


def _merged_public_staff_rows(*, refresh_remote: bool = True) -> tuple[list, str]:
    merged: dict[str, dict] = {}
    for item in _staff_accounts():
        if not _as_enabled(item.get('enabled', True)):
            continue
        key = _staff_identity_key(item)
        if key:
            merged[key] = item

    if refresh_remote:
        remote_rows, warning = _list_supabase_staff()
    else:
        cached_rows = _staff_list_cache.get('rows')
        if cached_rows is not None:
            remote_rows, warning = cached_rows, str(_staff_list_cache.get('warning') or '')
        else:
            remote_rows, warning = _list_supabase_staff()
    for item in remote_rows:
        if not _as_enabled(item.get('enabled', True)):
            continue
        key = _staff_identity_key(item)
        if not key:
            continue
        local_item = merged.get(key) or {}
        cookies = _combine_staff_facebook_cookies(local_item, item)
        primary_cookie = _primary_staff_cookie({
            'facebook_cookies': cookies,
            'active_cookie_id': item.get('active_cookie_id') or local_item.get('active_cookie_id'),
            'cookie': item.get('cookie') or local_item.get('cookie', ''),
        })
        merged[key] = {
            **local_item,
            **item,
            'facebook_cookies': cookies,
            'cookie': primary_cookie,
            'facebook_user_id': _extract_cookie_user(primary_cookie),
            'managed_groups': _merge_managed_groups(
                local_item.get('managed_groups'),
                item.get('managed_groups'),
            ),
        }

    current = _current_staff()
    if current:
        merged[current.get('id') or current.get('username') or 'current'] = current
    return [_public_staff_cookie(item) for item in merged.values() if item], warning


def _set_logged_in_staff(staff: dict) -> None:
    old_token = session.pop('staff_cache_token', None)
    if old_token:
        _session_staff_cache.pop(old_token, None)

    session['staff_id'] = staff.get('id', '')
    session['staff_username'] = staff.get('username', '')
    session['staff_source'] = staff.get('_auth_source', 'local')
    active_cookie_id = str(staff.get('active_cookie_id') or '').strip()
    if active_cookie_id:
        session['active_cookie_id'] = active_cookie_id
    else:
        session.pop('active_cookie_id', None)

    if staff.get('_auth_source') == 'supabase':
        token = uuid.uuid4().hex
        _session_staff_cache[token] = staff
        session['staff_cache_token'] = token

    _prefetch_facebook_display_name(staff)


def _clear_logged_in_staff() -> None:
    token = session.pop('staff_cache_token', None)
    if token:
        _session_staff_cache.pop(token, None)
    session.pop('staff_id', None)
    session.pop('staff_username', None)
    session.pop('staff_source', None)
    session.pop('active_cookie_id', None)
    session.pop('facebook_display_name', None)


def _setup_required() -> bool:
    if SIMPLE_LOGIN_ONLY:
        return False
    return not any(item.get('enabled', True) and item.get('username') and item.get('password_hash') for item in _staff_accounts())


def _current_staff() -> dict:
    override = getattr(_runtime_staff_context, 'staff', None)
    if override:
        return _staff_with_active_cookie(override)
    if not has_request_context():
        return {}
    staff_id = session.get('staff_id', '')
    if not staff_id:
        return {}
    local = next((item for item in _staff_accounts() if item.get('id') == staff_id and item.get('enabled', True)), {})
    if local:
        return _staff_with_active_cookie(local)

    token = session.get('staff_cache_token', '')
    cached = _session_staff_cache.get(token) if token else None
    if cached and cached.get('id') == staff_id and cached.get('enabled', True):
        return _staff_with_active_cookie(cached)

    if session.get('staff_source') == 'supabase':
        row, _ = _load_supabase_staff(session.get('staff_username', ''))
        if row:
            staff = _normalize_supabase_staff(row)
            if staff.get('id') == staff_id and staff.get('enabled', True):
                token = uuid.uuid4().hex
                staff = _staff_with_active_cookie(staff)
                _session_staff_cache[token] = staff
                session['staff_cache_token'] = token
                return staff
    return {}


def _current_staff_id() -> str:
    return _current_staff().get('id', '')


def _is_admin() -> bool:
    return str(_current_staff().get('role') or '').strip().lower() == 'admin'


def _public_current_staff() -> dict:
    staff = _current_staff()
    return _public_staff_cookie(staff) if staff else {}


def _active_staff() -> dict:
    current = _current_staff()
    if current:
        return current
    if _setup_required():
        return {}
    active_id = _staff_cookies.get('active_staff_id', '')
    active = next((item for item in _staff_accounts() if item.get('id') == active_id and item.get('enabled', True)), None)
    return _staff_with_active_cookie(active or {})


def _active_staff_id() -> str:
    return _active_staff().get('id', '')


def _active_cookie() -> str:
    return _primary_staff_cookie(_active_staff())


def _staff_token_file(staff_id: str, cookie_id: str = '', cookie: str = '') -> str:
    safe_id = re.sub(r'[^a-zA-Z0-9_-]+', '_', staff_id or 'default')
    cookie_key = str(cookie_id or _extract_cookie_user(cookie) or 'primary').strip()
    safe_cookie = re.sub(r'[^a-zA-Z0-9_-]+', '_', cookie_key or 'primary')
    return os.path.join(STAFF_TOKEN_DIR, f'{safe_id}__{safe_cookie}.txt')


def _clear_staff_access_token(staff_id: str = '', cookie_id: str = '', cookie: str = '') -> None:
    staff_id = str(staff_id or _active_staff_id() or '').strip()
    if not staff_id:
        return
    token_files = [_staff_token_file(staff_id, cookie_id=cookie_id, cookie=cookie)]
    if not cookie_id and not cookie:
        safe_id = re.sub(r'[^a-zA-Z0-9_-]+', '_', staff_id or 'default')
        try:
            for name in os.listdir(STAFF_TOKEN_DIR):
                if name == f'{safe_id}.txt' or name.startswith(f'{safe_id}__'):
                    token_files.append(os.path.join(STAFF_TOKEN_DIR, name))
        except OSError:
            pass
    for token_file in set(token_files):
        try:
            os.remove(token_file)
        except OSError:
            pass


def _invalidate_facebook_cache(staff_id: str = '') -> None:
    _api_cache.clear()
    _pages_cache.clear()
    if staff_id:
        _clear_staff_access_token(staff_id)


def _clean_business_profile(body: dict) -> dict:
    current = {**_default_business_profile(), **(_business_profile or {})}
    limits = {
        'business_name': 120,
        'phone': 60,
        'address': 240,
        'why_choose_us': 1000,
        'extra_notes': 800,
    }
    for key, limit in limits.items():
        if key in body:
            current[key] = str(body.get(key) or '').strip()[:limit]
    return current


def _extract_target_id_from_link(link: str) -> str:
    link = (link or '').strip()
    if not link:
        return ''
    patterns = (
        r'(?:/video/|/videos/)([A-Za-z0-9_.-]+)',
        r'/groups/([A-Za-z0-9_.-]+)',
        r'[?&]id=([A-Za-z0-9_.-]+)',
        r'/channel/([A-Za-z0-9_.-]+)',
        r'@([A-Za-z0-9_.-]+)',
    )
    for pattern in patterns:
        match = re.search(pattern, link)
        if match:
            return match.group(1).strip('/')
    nums = re.findall(r'\d{6,}', link)
    return nums[-1] if nums else ''


def _normalize_channel_type(value: str) -> str:
    raw = (value or '').strip().lower()
    mapping = {
        'page': 'Page',
        'fanpage': 'Page',
        'video': 'Video',
        'nhom': 'Nhóm',
        'nhóm': 'Nhóm',
        'group': 'Nhóm',
    }
    return mapping.get(raw, (value or 'Nhóm').strip()[:40])


def _clean_managed_channel(body: dict, current: dict | None = None) -> dict:
    current = current or {}
    platform = str(body.get('platform', current.get('platform', '')) or '').strip()[:60]
    channel_name = str(body.get('channel_name', body.get('channel', current.get('channel_name', ''))) or '').strip()[:160]
    channel_type_value = body.get('channel_type', body.get('type', current.get('channel_type', '')))
    channel_type = _normalize_channel_type(str(channel_type_value or 'Nhóm'))
    link = str(body.get('link', current.get('link', '')) or '').strip()[:1000]
    target_id = str(body.get('target_id', body.get('external_id', current.get('target_id', ''))) or '').strip()[:220]
    note = str(body.get('note', current.get('note', '')) or '').strip()[:500]
    if not target_id:
        target_id = _extract_target_id_from_link(link)
    cleaned = {
        'platform': platform,
        'channel_name': channel_name,
        'channel_type': channel_type,
        'link': link,
        'target_id': target_id,
        'note': note,
    }
    return cleaned


def _managed_channel_db_row(row: dict) -> dict:
    allowed = {'id', 'platform', 'channel_name', 'channel_type', 'link', 'target_id', 'note', 'created_at', 'updated_at'}
    return {key: row[key] for key in allowed if key in row}


def _facebook_channel_validation_error(row: dict) -> str:
    platform = str(row.get('platform') or '').strip().lower()
    channel_type = str(row.get('channel_type') or '').strip().lower()
    target_id = str(row.get('target_id') or '').strip()
    link = str(row.get('link') or '').strip().lower()
    if platform != 'facebook':
        return ''
    if channel_type in ('page', 'fanpage', 'trang') and re.search(r'facebook\.com/(?:groups|group)/', link):
        return 'Link đang là link Nhóm Facebook nhưng loại đang chọn là Page. Hãy đổi Loại thành "Nhóm", hoặc dán đúng link Page.'
    if channel_type in ('nhóm', 'nhom', 'group', 'page', 'fanpage') and target_id and not re.fullmatch(r'\d{10,20}', target_id):
        return 'ID Facebook chưa hợp lệ. Hãy nhập ID số thật của Group/Page (10-20 chữ số), không nhập tên như "page" hoặc ID ngắn như "1".'
    return ''


def _resolve_facebook_group_channel(row: dict) -> dict:
    platform = str(row.get('platform') or '').strip().lower()
    channel_type = str(row.get('channel_type') or '').strip().lower()
    target_id = str(row.get('target_id') or '').strip()
    if platform != 'facebook' or channel_type not in ('nhóm', 'nhom', 'group') or not target_id:
        return row
    if re.fullmatch(r'\d{10,20}', target_id):
        return row
    resolved = None
    try:
        resolved = get_api(DEFAULT_GROUP).resolve_slug(target_id)
    except Exception:
        resolved = None
    if not resolved or not resolved.get('id'):
        return row

    next_row = {**row, 'target_id': str(resolved.get('id') or '').strip()}
    if resolved.get('name') and not str(next_row.get('note') or '').strip():
        next_row['note'] = str(resolved.get('name') or '').strip()[:500]
    if not str(next_row.get('channel_name') or '').strip():
        next_row['channel_name'] = str(resolved.get('name') or '').strip()[:160]
    if USE_SUPABASE and next_row.get('id'):
        try:
            sb.update_managed_channel(
                next_row['id'],
                _managed_channel_db_row(next_row),
                SUPABASE_CHANNEL_TABLE,
            )
        except Exception as e:
            print(f'[supabase] update resolved managed channel failed: {e}')
    return next_row


def _norm_channel_text(value: str) -> str:
    return re.sub(r'\s+', ' ', str(value or '').strip()).lower()


def _norm_channel_link(value: str) -> str:
    raw = str(value or '').strip().lower()
    raw = re.sub(r'[?#].*$', '', raw)
    return raw.rstrip('/')


def _find_duplicate_managed_channel(row: dict, exclude_id: str = '') -> dict:
    row_platform = _norm_channel_text(row.get('platform', ''))
    row_type = _norm_channel_text(row.get('channel_type', ''))
    row_name = _norm_channel_text(row.get('channel_name', ''))
    row_target = str(row.get('target_id') or '').strip()
    row_link = _norm_channel_link(row.get('link', ''))

    for item in _managed_channels:
        item_id = str(item.get('id') or '')
        if exclude_id and item_id == exclude_id:
            continue
        same_identity = (
            (row_target and row_target == str(item.get('target_id') or '').strip())
            or (row_link and row_link == _norm_channel_link(item.get('link', '')))
        )
        same_name = (
            row_platform
            and row_type
            and row_name
            and row_platform == _norm_channel_text(item.get('platform', ''))
            and row_type == _norm_channel_text(item.get('channel_type', ''))
            and row_name == _norm_channel_text(item.get('channel_name', ''))
        )
        if same_identity or same_name:
            return item
    return {}


def _public_managed_channel(row: dict, staff_rows: list | None = None) -> dict:
    stored_ids = _channel_assigned_staff_ids(row)
    if stored_ids:
        assigned = _staff_display_entries(stored_ids, staff_rows)
    else:
        assigned = _channel_assigned_staff_public(row, staff_rows)
    return {
        'id': row.get('id', ''),
        'platform': row.get('platform', ''),
        'channel_name': row.get('channel_name', ''),
        'channel_type': row.get('channel_type', ''),
        'link': row.get('link', ''),
        'target_id': row.get('target_id', ''),
        'note': row.get('note', ''),
        'assigned_staff_ids': [item.get('id') for item in assigned if item.get('id')],
        'assigned_staff': assigned,
        'created_at': row.get('created_at', ''),
        'updated_at': row.get('updated_at', ''),
    }


def _managed_group_from_channel(row: dict) -> dict:
    return {
        'id': str(row.get('target_id') or '').strip(),
        'name': str(row.get('channel_name') or '').strip(),
        'platform': str(row.get('platform') or '').strip(),
        'channel_type': str(row.get('channel_type') or '').strip(),
    }


def _managed_group_matches(left: dict, right: dict) -> bool:
    left_id = str(left.get('id') or '').strip()
    right_id = str(right.get('id') or '').strip()
    if left_id and right_id and left_id == right_id:
        left_platform = str(left.get('platform') or '').strip().lower()
        right_platform = str(right.get('platform') or '').strip().lower()
        if left_platform and right_platform and left_platform != right_platform:
            return False
        return True
    left_name = str(left.get('name') or '').strip().lower()
    right_name = str(right.get('name') or '').strip().lower()
    if not left_name or left_name != right_name:
        return False
    left_platform = str(left.get('platform') or '').strip().lower()
    right_platform = str(right.get('platform') or '').strip().lower()
    left_type = _channel_type_bucket(left.get('channel_type') or left.get('type'))
    right_type = _channel_type_bucket(right.get('channel_type') or right.get('type'))
    if left_platform and right_platform and left_platform != right_platform:
        return False
    if left_type and right_type and left_type != right_type:
        return False
    return True


_staff_assignment_cache: dict = {'rows': None, 'at': 0.0}


def _all_staff_rows_for_assignment(*, refresh: bool = False) -> list[dict]:
    global _staff_assignment_cache
    now = time_module.monotonic()
    cached_rows = _staff_assignment_cache.get('rows')
    if (
        not refresh
        and cached_rows is not None
        and now - float(_staff_assignment_cache.get('at') or 0) < _STAFF_LIST_CACHE_TTL
    ):
        return list(cached_rows)
    merged: dict[str, dict] = {}
    for item in _staff_accounts():
        if not _as_enabled(item.get('enabled', True)):
            continue
        key = _staff_identity_key(item)
        if key:
            merged[key] = dict(item)
    if USE_SUPABASE:
        try:
            for row in sb.list_staff_users(SUPABASE_STAFF_TABLE):
                norm = _normalize_supabase_staff(row)
                if not _as_enabled(norm.get('enabled', True)):
                    continue
                key = _staff_identity_key(norm)
                if not key:
                    continue
                local_item = merged.get(key, {})
                merged[key] = {
                    **local_item,
                    **norm,
                    'managed_groups': _merge_managed_groups(
                        local_item.get('managed_groups'),
                        norm.get('managed_groups'),
                    ),
                }
        except Exception:
            pass
    rows = list(merged.values())
    _staff_assignment_cache = {'rows': rows, 'at': now}
    return rows


def _persist_staff_managed_groups(staff_id: str, groups: list[dict], hint: dict | None = None) -> str:
    staff_id = str(staff_id or '').strip()
    if not staff_id:
        return ''
    hint = hint or {}
    local_target = _find_local_staff_account(staff_id, hint)
    canonical_id = str((local_target or {}).get('id') or staff_id).strip()
    normalized = _normalize_staff_managed_groups(groups)
    now = datetime.utcnow().isoformat(timespec='seconds') + 'Z'
    if local_target:
        local_target['managed_groups'] = normalized
        local_target['updated_at'] = now
    supabase_warning = ''
    if USE_SUPABASE:
        payload = {'managed_groups': normalized, 'updated_at': now}
        try:
            _, dropped = sb.update_staff_user_by_id(canonical_id, payload, SUPABASE_STAFF_TABLE)
            if dropped and 'managed_groups' in dropped:
                supabase_warning = _supabase_staff_write_warning(dropped)
            username = str((local_target or hint).get('username') or '').strip().lower()
            if username and (dropped or supabase_warning):
                _, dropped_user = sb.update_staff_user(username, payload, SUPABASE_STAFF_TABLE)
                if dropped_user and 'managed_groups' in dropped_user:
                    supabase_warning = _supabase_staff_write_warning(dropped_user)
                elif not dropped_user:
                    supabase_warning = ''
        except Exception as e:
            err = str(e)
            if sb.is_missing_column_error(err) and 'managed_groups' in err:
                supabase_warning = 'Supabase thiếu cột managed_groups — chạy supabase_staff_managed_groups_patch.sql'
            else:
                supabase_warning = f'Không lưu phân công nhân sự lên Supabase: {err}'
    current_staff_id = _current_staff_id()
    if canonical_id == current_staff_id or staff_id == current_staff_id:
        current = _current_staff()
        if current:
            current['managed_groups'] = normalized
            if session.get('staff_cache_token'):
                token = session.get('staff_cache_token')
                if token in _session_staff_cache:
                    cached = dict(_session_staff_cache[token])
                    cached['managed_groups'] = normalized
                    _session_staff_cache[token] = cached
    cache_row = dict(local_target or hint)
    cache_row['id'] = canonical_id
    cache_row['managed_groups'] = normalized
    cache_row['updated_at'] = now
    _upsert_staff_list_cache_row(cache_row)
    _save_staff_cookies()
    global _staff_assignment_cache
    _staff_assignment_cache = {'rows': None, 'at': 0.0}
    _invalidate_staff_list_cache()
    return supabase_warning


def _sync_channel_staff_assignments(channel_row: dict, assigned_staff_ids) -> str:
    if not _is_admin():
        return ''
    group_entry = _managed_group_from_channel(channel_row)
    if not group_entry.get('id') and not group_entry.get('name'):
        return ''
    wanted = {str(item or '').strip() for item in (assigned_staff_ids or []) if str(item or '').strip()}
    wanted_keys = _staff_wanted_keys(wanted)
    channel_id = str(channel_row.get('id') or '').strip()
    previous_ids = _channel_assigned_staff_ids(channel_row)
    previous_keys = _staff_wanted_keys(previous_ids)
    affected_keys = wanted_keys | previous_keys
    canonical_wanted = []
    seen_ids: set[str] = set()
    for raw_id in wanted:
        cid = _canonical_staff_id(raw_id)
        if cid and cid not in seen_ids:
            seen_ids.add(cid)
            canonical_wanted.append(cid)
    _set_channel_assigned_staff_ids(channel_id, canonical_wanted)
    channel_row['assigned_staff_ids'] = canonical_wanted
    changed = bool(previous_ids != canonical_wanted)
    warnings: list[str] = []
    for staff_row in _all_staff_rows_for_assignment(refresh=True):
        if not _staff_row_in_wanted(staff_row, affected_keys):
            continue
        staff_id = str(staff_row.get('id') or '').strip()
        if not staff_id:
            continue
        should_have = _staff_row_in_wanted(staff_row, wanted_keys)
        baseline = _merge_managed_groups(
            _staff_managed_groups_snapshot(staff_id, staff_row),
            _groups_from_other_assigned_channels(staff_id, exclude_channel_id=channel_id),
        )
        if should_have:
            next_groups = _merge_managed_groups(baseline, [group_entry])
        else:
            next_groups = [
                item for item in baseline
                if not _managed_group_matches(item, group_entry)
            ]
        if _managed_groups_signature(next_groups) == _managed_groups_signature(baseline):
            continue
        warn = _persist_staff_managed_groups(staff_id, next_groups, staff_row)
        if warn:
            warnings.append(warn)
        changed = True
    if warnings:
        return warnings[0]
    return 'Đã cập nhật phân công nhân sự' if changed else ''


def _remove_channel_from_all_staff(channel_row: dict) -> None:
    group_entry = _managed_group_from_channel(channel_row)
    if not group_entry.get('id') and not group_entry.get('name'):
        return
    for staff_row in _all_staff_rows_for_assignment():
        staff_id = str(staff_row.get('id') or '').strip()
        if not staff_id:
            continue
        groups = _normalize_staff_managed_groups(staff_row.get('managed_groups'))
        next_groups = [item for item in groups if not _managed_group_matches(item, group_entry)]
        if len(next_groups) != len(groups):
            _persist_staff_managed_groups(staff_id, next_groups, staff_row)


def _channel_assigned_staff_public(channel_row: dict, staff_rows: list | None = None) -> list[dict]:
    group_entry = _managed_group_from_channel(channel_row)
    if not group_entry.get('id') and not group_entry.get('name'):
        return []
    source_rows = staff_rows if staff_rows is not None else _all_staff_rows_for_assignment()
    rows = []
    for staff_row in source_rows:
        groups = _normalize_staff_managed_groups(staff_row.get('managed_groups'))
        if any(_managed_group_matches(item, group_entry) for item in groups):
            rows.append({
                'id': staff_row.get('id', ''),
                'name': staff_row.get('name', ''),
                'username': staff_row.get('username', ''),
                'role': staff_row.get('role', 'staff'),
            })
    return rows


def _staff_can_see_channel(channel_row: dict, allowed_groups: list[dict]) -> bool:
    if not allowed_groups:
        return False
    group_entry = _managed_group_from_channel(channel_row)
    return any(_managed_group_matches(item, group_entry) for item in allowed_groups)


def _filter_managed_channels_for_staff(rows: list[dict]) -> list[dict]:
    if _is_admin():
        return rows
    staff = _current_staff()
    if not staff:
        return []
    allowed = _current_staff_managed_groups()
    return [row for row in rows if _staff_can_see_channel(row, allowed)]


def _normalize_assigned_staff_ids(raw) -> list[str]:
    if raw is None:
        return []
    if isinstance(raw, str):
        text = raw.strip()
        if not text:
            return []
        try:
            raw = json.loads(text)
        except json.JSONDecodeError:
            raw = [part.strip() for part in text.split(',') if part.strip()]
    if not isinstance(raw, list):
        return []
    return [str(item or '').strip() for item in raw if str(item or '').strip()]


def _managed_channel_store_error(exc: Exception) -> str:
    detail = str(exc)
    if 'assigned_staff_ids' in detail and ('PGRST204' in detail or 'column' in detail.lower()):
        return 'Lỗi đồng bộ nhân sự kênh. Hãy redeploy backend mới nhất rồi thử lại.'
    if 'PGRST204' in detail and 'column' in detail.lower():
        return detail
    if 'managed_channels' in detail and ('PGRST205' in detail or 'Could not find the table' in detail):
        return 'Supabase chưa có bảng managed_channels. Hãy chạy supabase_managed_channels_patch.sql trong SQL Editor rồi thử lại.'
    if 'schema cache' in detail.lower() and 'Could not find the table' in detail:
        return 'Supabase chưa cập nhật schema. Chạy NOTIFY pgrst, \'reload schema\'; trong SQL Editor rồi thử lại.'
    return detail


def _append_warning(current: str, extra: str) -> str:
    extra = str(extra or '').strip()
    if not extra:
        return str(current or '').strip()
    current = str(current or '').strip()
    return f'{current} · {extra}' if current else extra


def _sync_managed_channel_supabase(row: dict, *, channel_id: str = '') -> tuple[dict, str]:
    """Ghi managed_channels lên Supabase; luôn strip field không thuộc bảng."""
    if not USE_SUPABASE:
        return row, ''
    cid = str(channel_id or row.get('id') or '').strip()
    db_row = _managed_channel_db_row({**row, **({'id': cid} if cid else {})})
    try:
        if cid:
            try:
                remote = sb.update_managed_channel(cid, db_row, SUPABASE_CHANNEL_TABLE)
                if not remote:
                    remote = sb.upsert_managed_channel({**db_row, 'id': cid}, SUPABASE_CHANNEL_TABLE)
            except Exception as update_err:
                remote = sb.upsert_managed_channel({**db_row, 'id': cid}, SUPABASE_CHANNEL_TABLE)
                if not remote:
                    raise update_err
        else:
            remote = sb.upsert_managed_channel(db_row, SUPABASE_CHANNEL_TABLE)
        return ({**row, **remote} if remote else row), ''
    except Exception as e:
        print(f'[supabase] sync managed channel failed: {e}')
        return row, _managed_channel_store_error(e)


def _save_business_profile():
    tmp = BUSINESS_PROFILE_FILE + '.tmp'
    with open(tmp, 'w', encoding='utf-8') as f:
        json.dump(_business_profile, f, ensure_ascii=False)
    os.replace(tmp, BUSINESS_PROFILE_FILE)


def _business_profile_key() -> str:
    return _current_staff_ai_key() or 'default'


def _load_business_profile_from_supabase() -> tuple[dict, str]:
    if not SUPABASE_URL or not SUPABASE_KEY:
        return {}, 'Chưa cấu hình Supabase'
    profile_id = _business_profile_key()
    try:
        resp = _req.get(
            f"{SUPABASE_URL.rstrip('/')}/rest/v1/{SUPABASE_PROFILE_TABLE}",
            headers={
                'apikey': SUPABASE_KEY,
                'Authorization': f'Bearer {SUPABASE_KEY}',
            },
            params={'id': f'eq.{profile_id}', 'select': '*', 'limit': '1'},
            timeout=20,
        )
        if resp.status_code != 200:
            return {}, resp.text[:300]
        rows = resp.json()
        if not rows:
            return {}, ''
        row = rows[0]
        return {
            'business_name': row.get('business_name') or '',
            'phone': row.get('phone') or '',
            'address': row.get('address') or '',
            'why_choose_us': row.get('why_choose_us') or '',
            'extra_notes': row.get('extra_notes') or '',
        }, ''
    except Exception as e:
        return {}, str(e)[:300]


def _save_business_profile_to_supabase(profile: dict) -> tuple[bool, str]:
    if not SUPABASE_URL or not SUPABASE_KEY:
        return False, 'Chưa cấu hình Supabase'
    payload = {
        'id': _business_profile_key(),
        'business_name': profile.get('business_name', ''),
        'phone': profile.get('phone', ''),
        'address': profile.get('address', ''),
        'why_choose_us': profile.get('why_choose_us', ''),
        'extra_notes': profile.get('extra_notes', ''),
    }
    try:
        resp = _req.post(
            f"{SUPABASE_URL.rstrip('/')}/rest/v1/{SUPABASE_PROFILE_TABLE}",
            headers={
                'apikey': SUPABASE_KEY,
                'Authorization': f'Bearer {SUPABASE_KEY}',
                'Content-Type': 'application/json',
                'Prefer': 'resolution=merge-duplicates,return=representation',
            },
            params={'on_conflict': 'id'},
            json=payload,
            timeout=20,
        )
        if resp.status_code in (200, 201):
            return True, ''
        return False, (resp.json().get('message') if resp.headers.get('content-type', '').startswith('application/json') else resp.text)[:300]
    except Exception as e:
        return False, str(e)[:300]


def _save_reply_suggestion_to_supabase(suggestion: dict) -> tuple[bool, str]:
    if not SUPABASE_URL or not SUPABASE_KEY:
        return False, 'Chưa cấu hình Supabase'
    payload = {
        'post_id': suggestion.get('post_id', ''),
        'group_id': suggestion.get('group_id', ''),
        'post_url': suggestion.get('post_url', ''),
        'target_source': suggestion.get('target_source', ''),
        'target_source_id': suggestion.get('target_source_id', ''),
        'customer_name': suggestion.get('customer_name', ''),
        'intent_label': suggestion.get('intent_label', ''),
        'customer_need': suggestion.get('customer_need', ''),
        'buying_stage': suggestion.get('buying_stage', ''),
        'urgency': suggestion.get('urgency', ''),
        'confidence': suggestion.get('confidence', 0),
        'recommended_approach': suggestion.get('recommended_approach', ''),
        'suggested_replies': suggestion.get('suggested_replies', []),
        'raw_ai': suggestion,
    }
    try:
        resp = _req.post(
            f"{SUPABASE_URL.rstrip('/')}/rest/v1/{SUPABASE_REPLY_TABLE}",
            headers={
                'apikey': SUPABASE_KEY,
                'Authorization': f'Bearer {SUPABASE_KEY}',
                'Content-Type': 'application/json',
                'Prefer': 'return=minimal',
            },
            json=payload,
            timeout=20,
        )
        if resp.status_code in (200, 201, 204):
            return True, ''
        return False, (resp.json().get('message') if resp.headers.get('content-type', '').startswith('application/json') else resp.text)[:300]
    except Exception as e:
        return False, str(e)[:300]


def _save_comment_log_to_supabase(log: dict) -> tuple[bool, str]:
    if not SUPABASE_URL or not SUPABASE_KEY:
        return False, 'Chưa cấu hình Supabase'
    payload = {
        'staff_id': log.get('staff_id', ''),
        'staff_name': log.get('staff_name', ''),
        'staff_username': log.get('staff_username', ''),
        'facebook_user_id': log.get('facebook_user_id', ''),
        'post_id': log.get('post_id', ''),
        'group_id': log.get('group_id', ''),
        'post_url': log.get('post_url', ''),
        'comment_text': log.get('comment_text', ''),
        'comment_image_url': log.get('comment_image_url', ''),
        'comment_id': log.get('comment_id', ''),
        'page_id': log.get('page_id', ''),
        'status': log.get('status', ''),
        'error_message': log.get('error_message', ''),
        'created_at': log.get('created_at'),
    }
    try:
        resp = _req.post(
            f"{SUPABASE_URL.rstrip('/')}/rest/v1/{SUPABASE_COMMENT_LOG_TABLE}",
            headers={
                'apikey': SUPABASE_KEY,
                'Authorization': f'Bearer {SUPABASE_KEY}',
                'Content-Type': 'application/json',
                'Prefer': 'return=minimal',
            },
            json=payload,
            timeout=20,
        )
        if resp.status_code in (200, 201, 204):
            return True, ''
        return False, (resp.json().get('message') if resp.headers.get('content-type', '').startswith('application/json') else resp.text)[:300]
    except Exception as e:
        return False, str(e)[:300]


def _save_comment_summary_to_supabase(summary: dict) -> tuple[bool, str]:
    if not SUPABASE_URL or not SUPABASE_KEY:
        return False, 'Chưa cấu hình Supabase'
    payload = {
        'post_id': summary.get('post_id', ''),
        'group_id': summary.get('group_id', ''),
        'post_url': summary.get('post_url', ''),
        'post_author': summary.get('post_author', ''),
        'post_text': summary.get('post_text', ''),
        'comment_count': summary.get('comment_count', 0),
        'fetched_comment_count': summary.get('fetched_comment_count', 0),
        'comment_authors_count': summary.get('comment_authors_count', 0),
        'summary': summary.get('summary', ''),
        'sentiment': summary.get('sentiment', ''),
        'urgency': summary.get('urgency', ''),
        'main_topics': summary.get('main_topics', []),
        'customer_intents': summary.get('customer_intents', []),
        'top_questions': summary.get('top_questions', []),
        'notable_comments': summary.get('notable_comments', []),
        'lead_signals': summary.get('lead_signals', []),
        'recommended_action': summary.get('recommended_action', ''),
        'spam_or_noise_count': summary.get('spam_or_noise_count', 0),
        'raw_ai': summary,
        'created_by_staff_id': summary.get('created_by_staff_id', ''),
        'created_by_staff_name': summary.get('created_by_staff_name', ''),
        'created_at': summary.get('created_at'),
    }
    try:
        resp = _req.post(
            f"{SUPABASE_URL.rstrip('/')}/rest/v1/{SUPABASE_COMMENT_SUMMARY_TABLE}",
            headers={
                'apikey': SUPABASE_KEY,
                'Authorization': f'Bearer {SUPABASE_KEY}',
                'Content-Type': 'application/json',
                'Prefer': 'return=minimal',
            },
            json=payload,
            timeout=20,
        )
        if resp.status_code in (200, 201, 204):
            return True, ''
        return False, (resp.json().get('message') if resp.headers.get('content-type', '').startswith('application/json') else resp.text)[:300]
    except Exception as e:
        return False, str(e)[:300]


def _normalize_keywords(value) -> list[str]:
    if isinstance(value, list):
        raw = value
    else:
        raw = re.split(r'[\n,;]+', str(value or ''))
    seen = set()
    keywords = []
    for item in raw:
        kw = str(item or '').strip()
        key = kw.lower()
        if kw and key not in seen:
            seen.add(key)
            keywords.append(kw)
    return keywords[:50]


def _match_comment_keywords(message: str, keywords: list[str]) -> list[str]:
    hay = (message or '').lower()
    return [kw for kw in keywords if kw.lower() in hay]


def _iso_from_unix(value) -> str:
    try:
        ts = int(value or 0)
        if ts <= 0:
            return ''
        return datetime.fromtimestamp(ts, timezone.utc).isoformat().replace('+00:00', 'Z')
    except Exception:
        return ''


def _facebook_comment_url(post_url: str, comment_id: str) -> str:
    post_url = str(post_url or '').strip()
    comment_id = str(comment_id or '').strip()
    if not comment_id:
        return post_url
    if post_url:
        anchor = comment_id.split('_')[-1] if '_' in comment_id else comment_id
        joiner = '&' if '?' in post_url else '?'
        return f'{post_url}{joiner}comment_id={anchor}'
    return f'https://www.facebook.com/{comment_id}'


def _url_with_query_param(url: str, key: str, value: str) -> str:
    url = str(url or '').strip()
    key = str(key or '').strip()
    value = str(value or '').strip()
    if not url or not key or not value:
        return url
    parts = urlsplit(url)
    params = [(k, v) for k, v in parse_qsl(parts.query, keep_blank_values=True) if k != key]
    params.append((key, value))
    return urlunsplit((parts.scheme, parts.netloc, parts.path, urlencode(params), parts.fragment))


def _comment_url_for_row(source: str, post_url: str, comment_id: str) -> str:
    src = str(source or '').lower()
    cid = str(comment_id or '').strip().replace('tiktok_', '', 1)
    post_url = str(post_url or '').strip()
    if 'tiktok' in src:
        if post_url and cid and cid.isdigit():
            return _url_with_query_param(post_url, 'comment', cid)
        return post_url
    if 'facebook' in src:
        return _facebook_comment_url(post_url, cid)
    return post_url


def _flatten_facebook_comment_rows(post: dict, comments: list, keywords: list[str], fetched_at: str, staff: dict) -> list[dict]:
    rows: list[dict] = []
    post_id = str(post.get('id') or '')
    page_id = str(post.get('_page_id') or '')
    group_id = str(post.get('_group_id') or page_id or DEFAULT_GROUP)
    post_url = post.get('permalink_url') or ''
    post_title = _strip_html(post.get('message') or post.get('story') or '', 220)
    source = 'facebook_page' if page_id else 'facebook'

    def walk(items: list, parent_id: str = '', depth: int = 0):
        for item in items or []:
            if not isinstance(item, dict):
                continue
            cid = str(item.get('id') or '').strip()
            if not cid:
                continue
            from_obj = item.get('from') if isinstance(item.get('from'), dict) else {}
            message = item.get('message') or ''
            matched = _match_comment_keywords(message, keywords)
            rows.append({
                'source': source,
                'post_id': post_id,
                'post_title': post_title,
                'group_id': group_id,
                'post_url': post_url,
                'comment_url': _facebook_comment_url(post_url, cid),
                'comment_id': cid,
                'parent_comment_id': parent_id,
                'depth': depth,
                'author_id': from_obj.get('id') or '',
                'author_name': from_obj.get('name') or 'Ẩn danh',
                'message': message,
                'attachment_type': ((item.get('attachment') or {}).get('type') if isinstance(item.get('attachment'), dict) else '') or '',
                'created_time': item.get('created_time') or None,
                'matched_keywords': matched,
                'is_matched': bool(matched),
                'raw_comment': item,
                'fetched_by_staff_id': staff.get('id', ''),
                'fetched_by_staff_name': staff.get('name', ''),
                'fetched_by_staff_username': staff.get('username', ''),
                'fetched_at': fetched_at,
            })
            replies = ((item.get('comments') or {}).get('data') if isinstance(item.get('comments'), dict) else []) or []
            if replies:
                walk(replies, cid, depth + 1)

    walk(comments)
    return rows


def _save_post_comment_rows_to_supabase(rows: list[dict]) -> tuple[bool, str]:
    if not rows:
        return True, ''
    if not SUPABASE_URL or not SUPABASE_KEY:
        return False, 'Chưa cấu hình Supabase'
    deduped_by_comment_id: dict[str, dict] = {}
    for row in rows:
        cid = str(row.get('comment_id') or '').strip()
        if not cid:
            continue
        deduped_by_comment_id[cid] = row
    rows = list(deduped_by_comment_id.values())
    if not rows:
        return True, ''
    headers = {
        'apikey': SUPABASE_KEY,
        'Authorization': f'Bearer {SUPABASE_KEY}',
        'Content-Type': 'application/json',
        'Prefer': 'resolution=merge-duplicates,return=minimal',
    }
    chunk = 200

    def post_chunks(payload_rows: list[dict]) -> tuple[bool, str]:
        for i in range(0, len(payload_rows), chunk):
            resp = _req.post(
                f"{SUPABASE_URL.rstrip('/')}/rest/v1/{SUPABASE_POST_COMMENT_TABLE}?on_conflict=comment_id",
                headers=headers,
                json=payload_rows[i:i + chunk],
                timeout=30,
            )
            if resp.status_code not in (200, 201, 204):
                if resp.headers.get('content-type', '').startswith('application/json'):
                    try:
                        return False, (resp.json().get('message') or resp.text)[:300]
                    except Exception:
                        pass
                return False, resp.text[:300]
        return True, ''

    try:
        ok, error = post_chunks(rows)
        if ok:
            return True, ''
        if "'source' column" in error or 'source column' in error:
            legacy_rows = [{k: v for k, v in row.items() if k != 'source'} for row in rows]
            legacy_ok, legacy_error = post_chunks(legacy_rows)
            if legacy_ok:
                return True, 'Đã lưu Supabase, nhưng bảng post_comments đang thiếu cột source nên chưa phân loại được facebook/tiktok trong DB.'
            return False, legacy_error
        return False, error
    except Exception as e:
        return False, str(e)[:300]


def _store_post_comment_rows(rows: list[dict]) -> tuple[str, str]:
    global _post_comments
    if not rows:
        return 'local', ''
    by_id = {str(item.get('comment_id')): item for item in _post_comments if item.get('comment_id')}
    for row in rows:
        by_id[str(row.get('comment_id'))] = row
    _post_comments = list(by_id.values())[-5000:]
    _save_post_comments()
    _sync_phone_leads_from_comment_rows(rows)
    ok, error = _save_post_comment_rows_to_supabase(rows)
    return ('supabase' if ok else 'local'), error


def _load_post_comment_rows(source: str = '', post_id: str = '', limit: int = 1000) -> tuple[list[dict], str]:
    limit = max(1, min(int(limit or 1000), 5000))
    source = (source or '').strip().lower()
    post_id = (post_id or '').strip()
    if USE_SUPABASE and SUPABASE_URL and SUPABASE_KEY:
        try:
            filters = [
                'select=source,post_id,group_id,post_url,comment_id,parent_comment_id,depth,author_id,author_name,message,attachment_type,created_time,matched_keywords,is_matched,raw_comment,fetched_by_staff_id,fetched_by_staff_name,fetched_by_staff_username,fetched_at',
                'order=fetched_at.desc',
                f'limit={limit}',
            ]
            if source and source != 'facebook':
                filters.append(f'source=eq.{quote(source, safe="")}')
            if post_id:
                filters.append(f'post_id=eq.{quote(post_id, safe="")}')
            resp = _req.get(
                f"{SUPABASE_URL.rstrip('/')}/rest/v1/{SUPABASE_POST_COMMENT_TABLE}?{'&'.join(filters)}",
                headers={'apikey': SUPABASE_KEY, 'Authorization': f'Bearer {SUPABASE_KEY}'},
                timeout=30,
            )
            if resp.status_code in (200, 206):
                remote_rows = resp.json()
                if not isinstance(remote_rows, list):
                    remote_rows = []
                by_id = {str(row.get('comment_id') or ''): row for row in remote_rows if row.get('comment_id')}
                for row in _post_comments:
                    if source == 'facebook':
                        if 'facebook' not in str(row.get('source') or '').lower():
                            continue
                    elif source and str(row.get('source') or 'facebook').lower() != source:
                        continue
                    if post_id and str(row.get('post_id') or '') != post_id:
                        continue
                    cid = str(row.get('comment_id') or '')
                    if cid and cid not in by_id:
                        by_id[cid] = row
                rows = list(by_id.values())
                if source == 'facebook':
                    rows = [row for row in rows if 'facebook' in str(row.get('source') or '').lower()]
                rows.sort(key=lambda row: row.get('fetched_at') or row.get('created_time') or '', reverse=True)
                return rows[:limit], ''
            return [], resp.text[:300]
        except Exception as e:
            return [], str(e)[:300]
    rows = list(_post_comments)
    if source == 'facebook':
        rows = [row for row in rows if 'facebook' in str(row.get('source') or '').lower()]
    elif source:
        rows = [row for row in rows if str(row.get('source') or 'facebook').lower() == source]
    if post_id:
        rows = [row for row in rows if str(row.get('post_id') or '') == post_id]
    rows.sort(key=lambda row: row.get('fetched_at') or row.get('created_time') or '', reverse=True)
    return rows[:limit], ''


def _public_comment_row(row: dict) -> dict:
    raw = row.get('raw_comment') if isinstance(row.get('raw_comment'), dict) else {}
    meta = raw.get('_video_meta') if isinstance(raw.get('_video_meta'), dict) else {}
    cid = str(row.get('comment_id') or '')
    post_url = row.get('post_url') or ''
    auto_phones = extract_phones(row.get('message') or '')
    phone, phones, manual_phones = _resolve_comment_phones(row)
    post_title = str(row.get('post_title') or meta.get('video_title') or '').strip()
    return {
        'source': row.get('source') or '',
        'post_id': row.get('post_id') or '',
        'post_title': post_title,
        'group_id': row.get('group_id') or '',
        'post_url': post_url,
        'comment_url': _comment_url_for_row(str(row.get('source') or ''), post_url, cid),
        'comment_id': cid,
        'parent_comment_id': row.get('parent_comment_id') or '',
        'depth': row.get('depth') or 0,
        'author_id': row.get('author_id') or '',
        'author_name': row.get('author_name') or 'Ẩn danh',
        'message': row.get('message') or '',
        'attachment_type': row.get('attachment_type') or '',
        'created_time': row.get('created_time'),
        'matched_keywords': row.get('matched_keywords') or [],
        'manual_tags': _comment_tag_assignments.get(cid) or row.get('manual_tags') or [],
        'is_matched': bool(row.get('is_matched')),
        'phone': phone,
        'phones': phones,
        'phones_auto': auto_phones,
        'phones_manual': manual_phones,
        'channel_name': meta.get('channel_name') or _derive_tiktok_channel_name(post_url),
        'video_title': meta.get('video_title') or '',
        'fetched_at': row.get('fetched_at'),
        'processed': bool((_comment_inbox_workflow.get(cid) or {}).get('processed')),
        'starred': bool((_comment_inbox_workflow.get(cid) or {}).get('starred')),
    }


def _extract_tiktok_video_id(raw: str) -> tuple[str, str]:
    value = (raw or '').strip()
    if not value:
        return '', ''
    if re.fullmatch(r'\d{8,}', value):
        return value, f'https://www.tiktok.com/@/video/{value}'

    url = value
    if 'tiktok.com' not in url.lower() and re.search(r'\d{8,}', url):
        vid = re.search(r'\d{8,}', url).group(0)
        return vid, url
    if not re.match(r'^https?://', url, re.I):
        url = 'https://' + url

    final_url = url
    try:
        resp = _req.get(
            url,
            headers={'User-Agent': 'Mozilla/5.0'},
            allow_redirects=True,
            timeout=15,
        )
        final_url = resp.url or url
    except Exception:
        final_url = url

    match = re.search(r'/video/(\d+)', final_url)
    if not match:
        match = re.search(r'(?:item_id|itemId|aweme_id)=(\d+)', final_url)
    return (match.group(1), final_url) if match else ('', final_url)


def _fetch_tiktok_comments(video_id: str, limit: int = 300, cookie: str = '') -> tuple[list[dict], str]:
    comments: list[dict] = []
    cursor = 0
    limit = max(1, min(int(limit or 300), 1000))
    headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
        'Accept': 'application/json, text/plain, */*',
        'Referer': f'https://www.tiktok.com/@/video/{video_id}',
        'Origin': 'https://www.tiktok.com',
    }
    merged_cookie = (cookie or _configured_tiktok_cookie()).strip()
    if merged_cookie:
        headers['Cookie'] = merged_cookie

    def request_page(url: str, params: dict) -> tuple[dict, str]:
        try:
            resp = _req.get(url, params=params, headers=headers, timeout=25)
        except Exception as e:
            return {}, f'Lỗi kết nối TikTok: {str(e)[:180]}'
        if resp.status_code in (401, 403):
            return {}, 'TikTok đang chặn request. Hãy cập nhật TikTok cookie trong menu Cooki rồi chạy lại.'
        if resp.status_code != 200:
            return {}, f'TikTok trả lỗi {resp.status_code}: {resp.text[:160]}'
        try:
            return resp.json(), ''
        except Exception:
            return {}, 'TikTok không trả JSON hợp lệ, có thể endpoint đang bị chặn.'

    def fetch_replies(parent: dict):
        parent_cid = str(parent.get('cid') or parent.get('id') or '').strip()
        if not parent_cid or len(comments) >= limit:
            return ''
        total_replies = int(parent.get('reply_comment_total') or parent.get('reply_comment_count') or 0)
        if total_replies <= 0:
            return ''
        reply_cursor = 0
        while len(comments) < limit:
            reply_count = min(50, limit - len(comments))
            data, error = request_page(
                'https://www.tiktok.com/api/comment/list/reply/',
                {
                    'item_id': video_id,
                    'comment_id': parent_cid,
                    'cursor': reply_cursor,
                    'count': reply_count,
                    'aid': 1988,
                    'app_language': 'vi-VN',
                    'browser_language': 'vi-VN',
                    'device_platform': 'webapp',
                    'region': 'VN',
                    'os': 'windows',
                },
            )
            if error:
                return error
            batch = data.get('comments') or []
            if not batch:
                return ''
            for item in batch:
                if isinstance(item, dict):
                    item['_parent_cid'] = parent_cid
                    item['_depth'] = 1
                    comments.append(item)
                    if len(comments) >= limit:
                        break
            has_more = bool(data.get('has_more'))
            next_cursor = data.get('cursor')
            if not has_more or next_cursor is None or int(next_cursor) == reply_cursor:
                return ''
            reply_cursor = int(next_cursor)
        return ''

    while len(comments) < limit:
        count = min(50, limit - len(comments))
        params = {
            'aweme_id': video_id,
            'cursor': cursor,
            'count': count,
            'aid': 1988,
            'app_language': 'vi-VN',
            'browser_language': 'vi-VN',
            'device_platform': 'webapp',
            'region': 'VN',
            'os': 'windows',
        }
        data, error = request_page('https://www.tiktok.com/api/comment/list/', params)
        if error:
            return comments, error

        batch = data.get('comments') or []
        if not batch:
            msg = data.get('status_msg') or data.get('message') or ''
            return comments, msg or ('Không thấy comment TikTok hoặc video/cookie không có quyền đọc.')
        for item in batch:
            if not isinstance(item, dict):
                continue
            item['_depth'] = 0
            comments.append(item)
            if len(comments) >= limit:
                break
            reply_error = fetch_replies(item)
            if reply_error and not comments:
                return comments, reply_error
            if len(comments) >= limit:
                break
        has_more = bool(data.get('has_more'))
        next_cursor = data.get('cursor')
        if not has_more or next_cursor is None or int(next_cursor) == cursor:
            break
        cursor = int(next_cursor)
    return comments[:limit], ''


def _derive_tiktok_channel_name(video_url: str) -> str:
    match = re.search(r'tiktok\.com/@([^/?#]+)', video_url or '', re.I)
    return f"@{match.group(1).lstrip('@')}" if match else ''


def _extract_tiktok_handle(raw: str) -> tuple[str, str]:
    value = str(raw or '').strip()
    if not value:
        return '', ''
    match = re.search(r'tiktok\.com/@([^/?#]+)', value, re.I)
    if match:
        handle = match.group(1).strip()
        return handle, f'https://www.tiktok.com/@{handle}'
    handle = value.lstrip('@').strip('/ ')
    if re.fullmatch(r'[A-Za-z0-9._-]{2,80}', handle):
        return handle, f'https://www.tiktok.com/@{handle}'
    return '', value


def _extract_tiktok_video_title(html: str, video_id: str) -> str:
    if not html:
        return f'Video {video_id}'
    idx = html.find(video_id)
    window = html[max(0, idx - 1600): idx + 1600] if idx >= 0 else html[:4000]
    for pattern in (
        r'"desc"\s*:\s*"([^"]{1,220})"',
        r'"description"\s*:\s*"([^"]{1,220})"',
        r'<meta[^>]+property=["\']og:description["\'][^>]+content=["\']([^"\']+)["\']',
    ):
        match = re.search(pattern, window, re.I)
        if match:
            try:
                return unescape(match.group(1)).encode('utf-8').decode('unicode_escape')[:220]
            except Exception:
                return unescape(match.group(1))[:220]
    return f'Video {video_id}'


def _fetch_tiktok_channel_videos_from_worker(channel: str, max_videos: int = 8, cookie: str = '') -> tuple[list[dict], str]:
    if not TIKTOK_PLAYWRIGHT_WORKER_URL:
        return [], 'Chưa cấu hình TIKTOK_PLAYWRIGHT_WORKER_URL để gom video kênh bằng Browser Worker.'

    headers = {'Content-Type': 'application/json'}
    if TIKTOK_PLAYWRIGHT_WORKER_KEY:
        headers['Authorization'] = f'Bearer {TIKTOK_PLAYWRIGHT_WORKER_KEY}'
        headers['X-Worker-Key'] = TIKTOK_PLAYWRIGHT_WORKER_KEY

    try:
        resp = _req.post(
            f'{TIKTOK_PLAYWRIGHT_WORKER_URL}/tiktok/channel-videos',
            headers=headers,
            json={
                'channel': channel,
                'max_videos': max_videos,
                'cookie': cookie or _configured_tiktok_cookie(),
            },
            timeout=max(35, min((TIKTOK_PLAYWRIGHT_TIMEOUT_MS // 1000) + 45, 180)),
        )
    except Exception as e:
        return [], f'Không gọi được Browser Worker để gom video kênh: {str(e)[:220]}'

    try:
        payload = resp.json()
    except Exception:
        return [], f'Browser Worker trả phản hồi không hợp lệ ({resp.status_code}): {resp.text[:180]}'

    if resp.status_code in (401, 403):
        return [], payload.get('error') or 'Browser Worker từ chối API key.'
    if resp.status_code >= 400 or not payload.get('ok'):
        return [], payload.get('error') or f'Browser Worker lỗi {resp.status_code}'

    rows = []
    for item in payload.get('videos') or []:
        if not isinstance(item, dict):
            continue
        video_id = str(item.get('video_id') or '').strip()
        post_url = str(item.get('post_url') or '').strip()
        if not video_id:
            video_id, post_url = _extract_tiktok_video_id(post_url)
        if not video_id:
            continue
        rows.append({
            'video_id': video_id,
            'post_url': post_url or f'https://www.tiktok.com/@/video/{video_id}',
            'channel_name': item.get('channel_name') or payload.get('channel') or _derive_tiktok_channel_name(post_url),
            'video_title': item.get('video_title') or f'Video {video_id}',
        })
    return rows[:max_videos], '' if rows else 'Browser Worker không trả video hợp lệ.'


def _fetch_tiktok_channel_videos(channel: str, max_videos: int = 8, cookie: str = '') -> tuple[list[dict], str]:
    handle, profile_url = _extract_tiktok_handle(channel)
    if not handle:
        return [], 'Không nhận diện được kênh TikTok. Nhập @username hoặc link kênh TikTok.'
    max_videos = max(1, min(int(max_videos or 8), 50))
    headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Referer': 'https://www.tiktok.com/',
    }
    merged_cookie = (cookie or _configured_tiktok_cookie()).strip()
    if merged_cookie:
        headers['Cookie'] = merged_cookie
    try:
        resp = _req.get(profile_url, headers=headers, timeout=25)
    except Exception as e:
        worker_rows, worker_error = _fetch_tiktok_channel_videos_from_worker(channel, max_videos, merged_cookie)
        if worker_rows:
            return worker_rows, ''
        return [], worker_error or f'Lỗi kết nối TikTok khi đọc kênh: {str(e)[:180]}'
    if resp.status_code in (401, 403):
        worker_rows, worker_error = _fetch_tiktok_channel_videos_from_worker(channel, max_videos, merged_cookie)
        if worker_rows:
            return worker_rows, ''
        return [], worker_error or 'TikTok đang chặn đọc kênh. Cập nhật TikTok cookie hoặc mở kênh bằng Chrome đang đăng nhập.'
    if resp.status_code != 200:
        worker_rows, worker_error = _fetch_tiktok_channel_videos_from_worker(channel, max_videos, merged_cookie)
        if worker_rows:
            return worker_rows, ''
        return [], worker_error or f'TikTok trả lỗi {resp.status_code} khi đọc kênh: {resp.text[:120]}'
    html = resp.text or ''
    video_ids: list[str] = []
    for pattern in (rf'tiktok\.com/@{re.escape(handle)}/video/(\d+)', r'/video/(\d{8,})', r'"id"\s*:\s*"(\d{8,})"'):
        for vid in re.findall(pattern, html, re.I):
            if vid and vid not in video_ids:
                video_ids.append(vid)
            if len(video_ids) >= max_videos:
                break
        if len(video_ids) >= max_videos:
            break
    rows = []
    for vid in video_ids[:max_videos]:
        rows.append({
            'video_id': vid,
            'post_url': f'https://www.tiktok.com/@{handle}/video/{vid}',
            'channel_name': f'@{handle}',
            'video_title': _extract_tiktok_video_title(html, vid),
        })
    if not rows:
        worker_rows, worker_error = _fetch_tiktok_channel_videos_from_worker(channel, max_videos, merged_cookie)
        if worker_rows:
            return worker_rows, ''
        detail = f' {worker_error}' if worker_error else ''
        return [], f'Không tìm thấy video công khai bằng request server. Browser Worker cũng chưa gom được video.{detail}'
    return rows, ''


def _flatten_tiktok_comment_rows(
    video_id: str,
    video_url: str,
    comments: list,
    keywords: list[str],
    fetched_at: str,
    staff: dict,
    channel_name: str = '',
    video_title: str = '',
) -> list[dict]:
    rows: list[dict] = []
    post_id = f'tiktok_{video_id}'
    video_meta = {
        'channel_name': channel_name or _derive_tiktok_channel_name(video_url),
        'video_title': video_title or f'Video {video_id}',
        'video_id': video_id,
    }
    for item in comments or []:
        if not isinstance(item, dict):
            continue
        cid = str(item.get('cid') or item.get('id') or '').strip()
        if not cid:
            continue
        depth = int(item.get('_depth') or 0)
        parent_cid = str(item.get('_parent_cid') or '').strip()
        user = item.get('user') if isinstance(item.get('user'), dict) else {}
        share_info = item.get('share_info') if isinstance(item.get('share_info'), dict) else {}
        message = item.get('text') or share_info.get('desc') or ''
        matched = _match_comment_keywords(message, keywords)
        raw_comment = {**item, '_video_meta': video_meta}
        rows.append({
            'source': 'tiktok',
            'post_id': post_id,
            'post_title': video_meta['video_title'],
            'group_id': '',
            'post_url': video_url,
            'comment_url': _comment_url_for_row('tiktok', video_url, f'tiktok_{cid}'),
            'comment_id': f'tiktok_{cid}',
            'parent_comment_id': f'tiktok_{parent_cid}' if parent_cid else '',
            'depth': depth,
            'author_id': str(user.get('uid') or user.get('sec_uid') or ''),
            'author_name': user.get('nickname') or user.get('unique_id') or 'Ẩn danh',
            'message': message,
            'attachment_type': '',
            'created_time': _iso_from_unix(item.get('create_time')) or None,
            'matched_keywords': matched,
            'is_matched': bool(matched),
            'raw_comment': raw_comment,
            'fetched_by_staff_id': staff.get('id', ''),
            'fetched_by_staff_name': staff.get('name', ''),
            'fetched_by_staff_username': staff.get('username', ''),
            'fetched_at': fetched_at,
        })
    return rows


def _tiktok_comment_stats(rows: list[dict]) -> list[dict]:
    grouped: dict[str, dict] = {}
    for row in rows or []:
        if str(row.get('source') or '').lower() != 'tiktok':
            continue
        post_id = str(row.get('post_id') or '')
        if not post_id:
            continue
        public_row = _public_comment_row(row)
        raw = row.get('raw_comment') if isinstance(row.get('raw_comment'), dict) else {}
        meta = raw.get('_video_meta') if isinstance(raw.get('_video_meta'), dict) else {}
        stat = grouped.setdefault(post_id, {
            'post_id': post_id,
            'video_id': post_id.replace('tiktok_', '', 1),
            'post_url': row.get('post_url') or '',
            'channel_name': meta.get('channel_name') or public_row.get('channel_name') or '',
            'video_title': meta.get('video_title') or public_row.get('video_title') or post_id.replace('tiktok_', 'Video '),
            'comment_count': 0,
            'matched_count': 0,
            'phone_count': 0,
            'latest_fetched_at': '',
            'latest_comment_at': '',
            'comments': [],
        })
        if not stat.get('post_url') and row.get('post_url'):
            stat['post_url'] = row.get('post_url')
        if not stat.get('channel_name') and public_row.get('channel_name'):
            stat['channel_name'] = public_row.get('channel_name')
        if not stat.get('video_title') and public_row.get('video_title'):
            stat['video_title'] = public_row.get('video_title')
        stat['comment_count'] += 1
        if public_row.get('is_matched'):
            stat['matched_count'] += 1
        if public_row.get('phones'):
            stat['phone_count'] += 1
        fetched_at = str(public_row.get('fetched_at') or '')
        created_time = str(public_row.get('created_time') or '')
        if fetched_at > str(stat.get('latest_fetched_at') or ''):
            stat['latest_fetched_at'] = fetched_at
        if created_time > str(stat.get('latest_comment_at') or ''):
            stat['latest_comment_at'] = created_time
        stat['comments'].append(public_row)

    stats = list(grouped.values())
    for stat in stats:
        stat['comments'].sort(key=lambda row: row.get('created_time') or row.get('fetched_at') or '', reverse=True)
    stats.sort(key=lambda item: item.get('latest_fetched_at') or item.get('latest_comment_at') or '', reverse=True)
    return stats


def _send_tiktok_comment(video_id: str, video_url: str, message: str, cookie: str = '') -> tuple[dict, str]:
    message = (message or '').strip()
    if not message:
        return {}, 'Nhập nội dung bình luận TikTok'
    merged_cookie = (cookie or _configured_tiktok_cookie()).strip()
    if not merged_cookie:
        return {}, 'Thiếu cookie TikTok. Admin cần nhập TikTok cookie trong menu Cooki.'
    if not _has_tiktok_login_cookie(merged_cookie):
        return {}, _tiktok_cookie_login_message(merged_cookie)

    csrf = (
        _extract_cookie_value(merged_cookie, 'tt_csrf_token')
        or _extract_cookie_value(merged_cookie, 'csrf_session_id')
    )
    headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
        'Accept': 'application/json, text/plain, */*',
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        'Referer': video_url or f'https://www.tiktok.com/@/video/{video_id}',
        'Origin': 'https://www.tiktok.com',
        'Cookie': merged_cookie,
    }
    if csrf:
        headers['X-Secsdk-Csrf-Token'] = csrf
        headers['x-secsdk-csrf-token'] = csrf

    params = {
        'aweme_id': video_id,
        'aid': 1988,
        'app_language': 'vi-VN',
        'browser_language': 'vi-VN',
        'device_platform': 'webapp',
        'region': 'VN',
        'os': 'windows',
    }
    data = {
        'aweme_id': video_id,
        'text': message,
    }
    try:
        resp = _req.post(
            'https://www.tiktok.com/api/comment/publish/',
            params=params,
            headers=headers,
            data=data,
            timeout=30,
        )
    except Exception as e:
        return {}, f'Lỗi kết nối TikTok: {str(e)[:180]}'

    if resp.status_code in (401, 403):
        return {}, 'TikTok chặn gửi bình luận. Cookie có thể hết hạn, thiếu CSRF hoặc tài khoản không có quyền bình luận video này.'
    if resp.status_code != 200:
        return {}, f'TikTok trả lỗi {resp.status_code}: {resp.text[:180]}'
    try:
        payload = resp.json()
    except Exception:
        return {}, 'TikTok không trả JSON hợp lệ khi gửi bình luận.'

    status_code = payload.get('status_code')
    if status_code not in (0, '0', None) or payload.get('status_msg') or payload.get('message'):
        msg = payload.get('status_msg') or payload.get('message') or payload.get('log_pb') or 'TikTok không nhận bình luận'
        if status_code in (0, '0') and (payload.get('comment') or payload.get('comments')):
            return payload, ''
        return {}, _friendly_tiktok_publish_error(str(msg)[:220])
    return payload, ''


def _click_first_visible(locator) -> bool:
    try:
        count = min(locator.count(), 6)
    except Exception:
        return False
    for idx in range(count):
        item = locator.nth(idx)
        try:
            if item.is_visible(timeout=700):
                item.click(timeout=2500)
                return True
        except Exception:
            continue
    return False


def _run_tiktok_playwright_comment(body: dict) -> tuple[dict, str]:
    if not TIKTOK_PLAYWRIGHT_ENABLED:
        return {}, 'Playwright backend chưa bật. Bật TIKTOK_PLAYWRIGHT_ENABLED=true trên máy/VPS chạy backend để thử browser automation.'

    try:
        from playwright.sync_api import sync_playwright
    except Exception:
        return {}, 'Backend chưa cài Playwright. Chạy: pip install playwright && python -m playwright install chromium'

    raw_url = str(body.get('url') or body.get('video_url') or body.get('post_url') or '').strip()
    raw_video_id = str(body.get('video_id') or '').strip()
    post_id = str(body.get('post_id') or '').strip()
    message = str(body.get('message') or body.get('text') or '').strip()
    comment_text = str(body.get('comment_text') or '').strip()
    if post_id.startswith('tiktok_') and not raw_video_id:
        raw_video_id = post_id.replace('tiktok_', '', 1)
    video_id, final_url = _extract_tiktok_video_id(raw_video_id or raw_url)
    if not video_id:
        return {}, 'Không nhận diện được video TikTok để chạy Playwright.'
    if not message:
        return {}, 'Nhập nội dung bình luận TikTok'
    if not final_url:
        final_url = raw_url or f'https://www.tiktok.com/@/video/{video_id}'

    os.makedirs(TIKTOK_PLAYWRIGHT_USER_DATA_DIR, exist_ok=True)
    timeout = max(15000, min(TIKTOK_PLAYWRIGHT_TIMEOUT_MS, 180000))
    context = None
    try:
        with sync_playwright() as p:
            launch_opts = {
                'headless': TIKTOK_PLAYWRIGHT_HEADLESS,
                'viewport': {'width': 1366, 'height': 900},
                'locale': 'vi-VN',
                'args': [
                    '--disable-blink-features=AutomationControlled',
                    '--no-first-run',
                    '--disable-dev-shm-usage',
                ],
            }
            try:
                context = p.chromium.launch_persistent_context(
                    TIKTOK_PLAYWRIGHT_USER_DATA_DIR,
                    channel='chrome',
                    **launch_opts,
                )
            except Exception:
                context = p.chromium.launch_persistent_context(
                    TIKTOK_PLAYWRIGHT_USER_DATA_DIR,
                    **launch_opts,
                )

            page = context.pages[0] if context.pages else context.new_page()
            page.set_default_timeout(timeout)
            page.goto(final_url, wait_until='domcontentloaded', timeout=timeout)
            page.wait_for_timeout(2500)

            login_markers = [
                'text=/Log in|Đăng nhập|Sign up|Đăng ký/i',
                '[data-e2e="login-button"]',
            ]
            login_visible = False
            for selector in login_markers:
                try:
                    if page.locator(selector).first.is_visible(timeout=800):
                        login_visible = True
                        break
                except Exception:
                    continue
            if login_visible and TIKTOK_PLAYWRIGHT_HEADLESS:
                return {}, 'Playwright profile chưa đăng nhập TikTok. Chạy local với TIKTOK_PLAYWRIGHT_HEADLESS=false, đăng nhập TikTok trong cửa sổ Chrome mở ra rồi thử lại.'

            for selector in (
                '[data-e2e="comment-icon"]',
                'button[aria-label*="comment" i]',
                'button[aria-label*="bình luận" i]',
                'div[role="button"][aria-label*="comment" i]',
            ):
                _click_first_visible(page.locator(selector))
                page.wait_for_timeout(500)

            reply_target_found = False
            if comment_text:
                try:
                    reply_target_found = bool(page.evaluate(
                        """(text) => {
                          const normalize = (value) => String(value || '').replace(/\\s+/g, ' ').trim().toLowerCase();
                          const needle = normalize(text).slice(0, 120);
                          if (!needle) return false;
                          const nodes = Array.from(document.querySelectorAll('div, span, p'));
                          for (const node of nodes) {
                            const haystack = normalize(node.innerText || node.textContent);
                            if (!haystack.includes(needle)) continue;
                            node.scrollIntoView({ block: 'center', inline: 'nearest' });
                            let parent = node;
                            for (let depth = 0; depth < 10 && parent; depth += 1, parent = parent.parentElement) {
                              const actions = Array.from(parent.querySelectorAll('button, [role="button"], span'));
                              const reply = actions.find((item) => /reply|trả lời/i.test(item.innerText || item.getAttribute('aria-label') || ''));
                              if (reply) {
                                reply.click();
                                return true;
                              }
                            }
                            return true;
                          }
                          return false;
                        }""",
                        comment_text,
                    ))
                    page.wait_for_timeout(900)
                except Exception:
                    reply_target_found = False

            input_clicked = False
            for selector in (
                '[data-e2e="comment-input"] [contenteditable="true"]',
                'div.public-DraftEditor-content[contenteditable="true"]',
                'div[contenteditable="true"][role="textbox"]',
                'div[contenteditable="true"]',
                'textarea[placeholder*="comment" i]',
                'textarea[placeholder*="bình luận" i]',
            ):
                loc = page.locator(selector)
                try:
                    if loc.count():
                        target = loc.first
                        target.click(timeout=3000)
                        page.keyboard.insert_text(message)
                        input_clicked = True
                        break
                except Exception:
                    continue
            if not input_clicked:
                return {}, 'Playwright đã mở TikTok nhưng không tìm thấy ô nhập bình luận. Có thể TikTok đổi UI hoặc tài khoản chưa được phép comment.'

            page.wait_for_timeout(600)
            submitted = False
            for selector in (
                '[data-e2e="comment-post"]',
                'button[data-e2e*="comment-post"]',
                'button[aria-label*="post" i]',
                'button[aria-label*="đăng" i]',
                'button[aria-label*="gửi" i]',
                'div[role="button"][aria-label*="post" i]',
            ):
                if _click_first_visible(page.locator(selector)):
                    submitted = True
                    break
            if not submitted:
                for key in ('Control+Enter', 'Meta+Enter', 'Enter'):
                    try:
                        page.keyboard.press(key)
                        submitted = True
                        break
                    except Exception:
                        continue
            if not submitted:
                return {}, 'Playwright đã nhập bình luận nhưng không bấm được nút gửi.'

            page.wait_for_timeout(1800)
            return {
                'ok': True,
                'method': 'playwright-browser',
                'url': final_url,
                'video_id': video_id,
                'comment_id': f'playwright_{uuid.uuid4().hex}',
                'reply_target_found': reply_target_found,
                'message': 'Đã gửi bằng Playwright browser profile.',
            }, ''
    except Exception as e:
        return {}, f'Playwright không gửi được TikTok: {str(e)[:260]}'
    finally:
        try:
            if context:
                context.close()
        except Exception:
            pass


def _run_tiktok_playwright_worker_comment(body: dict) -> tuple[dict, str]:
    if not TIKTOK_PLAYWRIGHT_WORKER_URL:
        return {}, 'Chưa cấu hình TIKTOK_PLAYWRIGHT_WORKER_URL để gọi Browser Worker.'

    headers = {'Content-Type': 'application/json'}
    if TIKTOK_PLAYWRIGHT_WORKER_KEY:
        headers['Authorization'] = f'Bearer {TIKTOK_PLAYWRIGHT_WORKER_KEY}'
        headers['X-Worker-Key'] = TIKTOK_PLAYWRIGHT_WORKER_KEY

    try:
        resp = _req.post(
            f'{TIKTOK_PLAYWRIGHT_WORKER_URL}/tiktok/comment',
            headers=headers,
            json=body,
            timeout=max(20, min((TIKTOK_PLAYWRIGHT_TIMEOUT_MS // 1000) + 15, 120)),
        )
    except Exception as e:
        return {}, f'Không gọi được Browser Worker: {str(e)[:220]}'

    try:
        payload = resp.json()
    except Exception:
        return {}, f'Browser Worker trả phản hồi không hợp lệ ({resp.status_code}): {resp.text[:180]}'

    if resp.status_code in (401, 403):
        return {}, payload.get('error') or 'Browser Worker từ chối API key.'
    if resp.status_code >= 400 or not payload.get('ok'):
        return {}, payload.get('error') or f'Browser Worker lỗi {resp.status_code}'
    payload.setdefault('method', 'playwright-worker')
    return payload, ''


def _record_tiktok_extension_comment(body: dict) -> tuple[dict, int]:
    raw_url = str(body.get('url') or body.get('video_url') or body.get('post_url') or '').strip()
    raw_video_id = str(body.get('video_id') or '').strip()
    post_id = str(body.get('post_id') or '').strip()
    message = str(body.get('message') or body.get('text') or '').strip()
    status = str(body.get('status') or '').strip().lower()
    error = str(body.get('error') or '').strip()
    extension_result = body.get('extension_result') if isinstance(body.get('extension_result'), dict) else {}
    result_method = str(extension_result.get('method') or '')
    is_manual = bool(extension_result.get('manual')) or result_method.startswith('manual')
    if result_method.startswith('playwright'):
        delivery = 'browser_automation'
    else:
        delivery = 'manual_copy_open' if is_manual else 'chrome_extension'

    if post_id.startswith('tiktok_') and not raw_video_id:
        raw_video_id = post_id.replace('tiktok_', '', 1)
    video_id, final_url = _extract_tiktok_video_id(raw_video_id or raw_url)
    if not video_id:
        return {'ok': False, 'error': 'Không nhận diện được video TikTok để ghi lịch sử.'}, 400
    if not message:
        return {'ok': False, 'error': 'Thiếu nội dung bình luận TikTok'}, 400
    if not final_url:
        final_url = raw_url or f'https://www.tiktok.com/@/video/{video_id}'

    final_post_id = f'tiktok_{video_id}'
    now = datetime.utcnow().isoformat(timespec='seconds') + 'Z'
    staff = _current_staff()

    if status != 'success':
        log = _record_comment_log(
            final_post_id,
            'tiktok',
            final_url,
            message,
            'tiktok-extension',
            'failed',
            error_message=error or 'Extension chưa gửi được bình luận TikTok',
        )
        res = {
            'ok': False,
            'source': 'tiktok',
            'post_id': final_post_id,
            'post_url': final_url,
            'error': error or 'Extension chưa gửi được bình luận TikTok',
            'log_storage': log.get('storage'),
        }
        if log.get('storage_warning'):
            res['warning'] = f"Đã lưu local, Supabase chưa ghi được: {log['storage_warning']}"
        return res, 200

    comment_id = str(
        body.get('comment_id')
        or extension_result.get('comment_id')
        or extension_result.get('cid')
        or extension_result.get('id')
        or f'extension_{uuid.uuid4().hex}'
    )
    if not comment_id.startswith('tiktok_'):
        comment_id = f'tiktok_{comment_id}'

    log = _record_comment_log(
        final_post_id,
        'tiktok',
        final_url,
        message,
        delivery,
        'success',
        comment_id=comment_id,
        lead_context={
            'platform': 'tiktok',
            'customer_name': body.get('customer_name') or body.get('author_name') or body.get('channel_name'),
            'customer_need': body.get('customer_need') or body.get('comment_text') or body.get('video_title'),
            'video_title': body.get('video_title'),
            'channel_name': body.get('channel_name'),
        },
        create_lead=not is_manual,
    )
    rows = [{
        'source': 'tiktok',
        'post_id': final_post_id,
        'group_id': '',
        'post_url': final_url,
        'comment_id': comment_id,
        'parent_comment_id': '',
        'depth': 0,
        'author_id': staff.get('id', ''),
        'author_name': staff.get('name') or staff.get('username') or 'Nhân sự',
        'message': message,
        'attachment_type': '',
        'created_time': now,
        'matched_keywords': [],
        'is_matched': False,
        'raw_comment': {
            'outbound': True,
            'delivery': delivery,
            'manual_prepared': is_manual,
            'extension_result': extension_result,
            '_video_meta': {
                'channel_name': str(body.get('channel_name') or _derive_tiktok_channel_name(final_url)),
                'video_title': str(body.get('video_title') or f'Video {video_id}'),
                'video_id': video_id,
            },
        },
        'fetched_by_staff_id': staff.get('id', ''),
        'fetched_by_staff_name': staff.get('name', ''),
        'fetched_by_staff_username': staff.get('username', ''),
        'fetched_at': now,
    }]
    storage, storage_warning = _store_post_comment_rows(rows)
    res = {
        'ok': True,
        'source': 'tiktok',
        'post_id': final_post_id,
        'post_url': final_url,
        'comment_id': comment_id,
        'delivery': delivery,
        'manual_prepared': is_manual,
        'storage': storage,
        'log_storage': log.get('storage'),
    }
    warnings = []
    if storage_warning:
        prefix = 'Comment đã chuẩn bị thủ công' if is_manual else 'Comment đã gửi'
        warnings.append(f'{prefix}, nhưng Supabase post_comments chưa ghi được: {storage_warning}')
    if log.get('storage_warning'):
        warnings.append(f"Lịch sử comment đã lưu local, Supabase chưa ghi được: {log['storage_warning']}")
    if warnings:
        res['warning'] = ' | '.join(warnings)
    return res, 200


def _upload_comment_image_to_supabase(file_storage) -> tuple[str, str]:
    if not SUPABASE_URL or not SUPABASE_KEY:
        return '', 'Chưa cấu hình Supabase'
    if not file_storage or not file_storage.filename:
        return '', 'Chưa chọn file ảnh'

    content_type = (file_storage.mimetype or '').lower()
    if content_type not in ALLOWED_COMMENT_IMAGE_TYPES:
        return '', 'Chỉ hỗ trợ ảnh JPG, PNG, WEBP hoặc GIF'

    content = file_storage.read()
    if not content:
        return '', 'File ảnh rỗng'
    if len(content) > MAX_COMMENT_IMAGE_BYTES:
        return '', f'Ảnh quá lớn, tối đa {MAX_COMMENT_IMAGE_BYTES // (1024 * 1024)}MB'

    original = secure_filename(file_storage.filename or 'comment-image')
    _, original_ext = os.path.splitext(original)
    ext = original_ext.lower() if original_ext.lower() in {'.jpg', '.jpeg', '.png', '.webp', '.gif'} else ALLOWED_COMMENT_IMAGE_TYPES[content_type]
    if ext == '.jpeg':
        ext = '.jpg'

    staff_id = _current_staff_id() or 'anonymous'
    tz = _app_timezone()
    today = datetime.now(tz).strftime('%Y/%m/%d')
    object_path = f'{today}/{staff_id}/{uuid.uuid4().hex}{ext}'
    upload_url = f"{SUPABASE_URL.rstrip('/')}/storage/v1/object/{SUPABASE_COMMENT_IMAGE_BUCKET}/{object_path}"

    try:
        resp = _req.post(
            upload_url,
            headers={
                'apikey': SUPABASE_KEY,
                'Authorization': f'Bearer {SUPABASE_KEY}',
                'Content-Type': content_type,
                'x-upsert': 'false',
            },
            data=content,
            timeout=60,
        )
        if resp.status_code not in (200, 201):
            message = resp.text[:300]
            if resp.headers.get('content-type', '').startswith('application/json'):
                try:
                    message = resp.json().get('message') or message
                except Exception:
                    pass
            return '', message
        public_path = quote(object_path, safe='/')
        public_url = f"{SUPABASE_URL.rstrip('/')}/storage/v1/object/public/{SUPABASE_COMMENT_IMAGE_BUCKET}/{public_path}"
        return public_url, ''
    except Exception as e:
        return '', str(e)[:300]


def _upload_post_media_to_supabase(file_storage) -> tuple[str, str, str]:
    if not SUPABASE_URL or not SUPABASE_KEY:
        return '', '', 'Chưa cấu hình Supabase'
    if not file_storage or not file_storage.filename:
        return '', '', 'Chưa chọn file ảnh/video'

    content_type = (file_storage.mimetype or '').lower()
    if content_type not in ALLOWED_POST_MEDIA_TYPES:
        return '', '', 'Chỉ hỗ trợ JPG, PNG, WEBP, GIF, MP4 hoặc MOV'

    content = file_storage.read()
    if not content:
        return '', '', 'File rỗng'
    if len(content) > MAX_POST_MEDIA_BYTES:
        return '', '', f'File quá lớn, tối đa {MAX_POST_MEDIA_BYTES // (1024 * 1024)}MB'

    original = secure_filename(file_storage.filename or 'post-media')
    _, original_ext = os.path.splitext(original)
    valid_exts = set(ALLOWED_POST_MEDIA_TYPES.values()) | {'.jpeg'}
    ext = original_ext.lower() if original_ext.lower() in valid_exts else ALLOWED_POST_MEDIA_TYPES[content_type]
    if ext == '.jpeg':
        ext = '.jpg'

    staff_id = _current_staff_id() or 'anonymous'
    try:
        tz = ZoneInfo(APP_TIMEZONE)
    except Exception:
        tz = ZoneInfo('Asia/Ho_Chi_Minh')
    today = datetime.now(tz).strftime('%Y/%m/%d')
    object_path = f'posts/{today}/{staff_id}/{uuid.uuid4().hex}{ext}'
    upload_url = f"{SUPABASE_URL.rstrip('/')}/storage/v1/object/{SUPABASE_POST_MEDIA_BUCKET}/{object_path}"

    try:
        resp = _req.post(
            upload_url,
            headers={
                'apikey': SUPABASE_KEY,
                'Authorization': f'Bearer {SUPABASE_KEY}',
                'Content-Type': content_type,
                'x-upsert': 'false',
            },
            data=content,
            timeout=60,
        )
        if resp.status_code not in (200, 201):
            message = resp.text[:300]
            if resp.headers.get('content-type', '').startswith('application/json'):
                try:
                    message = resp.json().get('message') or message
                except Exception:
                    pass
            return '', '', message
        public_path = quote(object_path, safe='/')
        public_url = f"{SUPABASE_URL.rstrip('/')}/storage/v1/object/public/{SUPABASE_POST_MEDIA_BUCKET}/{public_path}"
        return public_url, content_type, ''
    except Exception as e:
        return '', '', str(e)[:300]


def _upload_post_media_bytes_to_supabase(content: bytes, filename: str, content_type: str) -> tuple[str, str, str]:
    if not SUPABASE_URL or not SUPABASE_KEY:
        return '', '', 'Chưa cấu hình Supabase'
    content_type = (content_type or '').lower()
    if content_type not in ALLOWED_POST_MEDIA_TYPES:
        return '', '', 'Chỉ hỗ trợ JPG, PNG, WEBP, GIF, MP4 hoặc MOV'
    if not content:
        return '', '', 'File rỗng'
    if len(content) > MAX_POST_MEDIA_BYTES:
        return '', '', f'File quá lớn, tối đa {MAX_POST_MEDIA_BYTES // (1024 * 1024)}MB'

    original = secure_filename(filename or 'post-media.png')
    _, original_ext = os.path.splitext(original)
    valid_exts = set(ALLOWED_POST_MEDIA_TYPES.values()) | {'.jpeg'}
    ext = original_ext.lower() if original_ext.lower() in valid_exts else ALLOWED_POST_MEDIA_TYPES[content_type]
    if ext == '.jpeg':
        ext = '.jpg'

    staff_id = _current_staff_id() or 'anonymous'
    try:
        tz = ZoneInfo(APP_TIMEZONE)
    except Exception:
        tz = ZoneInfo('Asia/Ho_Chi_Minh')
    today = datetime.now(tz).strftime('%Y/%m/%d')
    object_path = f'posts/{today}/{staff_id}/{uuid.uuid4().hex}{ext}'
    upload_url = f"{SUPABASE_URL.rstrip('/')}/storage/v1/object/{SUPABASE_POST_MEDIA_BUCKET}/{object_path}"
    try:
        resp = _req.post(
            upload_url,
            headers={
                'apikey': SUPABASE_KEY,
                'Authorization': f'Bearer {SUPABASE_KEY}',
                'Content-Type': content_type,
                'x-upsert': 'false',
            },
            data=content,
            timeout=90,
        )
        if resp.status_code not in (200, 201):
            message = resp.text[:300]
            if resp.headers.get('content-type', '').startswith('application/json'):
                try:
                    message = resp.json().get('message') or message
                except Exception:
                    pass
            return '', '', message
        public_path = quote(object_path, safe='/')
        public_url = f"{SUPABASE_URL.rstrip('/')}/storage/v1/object/public/{SUPABASE_POST_MEDIA_BUCKET}/{public_path}"
        return public_url, content_type, ''
    except Exception as e:
        return '', '', str(e)[:300]


def _generate_openai_image_bytes(prompt: str, model: str = '', size: str = '1024x1024') -> tuple[bytes, str]:
    prompt = str(prompt or '').strip()
    if not prompt:
        raise RuntimeError('Thiếu mô tả ảnh')
    api_key = _get_ai_key('openai')
    if not api_key:
        raise RuntimeError('Chưa có OpenAI/ChatGPT API key để tạo ảnh. Vào Cài đặt → Cấu hình AI theo khách, chọn OpenAI và lưu key.')
    model = str(model or os.environ.get('OPENAI_IMAGE_MODEL') or 'gpt-image-1').strip() or 'gpt-image-1'
    size = str(size or '1024x1024').strip()
    if size not in {'1024x1024', '1536x1024', '1024x1536'}:
        size = '1024x1024'
    try:
        resp = _req.post(
            'https://api.openai.com/v1/images/generations',
            headers={
                'Authorization': f'Bearer {api_key}',
                'Content-Type': 'application/json',
            },
            json={
                'model': model,
                'prompt': prompt[:8000],
                'size': size,
                'n': 1,
            },
            timeout=180,
        )
    except Exception as e:
        raise RuntimeError(f'Không gọi được OpenAI Images API: {str(e)[:300]}') from e
    data = resp.json() if resp.headers.get('content-type', '').startswith('application/json') else {}
    if resp.status_code >= 400:
        error = data.get('error') if isinstance(data, dict) else {}
        message = error.get('message') if isinstance(error, dict) else ''
        raise RuntimeError((message or resp.text or 'OpenAI Images API lỗi')[:500])
    rows = data.get('data') if isinstance(data, dict) else []
    item = rows[0] if isinstance(rows, list) and rows else {}
    b64 = str(item.get('b64_json') or '').strip() if isinstance(item, dict) else ''
    if b64:
        return base64.b64decode(b64), model
    image_url = str(item.get('url') or '').strip() if isinstance(item, dict) else ''
    if image_url:
        img_resp = _req.get(image_url, timeout=120)
        if img_resp.status_code < 400 and img_resp.content:
            return img_resp.content, model
    raise RuntimeError('OpenAI không trả dữ liệu ảnh')


def _staff_processed_post_ids(staff_id: str) -> set:
    staff_id = str(staff_id or '').strip()
    if not staff_id:
        return set()
    processed = set()
    for item in _comment_logs:
        if str(item.get('staff_id') or '').strip() != staff_id:
            continue
        if item.get('status') not in ('success', 'processed'):
            continue
        post_id = str(item.get('post_id') or '').strip()
        if post_id:
            processed.add(post_id)
    return processed


def _filter_posts_for_staff(posts: list, staff_id: str) -> tuple[list, int]:
    if not staff_id:
        return posts, 0
    processed_ids = _staff_processed_post_ids(staff_id)
    if not processed_ids:
        return posts, 0
    kept = []
    skipped = 0
    for post in posts:
        if str(post.get('id') or '').strip() in processed_ids:
            skipped += 1
            continue
        kept.append(post)
    return kept, skipped


def _commented_post_lead_key(platform: str, post_id: str, staff_id: str) -> str:
    identity = '|'.join([
        'commented_post',
        str(platform or '').strip().lower(),
        str(post_id or '').strip(),
        str(staff_id or '').strip(),
    ])
    return hashlib.sha1(identity.encode('utf-8')).hexdigest()


def _upsert_lead_from_comment_log(log: dict, lead_context: dict | None = None) -> tuple[dict, bool, str]:
    if str(log.get('status') or '').strip().lower() != 'success':
        return {}, True, ''
    context = lead_context if isinstance(lead_context, dict) else {}
    post_id = str(log.get('post_id') or '').strip()
    staff_id = str(log.get('staff_id') or '').strip()
    if not post_id or not staff_id:
        return {}, True, ''

    platform = str(context.get('platform') or '').strip().lower()
    if not platform:
        platform = 'tiktok' if post_id.startswith('tiktok_') or str(log.get('group_id') or '') == 'tiktok' else 'facebook'
    processor = str(log.get('staff_name') or log.get('staff_username') or 'Nhân sự').strip()
    customer_name = str(
        context.get('customer_name')
        or context.get('author_name')
        or context.get('channel_name')
        or 'Ẩn danh'
    ).strip()
    customer_need = str(
        context.get('customer_need')
        or context.get('post_message')
        or context.get('video_title')
        or ''
    ).strip()
    outbound_comment = str(log.get('comment_text') or '').strip()
    phones = extract_phones(customer_need)
    now = str(log.get('created_at') or datetime.utcnow().isoformat(timespec='seconds') + 'Z')
    lead_key = _commented_post_lead_key(platform, post_id, staff_id)
    lead = _normalise_lead({
        'lead_key': lead_key,
        'platform': platform,
        'source': 'commented_post',
        'source_id': post_id,
        'post_id': post_id,
        'group_id': str(log.get('group_id') or context.get('group_id') or '').strip(),
        'post_url': str(log.get('post_url') or context.get('post_url') or '').strip(),
        'comment_id': str(log.get('comment_id') or '').strip(),
        'name': customer_name,
        'comment_author': customer_name,
        'comment_text': outbound_comment,
        'need': customer_need[:500] or 'Bài viết đã được nhân sự bình luận và cần Sale chăm sóc.',
        'evidence': (customer_need[:300] or f'Đã bình luận: {outbound_comment[:260]}').strip(),
        'phone': phones[0] if phones else '',
        'phones': phones,
        'intent': 'staff_commented_post',
        'contact_status': 'has_phone' if phones else 'no_phone',
        'confidence': 0.95 if phones else 0.6,
        'processed_at': now,
        'processed_by': processor,
        'processed_by_staff_id': staff_id,
        'assigned_sale': processor,
        'crm_status': 'Lead mới',
        'created_at': now,
    }, post_id)
    _merge_leads_into_memory([lead])
    supabase_ok, supabase_error = _save_leads_to_supabase([lead])
    return lead, supabase_ok, supabase_error


def _record_comment_log(post_id: str, group_id: str, post_url: str, message: str, page_id: str,
                        status: str, comment_id: str = '', error_message: str = '', image_url: str = '',
                        lead_context: dict | None = None, create_lead: bool = True) -> dict:
    global _comment_logs
    staff = _current_staff()
    now = datetime.utcnow().isoformat(timespec='seconds') + 'Z'
    log = {
        'staff_id': staff.get('id', ''),
        'staff_name': staff.get('name', ''),
        'staff_username': staff.get('username', ''),
        'facebook_user_id': _extract_cookie_user(staff.get('cookie', '')),
        'post_id': post_id,
        'group_id': group_id,
        'post_url': post_url,
        'comment_text': message,
        'comment_image_url': image_url,
        'comment_id': comment_id,
        'page_id': page_id,
        'status': status,
        'error_message': error_message,
        'created_at': now,
    }
    _comment_logs.append(log)
    _save_comment_logs()
    supabase_ok, supabase_error = _save_comment_log_to_supabase(log)
    log['storage'] = 'supabase' if supabase_ok else 'local'
    warnings = [f'Lịch sử: {supabase_error}'] if supabase_error else []
    if create_lead and status == 'success':
        try:
            lead, lead_ok, lead_error = _upsert_lead_from_comment_log(log, lead_context)
            if lead:
                log['lead_key'] = lead.get('lead_key')
                log['lead_storage'] = 'supabase' if lead_ok else 'local'
            if lead_error:
                warnings.append(f'Lead: {lead_error}')
        except Exception as e:
            warnings.append(f'Lead: {str(e)[:300]}')
    if warnings:
        log['storage_warning'] = ' | '.join(warnings)
    return log


def _comment_log_identity(log: dict) -> tuple[str, ...]:
    created_at = str(log.get('created_at') or '').strip()
    parsed_created_at = _parse_log_time(created_at)
    if parsed_created_at:
        created_at = parsed_created_at.isoformat(timespec='seconds')
    return (
        str(log.get('staff_id') or '').strip(),
        str(log.get('post_id') or '').strip(),
        str(log.get('comment_id') or '').strip(),
        str(log.get('status') or '').strip(),
        created_at,
        str(log.get('comment_text') or '').strip(),
        str(log.get('error_message') or '').strip(),
    )


def _merge_comment_log_rows(local_rows: list, remote_rows: list, limit: int = 200) -> list[dict]:
    merged: dict[tuple[str, ...], dict] = {}
    for source, rows in (('local', local_rows), ('supabase', remote_rows)):
        for item in rows or []:
            if not isinstance(item, dict):
                continue
            row = {**item, 'storage': item.get('storage') or source}
            key = _comment_log_identity(row)
            merged[key] = {**merged.get(key, {}), **row}

    def sort_key(row: dict) -> tuple[float, int]:
        created_at = _parse_log_time(str(row.get('created_at') or ''))
        timestamp = created_at.timestamp() if created_at else 0.0
        try:
            row_id = int(row.get('id') or 0)
        except (TypeError, ValueError):
            row_id = 0
        return timestamp, row_id

    rows = sorted(merged.values(), key=sort_key)
    return rows[-max(1, min(int(limit or 200), 5000)):]


def _load_comment_logs_from_supabase(staff_id: str = '', limit: int = 1000) -> tuple[list[dict], str]:
    if not SUPABASE_URL or not SUPABASE_KEY:
        return [], 'Chưa cấu hình Supabase'
    params = {
        'select': '*',
        'order': 'created_at.desc',
        'limit': str(max(1, min(int(limit or 1000), 5000))),
    }
    if staff_id:
        params['staff_id'] = f'eq.{staff_id}'
    try:
        resp = _req.get(
            f"{SUPABASE_URL.rstrip('/')}/rest/v1/{SUPABASE_COMMENT_LOG_TABLE}",
            headers={
                'apikey': SUPABASE_KEY,
                'Authorization': f'Bearer {SUPABASE_KEY}',
            },
            params=params,
            timeout=30,
        )
        if resp.status_code not in (200, 206):
            return [], resp.text[:300]
        rows = resp.json()
        return (rows if isinstance(rows, list) else []), ''
    except Exception as e:
        return [], str(e)[:300]


def _normalise_imported_comment_log(raw: dict, staff_by_username: dict[str, dict]) -> dict:
    if not isinstance(raw, dict):
        return {}
    status = str(raw.get('status') or '').strip().lower()
    post_id = str(raw.get('post_id') or '').strip()
    created_at = _parse_log_time(str(raw.get('created_at') or ''))
    username = str(raw.get('staff_username') or '').strip().lower()
    matched_staff = staff_by_username.get(username) or {}
    staff_id = str(matched_staff.get('id') or raw.get('staff_id') or '').strip()
    if status not in {'success', 'failed', 'processed'} or not post_id or not staff_id or not created_at:
        return {}
    comment_text = str(raw.get('comment_text') or '').strip()
    if not comment_text:
        comment_text = '[Đã xử lý bài viết]' if status == 'processed' else '[Bình luận bằng ảnh]'
    return {
        'staff_id': staff_id[:160],
        'staff_name': str(matched_staff.get('name') or raw.get('staff_name') or '').strip()[:160],
        'staff_username': str(matched_staff.get('username') or username).strip()[:160],
        'facebook_user_id': str(raw.get('facebook_user_id') or '').strip()[:160],
        'post_id': post_id[:500],
        'group_id': str(raw.get('group_id') or '').strip()[:500],
        'post_url': str(raw.get('post_url') or '').strip()[:2000],
        'comment_text': comment_text[:10000],
        'comment_image_url': str(raw.get('comment_image_url') or '').strip()[:2000],
        'comment_id': str(raw.get('comment_id') or '').strip()[:500],
        'page_id': str(raw.get('page_id') or '').strip()[:500],
        'status': status,
        'error_message': str(raw.get('error_message') or '').strip()[:2000],
        'created_at': created_at.isoformat(timespec='seconds').replace('+00:00', 'Z'),
    }


def _today_utc_bounds() -> tuple[datetime, datetime]:
    tz = _app_timezone()
    today = datetime.now(tz).date()
    start_local = datetime.combine(today, time.min, tzinfo=tz)
    end_local = datetime.combine(today, time.max, tzinfo=tz)
    return start_local.astimezone(timezone.utc), end_local.astimezone(timezone.utc)


def _parse_log_time(value: str) -> datetime | None:
    if not value:
        return None
    try:
        return datetime.fromisoformat(value.replace('Z', '+00:00')).astimezone(timezone.utc)
    except Exception:
        return None


def _count_today_success_local(staff_id: str = '') -> int:
    start_utc, end_utc = _today_utc_bounds()
    count = 0
    for item in _comment_logs:
        if item.get('status') != 'success':
            continue
        if staff_id and item.get('staff_id') != staff_id:
            continue
        created_at = _parse_log_time(item.get('created_at', ''))
        if created_at and start_utc <= created_at <= end_utc:
            count += 1
    return count


def _count_today_success_supabase(staff_id: str = '') -> tuple[int | None, str]:
    if not SUPABASE_URL or not SUPABASE_KEY:
        return None, 'Chưa cấu hình Supabase'
    start_utc, end_utc = _today_utc_bounds()
    params = [
        ('select', 'id'),
        ('status', 'eq.success'),
        ('created_at', f'gte.{start_utc.isoformat()}'),
        ('created_at', f'lte.{end_utc.isoformat()}'),
    ]
    if staff_id:
        params.append(('staff_id', f'eq.{staff_id}'))
    try:
        resp = _req.get(
            f"{SUPABASE_URL.rstrip('/')}/rest/v1/{SUPABASE_COMMENT_LOG_TABLE}",
            headers={
                'apikey': SUPABASE_KEY,
                'Authorization': f'Bearer {SUPABASE_KEY}',
                'Prefer': 'count=exact',
                'Range': '0-0',
            },
            params=params,
            timeout=20,
        )
        if resp.status_code not in (200, 206):
            return None, resp.text[:300]
        content_range = resp.headers.get('content-range') or resp.headers.get('Content-Range') or ''
        if '/' in content_range:
            return int(content_range.rsplit('/', 1)[-1]), ''
        return len(resp.json()), ''
    except Exception as e:
        return None, str(e)[:300]


def _current_staff_ai_key() -> str:
    staff = _current_staff()
    staff_id = str(staff.get('id') or '').strip()
    username = str(staff.get('username') or '').strip().lower()
    if staff_id:
        return f'staff:{staff_id}'
    if username:
        return f'user:{username}'
    return ''


def _current_staff_display_name() -> str:
    staff = _current_staff()
    return str(staff.get('name') or staff.get('username') or '').strip()


def _merge_ai_config(base: dict, row: dict | None = None) -> dict:
    defaults = _default_ai_config()
    cfg = {**defaults, **(base or {})}
    cfg['keys'] = {**defaults.get('keys', {}), **((base or {}).get('keys') or {})}
    if not row:
        return cfg
    provider = str(row.get('provider') or cfg.get('provider') or 'gemini').strip().lower()
    if provider not in PROVIDERS:
        provider = 'gemini'
    cfg['provider'] = provider
    default_model = PROVIDERS.get(provider, {}).get('default_model', DEFAULT_MODEL)
    cfg['model'] = str(row.get('model') or cfg.get('model') or default_model).strip() or default_model
    raw_keys = row.get('api_keys') if isinstance(row.get('api_keys'), dict) else {}
    cfg['keys'] = {**cfg.get('keys', {}), **{str(k): str(v or '') for k, v in raw_keys.items() if v}}
    active_key = str(row.get('api_key') or '').strip()
    if active_key:
        cfg['keys'][provider] = active_key
    cfg['customer_name'] = str(row.get('customer_name') or cfg.get('customer_name') or '').strip()
    return cfg


def _load_customer_ai_row() -> tuple[dict | None, str]:
    staff_key = _current_staff_ai_key()
    if not USE_SUPABASE or not staff_key:
        return None, ''
    try:
        return sb.get_customer_ai_settings(staff_key, SUPABASE_CUSTOMER_AI_TABLE), ''
    except Exception as e:
        return None, str(e)[:300]


def _effective_ai_config() -> tuple[dict, str, str]:
    row, warning = _load_customer_ai_row()
    cfg = _merge_ai_config(_ai_config, row)
    if not cfg.get('customer_name'):
        cfg['customer_name'] = _current_staff_display_name()
    if row:
        return cfg, 'supabase', warning
    return cfg, 'global', warning


def _save_customer_ai_config(body: dict) -> tuple[str, str]:
    global _ai_config
    provider = str(body.get('provider') or _ai_config.get('provider') or 'gemini').strip().lower()
    if provider not in PROVIDERS:
        provider = 'gemini'
    default_model = PROVIDERS.get(provider, {}).get('default_model', DEFAULT_MODEL)
    model = str(body.get('model') or default_model).strip() or default_model
    customer_name = str(body.get('customer_name') or _current_staff_display_name()).strip()

    cfg, _, _ = _effective_ai_config()
    keys = dict(cfg.get('keys') or {})
    if 'key' in body:
        key = str(body.get('key') or '').strip()
        if key:
            keys[provider] = key

    staff_key = _current_staff_ai_key()
    if USE_SUPABASE and staff_key:
        staff = _current_staff()
        try:
            sb.upsert_customer_ai_settings({
                'staff_key': staff_key,
                'staff_id': str(staff.get('id') or ''),
                'username': str(staff.get('username') or ''),
                'customer_name': customer_name,
                'provider': provider,
                'model': model,
                'api_key': keys.get(provider, ''),
                'api_keys': keys,
            }, SUPABASE_CUSTOMER_AI_TABLE)
            return 'supabase', ''
        except Exception as e:
            warning = f'{str(e)[:300]} ({_supabase_debug_context(SUPABASE_CUSTOMER_AI_TABLE)})'
        _ai_config['provider'] = provider
        _ai_config['model'] = model
        _ai_config.setdefault('keys', {}).update(keys)
        _save_ai_config()
        return 'global', warning

    _ai_config['provider'] = provider
    _ai_config['model'] = model
    _ai_config.setdefault('keys', {}).update(keys)
    _ai_config['customer_name'] = customer_name
    _save_ai_config()
    return 'global', ''


def _get_ai_key(provider: str) -> str:
    cfg, _, _ = _effective_ai_config()
    return _get_ai_key_from_config(provider, cfg)


def _get_ai_key_from_config(provider: str, config: dict) -> str:
    stored_key = (config.get('keys') or {}).get(provider, '')
    env_keys = {
        'gemini': 'GEMINI_API_KEY',
        'openai': 'OPENAI_API_KEY',
        'groq': 'GROQ_API_KEY',
        'claude': 'CLAUDE_API_KEY',
    }
    fallback_key = DEFAULT_API_KEY if provider == 'gemini' else ''
    return stored_key or os.environ.get(env_keys.get(provider, ''), '') or fallback_key


def _get_classifier() -> AIClassifier:
    cfg, _, _ = _effective_ai_config()
    provider = cfg.get('provider', 'gemini')
    default_model = PROVIDERS.get(provider, {}).get('default_model', DEFAULT_MODEL)
    model = cfg.get('model', default_model) or default_model
    api_key = _get_ai_key_from_config(provider, cfg)
    categories = cfg.get('categories', DEFAULT_CATEGORIES)
    return AIClassifier(provider, model, api_key, categories)


def get_api(group_id: str) -> FacebookGroupAPI:
    active_staff = _active_staff()
    staff_id = str(active_staff.get('id') or '')
    session_cookie_id = session.get('active_cookie_id') if has_request_context() else ''
    active_cookie_id = str(session_cookie_id or active_staff.get('active_cookie_id') or '')
    active_cookie = _primary_staff_cookie(active_staff)
    cache_key = f'{staff_id or "default"}:{active_cookie_id}:{group_id}'
    if cache_key not in _api_cache:
        token_file = _staff_token_file(staff_id, cookie_id=active_cookie_id, cookie=active_cookie) if staff_id else None
        _api_cache[cache_key] = FacebookGroupAPI(group_id, cookie=active_cookie, token_file=token_file)
    return _api_cache[cache_key]


@app.before_request
def _require_auth_for_api():
    if request.method == 'OPTIONS':
        return None
    if request.method == 'GET' and request.path.rstrip('/') == '/api/groups/resolve':
        return None
    public_endpoints = {'auth_status', 'auth_login', 'auth_setup', 'api_resolve_group', 'api_health'}
    if request.path.startswith('/api/') and request.endpoint not in public_endpoints:
        if _setup_required():
            return jsonify({'ok': False, 'error': 'Cần setup tài khoản đầu tiên', 'setup_required': True}), 401
        if not _current_staff():
            return jsonify({'ok': False, 'error': 'Vui lòng đăng nhập', 'auth_required': True}), 401


# ── Telegram ───────────────────────────────────────────
def _tg_send(chat_id: str, text: str):
    if not BOT_TOKEN:
        return
    try:
        _req.post(
            f'https://api.telegram.org/bot{BOT_TOKEN}/sendMessage',
            json={'chat_id': chat_id, 'text': text, 'parse_mode': 'Markdown',
                  'disable_web_page_preview': False},
            timeout=10,
        )
    except Exception:
        pass


def _notify_new_post(post: dict):
    if not _tg_chat_ids:
        return
    author = (post.get('from') or {}).get('name', 'Ẩn danh')
    text = post.get('message', '') or ''
    preview = text[:300] + ('...' if len(text) > 300 else '')
    msg = (
        f"🔔 *Bài mới trong nhóm* `{post.get('_group_id', '')}`\n\n"
        f"👤 *{author}*\n{preview}\n\n"
        f"[🔗 Xem bài viết]({post.get('permalink_url', '')})"
    )
    for cid in _tg_chat_ids:
        _tg_send(cid, msg)


def _poll_telegram():
    if not BOT_TOKEN:
        return
    offset = 0
    while True:
        try:
            r = _req.get(
                f'https://api.telegram.org/bot{BOT_TOKEN}/getUpdates',
                params={'offset': offset, 'timeout': 30},
                timeout=35,
            )
            for upd in r.json().get('result', []):
                offset = upd['update_id'] + 1
                msg = upd.get('message', {})
                if msg.get('text', '').startswith('/start'):
                    cid = str(msg['chat']['id'])
                    name = msg['from'].get('first_name', '')
                    _tg_send(cid,
                        f"👋 Xin chào {name}\\!\n\n"
                        f"Chat ID của bạn là:\n`{cid}`\n\n"
                        f"Copy ID này rồi vào web thêm vào mục *Telegram* để nhận thông báo\\."
                    )
        except Exception:
            pass


# ── Routes ─────────────────────────────────────────────
@app.route('/')
def index():
    if USE_LEGACY_UI:
        return render_template('index.html')
    from flask import redirect
    return redirect(WEB_UI_URL)


@app.route('/api/health')
def api_health():
    return jsonify({
        'ok': True,
        'features': {
            'staff_cookie_optional': True,
            'groups_resolve_public': True,
            'staff_list_refresh_v2': True,
            'channel_db_row_v3': True,
        },
    })


@app.route('/api/auth/status')
def auth_status():
    staff = _public_current_staff()
    return jsonify({
        'ok': True,
        'authenticated': bool(staff),
        'setup_required': _setup_required(),
        'simple_login': SIMPLE_LOGIN_ONLY,
        'staff': staff,
    })


@app.route('/api/auth/setup', methods=['POST'])
def auth_setup():
    global _staff_cookies
    body = request.get_json() or {}
    name = str(body.get('name') or '').strip()[:80]
    username = str(body.get('username') or '').strip().lower()[:60]
    password = str(body.get('password') or '')
    cookie = str(body.get('cookie') or '').strip()
    if not _setup_required():
        existing = next((item for item in _staff_accounts()
                         if item.get('enabled', True) and item.get('username') == username), None)
        if existing and _verify_password(password, existing.get('password_salt', ''), existing.get('password_hash', '')):
            _set_logged_in_staff(existing)
            _invalidate_facebook_cache()
            return jsonify({'ok': True, 'already_setup': True, 'staff': _public_current_staff()})
        return jsonify({
            'ok': False,
            'already_setup': True,
            'setup_required': False,
            'error': 'Hệ thống đã có admin. Vui lòng đăng nhập bằng tài khoản đã tạo.',
        }), 409
    if not name or not username or not password:
        return jsonify({'ok': False, 'error': 'Nhập đủ tên, tài khoản và mật khẩu'}), 400
    if len(password) < 6:
        return jsonify({'ok': False, 'error': 'Mật khẩu tối thiểu 6 ký tự'}), 400
    if cookie and 'c_user=' not in cookie:
        return jsonify({'ok': False, 'error': 'Cookie chưa có c_user, vui lòng kiểm tra lại'}), 400

    salt, digest = _hash_password(password)
    now = datetime.utcnow().isoformat(timespec='seconds') + 'Z'
    staff_id = uuid.uuid4().hex[:12]
    _staff_cookies = {
        'active_staff_id': staff_id,
        'staff': [{
            'id': staff_id,
            'name': name,
            'username': username,
            'password_salt': salt,
            'password_hash': digest,
            'cookie': cookie,
            'role': 'admin',
            'enabled': True,
            'created_at': now,
            'updated_at': now,
        }]
    }
    _save_staff_cookies()
    _set_logged_in_staff(_staff_cookies['staff'][0])
    _invalidate_facebook_cache()
    return jsonify({'ok': True, 'staff': _public_current_staff()})


@app.route('/api/auth/login', methods=['POST'])
def auth_login():
    body = request.get_json() or {}
    username = str(body.get('username') or '').strip().lower()
    password = str(body.get('password') or '')
    if not username or not password:
        return jsonify({'ok': False, 'error': 'Nhập tài khoản và mật khẩu'}), 400

    staff = _find_local_staff(username)
    if staff and _verify_password(password, staff.get('password_salt', ''), staff.get('password_hash', '')):
        _set_logged_in_staff(staff)
        _invalidate_facebook_cache()
        return jsonify({'ok': True, 'staff': _public_current_staff()})

    row, supabase_error = _load_supabase_staff(username)
    if row:
        supabase_staff = _normalize_supabase_staff(row)
        if not supabase_staff.get('enabled', True):
            return jsonify({'ok': False, 'error': 'Tài khoản đã bị tắt'}), 403
        if _supabase_password_matches(row, password):
            _set_logged_in_staff(supabase_staff)
            _invalidate_facebook_cache()
            return jsonify({'ok': True, 'staff': _public_current_staff()})
        return jsonify({'ok': False, 'error': 'Sai tài khoản hoặc mật khẩu'}), 401

    if supabase_error and 'Could not find the table' in supabase_error:
        return jsonify({
            'ok': False,
            'error': f'Chưa có bảng {SUPABASE_STAFF_TABLE} trong Supabase. Chạy lại file SQL rồi thêm user/pass.',
        }), 500
    if supabase_error and 'Could not find the' in supabase_error:
        return jsonify({'ok': False, 'error': f'Lỗi bảng đăng nhập Supabase: {supabase_error}'}), 500

    return jsonify({'ok': False, 'error': 'Sai tài khoản hoặc mật khẩu'}), 401


@app.route('/api/auth/logout', methods=['POST'])
def auth_logout():
    _clear_logged_in_staff()
    _invalidate_facebook_cache()
    return jsonify({'ok': True})


def _group_display_name(gid: str) -> str:
    return next((g.get('name') for g in _merged_facebook_groups() if g.get('id') == gid), gid)


def _fetch_group_feed(gid: str, limit: int):
    api = get_api(gid)
    posts = api.get_posts(limit)
    name = _group_display_name(gid)
    if posts is None:
        return [], {
            'group_id': gid,
            'group_name': name,
            'target_type': 'group',
            'target_id': gid,
            'ok': False,
            'count': 0,
            'source': 'facebook_graph',
            'error': api.last_graph_error or 'Cookie hết hạn, chưa vào nhóm, hoặc Facebook không cho đọc feed nhóm này',
        }
    for p in posts:
        p['_group_id'] = gid
        p['_source'] = 'facebook_graph'
    return posts, {
        'group_id': gid,
        'target_type': 'group',
        'target_id': gid,
        'group_name': name,
        'ok': True,
        'count': len(posts or []),
        'source': 'facebook_graph',
        'error': '',
    }


def _fetch_page_feed(page_id: str, limit: int):
    page_name = next((item.get('channel_name') for item in _managed_channels if str(item.get('target_id') or '') == page_id), '')
    try:
        page_token = _page_token_from_cache(page_id)
        posts = get_api(DEFAULT_GROUP).get_page_posts(page_id, page_token, limit)
    except Exception:
        posts = None
    display = page_name or (_pages_cache.get(page_id) or {}).get('name') or page_id
    if posts is None:
        return [], {
            'group_id': page_id,
            'target_type': 'page',
            'target_id': page_id,
            'group_name': display,
            'ok': False,
            'count': 0,
            'source': 'facebook_page_graph',
            'error': 'Không đọc được bài từ Page. Kiểm tra ID Page, cookie và quyền quản trị/Page public.',
        }
    for p in posts:
        p['_page_id'] = page_id
        p['_page_name'] = display
        p['_source'] = 'facebook_page_graph'
    return posts, {
        'group_id': page_id,
        'target_type': 'page',
        'target_id': page_id,
        'group_name': display,
        'ok': True,
        'count': len(posts or []),
        'source': 'facebook_page_graph',
        'error': '',
    }


@app.route('/api/posts')
def api_posts():
    global _seen_ids
    limit = request.args.get('limit', 10, type=int)
    group_ids = [g.strip() for g in request.args.get('groups', DEFAULT_GROUP).split(',') if g.strip()]
    group_ids = _filter_group_ids_for_staff(group_ids)
    page_ids = [p.strip() for p in request.args.get('pages', '').split(',') if p.strip()]
    debug = request.args.get('debug', '').lower() in ('1', 'true', 'yes')
    is_first = len(_seen_ids) == 0

    try:
        all_posts = []
        report = []
        skipped_processed = 0
        targets = [( 'group', gid) for gid in group_ids] + [('page', pid) for pid in page_ids]
        if targets:
            workers = min(8, len(targets))
            with ThreadPoolExecutor(max_workers=workers) as pool:
                futures = []
                for kind, target_id in targets:
                    fn = _fetch_group_feed if kind == 'group' else _fetch_page_feed
                    futures.append(pool.submit(copy_current_request_context(fn), target_id, limit))
                for future in as_completed(futures):
                    posts, item = future.result()
                    all_posts.extend(posts)
                    report.append(item)

        if (group_ids or page_ids) and not all_posts and any(not item.get('ok') for item in report):
            failed_errors = [
                f"{item.get('group_name') or item.get('target_id') or 'Nguồn'}: {item.get('error')}"
                for item in report
                if not item.get('ok') and item.get('error')
            ]
            detail = failed_errors[0] if failed_errors else ''
            payload = {
                'ok': False,
                'error': (
                    'Không lấy được bài từ Facebook. Kiểm tra cookie nhân sự, quyền nhóm/Page và quyền quản trị Page.'
                    + (f' Chi tiết: {detail}' if detail else '')
                ),
                'posts': [],
                'report': report,
                'source': 'facebook_graph',
            }
            return jsonify(payload), 200

        all_posts.sort(key=lambda x: x.get('created_time', ''), reverse=True)

        staff_id = _current_staff_id()
        all_posts, skipped_processed = _filter_posts_for_staff(all_posts, staff_id)

        new_ids = set()
        new_posts = []
        for post in all_posts:
            pid = post.get('id')
            if pid and pid not in _seen_ids:
                new_ids.add(pid)
                new_posts.append(post)
                if not is_first:
                    threading.Thread(target=_notify_new_post, args=(post,), daemon=True).start()

        if new_ids:
            _seen_ids.update(new_ids)
            _save_seen(new_posts)

        if debug:
            return jsonify({
                'ok': True,
                'source': 'facebook_graph',
                'posts': all_posts,
                'report': report,
                'total_posts': len(all_posts),
                'skipped_processed': skipped_processed,
            })
        return jsonify(all_posts)
    except Exception as e:
        return jsonify({
            'ok': False,
            'error': friendly_graph_error(e),
            'posts': [],
            'report': [],
            'source': 'facebook_graph',
        }), 200


@app.route('/api/post', methods=['POST'])
def api_create_post():
    body = request.get_json() or {}
    group_id = body.get('group_id', '').strip()
    message = body.get('message', '').strip()
    page_id = body.get('page_id', '').strip()
    media_url, native_video_url = _extract_post_media(body)
    media_urls = _extract_media_urls(body)
    if not group_id or (not message and not media_urls):
        return jsonify({'ok': False, 'error': 'Thiếu group_id hoặc nội dung/ảnh/video'}), 400
    try:
        page_token = _pages_cache.get(page_id, {}).get('access_token') if page_id else None
        result = get_api(group_id).create_post(
            message,
            page_token,
            '' if media_urls else media_url,
            '' if media_urls else native_video_url,
            media_urls=media_urls,
        )
        delivery = (result or {}).get('_delivery') or ('native_video' if native_video_url else ('link_preview' if media_url else ('native_media' if media_urls else 'text')))
        if result and 'id' in result:
            return jsonify({
                'ok': True,
                'post_id': result['id'],
                'delivery': delivery,
                'media_count': len(media_urls),
                'native_video_error': (result or {}).get('_native_video_error'),
                'target': {'type': 'group', 'id': group_id},
            })
        err = (result or {}).get('error', {}).get('message', 'Lỗi không xác định')
        return jsonify({'ok': False, 'error': err, 'delivery': delivery, 'native_video_error': (result or {}).get('_native_video_error'), 'target': {'type': 'group', 'id': group_id}})
    except Exception as e:
        return jsonify({'ok': False, 'error': str(e), 'target': {'type': 'group', 'id': group_id}}), 500


@app.route('/api/publish', methods=['POST'])
def api_publish_targets():
    body = request.get_json(silent=True) or {}
    raw_targets = body.get('targets') or []
    message = str(body.get('message') or body.get('content') or '').strip()
    media_url, native_video_url = _extract_post_media(body)
    media_urls = _extract_media_urls(body)
    if not message:
        return jsonify({'ok': False, 'error': 'Thiếu nội dung bài đăng'}), 400
    if not isinstance(raw_targets, list) or not raw_targets:
        return jsonify({'ok': False, 'error': 'Chọn ít nhất một Page hoặc nhóm để đăng'}), 400

    targets = []
    for item in raw_targets:
        if not isinstance(item, dict):
            continue
        target_type = str(item.get('type') or 'group').strip().lower() or 'group'
        target_id = str(item.get('id') or item.get('group_id') or item.get('page_id') or '').strip()
        if not target_id:
            continue
        targets.append({
            'type': 'page' if target_type == 'page' else 'group',
            'id': target_id,
            'name': str(item.get('name') or '').strip(),
            'page_id': str(item.get('page_id') or '').strip(),
        })

    if not targets:
        return jsonify({'ok': False, 'error': 'Danh sách target không hợp lệ'}), 400

    dry_run = bool(body.get('dry_run') or body.get('dryRun'))
    result = _publish_content_pipeline_post({
        'content': message,
        'hashtags': '',
        'media_url': '' if media_urls else media_url,
        'native_video_url': '' if media_urls else native_video_url,
        'media_urls': media_urls,
    }, targets, dry_run=dry_run)
    return jsonify(result), (200 if result.get('ok') else 502)


@app.route('/api/page-post', methods=['POST'])
def api_create_page_post():
    body = request.get_json() or {}
    page_id = str(body.get('page_id') or '').strip()
    message = str(body.get('message') or '').strip()
    media_url, native_video_url = _extract_post_media(body)
    media_urls = _extract_media_urls(body)
    if not page_id or (not message and not media_urls):
        return jsonify({'ok': False, 'error': 'Thiếu page_id hoặc nội dung/ảnh/video'}), 400
    try:
        page_token = _page_token_from_cache(page_id)
        if not page_token:
            return jsonify({'ok': False, 'error': 'Không lấy được Page token. Kiểm tra quyền quản trị Page/cookie.'}), 400
        result = get_api(DEFAULT_GROUP).create_page_post(
            page_id,
            message,
            page_token,
            '' if media_urls else media_url,
            '' if media_urls else native_video_url,
            media_urls=media_urls,
        )
        delivery = (result or {}).get('_delivery') or ('native_video' if native_video_url else ('link_preview' if media_url else ('native_media' if media_urls else 'text')))
        if result and result.get('id'):
            return jsonify({
                'ok': True,
                'post_id': result['id'],
                'delivery': delivery,
                'media_count': len(media_urls),
                'native_video_error': (result or {}).get('_native_video_error'),
                'target': {'type': 'page', 'id': page_id},
            })
        err = (result or {}).get('error', {}).get('message', 'Lỗi không xác định')
        return jsonify({'ok': False, 'error': err, 'delivery': delivery, 'native_video_error': (result or {}).get('_native_video_error'), 'target': {'type': 'page', 'id': page_id}})
    except Exception as e:
        return jsonify({'ok': False, 'error': str(e), 'target': {'type': 'page', 'id': page_id}}), 500


@app.route('/api/pages')
def api_pages():
    try:
        pages, warning, source = _load_facebook_pages_for_active_cookie()
        rows = [{'id': p.get('id'), 'name': p.get('name')} for p in pages if p.get('id')]
        if request.args.get('format') == 'object':
            payload = {'ok': True, 'pages': rows, 'source': source}
            if warning:
                payload['warning'] = warning
            return jsonify(payload)
        return jsonify(rows)
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/api/uploads/comment-image', methods=['POST'])
def upload_comment_image():
    file_storage = request.files.get('image')
    image_url, error = _upload_comment_image_to_supabase(file_storage)
    if not image_url:
        return jsonify({'ok': False, 'error': error or 'Upload ảnh thất bại'}), 400
    return jsonify({'ok': True, 'image_url': image_url})


@app.route('/api/uploads/post-media', methods=['POST'])
def upload_post_media():
    files = (
        request.files.getlist('media')
        or request.files.getlist('files')
        or request.files.getlist('image')
        or request.files.getlist('file')
    )
    files = [f for f in files if f and f.filename]
    if not files:
        return jsonify({'ok': False, 'error': 'Chưa chọn file ảnh/video'}), 400

    uploaded = []
    for file_storage in files:
        media_url, content_type, error = _upload_post_media_to_supabase(file_storage)
        if not media_url:
            return jsonify({'ok': False, 'error': error or 'Upload ảnh/video thất bại'}), 400
        uploaded.append({
            'url': media_url,
            'type': 'video' if content_type.startswith('video/') else 'image',
            'content_type': content_type,
            'name': secure_filename(file_storage.filename or 'post-media'),
        })
    media_urls = [item['url'] for item in uploaded]
    return jsonify({
        'ok': True,
        'media': uploaded,
        'media_urls': media_urls,
        'image_urls': [item['url'] for item in uploaded if item['type'] == 'image'],
        'image_url': media_urls[0] if len(media_urls) == 1 else '',
    })


@app.route('/api/scripts/generate-image', methods=['POST'])
def scripts_generate_image():
    body = request.get_json(silent=True) or {}
    prompt = str(body.get('prompt') or '').strip()
    title = str(body.get('title') or 'script-image').strip()[:120] or 'script-image'
    model = str(body.get('model') or '').strip()
    size = str(body.get('size') or '1024x1024').strip()
    if not prompt:
        return jsonify({'ok': False, 'error': 'Thiếu prompt ảnh'}), 400
    try:
        image_bytes, used_model = _generate_openai_image_bytes(prompt, model=model, size=size)
        filename_base = re.sub(r'[^0-9a-zA-Z_-]+', '-', title).strip('-')[:80] or 'script-image'
        image_url, content_type, upload_error = _upload_post_media_bytes_to_supabase(
            image_bytes,
            f'{filename_base}.png',
            'image/png',
        )
        if not image_url:
            return jsonify({
                'ok': False,
                'error': f'Đã tạo ảnh nhưng chưa upload được Supabase Storage: {upload_error}',
                'model': used_model,
            }), 502
        return jsonify({
            'ok': True,
            'image_url': image_url,
            'media_url': image_url,
            'content_type': content_type,
            'prompt': prompt,
            'model': used_model,
            'storage': 'supabase',
        })
    except Exception as e:
        return jsonify({'ok': False, 'error': str(e)[:500]}), 502


@app.route('/api/comment', methods=['POST'])
def api_comment():
    body = request.get_json() or {}
    post_id = body.get('post_id', '').strip()
    message = body.get('message', '').strip()
    group_id = body.get('group_id', DEFAULT_GROUP)
    page_id = body.get('page_id', '').strip()
    post_url = body.get('post_url', '').strip()
    image_url = body.get('image_url', '').strip()
    if not post_id or (not message and not image_url):
        return jsonify({'ok': False, 'error': 'Thiếu post_id hoặc nội dung/ảnh bình luận'}), 400
    try:
        page_token = _page_token_from_cache(page_id) if page_id else None
        result = get_api(group_id).post_comment(post_id, message, page_token, image_url)
        if result and 'id' in result:
            log_text = message or '[Bình luận bằng ảnh]'
            log = _record_comment_log(
                post_id,
                group_id,
                post_url,
                log_text,
                page_id,
                'success',
                comment_id=result['id'],
                image_url=image_url,
                lead_context={
                    'platform': 'facebook',
                    'customer_name': body.get('customer_name') or body.get('author_name'),
                    'customer_need': body.get('customer_need') or body.get('post_message'),
                },
            )
            payload = {'ok': True, 'comment_id': result['id'], 'log_storage': log.get('storage')}
            if log.get('storage_warning'):
                payload['warning'] = f"Đã lưu local, Supabase chưa ghi được: {log['storage_warning']}"
            return jsonify(payload)
        err = (result or {}).get('error', {}).get('message', 'Lỗi không xác định')
        log = _record_comment_log(post_id, group_id, post_url, message or '[Bình luận bằng ảnh]', page_id, 'failed', error_message=err, image_url=image_url)
        payload = {'ok': False, 'error': err, 'log_storage': log.get('storage')}
        if log.get('storage_warning'):
            payload['warning'] = f"Đã lưu local, Supabase chưa ghi được: {log['storage_warning']}"
        return jsonify(payload)
    except Exception as e:
        err = str(e)
        log = _record_comment_log(post_id, group_id, post_url, message or '[Bình luận bằng ảnh]', page_id, 'failed', error_message=err, image_url=image_url)
        payload = {'ok': False, 'error': err, 'log_storage': log.get('storage')}
        if log.get('storage_warning'):
            payload['warning'] = f"Đã lưu local, Supabase chưa ghi được: {log['storage_warning']}"
        return jsonify(payload), 500


@app.route('/api/post-comments/reply', methods=['POST'])
def api_reply_post_comment():
    body = request.get_json() or {}
    comment_id = str(body.get('comment_id') or '').strip()
    post_id = str(body.get('post_id') or '').strip()
    message = str(body.get('message') or body.get('text') or '').strip()
    group_id = str(body.get('group_id') or DEFAULT_GROUP).strip()
    post_url = str(body.get('post_url') or body.get('comment_url') or '').strip()
    source = str(body.get('source') or '').strip().lower()
    page_id = str(body.get('page_id') or '').strip()
    if not page_id and ('page' in source):
        page_id = group_id

    if not comment_id:
        return jsonify({'ok': False, 'error': 'Thiếu comment_id để trả lời'}), 400
    if not message:
        return jsonify({'ok': False, 'error': 'Nhập nội dung trả lời'}), 400
    if comment_id.startswith('tiktok_') or 'tiktok' in source:
        return jsonify({
            'ok': False,
            'error': 'TikTok chưa hỗ trợ reply đúng vào từng comment qua server. Hãy dùng nút gửi TikTok bằng extension hoặc mở link để trả lời trực tiếp.',
        }), 400
    if 'instagram' in source or source == 'ig':
        return jsonify({'ok': False, 'error': 'Instagram chưa hỗ trợ trả lời comment trong bản này'}), 400

    try:
        page_token = _page_token_from_cache(page_id) if page_id else None
        api_group_id = DEFAULT_GROUP if page_token else (group_id or DEFAULT_GROUP)
        result = get_api(api_group_id).post_comment(comment_id, message, page_token)
        if result and result.get('id'):
            log = _record_comment_log(
                post_id or comment_id,
                group_id,
                post_url,
                message,
                page_id,
                'success',
                comment_id=result['id'],
                lead_context={
                    'platform': 'facebook',
                    'customer_name': body.get('customer_name') or body.get('author_name'),
                    'customer_need': body.get('customer_need') or body.get('post_message') or body.get('comment_text'),
                },
            )
            now = datetime.utcnow().isoformat(timespec='seconds') + 'Z'
            staff = _current_staff()
            row = {
                'source': 'facebook_page' if page_token or 'page' in source else 'facebook',
                'post_id': post_id or comment_id,
                'group_id': group_id,
                'post_url': post_url,
                'comment_id': str(result['id']),
                'parent_comment_id': comment_id,
                'depth': int(body.get('depth') or 0) + 1,
                'author_id': staff.get('id', ''),
                'author_name': staff.get('name') or staff.get('username') or 'Nhân sự',
                'message': message,
                'attachment_type': '',
                'created_time': now,
                'matched_keywords': [],
                'is_matched': False,
                'raw_comment': {'outbound_reply': True, 'reply_to_comment_id': comment_id, 'publish_response': result},
                'fetched_by_staff_id': staff.get('id', ''),
                'fetched_by_staff_name': staff.get('name', ''),
                'fetched_by_staff_username': staff.get('username', ''),
                'fetched_at': now,
            }
            storage, storage_warning = _store_post_comment_rows([row])
            payload = {
                'ok': True,
                'comment_id': result['id'],
                'storage': storage,
                'log_storage': log.get('storage'),
            }
            warnings = []
            if storage_warning:
                warnings.append(f'Reply đã gửi, nhưng Supabase post_comments chưa ghi được: {storage_warning}')
            if log.get('storage_warning'):
                warnings.append(f"Lịch sử comment đã lưu local, Supabase chưa ghi được: {log['storage_warning']}")
            if warnings:
                payload['warning'] = ' | '.join(warnings)
            return jsonify(payload)

        err = (result or {}).get('error', {}).get('message') or 'Facebook không nhận trả lời comment'
        log = _record_comment_log(post_id or comment_id, group_id, post_url, message, page_id, 'failed', error_message=err)
        payload = {'ok': False, 'error': err, 'log_storage': log.get('storage')}
        if log.get('storage_warning'):
            payload['warning'] = f"Đã lưu local, Supabase chưa ghi được: {log['storage_warning']}"
        return jsonify(payload), 502
    except Exception as e:
        err = str(e)
        log = _record_comment_log(post_id or comment_id, group_id, post_url, message, page_id, 'failed', error_message=err)
        payload = {'ok': False, 'error': err, 'log_storage': log.get('storage')}
        if log.get('storage_warning'):
            payload['warning'] = f"Đã lưu local, Supabase chưa ghi được: {log['storage_warning']}"
        return jsonify(payload), 500


def _upsert_lead_from_processed_post(body: dict, staff: dict) -> tuple[dict, str]:
    post_id = str(body.get('post_id') or '').strip()
    group_id = str(body.get('group_id') or body.get('_group_id') or '').strip()
    post_url = str(body.get('post_url') or body.get('permalink_url') or '').strip()
    message = str(body.get('message') or body.get('post_message') or '').strip()
    preview = message[:240]
    comment_text = preview or 'Đã đánh dấu xử lý — không cần quét lại'
    author_name = str(body.get('author_name') or body.get('from_name') or '').strip()
    phones = extract_phones(message)
    phone = phones[0] if phones else ''
    now = datetime.utcnow().isoformat(timespec='seconds') + 'Z'
    processor = str(staff.get('name') or staff.get('username') or 'Nhân sự').strip()
    staff_id = str(staff.get('id') or '')
    crm_status = str(body.get('crm_status') or 'Lead mới').strip() or 'Lead mới'
    assigned_sale = str(body.get('assigned_sale') or body.get('sale_owner') or '').strip()
    lead = _normalise_lead({
        'platform': 'facebook',
        'source': 'processed_post',
        'post_id': post_id,
        'group_id': group_id,
        'post_url': post_url,
        'name': author_name or 'Ẩn danh',
        'need': message[:500] or comment_text,
        'evidence': message[:300] or comment_text,
        'phone': phone,
        'phones': phones,
        'processed_at': now,
        'processed_by': processor,
        'processed_by_staff_id': staff_id,
        'crm_status': crm_status,
        'assigned_sale': assigned_sale,
        'created_at': now,
    }, post_id)
    _merge_leads_into_memory([lead])
    supabase_ok, supabase_error = _save_leads_to_supabase([lead])
    warning = ''
    if not supabase_ok and supabase_error:
        warning = f'Đã lưu lead local, Supabase chưa ghi được: {supabase_error}'
    return lead, warning


@app.route('/api/leads/save-processed', methods=['POST'])
def api_leads_save_processed():
    try:
        body = request.get_json() or {}
        post_id = str(body.get('post_id') or '').strip()
        if not post_id:
            return jsonify({'ok': False, 'error': 'Thiếu ID bài viết'}), 400
        staff = _current_staff()
        if not staff:
            return jsonify({'ok': False, 'error': 'Chưa đăng nhập'}), 401
        lead, warning = _upsert_lead_from_processed_post(body, staff)
        payload = {'ok': True, 'post_id': post_id, 'lead': lead}
        if warning:
            payload['warning'] = warning
        return jsonify(payload)
    except Exception as e:
        return jsonify({'ok': False, 'error': f'Lỗi lưu lead: {e}'}), 500


@app.route('/api/posts/mark-processed', methods=['POST'])
def api_mark_post_processed():
    try:
        body = request.get_json() or {}
        post_id = str(body.get('post_id') or '').strip()
        if not post_id:
            return jsonify({'ok': False, 'error': 'Thiếu ID bài viết'}), 400
        staff = _current_staff()
        if not staff:
            return jsonify({'ok': False, 'error': 'Chưa đăng nhập'}), 401

        staff_id = str(staff.get('id') or '')
        already_logged = post_id in _staff_processed_post_ids(staff_id)

        group_id = str(body.get('group_id') or body.get('_group_id') or '').strip()
        post_url = str(body.get('post_url') or body.get('permalink_url') or '').strip()
        preview = str(body.get('message') or body.get('post_message') or '').strip()[:240]
        comment_text = preview or 'Đã đánh dấu xử lý — không cần quét lại'
        log = {}
        if not already_logged:
            log = _record_comment_log(
                post_id,
                group_id,
                post_url,
                comment_text,
                '',
                'processed',
            )

        lead, lead_warning = _upsert_lead_from_processed_post(body, staff)

        payload = {'ok': True, 'post_id': post_id, 'log': log, 'lead': lead, 'already': already_logged}
        if lead_warning:
            payload['warning'] = lead_warning
        elif log.get('storage_warning'):
            payload['warning'] = log['storage_warning']
        return jsonify(payload)
    except Exception as e:
        return jsonify({'ok': False, 'error': f'Lỗi lưu lead: {e}'}), 500


@app.route('/api/comment-logs', methods=['GET'])
def comment_logs_get():
    global _comment_logs
    is_admin = _is_admin()
    staff_id = '' if is_admin else _current_staff_id()
    if not is_admin and not staff_id:
        return jsonify([]), 401

    remote_rows, warning = _load_comment_logs_from_supabase(staff_id)
    if remote_rows:
        _comment_logs = _merge_comment_log_rows(_comment_logs, remote_rows, limit=5000)
    if warning:
        print(f'[comment_logs] Supabase read failed, using local history: {warning}')
    scoped_rows = _comment_logs if is_admin else [
        item for item in _comment_logs
        if str(item.get('staff_id') or '').strip() == staff_id
    ]
    return jsonify(_merge_comment_log_rows(scoped_rows, [], limit=200))


@app.route('/api/comment-logs/import', methods=['POST'])
def comment_logs_import():
    global _comment_logs
    if not _is_admin():
        return jsonify({'ok': False, 'error': 'Chỉ admin được nhập lịch sử'}), 403
    body = request.get_json(silent=True) or {}
    source_rows = body.get('rows') or []
    if not isinstance(source_rows, list) or not source_rows:
        return jsonify({'ok': False, 'error': 'Không có lịch sử để nhập'}), 400
    if len(source_rows) > 1000:
        return jsonify({'ok': False, 'error': 'Tối đa 1000 dòng mỗi lần nhập'}), 400

    remote_rows, warning = _load_comment_logs_from_supabase('', limit=5000)
    if warning:
        return jsonify({'ok': False, 'error': f'Không đọc được lịch sử Supabase đích: {warning}'}), 502
    staff_by_username = {
        str(item.get('username') or '').strip().lower(): item
        for item in _staff_accounts()
        if str(item.get('username') or '').strip()
    }
    existing_keys = {_comment_log_identity(item) for item in remote_rows}
    imported_rows: list[dict] = []
    skipped = 0
    failed = 0
    errors: list[str] = []
    for raw in source_rows:
        row = _normalise_imported_comment_log(raw, staff_by_username)
        if not row:
            failed += 1
            continue
        key = _comment_log_identity(row)
        if key in existing_keys:
            skipped += 1
            continue
        ok, error = _save_comment_log_to_supabase(row)
        if not ok:
            failed += 1
            if error and error not in errors:
                errors.append(error)
            continue
        existing_keys.add(key)
        imported_rows.append(row)

    if imported_rows:
        _comment_logs = _merge_comment_log_rows(_comment_logs, imported_rows, limit=5000)
    payload = {
        'ok': failed == 0,
        'imported': len(imported_rows),
        'skipped': skipped,
        'failed': failed,
    }
    if errors:
        payload['error'] = '; '.join(errors[:3])
    return jsonify(payload), (200 if failed == 0 else 207)


@app.route('/api/comment-stats/today', methods=['GET'])
def comment_stats_today():
    try:
        staff_id = '' if _is_admin() else _current_staff_id()
        count, warning = _count_today_success_supabase(staff_id)
        storage = 'supabase'
        if count is None:
            count = _count_today_success_local(staff_id)
            storage = 'local'
        payload = {
            'ok': True,
            'success_count': count,
            'storage': storage,
            'scope': 'all' if _is_admin() else 'self',
        }
        if warning and storage == 'local':
            payload['warning'] = warning
        return jsonify(payload)
    except Exception as e:
        return jsonify({'ok': False, 'error': str(e), 'success_count': 0}), 500


@app.route('/api/post-engagement', methods=['POST'])
def api_post_engagement():
    body = request.get_json() or {}
    post = body.get('post') or {}
    if not post or not post.get('id'):
        return jsonify({'ok': False, 'error': 'Thiếu bài viết Facebook'}), 400
    kind = str(body.get('kind') or 'all').strip().lower()
    limit = max(1, min(int(body.get('limit') or 100), 500))
    post_id = str(post.get('id'))
    page_id = str(post.get('_page_id') or body.get('page_id') or '').strip()
    group_id = str(post.get('_group_id') or page_id or DEFAULT_GROUP)
    page_token = _page_token_from_cache(page_id) if page_id else None
    api_client = get_api(group_id)
    payload = {'ok': True, 'post_id': post_id}

    try:
        if kind in ('comments', 'all'):
            embedded = ((post.get('comments') or {}).get('data') or [])
            embedded_total = ((post.get('comments') or {}).get('summary') or {}).get('total_count')
            if kind == 'comments' and embedded and len(embedded) >= min(limit, 50):
                payload['comments'] = embedded[:limit]
                payload['comment_count'] = int(embedded_total or len(embedded))
                payload['source'] = 'embedded'
            else:
                if page_id:
                    loaded = api_client.get_post_comments(post_id, limit=limit, access_token=page_token or None)
                else:
                    loaded = api_client.get_post_comments(post_id, limit=limit)
                if loaded is None:
                    if embedded:
                        payload['comments'] = embedded[:limit]
                        payload['comment_count'] = int(embedded_total or len(embedded))
                        payload['source'] = 'embedded'
                        payload['warning'] = 'Không tải thêm được comment từ Facebook, hiển thị dữ liệu có sẵn.'
                    elif kind == 'comments':
                        return jsonify({'ok': False, 'error': 'Không đọc được bình luận Facebook.'}), 502
                else:
                    payload['comments'] = loaded.get('comments') or []
                    payload['comment_count'] = int(loaded.get('total_count') or len(payload['comments']))
                    payload['source'] = 'facebook_graph'

        if kind in ('likes', 'reactions', 'all'):
            if page_id:
                loaded = api_client.get_post_reactions(post_id, limit=limit, access_token=page_token or None)
            else:
                loaded = api_client.get_post_reactions(post_id, limit=limit)
            if loaded is None:
                summary_count = ((post.get('reactions') or {}).get('summary') or {}).get('total_count')
                if summary_count is not None and kind == 'likes':
                    payload['reactions'] = []
                    payload['reaction_count'] = int(summary_count)
                    payload['warning'] = 'Facebook không trả danh sách người thích, chỉ có tổng số.'
                elif kind == 'likes':
                    return jsonify({'ok': False, 'error': 'Không đọc được danh sách người thích.'}), 502
            else:
                payload['reactions'] = loaded.get('reactions') or []
                payload['reaction_count'] = int(loaded.get('total_count') or len(payload['reactions']))

        if kind in ('shares', 'all'):
            share_count = post.get('shares', {}).get('count')
            if share_count is None and page_id:
                share_count = api_client.get_post_share_count(post_id, access_token=page_token or None)
            elif share_count is None:
                share_count = api_client.get_post_share_count(post_id)
            payload['share_count'] = int(share_count or 0)
            payload['shares_note'] = 'Facebook API thường chỉ trả tổng lượt chia sẻ, không trả danh sách người share.'

        return jsonify(payload)
    except Exception as e:
        return jsonify({'ok': False, 'error': str(e)}), 500


@app.route('/api/post-comments/fetch', methods=['POST'])
def fetch_facebook_post_comments():
    body = request.get_json() or {}
    post = body.get('post') or {}
    if not post or not post.get('id'):
        return jsonify({'ok': False, 'error': 'Thiếu bài viết Facebook'}), 400
    keywords = _normalize_keywords(body.get('keywords') or [])
    limit = max(1, min(int(body.get('limit') or 500), 1000))
    post_id = str(post.get('id'))
    page_id = str(post.get('_page_id') or body.get('page_id') or '').strip()
    group_id = str(post.get('_group_id') or page_id or DEFAULT_GROUP)
    try:
        if page_id:
            page_token = _page_token_from_cache(page_id)
            loaded = get_api(DEFAULT_GROUP).get_post_comments(post_id, limit=limit, access_token=page_token or None)
        else:
            loaded = get_api(group_id).get_post_comments(post_id, limit=limit)
        if loaded is None:
            return jsonify({'ok': False, 'error': 'Không đọc được bình luận Facebook. Kiểm tra cookie/quyền nhóm/Page.'}), 502
        comments = loaded.get('comments') or []
        total_count = int(loaded.get('total_count') or len(comments))
        fetched_at = datetime.utcnow().isoformat(timespec='seconds') + 'Z'
        rows = _flatten_facebook_comment_rows(post, comments, keywords, fetched_at, _current_staff())
        storage, warning = _store_post_comment_rows(rows)
        matched_count = sum(1 for row in rows if row.get('is_matched'))
        payload = {
            'ok': True,
            'source': 'facebook',
            'post_id': post_id,
            'comment_count': total_count,
            'fetched_comment_count': len(rows),
            'matched_count': matched_count,
            'comments': rows,
            'storage': storage,
        }
        if warning:
            payload['warning'] = warning if storage == 'supabase' else f'Đã lưu local, Supabase chưa ghi được: {warning}'
        return jsonify(payload)
    except Exception as e:
        return jsonify({'ok': False, 'error': str(e)}), 500


@app.route('/api/tiktok/comments/fetch', methods=['POST'])
def fetch_tiktok_comments():
    body = request.get_json() or {}
    raw_url = str(body.get('url') or body.get('video_url') or body.get('video_id') or '').strip()
    keywords = _normalize_keywords(body.get('keywords') or [])
    limit = max(1, min(int(body.get('limit') or 300), 1000))
    cookie = str(body.get('cookie') or '').strip()
    channel_name = str(body.get('channel_name') or body.get('channel') or '').strip()
    video_title = str(body.get('video_title') or body.get('title') or '').strip()
    video_id, final_url = _extract_tiktok_video_id(raw_url)
    if not video_id:
        return jsonify({'ok': False, 'error': 'Không nhận diện được video TikTok. Dán link video hoặc ID video.'}), 400
    comments, fetch_error = _fetch_tiktok_comments(video_id, limit=limit, cookie=cookie)
    if not comments and fetch_error:
        return jsonify({'ok': False, 'error': fetch_error, 'source': 'tiktok', 'post_id': f'tiktok_{video_id}'}), 502
    fetched_at = datetime.utcnow().isoformat(timespec='seconds') + 'Z'
    rows = _flatten_tiktok_comment_rows(video_id, final_url, comments, keywords, fetched_at, _current_staff(), channel_name, video_title)
    storage, warning = _store_post_comment_rows(rows)
    matched_count = sum(1 for row in rows if row.get('is_matched'))
    phone_count = sum(1 for row in rows if extract_phones(row.get('message') or ''))
    payload = {
        'ok': True,
        'source': 'tiktok',
        'post_id': f'tiktok_{video_id}',
        'video_id': video_id,
        'post_url': final_url,
        'channel_name': channel_name or _derive_tiktok_channel_name(final_url),
        'video_title': video_title or f'Video {video_id}',
        'comment_count': len(rows),
        'fetched_comment_count': len(rows),
        'matched_count': matched_count,
        'phone_count': phone_count,
        'comments': rows,
        'storage': storage,
    }
    if fetch_error:
        payload['warning'] = fetch_error
    if warning:
        save_warning = warning if storage == 'supabase' else f'Đã lưu local, Supabase chưa ghi được: {warning}'
        payload['warning'] = (payload.get('warning') + ' | ' if payload.get('warning') else '') + save_warning
    return jsonify(payload)


@app.route('/api/tiktok/channel-comments/fetch', methods=['POST'])
def fetch_tiktok_channel_comments():
    body = request.get_json() or {}
    channel = str(body.get('channel') or body.get('channel_url') or body.get('handle') or '').strip()
    keywords = _normalize_keywords(body.get('keywords') or [])
    max_videos = max(1, min(int(body.get('max_videos') or 8), 50))
    per_video_limit = max(1, min(int(body.get('limit_per_video') or body.get('limit') or 200), 500))
    cookie = str(body.get('cookie') or '').strip()
    videos, video_error = _fetch_tiktok_channel_videos(channel, max_videos=max_videos, cookie=cookie)
    if not videos:
        return jsonify({'ok': False, 'error': video_error or 'Không lấy được video từ kênh TikTok'}), 502

    all_rows: list[dict] = []
    errors: list[str] = []
    reports: list[dict] = []
    fetched_at = datetime.utcnow().isoformat(timespec='seconds') + 'Z'
    for video in videos:
        comments, fetch_error = _fetch_tiktok_comments(video['video_id'], limit=per_video_limit, cookie=cookie)
        if fetch_error:
            errors.append(f"{video.get('video_id')}: {fetch_error}")
        rows = _flatten_tiktok_comment_rows(
            video['video_id'],
            video['post_url'],
            comments,
            keywords,
            fetched_at,
            _current_staff(),
            video.get('channel_name') or '',
            video.get('video_title') or '',
        )
        all_rows.extend(rows)
        reports.append({
            'video_id': video.get('video_id'),
            'post_url': video.get('post_url'),
            'video_title': video.get('video_title'),
            'ok': bool(rows),
            'comment_count': len(rows),
            'error': fetch_error,
        })

    if not all_rows and errors:
        return jsonify({
            'ok': True,
            'source': 'tiktok',
            'channel': channel,
            'video_count': len(videos),
            'comment_count': 0,
            'fetched_comment_count': 0,
            'matched_count': 0,
            'phone_count': 0,
            'videos': videos,
            'reports': reports,
            'comments': [],
            'storage': 'local',
            'warning': (
                f"Đã tìm thấy {len(videos)} video trong kênh nhưng TikTok chưa trả comment. "
                f"Chi tiết: {' | '.join(errors[:3])}. "
                "Thử tab Một video với link cụ thể có comment, hoặc cập nhật TikTok cookie/quyền xem comment."
            ),
        })

    storage, warning = _store_post_comment_rows(all_rows)
    matched_count = sum(1 for row in all_rows if row.get('is_matched'))
    phone_count = sum(1 for row in all_rows if extract_phones(row.get('message') or ''))
    payload = {
        'ok': True,
        'source': 'tiktok',
        'channel': channel,
        'video_count': len(videos),
        'comment_count': len(all_rows),
        'fetched_comment_count': len(all_rows),
        'matched_count': matched_count,
        'phone_count': phone_count,
        'videos': videos,
        'reports': reports,
        'comments': all_rows,
        'storage': storage,
    }
    warnings = []
    if errors:
        warnings.append('Một số video lỗi: ' + ' | '.join(errors[:3]))
    if warning:
        warnings.append(warning if storage == 'supabase' else f'Đã lưu local, Supabase chưa ghi được: {warning}')
    if warnings:
        payload['warning'] = ' | '.join(warnings)
    return jsonify(payload)


@app.route('/api/tiktok/videos-comments/fetch', methods=['POST'])
def fetch_tiktok_videos_comments():
    body = request.get_json() or {}
    keywords = _normalize_keywords(body.get('keywords') or [])
    per_video_limit = max(1, min(int(body.get('limit_per_video') or body.get('limit') or 200), 500))
    cookie = str(body.get('cookie') or '').strip()
    raw_videos = body.get('videos') or []
    if not isinstance(raw_videos, list):
        raw_videos = []

    videos: list[dict] = []
    seen_video_ids: set[str] = set()
    for item in raw_videos[:50]:
        if isinstance(item, str):
            raw_url = item
            meta = {}
        elif isinstance(item, dict):
            raw_url = str(item.get('post_url') or item.get('url') or item.get('href') or item.get('video_url') or '')
            meta = item
        else:
            continue
        video_id, final_url = _extract_tiktok_video_id(raw_url or str(meta.get('video_id') or ''))
        if not video_id or video_id in seen_video_ids:
            continue
        seen_video_ids.add(video_id)
        videos.append({
            'video_id': video_id,
            'post_url': final_url or raw_url or f'https://www.tiktok.com/@/video/{video_id}',
            'channel_name': str(meta.get('channel_name') or meta.get('author') or ''),
            'video_title': str(meta.get('video_title') or meta.get('title') or f'Video {video_id}'),
        })

    if not videos:
        return jsonify({'ok': False, 'error': 'Chưa có danh sách video TikTok hợp lệ để đọc comment.'}), 400

    all_rows: list[dict] = []
    reports: list[dict] = []
    errors: list[str] = []
    fetched_at = datetime.utcnow().isoformat(timespec='seconds') + 'Z'
    for video in videos:
        comments, fetch_error = _fetch_tiktok_comments(video['video_id'], limit=per_video_limit, cookie=cookie)
        if fetch_error:
            errors.append(f"{video.get('video_id')}: {fetch_error}")
        rows = _flatten_tiktok_comment_rows(
            video['video_id'],
            video['post_url'],
            comments,
            keywords,
            fetched_at,
            _current_staff(),
            video.get('channel_name') or '',
            video.get('video_title') or '',
        )
        all_rows.extend(rows)
        reports.append({
            'video_id': video.get('video_id'),
            'post_url': video.get('post_url'),
            'video_title': video.get('video_title'),
            'ok': bool(rows),
            'comment_count': len(rows),
            'error': fetch_error,
        })

    storage, warning = _store_post_comment_rows(all_rows)
    payload = {
        'ok': True,
        'source': 'tiktok',
        'video_count': len(videos),
        'comment_count': len(all_rows),
        'fetched_comment_count': len(all_rows),
        'matched_count': sum(1 for row in all_rows if row.get('is_matched')),
        'phone_count': sum(1 for row in all_rows if extract_phones(row.get('message') or '')),
        'videos': videos,
        'reports': reports,
        'comments': all_rows,
        'storage': storage,
    }
    warnings = []
    if errors:
        warnings.append('Một số video lỗi: ' + ' | '.join(errors[:3]))
    if warning:
        warnings.append(warning if storage == 'supabase' else f'Đã lưu local, Supabase chưa ghi được: {warning}')
    if not all_rows:
        warnings.append('Đã gom được video từ Chrome nhưng TikTok chưa trả comment cho các video này.')
    if warnings:
        payload['warning'] = ' | '.join(warnings)
    return jsonify(payload)


@app.route('/api/tiktok/dom-comments/import', methods=['POST'])
def import_tiktok_dom_comments():
    body = request.get_json() or {}
    keywords = _normalize_keywords(body.get('keywords') or [])
    videos = body.get('videos') or []
    if not isinstance(videos, list):
        videos = []
    if not videos:
        return jsonify({'ok': False, 'error': 'Chưa có dữ liệu comment TikTok từ extension.'}), 400

    fetched_at = datetime.utcnow().isoformat(timespec='seconds') + 'Z'
    staff = _current_staff()
    all_rows: list[dict] = []
    reports: list[dict] = []
    for video in videos[:60]:
        if not isinstance(video, dict):
            continue
        raw_video_id = str(video.get('video_id') or video.get('post_id') or video.get('post_url') or '').replace('tiktok_', '').strip()
        video_id_match = re.search(r'\d{8,}', raw_video_id)
        video_id = video_id_match.group(0) if video_id_match else ''
        post_url = str(video.get('post_url') or video.get('url') or '').strip()
        if not video_id and post_url:
            video_id, post_url = _extract_tiktok_video_id(post_url)
        if not video_id:
            continue
        comments = video.get('comments') or []
        if not isinstance(comments, list):
            comments = []
        api_like_comments = []
        for index, item in enumerate(comments[:1000]):
            if not isinstance(item, dict):
                continue
            text = str(item.get('text') or item.get('message') or '').strip()
            if not text:
                continue
            raw_cid = str(item.get('id') or item.get('cid') or item.get('comment_id') or '').replace('tiktok_', '').strip()
            if not raw_cid:
                seed = f"{video_id}|{item.get('author_name') or item.get('author_id') or ''}|{text}|{index}"
                raw_cid = 'dom_' + hashlib.sha1(seed.encode('utf-8', errors='ignore')).hexdigest()[:24]
            author_name = str(item.get('author_name') or item.get('author') or item.get('nickname') or 'Ẩn danh').strip()
            author_id = str(item.get('author_id') or item.get('author_unique_id') or author_name or '').strip()
            api_like_comments.append({
                'cid': raw_cid,
                'text': text,
                'create_time': item.get('create_time') or item.get('created_time') or None,
                '_depth': int(item.get('depth') or 0),
                '_parent_cid': str(item.get('parent_comment_id') or '').replace('tiktok_', '').strip(),
                'user': {
                    'uid': author_id,
                    'unique_id': author_id,
                    'nickname': author_name,
                },
                '_source': 'chrome_dom',
            })
        rows = _flatten_tiktok_comment_rows(
            video_id,
            post_url or f'https://www.tiktok.com/@/video/{video_id}',
            api_like_comments,
            keywords,
            fetched_at,
            staff,
            str(video.get('channel_name') or ''),
            str(video.get('video_title') or ''),
        )
        all_rows.extend(rows)
        reports.append({
            'video_id': video_id,
            'post_url': post_url,
            'video_title': video.get('video_title') or '',
            'ok': bool(rows),
            'comment_count': len(rows),
            'source': 'chrome_dom',
        })

    storage, warning = _store_post_comment_rows(all_rows)
    payload = {
        'ok': True,
        'source': 'tiktok',
        'import_source': 'chrome_dom',
        'video_count': len(reports),
        'comment_count': len(all_rows),
        'fetched_comment_count': len(all_rows),
        'matched_count': sum(1 for row in all_rows if row.get('is_matched')),
        'phone_count': sum(1 for row in all_rows if extract_phones(row.get('message') or '')),
        'reports': reports,
        'comments': all_rows,
        'storage': storage,
    }
    warnings = []
    if not all_rows:
        warnings.append('Extension đã mở TikTok nhưng chưa scrape được comment nào từ giao diện.')
    if warning:
        warnings.append(warning if storage == 'supabase' else f'Đã lưu local, Supabase chưa ghi được: {warning}')
    if warnings:
        payload['warning'] = ' | '.join(warnings)
    return jsonify(payload)


@app.route('/api/tiktok/channels/fetch-comments', methods=['POST'])
def fetch_configured_tiktok_channels_comments():
    body = request.get_json() or {}
    keywords = _normalize_keywords(body.get('keywords') or [])
    max_videos = max(1, min(int(body.get('max_videos') or 5), 50))
    per_video_limit = max(1, min(int(body.get('limit_per_video') or 150), 500))
    cookie = str(body.get('cookie') or '').strip()
    selected_ids = {
        str(item).strip()
        for item in (body.get('channel_ids') or [])
        if str(item).strip()
    }
    _refresh_managed_channels_from_supabase()
    tiktok_channels = [
        row for row in _managed_channels
        if str(row.get('platform') or '').strip().lower() == 'tiktok'
        and (not selected_ids or str(row.get('id') or '') in selected_ids)
    ]
    if not tiktok_channels:
        return jsonify({'ok': False, 'error': 'Chưa có kênh TikTok nào trong Quản lý nhóm/kênh. Hãy thêm kênh TikTok trước.'}), 400

    merged_rows: list[dict] = []
    reports: list[dict] = []
    for channel in tiktok_channels:
        raw = channel.get('link') or channel.get('target_id') or channel.get('channel_name') or ''
        videos, video_error = _fetch_tiktok_channel_videos(raw, max_videos=max_videos, cookie=cookie)
        if not videos:
            reports.append({'channel_id': channel.get('id'), 'channel_name': channel.get('channel_name'), 'ok': False, 'error': video_error})
            continue
        fetched_at = datetime.utcnow().isoformat(timespec='seconds') + 'Z'
        channel_rows: list[dict] = []
        channel_errors: list[str] = []
        video_reports: list[dict] = []
        for video in videos:
            comments, fetch_error = _fetch_tiktok_comments(video['video_id'], limit=per_video_limit, cookie=cookie)
            if fetch_error:
                channel_errors.append(f"{video.get('video_id')}: {fetch_error}")
            video_rows = _flatten_tiktok_comment_rows(
                video['video_id'],
                video['post_url'],
                comments,
                keywords,
                fetched_at,
                _current_staff(),
                channel.get('channel_name') or video.get('channel_name') or '',
                video.get('video_title') or '',
            )
            channel_rows.extend(video_rows)
            video_reports.append({
                'video_id': video.get('video_id'),
                'post_url': video.get('post_url'),
                'video_title': video.get('video_title'),
                'ok': bool(video_rows),
                'comment_count': len(video_rows),
                'error': fetch_error,
            })
        merged_rows.extend(channel_rows)
        reports.append({
            'channel_id': channel.get('id'),
            'channel_name': channel.get('channel_name'),
            'ok': bool(channel_rows),
            'video_count': len(videos),
            'comment_count': len(channel_rows),
            'error': ' | '.join(channel_errors[:2]),
            'videos': video_reports,
        })

    storage, warning = _store_post_comment_rows(merged_rows)
    payload = {
        'ok': True,
        'channel_count': len(tiktok_channels),
        'comment_count': len(merged_rows),
        'fetched_comment_count': len(merged_rows),
        'matched_count': sum(1 for row in merged_rows if row.get('is_matched')),
        'phone_count': sum(1 for row in merged_rows if extract_phones(row.get('message') or '')),
        'reports': reports,
        'comments': merged_rows,
        'storage': storage,
    }
    if warning:
        payload['warning'] = warning if storage == 'supabase' else f'Đã lưu local, Supabase chưa ghi được: {warning}'
    if not merged_rows:
        no_comment_warning = 'Chưa lấy được comment từ kênh TikTok nào. Kiểm tra link kênh/cookie TikTok hoặc thử tab Một video với video chắc chắn có comment.'
        payload['warning'] = (payload.get('warning') + ' | ' if payload.get('warning') else '') + no_comment_warning
    return jsonify(payload)


@app.route('/api/tiktok/comment', methods=['POST'])
def send_tiktok_comment():
    body = request.get_json() or {}
    raw_url = str(body.get('url') or body.get('video_url') or body.get('post_url') or '').strip()
    raw_video_id = str(body.get('video_id') or '').strip()
    post_id = str(body.get('post_id') or '').strip()
    message = str(body.get('message') or body.get('text') or '').strip()
    cookie = str(body.get('cookie') or '').strip()
    if post_id.startswith('tiktok_') and not raw_video_id:
        raw_video_id = post_id.replace('tiktok_', '', 1)
    video_id, final_url = _extract_tiktok_video_id(raw_video_id or raw_url)
    if not video_id:
        return jsonify({'ok': False, 'error': 'Không nhận diện được video TikTok để bình luận.'}), 400
    if not message:
        return jsonify({'ok': False, 'error': 'Nhập nội dung bình luận TikTok'}), 400

    final_post_id = f'tiktok_{video_id}'
    if not final_url:
        final_url = raw_url or f'https://www.tiktok.com/@/video/{video_id}'
    payload, error = _send_tiktok_comment(video_id, final_url, message, cookie)
    if error:
        log = _record_comment_log(final_post_id, 'tiktok', final_url, message, 'tiktok', 'failed', error_message=error)
        res = {'ok': False, 'error': error, 'log_storage': log.get('storage')}
        if log.get('storage_warning'):
            res['warning'] = f"Đã lưu local, Supabase chưa ghi được: {log['storage_warning']}"
        return jsonify(res), 502

    comment_obj = payload.get('comment') if isinstance(payload.get('comment'), dict) else {}
    comment_id = str(
        comment_obj.get('cid')
        or comment_obj.get('id')
        or payload.get('cid')
        or payload.get('comment_id')
        or uuid.uuid4().hex
    )
    log = _record_comment_log(
        final_post_id,
        'tiktok',
        final_url,
        message,
        'tiktok',
        'success',
        comment_id=f'tiktok_{comment_id}',
        lead_context={
            'platform': 'tiktok',
            'customer_name': body.get('customer_name') or body.get('author_name') or body.get('channel_name'),
            'customer_need': body.get('customer_need') or body.get('comment_text') or body.get('video_title'),
            'video_title': body.get('video_title'),
            'channel_name': body.get('channel_name'),
        },
    )
    staff = _current_staff()
    now = datetime.utcnow().isoformat(timespec='seconds') + 'Z'
    rows = [{
        'source': 'tiktok',
        'post_id': final_post_id,
        'group_id': '',
        'post_url': final_url,
        'comment_id': f'tiktok_{comment_id}',
        'parent_comment_id': '',
        'depth': 0,
        'author_id': staff.get('id', ''),
        'author_name': staff.get('name') or staff.get('username') or 'Nhân sự',
        'message': message,
        'attachment_type': '',
        'created_time': now,
        'matched_keywords': [],
        'is_matched': False,
        'raw_comment': {
            'outbound': True,
            'publish_response': payload,
            '_video_meta': {
                'channel_name': _derive_tiktok_channel_name(final_url),
                'video_title': str(body.get('video_title') or f'Video {video_id}'),
                'video_id': video_id,
            },
        },
        'fetched_by_staff_id': staff.get('id', ''),
        'fetched_by_staff_name': staff.get('name', ''),
        'fetched_by_staff_username': staff.get('username', ''),
        'fetched_at': now,
    }]
    storage, storage_warning = _store_post_comment_rows(rows)
    res = {
        'ok': True,
        'source': 'tiktok',
        'post_id': final_post_id,
        'post_url': final_url,
        'comment_id': f'tiktok_{comment_id}',
        'storage': storage,
        'log_storage': log.get('storage'),
    }
    warnings = []
    if storage_warning:
        warnings.append(f'Comment đã gửi, nhưng Supabase post_comments chưa ghi được: {storage_warning}')
    if log.get('storage_warning'):
        warnings.append(f"Lịch sử comment đã lưu local, Supabase chưa ghi được: {log['storage_warning']}")
    if warnings:
        res['warning'] = ' | '.join(warnings)
    return jsonify(res)


@app.route('/api/tiktok/comment/playwright', methods=['POST'])
def send_tiktok_comment_playwright():
    body = request.get_json() or {}
    if TIKTOK_PLAYWRIGHT_WORKER_URL:
        payload, error = _run_tiktok_playwright_worker_comment(body)
    else:
        payload, error = _run_tiktok_playwright_comment(body)
    raw_url = str(body.get('url') or body.get('video_url') or body.get('post_url') or '').strip()
    raw_video_id = str(body.get('video_id') or '').strip()
    post_id = str(body.get('post_id') or '').strip()
    if post_id.startswith('tiktok_') and not raw_video_id:
        raw_video_id = post_id.replace('tiktok_', '', 1)
    video_id, final_url = _extract_tiktok_video_id(raw_video_id or raw_url)
    if error:
        status_code = 409 if 'chưa bật' in error.lower() or 'chưa cài' in error.lower() else 502
        return jsonify({
            'ok': False,
            'source': 'tiktok',
            'method': 'playwright-worker' if TIKTOK_PLAYWRIGHT_WORKER_URL else 'playwright-browser',
            'fallback_allowed': True,
            'error': error,
        }), status_code

    result_body = {
        **body,
        'status': 'success',
        'post_id': f'tiktok_{video_id}' if video_id else post_id,
        'post_url': final_url or raw_url or payload.get('url'),
        'comment_id': payload.get('comment_id'),
        'extension_result': payload,
    }
    recorded, _status = _record_tiktok_extension_comment(result_body)
    res = {
        **payload,
        'ok': True,
        'source': 'tiktok',
        'post_id': recorded.get('post_id') or result_body.get('post_id'),
        'post_url': recorded.get('post_url') or result_body.get('post_url'),
        'comment_id': recorded.get('comment_id') or payload.get('comment_id'),
        'storage': recorded.get('storage'),
        'log_storage': recorded.get('log_storage'),
    }
    if recorded.get('warning'):
        res['warning'] = recorded['warning']
    return jsonify(res)


@app.route('/api/tiktok/comment/result', methods=['POST'])
def record_tiktok_comment_result():
    body = request.get_json() or {}
    payload, status_code = _record_tiktok_extension_comment(body)
    return jsonify(payload), status_code


@app.route('/api/post-comments', methods=['GET'])
def list_post_comments():
    source = (request.args.get('source') or '').strip().lower()
    post_id = (request.args.get('post_id') or '').strip()
    keyword = (request.args.get('keyword') or '').strip().lower()
    limit = max(1, min(request.args.get('limit', 5000, type=int), 5000))
    rows, warning = _load_post_comment_rows(source=source, post_id=post_id, limit=limit)
    if keyword:
        rows = [row for row in rows if keyword in str(row.get('message') or '').lower()]
    rows.sort(key=lambda row: row.get('created_time') or row.get('fetched_at') or '', reverse=True)
    payload = {'ok': True, 'count': len(rows[:limit]), 'comments': [_public_comment_row(row) for row in rows[:limit]]}
    if warning:
        payload['warning'] = warning
    return jsonify(payload)


@app.route('/api/comment-templates', methods=['GET'])
def comment_templates_get():
    rows = sorted(_comment_templates, key=lambda item: (not bool(item.get('system')), str(item.get('title') or '')))
    return jsonify({'ok': True, 'templates': rows})


@app.route('/api/comment-templates', methods=['POST'])
def comment_templates_create():
    global _comment_templates
    body = request.get_json() or {}
    title = str(body.get('title') or '').strip()[:80]
    text = str(body.get('text') or '').strip()[:1600]
    trigger = re.sub(r'[^A-Za-z0-9_\\-À-ỹ]', '', str(body.get('trigger') or title).strip().lstrip('/').lower())[:40]
    if not title or not text:
        return jsonify({'ok': False, 'error': 'Nhập tên mẫu câu và nội dung'}), 400
    if not trigger:
        trigger = hashlib.sha1(title.encode('utf-8')).hexdigest()[:8]
    row = {
        'id': uuid.uuid4().hex[:12],
        'trigger': trigger,
        'title': title,
        'text': text,
        'created_by_staff_id': _current_staff_id(),
        'created_by_staff_name': _current_staff().get('name') or '',
        'created_at': datetime.utcnow().isoformat(timespec='seconds') + 'Z',
        'system': False,
    }
    _comment_templates = [*(_comment_templates or []), row]
    _save_comment_templates()
    return jsonify({'ok': True, 'template': row, 'templates': _comment_templates})


@app.route('/api/comment-templates/<template_id>', methods=['PUT', 'DELETE'])
def comment_templates_update(template_id):
    global _comment_templates
    template_id = str(template_id or '').strip()
    current = next((item for item in _comment_templates if str(item.get('id') or '') == template_id), None)
    if not current:
        return jsonify({'ok': False, 'error': 'Không tìm thấy mẫu câu'}), 404
    if current.get('system') and request.method == 'DELETE':
        return jsonify({'ok': False, 'error': 'Không xoá mẫu câu hệ thống'}), 400
    if request.method == 'DELETE':
        _comment_templates = [item for item in _comment_templates if str(item.get('id') or '') != template_id]
        _save_comment_templates()
        return jsonify({'ok': True, 'templates': _comment_templates})
    body = request.get_json() or {}
    current['title'] = str(body.get('title') or current.get('title') or '').strip()[:80]
    current['trigger'] = re.sub(r'[^A-Za-z0-9_\\-À-ỹ]', '', str(body.get('trigger') or current.get('trigger') or '').strip().lstrip('/').lower())[:40]
    current['text'] = str(body.get('text') or current.get('text') or '').strip()[:1600]
    current['updated_at'] = datetime.utcnow().isoformat(timespec='seconds') + 'Z'
    _save_comment_templates()
    return jsonify({'ok': True, 'template': current, 'templates': _comment_templates})


@app.route('/api/comment-tags', methods=['GET'])
def comment_tags_get():
    rows = sorted(_comment_tags, key=lambda item: (not bool(item.get('system')), str(item.get('label') or '')))
    return jsonify({'ok': True, 'tags': rows})


@app.route('/api/comment-tags', methods=['POST'])
def comment_tags_create():
    global _comment_tags
    body = request.get_json() or {}
    label = str(body.get('label') or '').strip()[:50]
    icon = str(body.get('icon') or '🏷️').strip()[:4]
    color = str(body.get('color') or 'blue').strip()[:30]
    if not label:
        return jsonify({'ok': False, 'error': 'Nhập tên tag'}), 400
    row_id = re.sub(r'[^a-z0-9_-]+', '-', label.lower()).strip('-')[:30] or uuid.uuid4().hex[:8]
    if any(str(item.get('id') or '') == row_id for item in _comment_tags):
        row_id = f'{row_id}-{uuid.uuid4().hex[:4]}'
    row = {
        'id': row_id,
        'label': label,
        'icon': icon,
        'color': color,
        'created_by_staff_id': _current_staff_id(),
        'created_at': datetime.utcnow().isoformat(timespec='seconds') + 'Z',
        'system': False,
    }
    _comment_tags = [*(_comment_tags or []), row]
    _save_comment_tags()
    return jsonify({'ok': True, 'tag': row, 'tags': _comment_tags})


@app.route('/api/comment-tags/<tag_id>', methods=['DELETE'])
def comment_tags_delete(tag_id):
    global _comment_tags, _comment_tag_assignments
    tag_id = str(tag_id or '').strip()
    current = next((item for item in _comment_tags if str(item.get('id') or '') == tag_id), None)
    if not current:
        return jsonify({'ok': False, 'error': 'Không tìm thấy tag'}), 404
    if current.get('system'):
        return jsonify({'ok': False, 'error': 'Không xoá tag hệ thống'}), 400
    _comment_tags = [item for item in _comment_tags if str(item.get('id') or '') != tag_id]
    for row in _post_comments:
        tags = row.get('manual_tags') if isinstance(row.get('manual_tags'), list) else []
        row['manual_tags'] = [item for item in tags if str(item) != tag_id]
    for comment_id, tags in list(_comment_tag_assignments.items()):
        if isinstance(tags, list):
            kept = [item for item in tags if str(item) != tag_id]
            if kept:
                _comment_tag_assignments[comment_id] = kept
            else:
                _comment_tag_assignments.pop(comment_id, None)
    _save_comment_tags()
    _save_comment_tag_assignments()
    _save_post_comments()
    return jsonify({'ok': True, 'tags': _comment_tags})


@app.route('/api/post-comments/tags', methods=['POST'])
def post_comment_tags_save():
    global _post_comments, _comment_tag_assignments
    body = request.get_json() or {}
    comment_id = str(body.get('comment_id') or '').strip()
    tags = [str(item).strip() for item in (body.get('tags') or []) if str(item).strip()]
    if not comment_id:
        return jsonify({'ok': False, 'error': 'Thiếu comment_id'}), 400
    changed = False
    for row in _post_comments:
        if str(row.get('comment_id') or '') == comment_id:
            row['manual_tags'] = tags
            changed = True
            break
    if not changed:
        rows, _ = _load_post_comment_rows(limit=5000)
        for row in rows:
            if str(row.get('comment_id') or '') == comment_id:
                row['manual_tags'] = tags
                _post_comments.append(row)
                changed = True
                break
    if not changed:
        return jsonify({'ok': False, 'error': 'Không tìm thấy comment để gắn tag'}), 404
    _comment_tag_assignments[comment_id] = tags
    _save_post_comments()
    _save_comment_tag_assignments()
    return jsonify({'ok': True, 'comment_id': comment_id, 'tags': tags, 'storage': 'supabase' if USE_SUPABASE else 'local'})


@app.route('/api/post-comments/workflow', methods=['GET', 'POST'])
def post_comment_workflow():
    global _comment_inbox_workflow
    if request.method == 'GET':
        processed, starred = _workflow_lists()
        return jsonify({'ok': True, 'processed': processed, 'starred': starred})

    body = request.get_json() or {}
    comment_id = str(body.get('comment_id') or '').strip()
    if not comment_id:
        return jsonify({'ok': False, 'error': 'Thiếu comment_id'}), 400

    current = dict(_comment_inbox_workflow.get(comment_id) or {})
    if 'processed' in body:
        current['processed'] = bool(body.get('processed'))
    if 'starred' in body:
        current['starred'] = bool(body.get('starred'))

    if not current.get('processed') and not current.get('starred'):
        _comment_inbox_workflow.pop(comment_id, None)
    else:
        _comment_inbox_workflow[comment_id] = current
    _save_comment_inbox_workflow()
    processed, starred = _workflow_lists()
    return jsonify({
        'ok': True,
        'comment_id': comment_id,
        'state': current,
        'processed': processed,
        'starred': starred,
        'storage': 'supabase' if USE_SUPABASE else 'local',
    })


@app.route('/api/post-comments/phone', methods=['POST'])
def post_comment_phone_save():
    global _post_comments, _comment_manual_phones
    body = request.get_json() or {}
    comment_id = str(body.get('comment_id') or '').strip()
    if not comment_id:
        return jsonify({'ok': False, 'error': 'Thiếu comment_id'}), 400

    row = next((item for item in _post_comments if str(item.get('comment_id') or '') == comment_id), None)
    if not row:
        rows, _ = _load_post_comment_rows(limit=5000)
        row = next((item for item in rows if str(item.get('comment_id') or '') == comment_id), None)
        if row and row not in _post_comments:
            _post_comments.append(row)

    message = str((row or {}).get('message') or body.get('message') or '').strip()
    extract_from_message = bool(body.get('extract_from_message'))
    raw_phones = body.get('phones') if isinstance(body.get('phones'), list) else None
    raw_phone = str(body.get('phone') if body.get('phone') is not None else '').strip()

    if extract_from_message:
        phones = extract_phones(message)
    elif raw_phones is not None:
        phones = _normalize_phones_list(raw_phones)
    elif 'phone' in body:
        phones = _normalize_phones_list([raw_phone] if raw_phone else [])
    else:
        return jsonify({'ok': False, 'error': 'Thiếu phone hoặc extract_from_message'}), 400

    if phones:
        _comment_manual_phones[comment_id] = {
            'phone': phones[0],
            'phones': phones,
            'updated_at': datetime.utcnow().isoformat(timespec='seconds') + 'Z',
        }
        if row:
            row['manual_phone'] = phones[0]
            row['manual_phones'] = phones
            _save_post_comments()
    else:
        _comment_manual_phones.pop(comment_id, None)
        if row:
            row.pop('manual_phone', None)
            row.pop('manual_phones', None)
            _save_post_comments()

    _save_comment_manual_phones()
    public = _public_comment_row(row or {'comment_id': comment_id, 'message': message})
    return jsonify({
        'ok': True,
        'comment_id': comment_id,
        'phone': public.get('phone') or '',
        'phones': public.get('phones') or [],
        'phones_auto': public.get('phones_auto') or [],
        'phones_manual': public.get('phones_manual') or [],
        'storage': 'supabase' if USE_SUPABASE else 'local',
    })


@app.route('/api/ai/caption-variants', methods=['POST'])
def ai_caption_variants():
    body = request.get_json() or {}
    base = str(body.get('message') or body.get('content') or '').strip()
    targets = body.get('targets') if isinstance(body.get('targets'), list) else []
    if not base:
        return jsonify({'ok': False, 'error': 'Nhập nội dung gốc trước khi tạo caption'}), 400
    clean_targets = []
    for index, target in enumerate(targets[:30], 1):
        if not isinstance(target, dict):
            continue
        clean_targets.append({
            'id': str(target.get('id') or index),
            'name': str(target.get('name') or target.get('id') or f'Kênh {index}')[:120],
            'type': str(target.get('type') or 'group')[:30],
        })
    if not clean_targets:
        clean_targets = [{'id': 'default', 'name': 'Kênh mặc định', 'type': 'group'}]

    fallback_rows = []
    tails = [
        'Anh/chị cần tư vấn thêm cứ để lại bình luận, bên em phản hồi ngay.',
        'Mình quan tâm phần nào nhất thì nhắn bên em để được hỗ trợ cụ thể.',
        'Bên em có thể tư vấn theo nhu cầu thực tế để chọn phương án phù hợp.',
        'Ai cần mẫu/chi tiết thì để lại SĐT hoặc inbox bên em nhé.',
    ]
    for idx, target in enumerate(clean_targets):
        fallback_rows.append({
            **target,
            'caption': f"{base}\n\n{tails[idx % len(tails)]}",
            'source': 'fallback',
        })

    classifier = _get_classifier()
    if not classifier.api_key:
        return jsonify({'ok': True, 'captions': fallback_rows, 'warning': 'Chưa có AI key, hệ thống dùng caption biến thể mặc định.'})
    try:
        prompt = f"""Bạn là content marketer tiếng Việt.

Tạo caption biến thể để đăng cùng một nội dung lên nhiều Facebook Group/Page, mục tiêu là tránh trùng lặp máy móc nhưng vẫn giữ đúng ý.

Yêu cầu:
- Trả về JSON array, mỗi item có id và caption.
- Giữ thông tin quan trọng, không bịa khuyến mãi/số liệu.
- Mỗi caption khác cách mở đầu hoặc CTA.
- Giọng tự nhiên, không spam, không quá dài.

Nội dung gốc:
{base}

Danh sách nơi đăng:
{json.dumps(clean_targets, ensure_ascii=False)}
"""
        raw = classifier._call_api(prompt)
        parsed = json.loads(re.sub(r'^```(?:json)?|```$', '', raw.strip(), flags=re.I | re.M))
        if not isinstance(parsed, list):
            raise ValueError('AI không trả list')
        by_id = {str(item.get('id') or ''): str(item.get('caption') or '').strip() for item in parsed if isinstance(item, dict)}
        rows = []
        for target, fallback in zip(clean_targets, fallback_rows):
            rows.append({**target, 'caption': by_id.get(target['id']) or fallback['caption'], 'source': 'ai'})
        return jsonify({'ok': True, 'captions': rows})
    except Exception as e:
        return jsonify({'ok': True, 'captions': fallback_rows, 'warning': f'AI lỗi, đã dùng caption biến thể mặc định: {str(e)[:180]}'})


@app.route('/api/tiktok/comment-stats', methods=['GET'])
def tiktok_comment_stats():
    limit = max(1, min(request.args.get('limit', 2000, type=int), 5000))
    rows, warning = _load_post_comment_rows(source='tiktok', limit=limit)
    stats = _tiktok_comment_stats(rows)
    payload = {
        'ok': True,
        'count': len(stats),
        'total_comments': sum(item.get('comment_count') or 0 for item in stats),
        'total_phone_comments': sum(item.get('phone_count') or 0 for item in stats),
        'stats': stats,
    }
    if warning:
        payload['warning'] = warning
    return jsonify(payload)


@app.route('/api/tiktok/config', methods=['GET'])
def tiktok_config_get():
    return jsonify({'ok': True, 'config': _public_tiktok_config()})


@app.route('/api/tiktok/config', methods=['POST'])
def tiktok_config_save():
    global _tiktok_config
    if not _is_admin():
        return jsonify({'ok': False, 'error': 'Chỉ admin được cập nhật TikTok cookie'}), 403
    body = request.get_json() or {}
    cookie = str(body.get('cookie') or '').strip()
    if not cookie:
        return jsonify({'ok': False, 'error': 'Dán cookie TikTok trước khi lưu'}), 400
    if '=' not in cookie:
        return jsonify({'ok': False, 'error': 'Cookie TikTok chưa đúng định dạng, cần chuỗi cookie đầy đủ từ trình duyệt'}), 400
    if not _has_tiktok_login_cookie(cookie):
        return jsonify({'ok': False, 'error': _tiktok_cookie_login_message(cookie)}), 400
    now = datetime.utcnow().isoformat(timespec='seconds') + 'Z'
    staff = _current_staff()
    _tiktok_config = {
        **_default_tiktok_config(),
        **(_tiktok_config if isinstance(_tiktok_config, dict) else {}),
        'cookie': cookie,
        'updated_at': now,
        'updated_by': staff.get('name') or staff.get('username') or '',
    }
    _save_tiktok_config()
    return jsonify({'ok': True, 'config': _public_tiktok_config(), 'storage': 'supabase' if USE_SUPABASE else 'local'})


@app.route('/api/tiktok/config/test', methods=['POST'])
def tiktok_config_test():
    body = request.get_json() or {}
    cookie = str(body.get('cookie') or '').strip() or _configured_tiktok_cookie()
    has_login_cookie = _has_tiktok_login_cookie(cookie)
    return jsonify({
        'ok': True,
        'valid': bool(cookie and has_login_cookie),
        'has_cookie': bool(cookie),
        'has_login_cookie': has_login_cookie,
        'message': _tiktok_cookie_login_message(cookie),
        'config': _public_tiktok_config(),
    })


@app.route('/api/tiktok/config', methods=['DELETE'])
def tiktok_config_delete():
    global _tiktok_config
    if not _is_admin():
        return jsonify({'ok': False, 'error': 'Chỉ admin được xoá TikTok cookie'}), 403
    _tiktok_config = {**_default_tiktok_config(), 'updated_at': datetime.utcnow().isoformat(timespec='seconds') + 'Z'}
    _save_tiktok_config()
    return jsonify({'ok': True, 'config': _public_tiktok_config(), 'storage': 'supabase' if USE_SUPABASE else 'local'})


def _lookup_local_group(slug: str):
    slug = str(slug or '').strip().strip('/')
    if not slug:
        return None
    for row in _merged_facebook_groups():
        gid = str(row.get('id') or '').strip()
        if gid and gid == slug:
            name = str(row.get('name') or '').strip()
            return {'id': gid, 'name': name or gid}
    return None


def _safe_group_membership(api, group_id: str):
    if not group_id:
        return None
    if not getattr(api, 'access_token', None) and not getattr(api, 'cookie', None):
        return None
    try:
        return bool(api.check_membership(group_id))
    except Exception:
        return None


@app.route('/api/groups/resolve')
def api_resolve_group():
    slug = request.args.get('slug', '').strip().strip('/')
    if not slug:
        return jsonify({'ok': False, 'error': 'Thiếu slug'}), 400

    local = _lookup_local_group(slug)
    if local:
        api = get_api(DEFAULT_GROUP)
        return jsonify({
            'ok': True,
            'id': local['id'],
            'name': local['name'],
            'is_member': _safe_group_membership(api, local['id']),
            'source': 'local',
        })

    if re.fullmatch(r'\d{6,}', slug):
        api = get_api(DEFAULT_GROUP)
        return jsonify({
            'ok': True,
            'id': slug,
            'name': slug,
            'is_member': _safe_group_membership(api, slug),
            'source': 'numeric-id',
        })

    try:
        api = get_api(DEFAULT_GROUP)
        if not api.access_token and not api.cookie:
            return jsonify({
                'ok': False,
                'error': 'Chưa có cookie Facebook. Vào Nhân sự để thêm cookie hoặc nhập trực tiếp ID nhóm.',
                'facebook_auth_required': True,
            }), 400
        data = api.resolve_slug(slug)
        if data and 'id' in data:
            return jsonify({
                'ok': True,
                'id': data['id'],
                'name': data.get('name', slug),
                'is_member': _safe_group_membership(api, data['id']),
                'source': 'facebook',
            })
        err = (data or {}).get('error', {}).get('message', 'Không tìm thấy group')
        return jsonify({'ok': False, 'error': err})
    except Exception as e:
        return jsonify({'ok': False, 'error': str(e)}), 500


def _membership_for_gid(gid: str):
    try:
        return gid, bool(get_api(DEFAULT_GROUP).check_membership(gid))
    except Exception:
        return gid, None


@app.route('/api/group-membership', methods=['GET'])
@app.route('/api/groups/membership', methods=['GET'])
def api_groups_membership():
    ids_raw = str(request.args.get('ids') or '').strip()
    ids = [item.strip() for item in ids_raw.split(',') if item.strip()]
    ids = _filter_group_ids_for_staff(ids)
    if not ids:
        return jsonify({'ok': True, 'membership': {}})
    try:
        get_api(DEFAULT_GROUP)
        membership = {}
        target_ids = ids[:80]
        workers = min(8, len(target_ids))
        with ThreadPoolExecutor(max_workers=workers) as pool:
            futures = [
                pool.submit(copy_current_request_context(_membership_for_gid), gid)
                for gid in target_ids
            ]
            for future in as_completed(futures):
                gid, status = future.result()
                membership[gid] = status
        return jsonify({'ok': True, 'membership': membership})
    except Exception as e:
        return jsonify({'ok': False, 'error': str(e)}), 500


@app.route('/api/groups/debug', methods=['GET'])
def api_groups_debug():
    ids_raw = str(request.args.get('ids') or '').strip()
    ids = [item.strip() for item in ids_raw.split(',') if item.strip()]
    staff = _active_staff()
    cookie = staff.get('cookie', '')
    rows = []
    for gid in ids[:20]:
        api = get_api(gid)
        cookie_membership = None
        graph_ok = False
        graph_error = ''
        try:
            cookie_membership = api._fetch_membership_via_cookie(gid)
        except Exception as e:
            graph_error = str(e)[:220]
        try:
            feed = api._call('get', f'{GRAPH_URL}/{gid}/feed', params={'fields': 'id', 'limit': 1})
            graph_ok = bool(feed is not None and not feed.get('error'))
            if feed and feed.get('error'):
                graph_error = (feed.get('error') or {}).get('message') or graph_error
            else:
                graph_error = api.last_graph_error or graph_error
        except Exception as e:
            graph_error = str(e)[:220]
        rows.append({
            'group_id': gid,
            'cookie_membership': cookie_membership,
            'graph_feed_ok': graph_ok,
            'graph_error': graph_error,
        })
    return jsonify({
        'ok': True,
        'staff': {
            'id': staff.get('id', ''),
            'name': staff.get('name', ''),
            'username': staff.get('username', ''),
            'facebook_user_id': _extract_cookie_user(cookie),
            'has_cookie': bool(cookie),
            'cookie_masked': _mask_cookie(cookie),
        },
        'groups': rows,
    })


@app.route('/api/groups/<gid>/join', methods=['POST'])
def api_join_group(gid):
    try:
        result = get_api(DEFAULT_GROUP).join_group(gid)
        return jsonify(result)
    except Exception as e:
        return jsonify({'ok': False, 'error': str(e)}), 500


def _sync_group_from_channel(row: dict) -> None:
    global _groups
    platform = str(row.get('platform') or '').strip().lower()
    channel_type = str(row.get('channel_type') or '').strip().lower()
    target_id = str(row.get('target_id') or '').strip()
    if platform != 'facebook' or channel_type not in ('nhóm', 'nhom', 'group') or not target_id:
        return
    name = str(row.get('channel_name') or '').strip()
    if not any(g.get('id') == target_id for g in _groups):
        _groups.append({'id': target_id, 'name': name})
    else:
        for group in _groups:
            if group.get('id') == target_id and name:
                group['name'] = name
    _save_groups()
    if USE_SUPABASE:
        try:
            sb.upsert_group(target_id, name)
        except Exception as e:
            print(f'[supabase] upsert_group from managed channel failed: {e}')


def _facebook_page_channels(rows: list | None = None) -> list[dict]:
    source = rows if rows is not None else _managed_channels
    out = []
    for row in source:
        platform = str(row.get('platform') or '').strip().lower()
        channel_type = str(row.get('channel_type') or '').strip().lower()
        target_id = str(row.get('target_id') or '').strip()
        if platform == 'facebook' and channel_type in ('page', 'fanpage', 'trang') and target_id:
            out.append({'id': target_id, 'name': str(row.get('channel_name') or '').strip()})
    return out


def _facebook_group_channels(rows: list | None = None) -> list[dict]:
    global _managed_channels
    source = rows if rows is not None else _managed_channels
    out = []
    changed = False
    next_channels = []
    for row in source:
        original_target = str(row.get('target_id') or '').strip()
        row = _resolve_facebook_group_channel(row)
        if str(row.get('target_id') or '').strip() != original_target:
            changed = True
        next_channels.append(row)
        platform = str(row.get('platform') or '').strip().lower()
        channel_type = str(row.get('channel_type') or '').strip().lower()
        target_id = str(row.get('target_id') or '').strip()
        if platform == 'facebook' and channel_type in ('nhóm', 'nhom', 'group') and target_id:
            out.append({'id': target_id, 'name': str(row.get('channel_name') or '').strip()})
    if rows is None and changed:
        _managed_channels = next_channels
        _save_managed_channels()
    return out


def _merged_facebook_groups() -> list[dict]:
    by_id = {}
    for row in _groups:
        gid = str(row.get('id') or '').strip()
        if gid:
            by_id[gid] = {'id': gid, 'name': str(row.get('name') or '').strip()}
    for row in _facebook_group_channels():
        gid = row['id']
        if gid not in by_id:
            by_id[gid] = row
        elif row.get('name'):
            by_id[gid]['name'] = row['name']
    return list(by_id.values())


def _legacy_group_channel_id(group_id: str) -> str:
    digest = hashlib.sha1(str(group_id or '').encode('utf-8')).hexdigest()[:12]
    return f'legacy-{digest}'


def _restore_legacy_groups_to_managed_channels() -> tuple[int, str]:
    """Migrate groups saved in the legacy groups table into managed_channels.

    Vercel storage is ephemeral, so displaying only managed_channels can make
    older groups appear lost after a deployment even though they still exist
    in Supabase's legacy groups table.
    """
    global _managed_channels
    existing_targets = {
        str(item.get('target_id') or '').strip()
        for item in _managed_channels
        if str(item.get('platform') or '').strip().lower() == 'facebook'
        and str(item.get('channel_type') or '').strip().lower() in ('nhóm', 'nhom', 'group')
        and str(item.get('target_id') or '').strip()
    }
    now = datetime.utcnow().isoformat(timespec='seconds') + 'Z'
    added = 0
    warning = ''
    for group in _groups:
        group_id = str(group.get('id') or '').strip()
        if not group_id or group_id in existing_targets:
            continue
        group_name = str(group.get('name') or '').strip()[:160]
        row = {
            'id': _legacy_group_channel_id(group_id),
            'platform': 'Facebook',
            'channel_name': group_name or f'Nhóm Facebook {group_id}',
            'channel_type': 'Nhóm',
            'link': f'https://www.facebook.com/groups/{group_id}',
            'target_id': group_id,
            'note': 'Khôi phục từ danh sách nhóm đã lưu trước đây',
            'created_at': now,
            'updated_at': now,
        }
        if USE_SUPABASE:
            row, row_warning = _sync_managed_channel_supabase(row)
            warning = _append_warning(warning, row_warning)
        _managed_channels.append(row)
        existing_targets.add(group_id)
        added += 1
    if added:
        _save_managed_channels()
    return added, warning


def _refresh_managed_channels_from_supabase(*, force: bool = False) -> None:
    global _managed_channels, _managed_channels_remote_at
    if not USE_SUPABASE:
        return
    now = time_module.monotonic()
    if not force and _managed_channels_remote_at and now - _managed_channels_remote_at < _MANAGED_CHANNELS_REFRESH_TTL:
        return
    try:
        rows = sb.list_managed_channels(SUPABASE_CHANNEL_TABLE)
        if isinstance(rows, list):
            _managed_channels = _merge_managed_channels_remote(rows, _managed_channels)
            _managed_channels_remote_at = now
            _save_managed_channels()
    except Exception as e:
        print(f'[supabase] refresh managed_channels failed: {e}')


def _visible_managed_channels() -> list[dict]:
    _backfill_channel_assigned_staff_ids()
    visible = _filter_managed_channels_for_staff(_managed_channels)
    staff_rows = _all_staff_rows_for_assignment()
    rows = [_public_managed_channel(item, staff_rows) for item in visible]
    rows.sort(key=lambda item: item.get('created_at') or item.get('updated_at') or '', reverse=True)
    return rows


@app.route('/api/channels', methods=['GET'])
def channels_get():
    _refresh_managed_channels_from_supabase()
    restored, warning = _restore_legacy_groups_to_managed_channels()
    payload = {
        'ok': True,
        'channels': _visible_managed_channels(),
        'can_assign_staff': _is_admin(),
        'restored_groups': restored,
    }
    if warning:
        payload['warning'] = warning
    return jsonify(payload)


@app.route('/api/channels/publish-targets', methods=['GET'])
def channels_publish_targets():
    """Nhóm/Page đăng bài — chỉ lấy từ bảng managed_channels (Supabase)."""
    _refresh_managed_channels_from_supabase()
    _restore_legacy_groups_to_managed_channels()
    visible = _filter_managed_channels_for_staff(_managed_channels)
    groups = _facebook_group_channels(visible)
    pages = _facebook_page_channels(visible)
    return jsonify({
        'ok': True,
        'groups': groups,
        'pages': pages,
        'count': len(groups) + len(pages),
        'storage': 'supabase' if USE_SUPABASE else 'local',
    })


@app.route('/api/channels/sync-facebook-pages', methods=['POST'])
def channels_sync_facebook_pages():
    """Đồng bộ các Facebook Page mà cookie hiện tại có quyền quản trị vào bảng kênh theo dõi."""
    global _managed_channels, _pages_cache
    try:
        pages, warning, source = _load_facebook_pages_for_active_cookie()
    except Exception as e:
        return jsonify({'ok': False, 'error': f'Không lấy được danh sách Page Facebook: {e}'}), 500

    if not pages:
        return jsonify({
            'ok': False,
            'error': warning or 'Không tìm thấy Page nào qua Facebook API/cookie HTML. Có thể Page mới tạo chưa được Facebook trả về; hãy bấm + Thêm và nhập thủ công ID Page.',
        }), 400

    _pages_cache = {
        str(p.get('id') or ''): {
            'name': p.get('name', ''),
            'access_token': p.get('access_token', '') or (_pages_cache.get(str(p.get('id') or '')) or {}).get('access_token', ''),
        }
        for p in pages
        if p.get('id')
    }
    existing_by_page_id = {
        str(item.get('target_id') or '').strip(): item
        for item in _managed_channels
        if str(item.get('platform') or '').strip().lower() == 'facebook'
        and str(item.get('channel_type') or '').strip().lower() in ('page', 'fanpage')
    }
    by_id = {str(item.get('id') or ''): item for item in _managed_channels if item.get('id')}
    now = datetime.utcnow().isoformat(timespec='seconds') + 'Z'
    added = 0
    updated = 0

    for page in pages:
        page_id = str(page.get('id') or '').strip()
        if not re.fullmatch(r'\d{10,20}', page_id):
            continue
        page_name = str(page.get('name') or page_id).strip()[:160]
        current = existing_by_page_id.get(page_id) or {}
        row_id = str(current.get('id') or uuid.uuid4().hex[:12])
        row = {
            **current,
            'id': row_id,
            'platform': 'Facebook',
            'channel_name': page_name,
            'channel_type': 'Page',
            'link': str(current.get('link') or f'https://www.facebook.com/{page_id}'),
            'target_id': page_id,
            'note': str(current.get('note') or 'Đồng bộ từ Page Facebook khách đang quản trị')[:500],
            'created_at': current.get('created_at') or now,
            'updated_at': now,
        }
        if USE_SUPABASE:
            try:
                row = {**row, **sb.upsert_managed_channel(row, SUPABASE_CHANNEL_TABLE)}
            except Exception as e:
                return jsonify({'ok': False, 'error': f'Không lưu Page lên Supabase: {_managed_channel_store_error(e)}'}), 500
        by_id[row_id] = row
        if current:
            updated += 1
        else:
            added += 1

    _managed_channels = list(by_id.values())
    _save_managed_channels()
    rows = [_public_managed_channel(item) for item in _managed_channels]
    rows.sort(key=lambda item: item.get('created_at') or item.get('updated_at') or '', reverse=True)
    payload = {'ok': True, 'added': added, 'updated': updated, 'channels': rows, 'source': source}
    if warning:
        payload['warning'] = warning
    return jsonify(payload)


@app.route('/api/channels', methods=['POST'])
def channels_create():
    global _managed_channels
    body = request.get_json() or {}
    row = _clean_managed_channel(body)
    row = _resolve_facebook_group_channel(row)
    validation_error = _facebook_channel_validation_error(row)
    if validation_error:
        return jsonify({'ok': False, 'error': validation_error}), 400
    if not row['platform']:
        return jsonify({'ok': False, 'error': 'Thiếu nền tảng'}), 400
    if not row['channel_name']:
        return jsonify({'ok': False, 'error': 'Thiếu tên kênh'}), 400
    if not row['target_id'] and not row['link']:
        return jsonify({'ok': False, 'error': 'Thiếu link hoặc ID'}), 400
    duplicated = _find_duplicate_managed_channel(row)
    if duplicated:
        return jsonify({
            'ok': False,
            'error': f"Kênh này đã có trong danh sách: {duplicated.get('channel_name') or duplicated.get('target_id') or duplicated.get('id')}",
            'duplicate': _public_managed_channel(duplicated),
        }), 409
    now = datetime.utcnow().isoformat(timespec='seconds') + 'Z'
    row = {
        'id': uuid.uuid4().hex[:12],
        **row,
        'created_at': now,
        'updated_at': now,
    }
    if USE_SUPABASE:
        row, supabase_warning = _sync_managed_channel_supabase(row)
    else:
        supabase_warning = ''
    _managed_channels = [item for item in _managed_channels if item.get('id') != row['id']]
    _managed_channels.append(row)
    _save_managed_channels()
    _sync_group_from_channel(row)
    assign_warning = supabase_warning
    if 'assigned_staff_ids' in body:
        if not _is_admin():
            return jsonify({'ok': False, 'error': 'Chỉ admin được phân công nhân sự cho kênh'}), 403
        assign_warning = _append_warning(assign_warning, _assign_staff_to_channel(row, body.get('assigned_staff_ids'), merge=False))
    return jsonify({
        'ok': True,
        'channel': _public_managed_channel(row),
        'channels': _visible_managed_channels(),
        'warning': assign_warning,
    })


@app.route('/api/channels/bulk-assign-staff', methods=['POST'])
def channels_bulk_assign_staff():
    if not _is_admin():
        return jsonify({'ok': False, 'error': 'Chỉ admin được phân công nhân sự cho kênh'}), 403
    body = request.get_json(silent=True) or {}
    channel_ids = body.get('channel_ids') or []
    staff_ids = body.get('staff_ids') or []
    if not isinstance(channel_ids, list) or not channel_ids:
        return jsonify({'ok': False, 'error': 'Chọn ít nhất một kênh'}), 400
    if not isinstance(staff_ids, list) or not staff_ids:
        return jsonify({'ok': False, 'error': 'Chọn ít nhất một nhân sự'}), 400
    updated = 0
    warnings: list[str] = []
    for raw_id in channel_ids:
        channel_id = str(raw_id or '').strip()
        if not channel_id:
            continue
        row = next((item for item in _managed_channels if str(item.get('id') or '') == channel_id), None)
        if not row:
            continue
        warn = _assign_staff_to_channel(row, staff_ids, merge=True)
        if warn:
            warnings.append(warn)
        updated += 1
    if updated <= 0:
        return jsonify({'ok': False, 'error': 'Không gán được kênh nào'}), 404
    payload = {'ok': True, 'updated': updated, 'channels': _visible_managed_channels()}
    if warnings:
        payload['warning'] = warnings[0]
    return jsonify(payload)


@app.route('/api/channels/<channel_id>', methods=['PUT'])
def channels_update(channel_id):
    global _managed_channels
    current = next((item for item in _managed_channels if item.get('id') == channel_id), {})
    if not current and USE_SUPABASE:
        try:
            remote = sb.list_managed_channels(SUPABASE_CHANNEL_TABLE)
            current = next((item for item in remote if item.get('id') == channel_id), {})
        except Exception:
            current = {}
    if not current:
        return jsonify({'ok': False, 'error': 'Không tìm thấy kênh'}), 404
    body = request.get_json() or {}
    row = {**current, **_clean_managed_channel(body, current), 'updated_at': datetime.utcnow().isoformat(timespec='seconds') + 'Z'}
    row = _resolve_facebook_group_channel(row)
    validation_error = _facebook_channel_validation_error(row)
    if validation_error:
        return jsonify({'ok': False, 'error': validation_error}), 400
    if not row.get('platform') or not row.get('channel_name'):
        return jsonify({'ok': False, 'error': 'Thiếu nền tảng hoặc tên kênh'}), 400
    if not row.get('target_id') and not row.get('link'):
        return jsonify({'ok': False, 'error': 'Thiếu link hoặc ID'}), 400
    duplicated = _find_duplicate_managed_channel(row, exclude_id=channel_id)
    if duplicated:
        return jsonify({
            'ok': False,
            'error': f"Kênh này đã có trong danh sách: {duplicated.get('channel_name') or duplicated.get('target_id') or duplicated.get('id')}",
            'duplicate': _public_managed_channel(duplicated),
        }), 409
    if USE_SUPABASE:
        row, supabase_warning = _sync_managed_channel_supabase(row, channel_id=channel_id)
    else:
        supabase_warning = ''
    _managed_channels = [row if item.get('id') == channel_id else item for item in _managed_channels]
    if not any(item.get('id') == channel_id for item in _managed_channels):
        _managed_channels.append(row)
    _save_managed_channels()
    _sync_group_from_channel(row)
    assign_warning = supabase_warning
    if 'assigned_staff_ids' in body:
        if not _is_admin():
            return jsonify({'ok': False, 'error': 'Chỉ admin được phân công nhân sự cho kênh'}), 403
        assign_warning = _append_warning(assign_warning, _assign_staff_to_channel(row, body.get('assigned_staff_ids'), merge=False))
    return jsonify({
        'ok': True,
        'channel': _public_managed_channel(row),
        'channels': _visible_managed_channels(),
        'warning': assign_warning,
    })


@app.route('/api/channels/<channel_id>', methods=['DELETE'])
def channels_delete(channel_id):
    global _managed_channels
    target = next((item for item in _managed_channels if item.get('id') == channel_id), {})
    if USE_SUPABASE:
        try:
            sb.delete_managed_channel(channel_id, SUPABASE_CHANNEL_TABLE)
        except Exception as e:
            return jsonify({'ok': False, 'error': f'Không xoá được kênh trên Supabase: {_managed_channel_store_error(e)}'}), 500
    if target:
        _remove_channel_from_all_staff(target)
    _managed_channels = [item for item in _managed_channels if item.get('id') != channel_id]
    _save_managed_channels()
    return jsonify({'ok': True, 'channels': _visible_managed_channels()})


@app.route('/api/telegram/chatids', methods=['GET'])
def tg_get():
    return jsonify(_tg_chat_ids)


@app.route('/api/telegram/chatids', methods=['POST'])
def tg_add():
    cid = (request.get_json() or {}).get('chat_id', '').strip()
    if not cid:
        return jsonify({'ok': False, 'error': 'Thiếu chat_id'}), 400
    if cid not in _tg_chat_ids:
        _tg_chat_ids.append(cid)
        _save_tg()
        if USE_SUPABASE:
            try:
                sb.add_chat_id(cid)
            except Exception as e:
                print(f'[supabase] add_chat_id failed: {e}')
    return jsonify({'ok': True, 'chat_ids': _tg_chat_ids})


@app.route('/api/telegram/chatids/<chat_id>', methods=['DELETE'])
def tg_remove(chat_id):
    if chat_id in _tg_chat_ids:
        _tg_chat_ids.remove(chat_id)
        _save_tg()
        if USE_SUPABASE:
            try:
                sb.remove_chat_id(chat_id)
            except Exception as e:
                print(f'[supabase] remove_chat_id failed: {e}')
    return jsonify({'ok': True, 'chat_ids': _tg_chat_ids})


@app.route('/api/groups', methods=['GET'])
def groups_get():
    """Danh sách nhóm Facebook — chỉ từ bảng managed_channels (/kenh), lọc theo nhân sự."""
    _refresh_managed_channels_from_supabase()
    _restore_legacy_groups_to_managed_channels()
    visible = _filter_managed_channels_for_staff(_managed_channels)
    return jsonify(_facebook_group_channels(visible))


@app.route('/api/groups', methods=['POST'])
def groups_add():
    global _groups
    body = request.get_json() or {}
    gid = body.get('id', '').strip()
    name = body.get('name', '').strip()
    if not gid:
        return jsonify({'ok': False, 'error': 'Thiếu id'}), 400
    if not any(g['id'] == gid for g in _groups):
        _groups.append({'id': gid, 'name': name})
    else:
        for g in _groups:
            if g['id'] == gid and name:
                g['name'] = name
    _save_groups()
    if USE_SUPABASE:
        try:
            sb.upsert_group(gid, name)
        except Exception as e:
            print(f'[supabase] upsert_group failed: {e}')
    return jsonify({'ok': True, 'groups': _groups})


@app.route('/api/groups/<gid>', methods=['DELETE'])
def groups_remove(gid):
    global _groups, _managed_channels
    _groups = [g for g in _groups if g['id'] != gid]
    _save_groups()

    removed_channels = 0
    next_channels = []
    for item in _managed_channels:
        platform = str(item.get('platform') or '').strip().lower()
        channel_type = str(item.get('channel_type') or '').strip().lower()
        target_id = str(item.get('target_id') or '').strip()
        if platform == 'facebook' and channel_type in ('nhóm', 'nhom', 'group') and target_id == gid:
            removed_channels += 1
            if USE_SUPABASE:
                try:
                    sb.delete_managed_channel(str(item.get('id') or ''), SUPABASE_CHANNEL_TABLE)
                except Exception as e:
                    print(f'[supabase] delete_managed_channel from group remove failed: {e}')
            continue
        next_channels.append(item)
    if removed_channels:
        _managed_channels = next_channels
        _save_managed_channels()

    if USE_SUPABASE:
        try:
            sb.delete_group(gid)
        except Exception as e:
            print(f'[supabase] delete_group failed: {e}')
    return jsonify({
        'ok': True,
        'groups': _merged_facebook_groups(),
        'removed_channels': removed_channels,
    })


@app.route('/api/staff-cookies', methods=['GET'])
def staff_cookies_get():
    warning = ''
    refresh = str(request.args.get('refresh') or '').strip().lower() in ('1', 'true', 'yes')
    if refresh:
        _invalidate_staff_list_cache()
    if _is_admin():
        staff_rows, warning = _merged_public_staff_rows(refresh_remote=refresh)
    else:
        staff_rows = [_public_current_staff()] if _current_staff() else []
    payload = {
        'active_staff_id': _current_staff_id(),
        'staff': staff_rows,
        'can_manage': _is_admin(),
        'fallback_cookie': bool(load_cookie()),
    }
    current = _current_staff()
    if current:
        payload['facebook_context'] = _facebook_cookie_context_payload(current, resolve_name=False)
    if warning:
        payload['warning'] = warning
    return jsonify(payload)


@app.route('/api/facebook-cookie/context', methods=['GET'])
def facebook_cookie_context():
    staff = _current_staff()
    if not staff:
        return jsonify({'ok': False, 'error': 'Chưa đăng nhập'}), 401
    return jsonify(_facebook_cookie_context_payload(staff, resolve_name=True))


@app.route('/api/facebook-cookie/refresh-names', methods=['POST'])
def facebook_cookie_refresh_names():
    staff = _current_staff()
    if not staff:
        return jsonify({'ok': False, 'error': 'Chưa đăng nhập'}), 401
    context = _facebook_cookie_context_payload(staff, resolve_name=True, force_refresh=True)
    active_name = context.get('active_facebook_name') or ''
    if active_name:
        context['message'] = f'Đã cập nhật tên Facebook: {active_name}'
    else:
        context['message'] = 'Không đọc được tên Facebook. Kiểm tra cookie còn hợp lệ.'
    return jsonify(context)


@app.route('/api/facebook-cookie/switch', methods=['POST'])
def facebook_cookie_switch():
    staff = _current_staff()
    if not staff:
        return jsonify({'ok': False, 'error': 'Chưa đăng nhập'}), 401
    body = request.get_json() or {}
    cookie_id = str(body.get('cookie_id') or body.get('id') or '').strip()
    cookies = _normalize_staff_facebook_cookies(staff.get('facebook_cookies'), staff.get('cookie', ''))
    target = next((item for item in cookies if str(item.get('id') or '') == cookie_id), None)
    if not target:
        return jsonify({'ok': False, 'error': 'Không tìm thấy cookie'}), 404
    cookie = str(target.get('cookie') or '').strip()
    if not cookie:
        return jsonify({'ok': False, 'error': 'Cookie rỗng'}), 400
    _persist_active_cookie_choice(staff, cookie_id, cookie)
    _invalidate_staff_list_cache()
    profile = _fetch_facebook_profile(cookie, allow_token=True)
    context = _facebook_cookie_context_payload(_current_staff(), resolve_name=False)
    if profile.get('ok') and profile.get('name'):
        context['active_facebook_name'] = profile.get('name', '')
        for item in context.get('cookies') or []:
            if item.get('id') == cookie_id:
                item['facebook_name'] = profile.get('name', '')
    context['message'] = f"Đã chuyển sang {profile.get('name') or target.get('label') or 'cookie mới'}"
    return jsonify(context)


@app.route('/api/staff-cookies', methods=['POST'])
def staff_cookies_save():
    global _staff_cookies
    if not _is_admin():
        return jsonify({'ok': False, 'error': 'Chỉ admin được thêm nhân sự'}), 403
    try:
        body = request.get_json() or {}
        name = str(body.get('name') or '').strip()[:80]
        username = str(body.get('username') or '').strip().lower()[:60]
        password = str(body.get('password') or '')
        managed_groups = _normalize_staff_managed_groups(body.get('managed_groups'))
        facebook_cookies = _normalize_staff_facebook_cookies(
            body.get('facebook_cookies'),
            body.get('cookie', ''),
        )
        facebook_cookies, cookie_warning = _sanitize_staff_cookie_rows(facebook_cookies)
        facebook_cookies = _prepare_staff_facebook_cookies_for_save(facebook_cookies, fetch_names=False)
        cookie = _primary_staff_cookie({'facebook_cookies': facebook_cookies, 'cookie': ''})
        if not name:
            return jsonify({'ok': False, 'error': 'Thiếu tên nhân sự'}), 400
        if not username:
            return jsonify({'ok': False, 'error': 'Thiếu tài khoản đăng nhập'}), 400
        if len(password) < 6:
            return jsonify({'ok': False, 'error': 'Mật khẩu tối thiểu 6 ký tự'}), 400

        staff = _staff_cookies.setdefault('staff', [])
        if any(
            item.get('username') == username and _as_enabled(item.get('enabled', True))
            for item in staff
        ):
            return jsonify({'ok': False, 'error': 'Tài khoản đăng nhập đã tồn tại'}), 400
        existing_row = {}
        if USE_SUPABASE:
            existing_row, existing_error = _load_supabase_staff(username)
            if existing_row and _as_enabled(existing_row.get('enabled', True)):
                return jsonify({'ok': False, 'error': 'Tài khoản đăng nhập đã tồn tại trong Supabase'}), 400
            if existing_error and 'Could not find the table' in existing_error:
                return jsonify({'ok': False, 'error': f'Chưa có bảng {SUPABASE_STAFF_TABLE} trong Supabase'}), 500
        now = datetime.utcnow().isoformat(timespec='seconds') + 'Z'
        saved_id = uuid.uuid4().hex[:12]
        salt, digest = _hash_password(password)
        remote_row = {
            'id': saved_id,
            'name': name,
            'username': username,
            'password': password,
            'role': 'staff',
            'cookie': cookie,
            'facebook_user_id': _extract_cookie_user(cookie),
            'managed_groups': managed_groups,
            'facebook_cookies': facebook_cookies,
            'enabled': True,
        }
        write_warning = ''
        supabase_saved = not USE_SUPABASE
        if USE_SUPABASE:
            try:
                if existing_row and not _as_enabled(existing_row.get('enabled', True)):
                    remote_row['id'] = existing_row.get('id') or saved_id
                    _, dropped = sb.update_staff_user(username, remote_row, SUPABASE_STAFF_TABLE)
                    saved_id = remote_row['id']
                else:
                    _, dropped = sb.insert_staff_user(remote_row, SUPABASE_STAFF_TABLE)
                supabase_saved = True
                write_warning = _supabase_staff_write_warning(dropped)
            except Exception as e:
                err = str(e)
                if sb.is_missing_column_error(err):
                    missing = []
                    if 'facebook_cookies' in err:
                        missing.append('facebook_cookies')
                    if 'managed_groups' in err:
                        missing.append('managed_groups')
                    if 'active_cookie_id' in err:
                        missing.append('active_cookie_id')
                    write_warning = _supabase_staff_write_warning(missing or ['facebook_cookies'])
                else:
                    return jsonify({
                        'ok': False,
                        'error': f'Không lưu được nhân sự lên Supabase: {err}',
                    }), 500

        if USE_SUPABASE and not supabase_saved:
            return jsonify({
                'ok': False,
                'error': 'Không lưu được nhân sự lên Supabase. Chạy patch SQL staff_users rồi thử lại.',
            }), 500

        local_row = {
            'id': saved_id,
            'name': name,
            'username': username,
            'password_salt': salt,
            'password_hash': digest,
            'cookie': cookie,
            'role': 'staff',
            'managed_groups': managed_groups,
            'facebook_cookies': facebook_cookies,
            'enabled': True,
            'created_at': now,
            'updated_at': now,
        }
        staff.append(local_row)
        if not _staff_cookies.get('active_staff_id'):
            _staff_cookies['active_staff_id'] = saved_id
        _save_staff_cookies()
        _invalidate_facebook_cache()
        _schedule_staff_cookie_name_refresh(saved_id, facebook_cookies)
        staff_rows, warning = _staff_list_after_change()
        warnings = [part for part in [warning, write_warning, cookie_warning] if part]
        return jsonify({
            'ok': True,
            'active_staff_id': _current_staff_id(),
            'staff': staff_rows,
            'can_manage': True,
            'storage': 'supabase' if USE_SUPABASE else 'local',
            'warning': ' | '.join(warnings),
        })
    except Exception as e:
        return jsonify({'ok': False, 'error': f'Không lưu được nhân sự: {e}'}), 500


@app.route('/api/staff-cookies/<staff_id>', methods=['PUT', 'PATCH'])
def staff_cookies_update(staff_id):
    body = request.get_json() or {}
    is_self = staff_id == _current_staff_id()
    if not _is_admin() and not is_self:
        return jsonify({'ok': False, 'error': 'Chỉ admin được sửa nhân sự'}), 403

    staff = _staff_accounts()
    local_target = next((item for item in staff if item.get('id') == staff_id), {})
    remote_target = {}
    remote_warning = ''
    if USE_SUPABASE:
        remote_row_raw, remote_warning = _load_supabase_staff_by_id(staff_id)
        if remote_row_raw:
            remote_target = _normalize_supabase_staff(remote_row_raw)

    # Supabase is the source of truth in production. Local JSON can be stale
    # after deploys, so let remote values win when both records exist.
    target = {**local_target, **remote_target}
    if not target:
        return jsonify({'ok': False, 'error': 'Không tìm thấy nhân sự'}), 404

    self_service = is_self and not _is_admin()
    name = str(target.get('name', '') or '').strip()[:80]
    username = str(target.get('username', '') or '').strip().lower()[:60]
    password = str(body.get('password') or '')
    managed_groups = _normalize_staff_managed_groups(target.get('managed_groups'))
    if not self_service:
        name = str(body.get('name', target.get('name', '')) or '').strip()[:80]
        username = str(body.get('username', target.get('username', '')) or '').strip().lower()[:60]
        managed_groups = _normalize_staff_managed_groups(
            body.get('managed_groups') if 'managed_groups' in body else target.get('managed_groups'),
        )
    incoming_cookies = body.get('facebook_cookies') if 'facebook_cookies' in body else None
    if incoming_cookies is None and body.get('cookie'):
        incoming_cookies = [{'id': 'primary', 'label': 'Cookie chính', 'cookie': body.get('cookie', '')}]
    facebook_cookies = _merge_staff_facebook_cookies(incoming_cookies, target)
    facebook_cookies, cookie_warning = _sanitize_staff_cookie_rows(facebook_cookies)
    facebook_cookies = _prepare_staff_facebook_cookies_for_save(facebook_cookies, fetch_names=True)
    cookie = _primary_staff_cookie({'facebook_cookies': facebook_cookies, 'cookie': target.get('cookie', '')})

    if not self_service:
        if not name:
            return jsonify({'ok': False, 'error': 'Thiếu tên nhân sự'}), 400
        if not username:
            return jsonify({'ok': False, 'error': 'Thiếu tài khoản đăng nhập'}), 400
    if password and len(password) < 6:
        return jsonify({'ok': False, 'error': 'Mật khẩu tối thiểu 6 ký tự'}), 400

    if not self_service:
        for item in staff:
            if item.get('id') != staff_id and item.get('username') == username and _as_enabled(item.get('enabled', True)):
                return jsonify({'ok': False, 'error': 'Tài khoản đăng nhập đã tồn tại'}), 400
        if USE_SUPABASE:
            existing_row, existing_error = _load_supabase_staff(username)
            if existing_row and str(existing_row.get('id') or '') != staff_id and _as_enabled(existing_row.get('enabled', True)):
                return jsonify({'ok': False, 'error': 'Tài khoản đăng nhập đã tồn tại trong Supabase'}), 400
            if existing_error and 'Could not find the table' in existing_error:
                return jsonify({'ok': False, 'error': f'Chưa có bảng {SUPABASE_STAFF_TABLE} trong Supabase'}), 500

    now = datetime.utcnow().isoformat(timespec='seconds') + 'Z'
    remote_row = {
        'name': name,
        'username': username,
        'role': target.get('role') or 'staff',
        'managed_groups': managed_groups,
        'facebook_cookies': facebook_cookies,
        'cookie': cookie,
        'facebook_user_id': _extract_cookie_user(cookie),
        'enabled': True,
        'updated_at': now,
    }
    if password:
        remote_row['password'] = password

    if USE_SUPABASE:
        write_warning = ''
        try:
            _, dropped = sb.update_staff_user_by_id(staff_id, remote_row, SUPABASE_STAFF_TABLE)
            write_warning = _supabase_staff_write_warning(dropped)
        except Exception as e:
            err = str(e)
            if sb.is_missing_column_error(err):
                missing = []
                if 'facebook_cookies' in err:
                    missing.append('facebook_cookies')
                if 'managed_groups' in err:
                    missing.append('managed_groups')
                if 'active_cookie_id' in err:
                    missing.append('active_cookie_id')
                write_warning = _supabase_staff_write_warning(missing or ['facebook_cookies'])
            else:
                return jsonify({'ok': False, 'error': f'Không cập nhật được nhân sự trên Supabase: {e}'}), 500
    else:
        write_warning = ''

    if local_target:
        local_target['name'] = name
        local_target['username'] = username
        local_target['role'] = target.get('role') or local_target.get('role') or 'staff'
        local_target['managed_groups'] = managed_groups
        local_target['facebook_cookies'] = facebook_cookies
        local_target['cookie'] = cookie
        local_target['facebook_user_id'] = _extract_cookie_user(cookie)
        local_target['updated_at'] = now
        if password:
            salt, digest = _hash_password(password)
            local_target['password_salt'] = salt
            local_target['password_hash'] = digest
    else:
        local_row = {
            'id': staff_id,
            'name': name,
            'username': username,
            'role': target.get('role') or 'staff',
            'managed_groups': managed_groups,
            'facebook_cookies': facebook_cookies,
            'cookie': cookie,
            'facebook_user_id': _extract_cookie_user(cookie),
            'enabled': True,
            'created_at': target.get('created_at') or now,
            'updated_at': now,
        }
        if password:
            salt, digest = _hash_password(password)
            local_row['password_salt'] = salt
            local_row['password_hash'] = digest
        staff.append(local_row)

    _save_staff_cookies()
    _invalidate_facebook_cache()
    _schedule_staff_cookie_name_refresh(staff_id, facebook_cookies)

    if staff_id == _current_staff_id():
        refreshed_staff = {
            **target,
            **remote_row,
            'id': staff_id,
            'created_at': target.get('created_at') or now,
            '_auth_source': 'supabase' if USE_SUPABASE else target.get('_auth_source', 'local'),
        }
        refreshed_staff['cookie'] = cookie
        refreshed_staff['facebook_cookies'] = facebook_cookies
        refreshed_staff['facebook_user_id'] = _extract_cookie_user(cookie)
        _set_logged_in_staff(refreshed_staff)

    staff_rows, warning = _staff_list_after_change()
    warnings = [part for part in [warning, remote_warning, write_warning, cookie_warning] if part]
    return jsonify({
        'ok': True,
        'active_staff_id': _current_staff_id(),
        'staff': staff_rows,
        'can_manage': _is_admin(),
        'storage': 'supabase' if USE_SUPABASE else 'local',
        'warning': ' | '.join(warnings),
    })


@app.route('/api/staff-cookies/<staff_id>/activate', methods=['POST'])
def staff_cookies_activate(staff_id):
    return jsonify({'ok': False, 'error': 'Cookie được gắn theo tài khoản đăng nhập, không cho chọn thủ công'}), 403


@app.route('/api/staff-cookies/<staff_id>', methods=['DELETE'])
def staff_cookies_delete(staff_id):
    if not _is_admin():
        return jsonify({'ok': False, 'error': 'Chỉ admin được xoá nhân sự'}), 403
    if staff_id == _current_staff_id():
        return jsonify({'ok': False, 'error': 'Không thể xoá tài khoản đang đăng nhập'}), 400
    staff = _staff_accounts()
    target = next((item for item in staff if item.get('id') == staff_id), {})
    if USE_SUPABASE:
        try:
            sb.delete_staff_user(staff_id=staff_id, username=target.get('username', ''), table=SUPABASE_STAFF_TABLE)
        except Exception as e:
            return jsonify({'ok': False, 'error': f'Không xoá được nhân sự trên Supabase: {e}'}), 500
    _staff_cookies['staff'] = [item for item in staff if item.get('id') != staff_id]
    if _staff_cookies.get('active_staff_id') == staff_id:
        _staff_cookies['active_staff_id'] = (_staff_cookies['staff'][0]['id'] if _staff_cookies['staff'] else '')
    _clear_staff_access_token(staff_id)
    _save_staff_cookies()
    _invalidate_facebook_cache()
    staff_rows, warning = _staff_list_after_change()
    return jsonify({'ok': True, 'active_staff_id': _current_staff_id(), 'staff': staff_rows, 'can_manage': True, 'warning': warning})


@app.route('/api/settings', methods=['GET'])
def settings_get():
    return jsonify(_settings)


@app.route('/api/settings', methods=['POST'])
def settings_save():
    global _settings
    body = request.get_json() or {}
    _settings.update({k: v for k, v in body.items() if k in ('auto_refresh', 'interval')})
    _save_settings()
    return jsonify({'ok': True, 'settings': _settings})


CONTENT_STUDIO_SETUP_KV = 'content_studio_setup'
CONTENT_TECHNIQUES_KV = 'content_techniques'
CONTENT_SECTION_KEYS = ('opening', 'body', 'ending')
CONTENT_SECTION_LABELS = {
    'opening': 'HOOK',
    'body': 'BODY',
    'ending': 'CTA',
}
APP_KV_RLS_FIX_HINT = (
    'Supabase app_kv đang chặn ghi do RLS. '
    'Sửa bằng cách thêm SUPABASE_SERVICE_ROLE_KEY cho backend hoặc chạy supabase_app_kv_rls_fix.sql trong Supabase SQL Editor.'
)
CUSTOMER_AI_CONTENT_SETUP_HINT = (
    f'Chạy lại file supabase_customer_ai_settings.sql để thêm cột content_setup cho bảng {SUPABASE_CUSTOMER_AI_TABLE}.'
)
CUSTOMER_AI_CONTENT_TECHNIQUES_HINT = (
    f'Chạy lại file supabase_customer_ai_settings.sql để thêm cột content_techniques cho bảng {SUPABASE_CUSTOMER_AI_TABLE}.'
)
CONTENT_SECTION_BLOCK_TYPES = {
    'opening': {'hook', 'h1', 'h2'},
    'body': {'body', 'text', 'scene', 'quote', 'image'},
    'ending': {'cta'},
}


def _trim_words(text: str, limit: int = 3) -> str:
    words = re.findall(r'\S+', str(text or '').strip())
    return ' '.join(words[:limit])


def _trim_lines(text: str, limit: int = 3) -> str:
    lines = [line.rstrip() for line in str(text or '').replace('\r\n', '\n').replace('\r', '\n').split('\n')]
    return '\n'.join(lines[:limit]).strip()


def _clean_content_studio_setup(raw) -> dict:
    default = _default_content_studio_setup()
    source = raw if isinstance(raw, dict) else {}
    raw_sections = source.get('sections') if isinstance(source.get('sections'), dict) else source
    sections: dict = {}
    for key in CONTENT_SECTION_KEYS:
        incoming = raw_sections.get(key) if isinstance(raw_sections, dict) else {}
        if not isinstance(incoming, dict):
            incoming = {}
        base = default['sections'][key]
        rule = str(incoming.get('rule') or base.get('rule') or '').strip()[:4000]
        if key == 'opening':
            rule = _trim_lines(rule, 3)
        sections[key] = {
            'label': CONTENT_SECTION_LABELS[key],
            'name': str(incoming.get('name') or base.get('name') or '').strip()[:80],
            'description': _trim_words(incoming.get('description') or base.get('description') or '', 3),
            'rule': rule,
        }
    return {'sections': sections}


def _app_kv_storage_warning(exc: Exception) -> str:
    message = str(exc or '')[:300]
    lowered = message.lower()
    if 'row-level security' in lowered or '42501' in lowered:
        return f'{APP_KV_RLS_FIX_HINT} Chi tiết: {message}'
    if 'permission denied' in lowered or 'permission' in lowered:
        return f'Supabase app_kv chưa cấp quyền ghi cho key hiện tại. {APP_KV_RLS_FIX_HINT} Chi tiết: {message}'
    return message


def _content_ai_settings_key() -> str:
    return _current_staff_ai_key() or 'default'


def _load_content_ai_row() -> tuple[dict | None, str]:
    if not USE_SUPABASE:
        return None, ''
    try:
        return sb.get_customer_ai_settings(_content_ai_settings_key(), SUPABASE_CUSTOMER_AI_TABLE), ''
    except Exception as e:
        return None, str(e)[:300]


def _save_content_ai_row(payload: dict) -> tuple[bool, str]:
    if not USE_SUPABASE:
        return False, 'Chưa cấu hình Supabase'
    staff = _current_staff()
    staff_key = _content_ai_settings_key()
    try:
        sb.upsert_customer_ai_settings({
            'staff_key': staff_key,
            'staff_id': str(staff.get('id') or '') if staff_key != 'default' else '',
            'username': str(staff.get('username') or '') if staff_key != 'default' else '',
            'customer_name': str(staff.get('name') or staff.get('username') or '') if staff_key != 'default' else 'Default',
            **payload,
        }, SUPABASE_CUSTOMER_AI_TABLE)
        return True, ''
    except Exception as e:
        return False, str(e)[:300]


def _load_content_studio_setup() -> tuple[dict, str, str]:
    local = _clean_content_studio_setup(_read_json(CONTENT_STUDIO_SETUP_FILE, _default_content_studio_setup()))
    row, warning = _load_content_ai_row()
    if row and isinstance(row.get('content_setup'), dict):
        setup = _clean_content_studio_setup(row.get('content_setup'))
        _write_json(CONTENT_STUDIO_SETUP_FILE, setup)
        return setup, 'supabase', ''
    if warning:
        return local, 'local', f'Supabase chưa đọc được cấu hình prompt theo user. {warning} ({_supabase_debug_context(SUPABASE_CUSTOMER_AI_TABLE)})'
    return local, 'local', ''


def _save_content_studio_setup(setup: dict) -> tuple[str, str]:
    cleaned = _clean_content_studio_setup(setup)
    _write_json(CONTENT_STUDIO_SETUP_FILE, cleaned)
    ok, warning = _save_content_ai_row({'content_setup': cleaned})
    if ok:
        return 'supabase', ''
    if warning:
        if 'PGRST204' in warning or 'content_setup' in warning:
            return 'local', f'{CUSTOMER_AI_CONTENT_SETUP_HINT} Chi tiết: {warning} ({_supabase_debug_context(SUPABASE_CUSTOMER_AI_TABLE)})'
        return 'local', f'Supabase chưa ghi được cấu hình prompt theo user: {warning} ({_supabase_debug_context(SUPABASE_CUSTOMER_AI_TABLE)})'
    return 'local', ''


def _technique_id(name: str) -> str:
    compact = re.sub(r'[^0-9a-zA-Z]+', '-', str(name or '').strip().lower()).strip('-')
    return compact[:80] or f'tech-{uuid.uuid4().hex[:10]}'


def _clean_content_techniques(rows) -> list[dict]:
    if not isinstance(rows, list):
        rows = []
    cleaned: list[dict] = []
    seen: set[str] = set()
    now = datetime.utcnow().isoformat(timespec='seconds') + 'Z'
    for raw in rows[:300]:
        if not isinstance(raw, dict):
            continue
        name = str(raw.get('name') or '').strip()[:120]
        content = str(raw.get('content') or '').strip()[:12000]
        if not name or not content:
            continue
        tech_id = str(raw.get('id') or _technique_id(name)).strip()[:120]
        base_id = tech_id
        suffix = 2
        while tech_id in seen:
            tech_id = f'{base_id}-{suffix}'
            suffix += 1
        seen.add(tech_id)
        cleaned.append({
            'id': tech_id,
            'name': name,
            'content': content,
            'created_at': str(raw.get('created_at') or now)[:40],
            'updated_at': str(raw.get('updated_at') or now)[:40],
            'system': bool(raw.get('system')),
        })
    return cleaned


def _ensure_system_content_techniques(rows: list[dict]) -> tuple[list[dict], bool]:
    defaults = _default_content_techniques()
    existing_names = {str(item.get('name') or '').strip().lower() for item in rows if str(item.get('name') or '').strip()}
    existing_ids = {str(item.get('id') or '').strip().lower() for item in rows if str(item.get('id') or '').strip()}
    merged = list(rows)
    changed = False
    for default in defaults:
        name_key = str(default.get('name') or '').strip().lower()
        id_key = str(default.get('id') or '').strip().lower()
        if name_key in existing_names or id_key in existing_ids:
            continue
        merged.append(dict(default))
        changed = True
    if not merged:
        merged = [dict(item) for item in defaults]
        changed = True
    return _clean_content_techniques(merged), changed


def _load_content_techniques() -> tuple[list[dict], str, str]:
    local_raw = _read_json(CONTENT_TECHNIQUES_FILE, None)
    local = _clean_content_techniques(local_raw if isinstance(local_raw, list) else [])
    row, warning = _load_content_ai_row()
    storage = 'local'
    rows = local
    if row and isinstance(row.get('content_techniques'), list):
        rows = _clean_content_techniques(row.get('content_techniques'))
        storage = 'supabase'
    rows, seeded = _ensure_system_content_techniques(rows)
    if seeded:
        storage, save_warning = _save_content_techniques(rows)
        seed_note = 'Đã tự thêm kỹ thuật marketing mặc định (PAS, AIDA, BAB, Storytelling, Social Proof).'
        if save_warning:
            return rows, storage, f'{seed_note} {save_warning}'
        return rows, storage, seed_note
    if warning:
        return rows, storage, f'Supabase chưa đọc được kỹ thuật content theo user. {warning} ({_supabase_debug_context(SUPABASE_CUSTOMER_AI_TABLE)})'
    return rows, storage, ''


def _save_content_techniques(rows: list[dict]) -> tuple[str, str]:
    cleaned = _clean_content_techniques(rows)
    _write_json(CONTENT_TECHNIQUES_FILE, cleaned)
    ok, warning = _save_content_ai_row({'content_techniques': cleaned})
    if ok:
        return 'supabase', ''
    if warning:
        if 'PGRST204' in warning or 'content_techniques' in warning:
            return 'local', f'{CUSTOMER_AI_CONTENT_TECHNIQUES_HINT} Chi tiết: {warning} ({_supabase_debug_context(SUPABASE_CUSTOMER_AI_TABLE)})'
        return 'local', f'Supabase chưa ghi được kỹ thuật content theo user: {warning} ({_supabase_debug_context(SUPABASE_CUSTOMER_AI_TABLE)})'
    return 'local', ''


def _strip_json_fence_local(text: str) -> str:
    text = (text or '').strip()
    if text.startswith('```'):
        lines = text.split('\n')
        end = len(lines) - 1 if lines and lines[-1].strip().startswith('```') else len(lines)
        text = '\n'.join(lines[1:end]).strip()
    return text


def _load_json_payload_local(text: str):
    text = _strip_json_fence_local(text)
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        pass
    match = re.search(r'(\{.*\}|\[.*\])', text, re.DOTALL)
    if match:
        try:
            return json.loads(match.group())
        except json.JSONDecodeError:
            pass
    return None


def _plain_from_html(text: str) -> str:
    text = re.sub(r'<br\s*/?>', '\n', str(text or ''), flags=re.I)
    text = re.sub(r'</(p|div|li|h[1-6])>', '\n', text, flags=re.I)
    text = re.sub(r'<[^>]+>', '', text)
    text = unescape(text).replace('\xa0', ' ')
    return re.sub(r'[ \t]+\n', '\n', text).strip()


def _script_sections(script: dict) -> dict:
    sections = {key: [] for key in CONTENT_SECTION_KEYS}
    blocks = script.get('blocks') if isinstance(script, dict) else []
    if not isinstance(blocks, list):
        blocks = []
    for block in blocks:
        if not isinstance(block, dict):
            continue
        block_type = str(block.get('type') or 'text').strip().lower()
        text = _plain_from_html(str(block.get('text') or ''))
        if not text:
            continue
        target = ''
        for key, types in CONTENT_SECTION_BLOCK_TYPES.items():
            if block_type in types:
                target = key
                break
        if not target:
            target = 'body'
        sections[target].append(text)
    return {key: '\n\n'.join(parts).strip() for key, parts in sections.items()}


def _normalize_mention_text(text: str) -> str:
    return re.sub(r'[\s_@#.\-]+', '', str(text or '').lower())


def _resolve_content_techniques(message: str, selected_ids: list[str] | None = None) -> list[dict]:
    rows, _, _ = _load_content_techniques()
    selected = {str(item or '').strip() for item in (selected_ids or []) if str(item or '').strip()}
    normalized_message = _normalize_mention_text(message)
    resolved: list[dict] = []
    for row in rows:
        tech_id = str(row.get('id') or '')
        name = str(row.get('name') or '')
        normalized_name = _normalize_mention_text(name)
        if tech_id in selected or (normalized_name and normalized_name in normalized_message):
            resolved.append(row)
    return resolved[:8]


def _build_script_ai_prompt(
    message: str,
    script: dict,
    active_section: str,
    setup: dict,
    techniques: list[dict],
) -> str:
    sections = _script_sections(script)
    setup_sections = setup.get('sections') if isinstance(setup, dict) else {}
    setup_lines = []
    for key in CONTENT_SECTION_KEYS:
        conf = setup_sections.get(key, {}) if isinstance(setup_sections, dict) else {}
        setup_lines.append(
            f'- {CONTENT_SECTION_LABELS[key]} | Tên: {conf.get("name", "")} | '
            f'Mô tả: {conf.get("description", "")} | Rule: {conf.get("rule", "")}'
        )
    technique_lines = []
    for item in techniques:
        technique_lines.append(f'- {item.get("name")}: {item.get("content")}')
    technique_text = '\n'.join(technique_lines) if technique_lines else '- Không có kỹ thuật được gọi bằng @ hoặc tên kỹ thuật.'
    active_label = CONTENT_SECTION_LABELS.get(active_section, 'Toàn bài')
    current_json = json.dumps({
        'opening': sections.get('opening', ''),
        'body': sections.get('body', ''),
        'ending': sections.get('ending', ''),
    }, ensure_ascii=False)
    return f"""Bạn là trợ lý AI viết content tiếng Việt cho Content Studio.

NHIỆM VỤ:
- Đọc nội dung hiện tại của thanh kết quả AI bên trái theo các block content: HOOK, BODY, CTA.
- Đọc rule setup cố định và kỹ thuật content được gọi từ database.
- Nếu người dùng đang chọn một phần cụ thể, chỉ xử lý phần đó, trừ khi câu lệnh yêu cầu rõ "toàn bài", "full", hoặc nêu nhiều phần.
- Giữ nguyên cấu trúc cũ. Khi người dùng yêu cầu đổi một chi tiết nhỏ, chỉ thay đúng chi tiết đó trong phần được chọn.
- Không bịa thông tin sản phẩm, giá, bảo hành, ưu đãi.
- HOOK bắt buộc tối đa 3 dòng.

PHẦN ĐANG CHỌN: {active_section or 'all'} ({active_label})

NỘI DUNG HIỆN TẠI Ở THANH BÊN TRÁI:
{current_json}

RULE SETUP:
{chr(10).join(setup_lines)}

KỸ THUẬT CONTENT TỪ DATABASE:
{technique_text}

CÂU LỆNH NGƯỜI DÙNG:
{message}

Trả về CHỈ JSON object, không markdown, đúng cấu trúc:
{{
  "reply": "giải thích ngắn cho người dùng",
  "target_section": "opening|body|ending|all|none",
  "action": "replace|append|none",
  "image_prompt": "mô tả ảnh minh họa nếu người dùng yêu cầu ảnh; không yêu cầu thì để rỗng",
  "sections": {{
    "opening": "nội dung HOOK mới nếu có",
    "body": "nội dung BODY mới nếu có",
    "ending": "nội dung CTA mới nếu có"
  }}
}}"""


def _normalize_script_ai_result(payload, fallback_text: str, active_section: str) -> dict:
    if not isinstance(payload, dict):
        payload = {}
    raw_sections = payload.get('sections') if isinstance(payload.get('sections'), dict) else {}
    sections = {}
    for key in CONTENT_SECTION_KEYS:
        text = str(raw_sections.get(key) or payload.get(key) or '').strip()
        if key == 'opening' and text:
            text = _trim_lines(text, 3)
        sections[key] = text[:50000]
    target = str(payload.get('target_section') or active_section or 'none').strip().lower()
    if target not in {'opening', 'body', 'ending', 'all', 'none'}:
        target = active_section if active_section in CONTENT_SECTION_KEYS else 'none'
    action = str(payload.get('action') or ('replace' if any(sections.values()) else 'none')).strip().lower()
    if action not in {'replace', 'append', 'none'}:
        action = 'replace'
    return {
        'reply': str(payload.get('reply') or fallback_text or '').strip()[:4000],
        'target_section': target,
        'action': action,
        'image_prompt': str(payload.get('image_prompt') or '').strip()[:4000],
        'sections': sections,
    }


def _fallback_gemini_models() -> list[dict]:
    rows = [
        ('gemini-3.1-pro-preview', 'Gemini 3.1 Pro Preview'),
        ('gemini-2.5-pro', 'Gemini 2.5 Pro'),
        ('gemini-3.5-flash', 'Gemini 3.5 Flash'),
        ('gemini-3.1-flash-lite', 'Gemini 3.1 Flash-Lite'),
        ('gemini-2.5-flash', 'Gemini 2.5 Flash'),
        ('gemini-flash-latest', 'Gemini Flash Latest'),
    ]
    return [
        {
            'id': model_id,
            'name': f'models/{model_id}',
            'display_name': label,
            'description': '',
            'supported_generation_methods': ['generateContent'],
        }
        for model_id, label in rows
    ]


def _fallback_groq_models() -> list[dict]:
    return [
        {'id': 'llama-3.3-70b-versatile', 'name': 'llama-3.3-70b-versatile', 'display_name': 'Groq Llama 3.3 70B Versatile'},
        {'id': 'llama-3.1-8b-instant', 'name': 'llama-3.1-8b-instant', 'display_name': 'Groq Llama 3.1 8B Instant'},
        {'id': 'openai/gpt-oss-120b', 'name': 'openai/gpt-oss-120b', 'display_name': 'Groq GPT OSS 120B'},
        {'id': 'openai/gpt-oss-20b', 'name': 'openai/gpt-oss-20b', 'display_name': 'Groq GPT OSS 20B'},
        {'id': 'qwen/qwen3-32b', 'name': 'qwen/qwen3-32b', 'display_name': 'Groq Qwen3 32B'},
    ]


def _list_gemini_models_from_api() -> tuple[list[dict], str]:
    api_key = _get_ai_key('gemini')
    if not api_key:
        return _fallback_gemini_models(), 'Chưa có Gemini API key nên đang dùng danh sách model gợi ý.'
    models: list[dict] = []
    page_token = ''
    try:
        for _ in range(10):
            params = {'key': api_key, 'pageSize': 1000}
            if page_token:
                params['pageToken'] = page_token
            resp = _req.get('https://generativelanguage.googleapis.com/v1beta/models', params=params, timeout=30)
            data = resp.json()
            if 'error' in data:
                raise RuntimeError(data['error'].get('message') or 'Gemini models API error')
            for item in data.get('models') or []:
                name = str(item.get('name') or '')
                model_id = name.replace('models/', '', 1)
                if 'gemini' not in model_id.lower():
                    continue
                methods = item.get('supportedGenerationMethods') or item.get('supported_actions') or []
                if methods and 'generateContent' not in methods:
                    continue
                models.append({
                    'id': model_id,
                    'name': name,
                    'display_name': item.get('displayName') or item.get('display_name') or model_id,
                    'description': item.get('description') or '',
                    'version': item.get('version') or '',
                    'input_token_limit': item.get('inputTokenLimit') or item.get('input_token_limit'),
                    'output_token_limit': item.get('outputTokenLimit') or item.get('output_token_limit'),
                    'supported_generation_methods': methods,
                })
            page_token = str(data.get('nextPageToken') or '')
            if not page_token:
                break
    except Exception as e:
        return _fallback_gemini_models(), f'Không tải được danh sách model từ Gemini API, đang dùng fallback: {str(e)[:180]}'
    models.sort(key=lambda item: (
        0 if 'pro' in item['id'].lower() else 1,
        0 if 'preview' not in item['id'].lower() else 1,
        item['id'],
    ))
    return models or _fallback_gemini_models(), ''


def _list_groq_models_from_api() -> tuple[list[dict], str]:
    api_key = _get_ai_key('groq')
    if not api_key:
        return _fallback_groq_models(), 'Chưa có Groq API key nên đang dùng danh sách model gợi ý.'
    try:
        resp = _req.get(
            'https://api.groq.com/openai/v1/models',
            headers={
                'Authorization': f'Bearer {api_key}',
                'Content-Type': 'application/json',
            },
            timeout=25,
        )
        data = resp.json()
        if 'error' in data:
            err = data.get('error') or {}
            raise RuntimeError(err.get('message') or 'Groq models API error')
        rows = data.get('data') if isinstance(data, dict) else []
        models = []
        for item in rows if isinstance(rows, list) else []:
            model_id = str(item.get('id') or item.get('name') or '').strip()
            if not model_id:
                continue
            owned_by = str(item.get('owned_by') or '').strip()
            models.append({
                'id': model_id,
                'name': model_id,
                'display_name': model_id,
                'description': owned_by,
            })
        models.sort(key=lambda row: row.get('display_name', row.get('id', '')))
        return models or _fallback_groq_models(), ''
    except Exception as e:
        return _fallback_groq_models(), f'Không tải được danh sách model từ Groq API, đang dùng fallback: {str(e)[:180]}'


def _is_missing_supabase_table_error(message: str) -> bool:
    text = str(message or '')
    return 'Could not find the table' in text or 'PGRST205' in text


def _is_content_scripts_rls_error(message: str) -> bool:
    text = str(message or '').lower()
    return '42501' in text or 'row-level security' in text


def _content_scripts_supabase_warning(exc: Exception) -> str:
    message = str(exc or '')
    if _is_content_scripts_rls_error(message):
        return CONTENT_SCRIPTS_RLS_HINT
    if 'PGRST205' in message or 'schema cache' in message.lower():
        return CONTENT_SCRIPTS_CACHE_HINT
    if _is_missing_supabase_table_error(message):
        return CONTENT_SCRIPTS_MISSING_HINT
    return message


def _content_scripts_should_fallback_local(exc: Exception) -> bool:
    message = str(exc or '')
    return (
        _is_missing_supabase_table_error(message)
        or _is_content_scripts_rls_error(message)
    )


def _load_scripts_local() -> list:
    rows = _read_json(SCRIPTS_FILE, [])
    return rows if isinstance(rows, list) else []


def _save_scripts_local(rows: list) -> None:
    _write_json(SCRIPTS_FILE, rows)


def _clean_script_library(rows) -> list[dict]:
    if not isinstance(rows, list):
        return []
    allowed_statuses = {'draft', 'pending', 'approved'}
    allowed_block_types = {'text', 'h1', 'h2', 'hook', 'body', 'cta', 'scene', 'quote', 'image'}
    cleaned = []
    for raw in rows[:500]:
        if not isinstance(raw, dict):
            continue
        script_id = str(raw.get('id') or '').strip()[:160]
        title = str(raw.get('title') or '').strip()[:300]
        if not script_id or not title:
            continue
        blocks = []
        for raw_block in (raw.get('blocks') or [])[:300]:
            if not isinstance(raw_block, dict):
                continue
            block_id = str(raw_block.get('id') or '').strip()[:160]
            block_type = str(raw_block.get('type') or 'text').strip().lower()
            if not block_id:
                continue
            block_row = {
                'id': block_id,
                'type': block_type if block_type in allowed_block_types else 'text',
                'text': str(raw_block.get('text') or '')[:50000],
            }
            align = str(raw_block.get('align') or '').strip().lower()
            if align in {'left', 'center', 'right', 'justify'}:
                block_row['align'] = align
            blocks.append(block_row)
        status = str(raw.get('status') or 'draft').strip().lower()
        cleaned.append({
            'id': script_id,
            'title': title,
            'platform': str(raw.get('platform') or 'TikTok').strip()[:80],
            'status': status if status in allowed_statuses else 'draft',
            'writer': str(raw.get('writer') or '').strip()[:160],
            'date': str(raw.get('date') or '').strip()[:40],
            'blocks': blocks,
        })
    return cleaned


WORKFLOW_STATUSES = {'todo', 'doing', 'pending', 'approved', 'archived'}
WORKFLOW_TO_SCRIPT_STATUS = {
    'todo': 'draft',
    'doing': 'draft',
    'pending': 'pending',
    'approved': 'approved',
    'archived': 'approved',
}
SCRIPT_TO_WORKFLOW_STATUS = {
    'draft': 'doing',
    'pending': 'pending',
    'approved': 'approved',
}
PLAN_COL_TO_WORKFLOW_STATUS = {
    0: 'todo',
    1: 'doing',
    2: 'pending',
    3: 'approved',
}
WORKFLOW_STATUS_TO_PLAN_COL = {
    'todo': 0,
    'doing': 1,
    'pending': 2,
    'approved': 3,
    'archived': 3,
}
PRIORITY_TO_BADGE = {
    'high': '🔴',
    'medium': '🟡',
    'low': '🟢',
}
BADGE_TO_PRIORITY = {
    '🔴': 'high',
    '🟡': 'medium',
    '🟢': 'low',
}


def _workflow_now() -> str:
    return datetime.utcnow().isoformat(timespec='seconds') + 'Z'


def _safe_json_list(value) -> list:
    return value if isinstance(value, list) else []


def _workflow_event(kind: str, label: str = '', staff: dict | None = None) -> dict:
    actor = staff or _current_staff()
    return {
        'id': uuid.uuid4().hex[:12],
        'kind': kind,
        'label': label or kind,
        'at': _workflow_now(),
        'staff_id': str(actor.get('id') or ''),
        'staff_name': str(actor.get('name') or actor.get('username') or ''),
    }


def _workflow_status_from_task(raw: dict) -> str:
    status = str(raw.get('status') or '').strip().lower()
    if status in WORKFLOW_STATUSES:
        return status
    try:
        col = int(raw.get('col'))
    except (TypeError, ValueError):
        col = 0
    return PLAN_COL_TO_WORKFLOW_STATUS.get(col, 'todo')


def _script_status_from_task(task: dict) -> str:
    workflow_status = str(task.get('status') or 'todo').strip().lower()
    if task.get('approved_at') or workflow_status in {'approved', 'archived'}:
        return 'approved'
    return WORKFLOW_TO_SCRIPT_STATUS.get(workflow_status, 'draft')


def _apply_legacy_script_statuses(scripts: list[dict]) -> list[dict]:
    if not USE_SUPABASE or not scripts:
        return scripts
    try:
        legacy_rows = sb.list_content_scripts(SUPABASE_SCRIPT_TABLE)
    except Exception:
        return scripts
    legacy_by_id = {str(row.get('id') or ''): row for row in legacy_rows}
    for script in scripts:
        legacy = legacy_by_id.get(script['id'])
        if legacy and str(legacy.get('status') or '').strip().lower() == 'approved':
            script['status'] = 'approved'
    return scripts


def _filter_scripts_by_status(rows: list[dict], status: str) -> list[dict]:
    wanted = str(status or '').strip().lower()
    if not wanted:
        return rows
    return [row for row in rows if str(row.get('status') or '').strip().lower() == wanted]


def _workflow_status_from_script(status: str, existing: dict | None = None) -> str:
    current = str((existing or {}).get('status') or '').strip().lower()
    if status == 'draft' and current in {'todo', 'doing'}:
        return current
    return SCRIPT_TO_WORKFLOW_STATUS.get(status, 'doing')


def _clean_content_tasks(rows) -> list[dict]:
    if not isinstance(rows, list):
        return []
    cleaned = []
    for raw in rows[:1000]:
        if not isinstance(raw, dict):
            continue
        title = str(raw.get('title') or '').strip()[:300]
        task_id = str(raw.get('id') or '').strip()[:160]
        if not title:
            continue
        if not task_id:
            task_id = f'task-{uuid.uuid4().hex[:10]}'
        assignee = str(raw.get('assignee') or raw.get('assignee_name') or raw.get('writer') or '').strip()[:160]
        status = _workflow_status_from_task(raw)
        priority = str(raw.get('priority') or BADGE_TO_PRIORITY.get(str(raw.get('pri') or ''), '') or 'medium').strip().lower()
        if priority not in PRIORITY_TO_BADGE:
            priority = 'medium'
        timeline = _safe_json_list(raw.get('timeline'))
        notes = _safe_json_list(raw.get('notes'))
        cleaned.append({
            'id': task_id,
            'title': title,
            'assignee_id': str(raw.get('assignee_id') or '').strip()[:160],
            'assignee_name': assignee,
            'assignee_username': str(raw.get('assignee_username') or '').strip()[:160],
            'status': status,
            'priority': priority,
            'due_date': str(raw.get('due_date') or raw.get('dl') or '').strip()[:40],
            'script_id': str(raw.get('script_id') or '').strip()[:160] or None,
            'platform': str(raw.get('platform') or 'TikTok').strip()[:80],
            'notes': notes,
            'timeline': timeline,
            'color': str(raw.get('color') or '').strip()[:40],
            'created_by_staff_id': str(raw.get('created_by_staff_id') or '').strip()[:160] or None,
            'created_by_staff_name': str(raw.get('created_by_staff_name') or '').strip()[:160] or None,
            'approved_by_staff_id': str(raw.get('approved_by_staff_id') or '').strip()[:160] or None,
            'approved_by_staff_name': str(raw.get('approved_by_staff_name') or '').strip()[:160] or None,
            'started_at': raw.get('started_at') or None,
            'submitted_at': raw.get('submitted_at') or None,
            'approved_at': raw.get('approved_at') or None,
            'completed_at': raw.get('completed_at') or None,
            'archived_at': raw.get('archived_at') or None,
            'created_at': raw.get('created_at') or None,
            'updated_at': raw.get('updated_at') or None,
        })
    return cleaned


def _public_content_task(row: dict, *, lite: bool = False) -> dict:
    status = str(row.get('status') or 'todo').strip().lower()
    if status not in WORKFLOW_STATUSES:
        status = 'todo'
    priority = str(row.get('priority') or 'medium').strip().lower()
    if priority not in PRIORITY_TO_BADGE:
        priority = 'medium'
    assignee = str(row.get('assignee_name') or '').strip()
    color_seed = abs(hash(assignee or row.get('id') or 'task')) % 5
    colors = ['#7C6CF0', '#3B82F6', '#10B981', '#F59E0B', '#EF4444']
    payload = {
        'id': row.get('id'),
        'col': WORKFLOW_STATUS_TO_PLAN_COL.get(status, 0),
        'status': status,
        'title': row.get('title') or '',
        'assignee': assignee or 'Chưa gán',
        'assignee_id': row.get('assignee_id') or '',
        'assignee_username': row.get('assignee_username') or '',
        'dl': row.get('due_date') or '--',
        'due_date': row.get('due_date') or '',
        'pri': PRIORITY_TO_BADGE.get(priority, '🟡'),
        'priority': priority,
        'color': row.get('color') or colors[color_seed],
        'script_id': row.get('script_id') or '',
        'platform': row.get('platform') or 'TikTok',
        'created_at': row.get('created_at') or '',
        'updated_at': row.get('updated_at') or '',
        'started_at': row.get('started_at') or '',
        'submitted_at': row.get('submitted_at') or '',
        'approved_at': row.get('approved_at') or '',
        'completed_at': row.get('completed_at') or '',
    }
    if lite:
        payload['notes'] = []
        payload['timeline'] = []
    else:
        payload['notes'] = _safe_json_list(row.get('notes'))
        payload['timeline'] = _safe_json_list(row.get('timeline'))
    return payload


def _filter_content_tasks_for_current_staff(rows: list[dict]) -> list[dict]:
    if _is_admin():
        return rows
    staff = _current_staff()
    staff_id = str(staff.get('id') or '').strip()
    username = str(staff.get('username') or '').strip().lower()
    name = str(staff.get('name') or '').strip().lower()
    if not staff_id and not username and not name:
        return rows
    visible = []
    for row in rows:
        assignee_id = str(row.get('assignee_id') or '').strip()
        assignee_user = str(row.get('assignee_username') or '').strip().lower()
        assignee_name = str(row.get('assignee_name') or '').strip().lower()
        creator_id = str(row.get('created_by_staff_id') or '').strip()
        if (
            (staff_id and staff_id in {assignee_id, creator_id})
            or (username and username == assignee_user)
            or (name and name == assignee_name)
        ):
            visible.append(row)
    return visible


def _task_db_payload(task: dict, existing: dict | None = None) -> dict:
    existing = existing or {}
    status = _workflow_status_from_task(task)
    now = _workflow_now()
    staff = _current_staff()
    timeline = _safe_json_list(task.get('timeline') or existing.get('timeline'))
    if not timeline:
        timeline = [_workflow_event('received', 'Nhận task', staff)]
    payload = {
        'id': task['id'],
        'title': task['title'],
        'assignee_id': task.get('assignee_id') or existing.get('assignee_id') or None,
        'assignee_name': task.get('assignee_name') or task.get('assignee') or existing.get('assignee_name') or '',
        'assignee_username': task.get('assignee_username') or existing.get('assignee_username') or None,
        'status': status,
        'priority': task.get('priority') or existing.get('priority') or 'medium',
        'due_date': task.get('due_date') or task.get('dl') or existing.get('due_date') or None,
        'script_id': task.get('script_id') or existing.get('script_id') or None,
        'platform': task.get('platform') or existing.get('platform') or 'TikTok',
        'notes': _safe_json_list(task.get('notes') or existing.get('notes')),
        'timeline': timeline,
        'created_by_staff_id': existing.get('created_by_staff_id') or staff.get('id') or None,
        'created_by_staff_name': existing.get('created_by_staff_name') or staff.get('name') or staff.get('username') or None,
        'created_at': existing.get('created_at') or now,
        'updated_at': now,
        'started_at': existing.get('started_at') or None,
        'submitted_at': existing.get('submitted_at') or None,
        'approved_at': existing.get('approved_at') or None,
        'completed_at': existing.get('completed_at') or None,
        'archived_at': existing.get('archived_at') or None,
        'approved_by_staff_id': existing.get('approved_by_staff_id') or None,
        'approved_by_staff_name': existing.get('approved_by_staff_name') or None,
    }
    for field in ('started_at', 'submitted_at', 'approved_at', 'completed_at', 'archived_at', 'approved_by_staff_id', 'approved_by_staff_name'):
        payload[field] = task.get(field) or existing.get(field) or payload[field]
    return payload


def _script_db_payload_from_script(script: dict, existing_task: dict | None = None) -> tuple[dict, list[dict]]:
    now = _workflow_now()
    staff = _current_staff()
    script_id = script['id']
    task_id = str((existing_task or {}).get('id') or f'task-{script_id}')[:160]
    status = _workflow_status_from_script(script.get('status', 'draft'), existing_task)
    timeline = _safe_json_list((existing_task or {}).get('timeline'))
    if not timeline:
        timeline = [_workflow_event('received', 'Nhận task', staff)]
    if status == 'doing' and not (existing_task or {}).get('started_at'):
        timeline.append(_workflow_event('started', 'Bắt đầu làm', staff))
    if status == 'pending' and (existing_task or {}).get('status') != 'pending':
        timeline.append(_workflow_event('submitted', 'Gửi duyệt', staff))
    if status == 'approved' and (existing_task or {}).get('status') != 'approved':
        timeline.append(_workflow_event('approved', 'Duyệt bài', staff))
    task = {
        'id': task_id,
        'title': script['title'],
        'assignee_id': (existing_task or {}).get('assignee_id') or staff.get('id') or None,
        'assignee_name': script.get('writer') or (existing_task or {}).get('assignee_name') or staff.get('name') or staff.get('username') or '',
        'assignee_username': (existing_task or {}).get('assignee_username') or staff.get('username') or None,
        'status': status,
        'priority': (existing_task or {}).get('priority') or 'medium',
        'due_date': (existing_task or {}).get('due_date') or script.get('date') or None,
        'script_id': script_id,
        'platform': script.get('platform') or 'TikTok',
        'notes': _safe_json_list((existing_task or {}).get('notes')),
        'timeline': timeline[-100:],
        'created_by_staff_id': (existing_task or {}).get('created_by_staff_id') or staff.get('id') or None,
        'created_by_staff_name': (existing_task or {}).get('created_by_staff_name') or staff.get('name') or staff.get('username') or None,
        'created_at': (existing_task or {}).get('created_at') or now,
        'updated_at': now,
        'started_at': (existing_task or {}).get('started_at') or None,
        'submitted_at': (existing_task or {}).get('submitted_at') or None,
        'approved_at': (existing_task or {}).get('approved_at') or None,
        'completed_at': (existing_task or {}).get('completed_at') or None,
        'archived_at': (existing_task or {}).get('archived_at') or None,
        'approved_by_staff_id': (existing_task or {}).get('approved_by_staff_id') or None,
        'approved_by_staff_name': (existing_task or {}).get('approved_by_staff_name') or None,
    }
    if status == 'doing':
        task['started_at'] = (existing_task or {}).get('started_at') or now
    if status == 'pending':
        task['started_at'] = (existing_task or {}).get('started_at') or now
        task['submitted_at'] = (existing_task or {}).get('submitted_at') or now
    if status == 'approved':
        task['started_at'] = (existing_task or {}).get('started_at') or now
        task['submitted_at'] = (existing_task or {}).get('submitted_at') or now
        task['approved_at'] = (existing_task or {}).get('approved_at') or now
        task['completed_at'] = (existing_task or {}).get('completed_at') or now
        task['approved_by_staff_id'] = staff.get('id') or None
        task['approved_by_staff_name'] = staff.get('name') or staff.get('username') or None
    blocks = []
    for index, block in enumerate(script.get('blocks') or []):
        blocks.append({
            'id': str(block.get('id') or f'{script_id}-block-{index}')[:160],
            'task_id': task_id,
            'script_id': script_id,
            'block_order': index,
            'content_type': str(block.get('type') or 'text')[:40],
            'content': str(block.get('text') or '')[:50000],
            'metadata': {
                'align': block.get('align') or '',
            },
        })
    return task, blocks


def _is_workflow_script_task(row: dict) -> bool:
    task_id = str(row.get('id') or '').strip()
    script_id = str(row.get('script_id') or '').strip()
    return bool(script_id) and task_id == f'task-{script_id}'


def _plan_visible_tasks(rows: list[dict]) -> list[dict]:
    """Hide internal script workflow rows from the user-facing planning board."""
    return [row for row in (rows or []) if not _is_workflow_script_task(row)]


def _plan_board_tasks(rows: list[dict]) -> list[dict]:
    """Plan tasks for the kanban board; fall back to workflow rows when no plan rows exist."""
    cleaned = _clean_content_tasks(rows)
    plan = _plan_visible_tasks(cleaned)
    if plan:
        return plan
    return [row for row in cleaned if _is_workflow_script_task(row)]


def _plan_task_ids_by_script(tasks: list[dict]) -> dict[str, str]:
    plan_by_script: dict[str, str] = {}
    for task in tasks or []:
        script_id = str(task.get('script_id') or '').strip()
        task_id = str(task.get('id') or '').strip()
        if not script_id or not task_id:
            continue
        if _is_workflow_script_task(task):
            plan_by_script.setdefault(script_id, task_id)
            continue
        plan_by_script[script_id] = task_id
    return plan_by_script


def _attach_plan_links_to_scripts(scripts: list[dict], tasks: list[dict]) -> list[dict]:
    plan_by_script = _plan_task_ids_by_script(tasks)
    plan_titles: dict[str, str] = {}
    for task in tasks or []:
        script_id = str(task.get('script_id') or '').strip()
        task_id = str(task.get('id') or '').strip()
        if script_id and task_id == plan_by_script.get(script_id):
            plan_titles[script_id] = str(task.get('title') or '').strip()
    for script in scripts:
        script_id = str(script.get('id') or '').strip()
        plan_task_id = plan_by_script.get(script_id)
        if plan_task_id:
            script['plan_task_id'] = plan_task_id
            if plan_titles.get(script_id):
                script['plan_task_title'] = plan_titles[script_id]
    return scripts


def _sync_plan_tasks_from_scripts(plan_tasks: list[dict], scripts: list[dict]) -> list[dict]:
    scripts_by_id = {str(script.get('id') or ''): script for script in scripts if str(script.get('id') or '').strip()}
    staff = _current_staff()
    synced: list[dict] = []
    for row in plan_tasks:
        task = dict(row)
        script_id = str(task.get('script_id') or '').strip()
        script = scripts_by_id.get(script_id)
        if not script:
            synced.append(task)
            continue
        script_status = str(script.get('status') or 'draft').strip().lower()
        new_status = SCRIPT_TO_WORKFLOW_STATUS.get(script_status, 'doing')
        old_status = str(task.get('status') or '').strip().lower()
        if new_status != old_status:
            task['status'] = new_status
            timeline = _safe_json_list(task.get('timeline'))
            now = _workflow_now()
            if new_status == 'doing' and not task.get('started_at'):
                task['started_at'] = now
                if old_status in {'', 'todo'}:
                    timeline.append(_workflow_event('started', 'Bắt đầu làm từ kịch bản', staff))
            if new_status == 'pending' and old_status != 'pending':
                task['started_at'] = task.get('started_at') or now
                task['submitted_at'] = task.get('submitted_at') or now
                timeline.append(_workflow_event('submitted', 'Gửi duyệt từ kịch bản', staff))
            if new_status == 'approved' and old_status != 'approved':
                task['started_at'] = task.get('started_at') or now
                task['submitted_at'] = task.get('submitted_at') or now
                task['approved_at'] = task.get('approved_at') or now
                task['completed_at'] = task.get('completed_at') or now
                task['approved_by_staff_id'] = staff.get('id') or None
                task['approved_by_staff_name'] = staff.get('name') or staff.get('username') or None
                timeline.append(_workflow_event('approved', 'Duyệt từ kịch bản', staff))
            task['timeline'] = timeline[-100:]
        writer = str(script.get('writer') or '').strip()
        if writer:
            task['assignee_name'] = writer
        synced.append(task)
    return synced


def _scripts_from_workflow_rows(tasks: list[dict], blocks: list[dict]) -> list[dict]:
    by_script: dict[str, list[dict]] = {}
    for block in blocks or []:
        script_id = str(block.get('script_id') or '').strip()
        if not script_id:
            continue
        by_script.setdefault(script_id, []).append(block)
    scripts_by_id: dict[str, dict] = {}
    for task in tasks or []:
        script_id = str(task.get('script_id') or '').strip()
        if not script_id:
            continue
        rows = sorted(by_script.get(script_id, []), key=lambda item: int(item.get('block_order') or 0))
        entry = {
            'id': script_id,
            'title': task.get('title') or '',
            'platform': task.get('platform') or 'TikTok',
            'status': _script_status_from_task(task),
            'writer': task.get('assignee_name') or '',
            'date': task.get('due_date') or '',
            'blocks': [{
                'id': row.get('id') or f'{script_id}-block-{idx}',
                'type': row.get('content_type') or 'text',
                'text': row.get('content') or '',
                **({'align': (row.get('metadata') or {}).get('align')} if isinstance(row.get('metadata'), dict) and (row.get('metadata') or {}).get('align') else {}),
            } for idx, row in enumerate(rows)],
        }
        existing = scripts_by_id.get(script_id)
        if not existing:
            scripts_by_id[script_id] = entry
            continue
        task_is_workflow = str(task.get('id') or '') == f'task-{script_id}'
        existing_is_workflow = str(existing.get('_task_id') or '') == f'task-{script_id}'
        if task_is_workflow and not existing_is_workflow:
            entry['_task_id'] = str(task.get('id') or '')
            scripts_by_id[script_id] = entry
        elif len(entry['blocks']) > len(existing.get('blocks') or []):
            entry['_task_id'] = str(task.get('id') or '')
            scripts_by_id[script_id] = entry
    cleaned = []
    for script in scripts_by_id.values():
        script.pop('_task_id', None)
        cleaned.append(script)
    return _clean_script_library(cleaned)


def _scripts_lite_from_tasks(tasks: list[dict]) -> list[dict]:
    scripts_by_id: dict[str, dict] = {}
    for task in tasks or []:
        script_id = str(task.get('script_id') or '').strip()
        if not script_id:
            continue
        entry = {
            'id': script_id,
            'title': task.get('title') or '',
            'platform': task.get('platform') or 'TikTok',
            'status': _script_status_from_task(task),
            'writer': task.get('assignee_name') or '',
            'date': task.get('due_date') or '',
            'blocks': [],
            '_task_id': str(task.get('id') or ''),
        }
        existing = scripts_by_id.get(script_id)
        if not existing:
            scripts_by_id[script_id] = entry
            continue
        task_is_workflow = str(task.get('id') or '') == f'task-{script_id}'
        existing_is_workflow = str(existing.get('_task_id') or '') == f'task-{script_id}'
        if task_is_workflow and not existing_is_workflow:
            scripts_by_id[script_id] = entry
    cleaned = []
    for script in scripts_by_id.values():
        script.pop('_task_id', None)
        cleaned.append(script)
    return _clean_script_library(cleaned)


def _content_workflow_supabase_warning(exc: Exception) -> str:
    text = str(exc)
    if 'PGRST205' in text or 'schema cache' in text.lower() or 'Could not find the table' in text:
        return f'{CONTENT_WORKFLOW_MISSING_HINT} Chi tiết: {text[:220]}'
    if '42501' in text or 'row-level security' in text.lower():
        return f'{CONTENT_WORKFLOW_RLS_HINT} Chi tiết: {text[:220]}'
    return text[:500]


WORKFLOW_READ_CACHE_SEC = 15
_workflow_read_cache: dict[str, object] = {'tasks': None, 'blocks': None, 'ts': 0.0}


def _invalidate_workflow_read_cache() -> None:
    _workflow_read_cache['ts'] = 0.0
    _workflow_read_cache['tasks'] = None
    _workflow_read_cache['blocks'] = None


def _cached_workflow_tasks(*, lite: bool = False, force: bool = False) -> list:
    key = 'tasks_lite' if lite else 'tasks'
    now = time_module.monotonic()
    cached = _workflow_read_cache.get(key)
    ts = float(_workflow_read_cache.get('ts') or 0.0)
    if not force and isinstance(cached, list) and now - ts < WORKFLOW_READ_CACHE_SEC:
        return cached
    rows = sb.list_content_tasks(SUPABASE_CONTENT_TASK_TABLE, lite=lite)
    _workflow_read_cache[key] = rows
    if not lite:
        _workflow_read_cache['tasks'] = rows
    _workflow_read_cache['ts'] = now
    return rows


def _cached_workflow_blocks(*, force: bool = False) -> list:
    now = time_module.monotonic()
    cached = _workflow_read_cache.get('blocks')
    ts = float(_workflow_read_cache.get('ts') or 0.0)
    if not force and isinstance(cached, list) and now - ts < WORKFLOW_READ_CACHE_SEC:
        return cached
    rows = sb.list_content_script_blocks(SUPABASE_CONTENT_SCRIPT_BLOCK_TABLE)
    _workflow_read_cache['blocks'] = rows
    _workflow_read_cache['ts'] = now
    return rows


def _load_scripts_from_workflow_supabase() -> list[dict]:
    tasks = _cached_workflow_tasks()
    blocks = _cached_workflow_blocks()
    scripts = _scripts_from_workflow_rows(tasks, blocks)
    return _attach_plan_links_to_scripts(scripts, tasks)


def _ensure_scripts_from_active_plan_tasks() -> None:
    if not USE_SUPABASE:
        return
    try:
        raw_tasks = _cached_workflow_tasks(lite=True)
    except Exception:
        return
    plan_rows = [
        _public_content_task(row, lite=True)
        for row in raw_tasks
        if not _is_workflow_script_task(row) and _workflow_status_from_task(row) in {'doing', 'pending'}
    ]
    if not plan_rows:
        return
    try:
        existing_scripts = _load_scripts_from_workflow_supabase()
    except Exception:
        existing_scripts = _attach_plan_links_to_scripts(_scripts_lite_from_tasks(raw_tasks), raw_tasks)
    updated_rows, new_scripts = _provision_scripts_for_active_plan_tasks(plan_rows, existing_scripts)
    script_id_changed = any(
        str(next_row.get('script_id') or '').strip() != str(prev_row.get('script_id') or '').strip()
        for next_row, prev_row in zip(updated_rows, plan_rows)
    )
    if not new_scripts and not script_id_changed:
        return
    scripts_by_id = {
        str(script.get('id') or ''): dict(script)
        for script in existing_scripts
        if str(script.get('id') or '').strip()
    }
    for script in new_scripts:
        scripts_by_id[script['id']] = script
    _save_scripts_to_workflow_supabase(
        list(scripts_by_id.values()),
        plan_provision_updates=updated_rows,
    )


def _script_id_for_plan_task(task: dict) -> str:
    task_id = str(task.get('id') or '').strip()
    if task_id.startswith('task-'):
        return f'script-{task_id[5:]}'[:160]
    compact = re.sub(r'[^0-9a-zA-Z]+', '-', task_id).strip('-').lower()
    return (f'script-{compact}' if compact else f'script-{uuid.uuid4().hex[:12]}')[:160]


def _script_status_from_workflow(status: str) -> str:
    status = str(status or 'todo').strip().lower()
    if status == 'approved':
        return 'approved'
    if status == 'pending':
        return 'pending'
    return 'draft'


def _provision_scripts_for_active_plan_tasks(
    rows: list[dict],
    existing_scripts: list[dict] | None = None,
    *,
    recreate_missing: bool = False,
) -> tuple[list[dict], list[dict]]:
    scripts_by_id = {str(script.get('id') or ''): script for script in (existing_scripts or []) if str(script.get('id') or '').strip()}
    updated_rows: list[dict] = []
    new_scripts: list[dict] = []
    for raw in rows:
        row = dict(raw)
        if _is_workflow_script_task(row):
            updated_rows.append(row)
            continue
        status = _workflow_status_from_task(row)
        script_id = str(row.get('script_id') or '').strip()
        if not script_id:
            script_id = _script_id_for_plan_task(row)
            row['script_id'] = script_id
        if script_id in scripts_by_id:
            updated_rows.append(row)
            continue
        if recreate_missing or status in {'todo', 'doing', 'pending', 'approved'}:
            script_status = _script_status_from_workflow(status)
            script = {
                'id': script_id,
                'title': row.get('title') or 'Kịch bản',
                'platform': row.get('platform') or 'TikTok',
                'status': script_status,
                'writer': str(row.get('assignee_name') or row.get('assignee') or '').strip(),
                'date': str(row.get('due_date') or row.get('dl') or '').strip(),
                'blocks': [{'id': f'{script_id}-block-0', 'type': 'hook', 'text': ''}],
            }
            new_scripts.append(script)
            scripts_by_id[script_id] = script
        updated_rows.append(row)
    return updated_rows, new_scripts


def _apply_script_provision_from_plan_tasks(rows: list[dict]) -> list[dict]:
    if not USE_SUPABASE or not rows:
        return rows
    try:
        existing_scripts = _load_scripts_from_workflow_supabase()
    except Exception:
        existing_scripts = []
    updated_rows, new_scripts = _provision_scripts_for_active_plan_tasks(rows, existing_scripts, recreate_missing=True)
    if not new_scripts:
        return updated_rows
    scripts_by_id = {str(script.get('id') or ''): script for script in existing_scripts if str(script.get('id') or '').strip()}
    for script in new_scripts:
        scripts_by_id.setdefault(script['id'], script)
    _save_scripts_to_workflow_supabase(list(scripts_by_id.values()), plan_provision_updates=updated_rows)
    return updated_rows


def _save_scripts_to_workflow_supabase(rows: list[dict], *, plan_provision_updates: list[dict] | None = None) -> None:
    existing_tasks = sb.list_content_tasks(SUPABASE_CONTENT_TASK_TABLE)
    by_script = {str(row.get('script_id') or ''): row for row in existing_tasks if row.get('script_id')}
    by_id = {str(row.get('id') or ''): row for row in existing_tasks if row.get('id')}
    provision_by_id = {str(row.get('id') or ''): row for row in (plan_provision_updates or []) if str(row.get('id') or '').strip()}
    kept_script_ids = {script['id'] for script in rows}
    removed_script_ids = [
        str(row.get('script_id') or '').strip()
        for row in existing_tasks
        if str(row.get('script_id') or '').strip() and str(row.get('script_id') or '').strip() not in kept_script_ids
    ]
    task_rows = []
    block_rows = []
    script_ids = []
    for script in rows:
        existing = by_script.get(script['id']) or by_id.get(f'task-{script["id"]}') or {}
        task, blocks = _script_db_payload_from_script(script, existing)
        task_rows.append(task)
        block_rows.extend(blocks)
        script_ids.append(script['id'])
    # Giữ task kế hoạch (id khác task kịch bản workflow), kể cả khi đã gắn script_id.
    script_task_ids = {str(task_row.get('id') or '').strip() for task_row in task_rows if str(task_row.get('id') or '').strip()}
    removed_script_ids_set = set(removed_script_ids)
    merged_plan: list[dict] = []
    for row in existing_tasks:
        task_id = str(row.get('id') or '').strip()
        script_id = str(row.get('script_id') or '').strip()
        if not task_id or task_id in script_task_ids:
            continue
        if script_id in removed_script_ids_set and _is_workflow_script_task(row):
            continue
        task = dict(row)
        if script_id in removed_script_ids_set:
            task['script_id'] = None
            if _workflow_status_from_task(task) in {'doing', 'pending'}:
                task['status'] = 'todo'
                task['started_at'] = None
                task['submitted_at'] = None
        provision = provision_by_id.get(task_id)
        if provision and provision.get('script_id'):
            task['script_id'] = provision['script_id']
        merged_plan.append(task)
    plan_tasks = _sync_plan_tasks_from_scripts(merged_plan, rows)
    plan_payloads = [
        _task_db_payload(task, by_id.get(str(task.get('id') or '').strip()))
        for task in plan_tasks
    ]
    sb.sync_content_tasks([*plan_payloads, *task_rows], SUPABASE_CONTENT_TASK_TABLE)
    sb.sync_content_script_blocks(block_rows, script_ids, SUPABASE_CONTENT_SCRIPT_BLOCK_TABLE)
    if removed_script_ids:
        sb.purge_content_script_blocks(removed_script_ids, SUPABASE_CONTENT_SCRIPT_BLOCK_TABLE)
    _invalidate_workflow_read_cache()


def _sync_legacy_content_scripts_table(rows: list[dict]) -> None:
    existing = sb.list_content_scripts(SUPABASE_SCRIPT_TABLE)
    existing_by_id = {str(row.get('id') or ''): row for row in existing}
    now = datetime.utcnow().isoformat(timespec='seconds') + 'Z'
    staff = _current_staff()
    db_rows = []
    for row in rows:
        current = existing_by_id.get(row['id']) or {}
        db_rows.append({
            'id': row['id'],
            'title': row['title'],
            'platform': row['platform'],
            'status': row['status'],
            'writer': row['writer'],
            'script_date': row['date'],
            'blocks': row['blocks'],
            'created_by_staff_id': current.get('created_by_staff_id') or staff.get('id') or None,
            'created_by_staff_name': current.get('created_by_staff_name') or staff.get('name') or staff.get('username') or None,
            'created_at': current.get('created_at') or now,
            'updated_at': now,
        })
    sb.sync_content_scripts(db_rows, SUPABASE_SCRIPT_TABLE)


@app.route('/api/scripts', methods=['GET'])
def scripts_get():
    status_filter = str(request.args.get('status') or '').strip().lower()
    lite = str(request.args.get('lite') or '').strip().lower() in {'1', 'true', 'yes'}
    if not USE_SUPABASE:
        return jsonify({
            'ok': False,
            'error': 'Chưa bật Supabase cho thư viện kịch bản. Không dùng dữ liệu local/mock.',
            'storage': 'disabled',
        }), 503
    try:
        if lite:
            tasks = _cached_workflow_tasks(lite=True)
            rows = _apply_legacy_script_statuses(
                _attach_plan_links_to_scripts(_scripts_lite_from_tasks(tasks), tasks),
            )
            rows = _filter_scripts_by_status(rows, status_filter)
            return jsonify({'ok': True, 'scripts': rows, 'storage': 'supabase_workflow_lite'})
        rows = _apply_legacy_script_statuses(_load_scripts_from_workflow_supabase())
        if rows:
            rows = _filter_scripts_by_status(rows, status_filter)
            return jsonify({'ok': True, 'scripts': rows, 'storage': 'supabase_workflow'})
        workflow_tasks = sb.list_content_tasks(SUPABASE_CONTENT_TASK_TABLE)
        if workflow_tasks:
            return jsonify({'ok': True, 'scripts': [], 'storage': 'supabase_workflow'})
        legacy_rows = _filter_scripts_by_status(
            _clean_script_library(sb.list_content_scripts(SUPABASE_SCRIPT_TABLE)),
            status_filter,
        )
        warning = 'Đang đọc dữ liệu bảng content_scripts cũ. Bấm Lưu bài một lần để migrate sang content_tasks/content_script_blocks.'
        return jsonify({'ok': True, 'scripts': legacy_rows, 'storage': 'supabase_legacy', 'warning': warning if legacy_rows else ''})
    except Exception as e:
        message = str(e)
        detail = _content_scripts_supabase_warning(e) if _content_scripts_should_fallback_local(e) else message
        return jsonify({
            'ok': False,
            'error': f'Không tải được kịch bản từ Supabase: {detail}',
            'storage': 'supabase_error',
        }), 500


@app.route('/api/scripts', methods=['PUT'])
def scripts_save():
    body = request.get_json(silent=True) or {}
    if not isinstance(body.get('scripts'), list):
        return jsonify({'ok': False, 'error': 'Dữ liệu scripts không hợp lệ'}), 400
    rows = _clean_script_library(body.get('scripts'))
    if not USE_SUPABASE:
        return jsonify({
            'ok': False,
            'error': 'Chưa bật Supabase cho thư viện kịch bản. Không lưu local/mock.',
            'storage': 'disabled',
        }), 503
    try:
        if body.get('full_documents') is not True:
            existing_rows = _load_scripts_from_workflow_supabase()
            incoming_by_id = {str(row.get('id') or ''): row for row in rows}
            at_risk = [
                row for row in existing_rows
                if row.get('blocks')
                and (
                    str(row.get('id') or '') not in incoming_by_id
                    or not incoming_by_id[str(row.get('id') or '')].get('blocks')
                )
            ]
            if at_risk:
                return jsonify({
                    'ok': False,
                    'error': 'Dữ liệu kịch bản chưa tải đầy đủ. Hãy tải lại trang trước khi lưu để tránh mất nội dung.',
                }), 409
        _save_scripts_to_workflow_supabase(rows)
        try:
            _sync_legacy_content_scripts_table(rows)
        except Exception:
            pass
        return jsonify({
            'ok': True,
            'scripts': rows,
            'count': len(rows),
            'storage': 'supabase_workflow',
            'updated_at': datetime.utcnow().isoformat(timespec='seconds') + 'Z',
        })
    except Exception as workflow_exc:
        workflow_warning = _content_workflow_supabase_warning(workflow_exc)
    try:
        existing = sb.list_content_scripts(SUPABASE_SCRIPT_TABLE)
        existing_by_id = {str(row.get('id') or ''): row for row in existing}
        now = datetime.utcnow().isoformat(timespec='seconds') + 'Z'
        staff = _current_staff()
        db_rows = []
        for row in rows:
            current = existing_by_id.get(row['id']) or {}
            db_rows.append({
                'id': row['id'],
                'title': row['title'],
                'platform': row['platform'],
                'status': row['status'],
                'writer': row['writer'],
                'script_date': row['date'],
                'blocks': row['blocks'],
                'created_by_staff_id': current.get('created_by_staff_id') or staff.get('id') or None,
                'created_by_staff_name': current.get('created_by_staff_name') or staff.get('name') or staff.get('username') or None,
                'created_at': current.get('created_at') or now,
                'updated_at': now,
            })
        sb.sync_content_scripts(db_rows, SUPABASE_SCRIPT_TABLE)
        return jsonify({
            'ok': True,
            'scripts': rows,
            'count': len(rows),
            'storage': 'supabase',
            'warning': f'Đã lưu bảng cũ content_scripts. Chạy supabase_content_workflow.sql để dùng schema task/block. {workflow_warning}',
            'updated_at': datetime.utcnow().isoformat(timespec='seconds') + 'Z',
        })
    except Exception as e:
        message = str(e)
        detail = _content_scripts_supabase_warning(e) if _content_scripts_should_fallback_local(e) else message
        return jsonify({
            'ok': False,
            'error': f'Không lưu được kịch bản lên Supabase: {detail} | Workflow mới: {workflow_warning}',
            'storage': 'supabase_error',
        }), 500


def _load_tasks_local() -> list:
    return _clean_content_tasks(_read_json(CONTENT_TASKS_FILE, []))


def _save_tasks_local(rows: list) -> None:
    _write_json(CONTENT_TASKS_FILE, rows)


def _upsert_task_local(task: dict) -> dict:
    task_id = str(task.get('id') or '').strip()
    rows = _load_tasks_local()
    next_rows = []
    merged = None
    for row in rows:
        if str(row.get('id') or '').strip() == task_id:
            merged = {**row, **task}
            next_rows.append(merged)
        else:
            next_rows.append(row)
    if merged is None:
        merged = dict(task)
        next_rows.append(merged)
    _save_tasks_local(next_rows)
    return merged


def _get_content_task_by_id(task_id: str) -> tuple[dict | None, str]:
    task_id = str(task_id or '').strip()
    if not task_id:
        return None, 'local'
    if USE_SUPABASE:
        try:
            row = sb.get_content_task(task_id, SUPABASE_CONTENT_TASK_TABLE)
            if row:
                cleaned = _clean_content_tasks([row])
                return (cleaned[0] if cleaned else None), 'supabase'
        except Exception:
            pass
    for row in _load_tasks_local():
        if str(row.get('id') or '').strip() == task_id:
            return row, 'local'
    return None, 'local'


def _patch_content_task_notes(task_id: str, notes: list) -> tuple[dict | None, str, str]:
    task_id = str(task_id or '').strip()
    now = _workflow_now()
    patch = {'notes': notes[-200:], 'updated_at': now}
    if USE_SUPABASE:
        try:
            saved = sb.patch_content_task(task_id, patch, SUPABASE_CONTENT_TASK_TABLE)
            if saved:
                merged = _upsert_task_local(saved)
                cleaned = _clean_content_tasks([merged])
                _invalidate_workflow_read_cache()
                return (cleaned[0] if cleaned else None), 'supabase', ''
        except Exception as exc:
            warning = _content_workflow_supabase_warning(exc)
            existing, _ = _get_content_task_by_id(task_id)
            if not existing:
                return None, 'local', warning
            merged = _upsert_task_local({**existing, **patch})
            cleaned = _clean_content_tasks([merged])
            return (cleaned[0] if cleaned else None), 'local', warning
    existing, _ = _get_content_task_by_id(task_id)
    if not existing:
        return None, 'local', ''
    merged = _upsert_task_local({**existing, **patch})
    cleaned = _clean_content_tasks([merged])
    return (cleaned[0] if cleaned else None), 'local', ''


def _tasks_payload(rows: list[dict], storage: str, warning: str = '', *, lite: bool = False) -> dict:
    public_rows = [
        _public_content_task(row, lite=lite)
        for row in _plan_board_tasks(rows)
    ]
    payload = {'ok': True, 'tasks': public_rows, 'storage': storage}
    if warning:
        payload['warning'] = warning
    return payload


def _load_tasks_any(include_all: bool = False, *, lite: bool = False) -> tuple[list[dict], str, str]:
    if USE_SUPABASE:
        try:
            rows = _clean_content_tasks(_cached_workflow_tasks(lite=lite))
            return (rows if include_all else _filter_content_tasks_for_current_staff(rows)), 'supabase', ''
        except Exception as exc:
            rows = _load_tasks_local()
            return (rows if include_all else _filter_content_tasks_for_current_staff(rows)), 'local', _content_workflow_supabase_warning(exc)
    rows = _load_tasks_local()
    return (rows if include_all else _filter_content_tasks_for_current_staff(rows)), 'local', ''


def _save_tasks_any(rows: list[dict], *, provision_scripts: bool = True) -> tuple[list[dict], str, str]:
    cleaned = _clean_content_tasks(rows)
    if provision_scripts:
        cleaned = _apply_script_provision_from_plan_tasks(cleaned)
    if USE_SUPABASE:
        try:
            current = sb.list_content_tasks(SUPABASE_CONTENT_TASK_TABLE)
            by_id = {str(row.get('id') or ''): row for row in current}
            payloads = [_task_db_payload(row, by_id.get(str(row.get('id') or ''))) for row in cleaned]
            sb.sync_content_tasks(payloads, SUPABASE_CONTENT_TASK_TABLE)
            _save_tasks_local(cleaned)
            _invalidate_workflow_read_cache()
            return cleaned, 'supabase', ''
        except Exception as exc:
            _save_tasks_local(cleaned)
            return cleaned, 'local', _content_workflow_supabase_warning(exc)
    _save_tasks_local(cleaned)
    return cleaned, 'local', ''


@app.route('/api/content-tasks', methods=['GET'])
def content_tasks_get():
    lite = str(request.args.get('lite') or '').strip().lower() in {'1', 'true', 'yes'}
    rows, storage, warning = _load_tasks_any(include_all=_is_admin(), lite=lite)
    return jsonify(_tasks_payload(rows, storage, warning, lite=lite))


@app.route('/api/content-tasks/<task_id>', methods=['GET'])
def content_tasks_get_one(task_id):
    task_id = str(task_id or '').strip()
    row, storage = _get_content_task_by_id(task_id)
    if not row:
        return jsonify({'ok': False, 'error': 'Không tìm thấy task'}), 404
    visible = _filter_content_tasks_for_current_staff([row])
    if not visible:
        return jsonify({'ok': False, 'error': 'Không tìm thấy task'}), 404
    return jsonify({'ok': True, 'task': _public_content_task(visible[0]), 'storage': storage})


@app.route('/api/content-tasks', methods=['POST'])
def content_tasks_create():
    body = request.get_json(silent=True) or {}
    rows, _, _ = _load_tasks_any(include_all=True)
    staff = _current_staff()
    title = str(body.get('title') or '').strip()
    if not title:
        return jsonify({'ok': False, 'error': 'Nhập tên task'}), 400
    task_id = str(body.get('id') or f'task-{uuid.uuid4().hex[:12]}')[:160]
    task = {
        'id': task_id,
        'title': title,
        'assignee_name': str(body.get('assignee') or body.get('assignee_name') or staff.get('name') or staff.get('username') or '').strip(),
        'assignee_id': str(body.get('assignee_id') or staff.get('id') or '').strip(),
        'assignee_username': str(body.get('assignee_username') or staff.get('username') or '').strip(),
        'status': _workflow_status_from_task(body),
        'priority': str(body.get('priority') or BADGE_TO_PRIORITY.get(str(body.get('pri') or ''), '') or 'medium'),
        'due_date': str(body.get('due_date') or body.get('dl') or '').strip(),
        'script_id': str(body.get('script_id') or '').strip(),
        'platform': str(body.get('platform') or 'TikTok').strip(),
        'notes': _safe_json_list(body.get('notes')),
        'timeline': [_workflow_event('received', 'Nhận task', staff)],
        'created_by_staff_id': staff.get('id') or None,
        'created_by_staff_name': staff.get('name') or staff.get('username') or None,
    }
    rows = [task, *[row for row in rows if str(row.get('id') or '') != task_id]]
    saved, storage, warning = _save_tasks_any(rows)
    payload = _tasks_payload(_filter_content_tasks_for_current_staff(saved), storage, warning)
    payload['task'] = _public_content_task(task)
    return jsonify(payload)


@app.route('/api/content-tasks', methods=['PUT'])
def content_tasks_sync():
    body = request.get_json(silent=True) or {}
    if not isinstance(body.get('tasks'), list):
        return jsonify({'ok': False, 'error': 'Dữ liệu tasks không hợp lệ'}), 400
    incoming_clean = _clean_content_tasks(body.get('tasks') or [])
    plan_incoming = _plan_visible_tasks(incoming_clean)
    incoming = plan_incoming if plan_incoming else [row for row in incoming_clean if _is_workflow_script_task(row)]
    if _is_admin():
        current_all, _, _ = _load_tasks_any(include_all=True)
        internal_rows = [row for row in current_all if _is_workflow_script_task(row)]
        rows_to_save = [*internal_rows, *incoming]
    else:
        current_all, _, _ = _load_tasks_any(include_all=True)
        incoming_ids = {str(row.get('id') or '') for row in incoming}
        rows_to_save = [row for row in current_all if str(row.get('id') or '') not in incoming_ids]
        rows_to_save.extend(incoming)
    saved, storage, warning = _save_tasks_any(rows_to_save)
    saved = _filter_content_tasks_for_current_staff(saved)
    return jsonify(_tasks_payload(saved, storage, warning))


@app.route('/api/content-tasks/<task_id>', methods=['PATCH'])
def content_tasks_patch(task_id):
    body = request.get_json(silent=True) or {}
    rows, _, _ = _load_tasks_any(include_all=True)
    task_id = str(task_id or '').strip()
    found = None
    staff = _current_staff()
    for row in rows:
        if str(row.get('id') or '') == task_id:
            found = row
            break
    if not found:
        return jsonify({'ok': False, 'error': 'Không tìm thấy task'}), 404
    before_status = str(found.get('status') or 'todo')
    updated = {**found, **body, 'id': task_id}
    updated['status'] = _workflow_status_from_task(updated)
    timeline = _safe_json_list(updated.get('timeline') or found.get('timeline'))
    status = updated['status']
    now = _workflow_now()
    if status != before_status:
        labels = {
            'todo': 'Chuyển về chưa làm',
            'doing': 'Bắt đầu làm',
            'pending': 'Gửi duyệt',
            'approved': 'Duyệt bài',
            'archived': 'Lưu trữ',
        }
        timeline.append(_workflow_event(status, labels.get(status, status), staff))
        if status == 'doing':
            updated['started_at'] = updated.get('started_at') or now
        if status == 'pending':
            updated['submitted_at'] = now
        if status == 'approved':
            updated['approved_at'] = now
            updated['completed_at'] = now
            updated['approved_by_staff_id'] = staff.get('id') or None
            updated['approved_by_staff_name'] = staff.get('name') or staff.get('username') or None
    updated['timeline'] = timeline[-100:]
    next_rows = [updated if str(row.get('id') or '') == task_id else row for row in rows]
    saved, storage, warning = _save_tasks_any(next_rows)
    public_rows = [
        _public_content_task(row)
        for row in _plan_board_tasks(_filter_content_tasks_for_current_staff(saved))
    ]
    payload = {'ok': True, 'task': next((row for row in public_rows if row.get('id') == task_id), _public_content_task(updated)), 'tasks': public_rows, 'storage': storage}
    if warning:
        payload['warning'] = warning
    return jsonify(payload)


@app.route('/api/content-tasks/<task_id>/notes', methods=['POST'])
def content_tasks_add_note(task_id):
    body = request.get_json(silent=True) or {}
    text = str(body.get('text') or '').strip()
    if not text:
        return jsonify({'ok': False, 'error': 'Nhập ghi chú'}), 400
    task_id = str(task_id or '').strip()
    existing, _ = _get_content_task_by_id(task_id)
    if not existing:
        return jsonify({'ok': False, 'error': 'Không tìm thấy task'}), 404
    staff = _current_staff()
    notes = _safe_json_list(existing.get('notes'))
    notes.append({
        'id': uuid.uuid4().hex[:12],
        'text': text[:3000],
        'at': _workflow_now(),
        'staff_id': staff.get('id') or '',
        'staff_name': staff.get('name') or staff.get('username') or 'Nhân sự',
    })
    saved, storage, warning = _patch_content_task_notes(task_id, notes)
    if not saved:
        return jsonify({'ok': False, 'error': 'Không lưu được ghi chú'}), 500
    payload = {'ok': True, 'task': _public_content_task(saved), 'storage': storage}
    if warning:
        payload['warning'] = warning
    return jsonify(payload)


@app.route('/api/content-tasks/<task_id>', methods=['DELETE'])
def content_tasks_delete(task_id):
    task_id = str(task_id or '').strip()
    rows, _, _ = _load_tasks_any(include_all=True)
    next_rows = [row for row in rows if str(row.get('id') or '') != task_id]
    if len(next_rows) == len(rows):
        return jsonify({'ok': False, 'error': 'Không tìm thấy task'}), 404
    saved, storage, warning = _save_tasks_any(next_rows)
    if USE_SUPABASE:
        try:
            sb.delete_content_task(task_id, SUPABASE_CONTENT_TASK_TABLE)
        except Exception:
            pass
    return jsonify(_tasks_payload(_filter_content_tasks_for_current_staff(saved), storage, warning))


@app.route('/api/content-studio/setup', methods=['GET'])
def content_studio_setup_get():
    setup, storage, warning = _load_content_studio_setup()
    payload = {'ok': True, 'setup': setup, 'storage': storage}
    if warning:
        payload['warning'] = f'Đã dùng local, Supabase chưa đọc được: {warning}'
    return jsonify(payload)


@app.route('/api/content-studio/setup', methods=['POST'])
def content_studio_setup_save():
    body = request.get_json(silent=True) or {}
    setup = _clean_content_studio_setup(body.get('setup') if 'setup' in body else body)
    storage, warning = _save_content_studio_setup(setup)
    payload = {'ok': True, 'setup': setup, 'storage': storage}
    if warning:
        payload['warning'] = f'Đã lưu local, Supabase chưa ghi được: {warning}'
    return jsonify(payload)


@app.route('/api/content-techniques', methods=['GET'])
def content_techniques_get():
    rows, storage, warning = _load_content_techniques()
    payload = {'ok': True, 'techniques': rows, 'storage': storage, 'seeded': 'tự thêm' in str(warning or '').lower()}
    if warning:
        if storage == 'local' and 'Supabase chưa đọc' in warning:
            payload['warning'] = f'Đã dùng local, Supabase chưa đọc được: {warning}'
        else:
            payload['warning'] = warning
    return jsonify(payload)


@app.route('/api/content-techniques', methods=['POST'])
def content_techniques_create():
    body = request.get_json(silent=True) or {}
    name = str(body.get('name') or '').strip()
    content = str(body.get('content') or '').strip()
    if not name or not content:
        return jsonify({'ok': False, 'error': 'Nhập đủ Tên kỹ thuật và Nội dung'}), 400
    rows, _, _ = _load_content_techniques()
    now = datetime.utcnow().isoformat(timespec='seconds') + 'Z'
    base_id = _technique_id(name)
    tech_id = base_id
    existing = {str(row.get('id') or '') for row in rows}
    suffix = 2
    while tech_id in existing:
        tech_id = f'{base_id}-{suffix}'
        suffix += 1
    row = {
        'id': tech_id,
        'name': name,
        'content': content,
        'created_at': now,
        'updated_at': now,
    }
    rows = _clean_content_techniques([row, *rows])
    storage, warning = _save_content_techniques(rows)
    payload = {'ok': True, 'technique': row, 'techniques': rows, 'storage': storage}
    if warning:
        payload['warning'] = f'Đã lưu local, Supabase chưa ghi được: {warning}'
    return jsonify(payload)


@app.route('/api/content-techniques/<tech_id>', methods=['PUT'])
def content_techniques_update(tech_id):
    body = request.get_json(silent=True) or {}
    rows, _, _ = _load_content_techniques()
    target = None
    for row in rows:
        if str(row.get('id') or '') == str(tech_id):
            target = row
            break
    if not target:
        return jsonify({'ok': False, 'error': 'Không tìm thấy kỹ thuật'}), 404
    if target.get('system'):
        target = dict(target)
    name = str(body.get('name') or target.get('name') or '').strip()
    content = str(body.get('content') or target.get('content') or '').strip()
    if not name or not content:
        return jsonify({'ok': False, 'error': 'Nhập đủ Tên kỹ thuật và Nội dung'}), 400
    now = datetime.utcnow().isoformat(timespec='seconds') + 'Z'
    next_rows = []
    updated = None
    for row in rows:
        if str(row.get('id') or '') == str(tech_id):
            updated = {
                **row,
                'name': name,
                'content': content,
                'updated_at': now,
                'system': bool(row.get('system')),
            }
            next_rows.append(updated)
        else:
            next_rows.append(row)
    next_rows = _clean_content_techniques(next_rows)
    storage, warning = _save_content_techniques(next_rows)
    payload = {'ok': True, 'technique': updated, 'techniques': next_rows, 'storage': storage}
    if warning:
        payload['warning'] = f'Đã lưu local, Supabase chưa ghi được: {warning}'
    return jsonify(payload)


@app.route('/api/content-techniques/<tech_id>', methods=['DELETE'])
def content_techniques_delete(tech_id):
    rows, _, _ = _load_content_techniques()
    before = len(rows)
    rows = [row for row in rows if str(row.get('id') or '') != str(tech_id)]
    if len(rows) == before:
        return jsonify({'ok': False, 'error': 'Không tìm thấy kỹ thuật'}), 404
    storage, warning = _save_content_techniques(rows)
    payload = {'ok': True, 'techniques': rows, 'deleted': before - len(rows), 'storage': storage}
    if warning:
        payload['warning'] = f'Đã lưu local, Supabase chưa ghi được: {warning}'
    return jsonify(payload)


@app.route('/api/scripts/ai-chat', methods=['POST'])
def scripts_ai_chat():
    body = request.get_json(silent=True) or {}
    message = str(body.get('message') or '').strip()
    script = body.get('script') if isinstance(body.get('script'), dict) else {}
    active_section = str(body.get('active_section') or '').strip().lower()
    if active_section not in CONTENT_SECTION_KEYS:
        active_section = ''
    if not message:
        return jsonify({'ok': False, 'error': 'Nhập yêu cầu cho AI'}), 400

    setup, _, _ = _load_content_studio_setup()
    selected_ids = body.get('selected_technique_ids') if isinstance(body.get('selected_technique_ids'), list) else []
    techniques = _resolve_content_techniques(message, selected_ids)
    classifier = _get_classifier()
    if not classifier.api_key:
        provider_label = PROVIDERS.get(classifier.provider, {}).get('name') or classifier.provider.upper()
        return jsonify({'ok': False, 'error': f'Chưa cấu hình API key cho {provider_label} — vào Setup để lưu key trước'}), 400

    prompt = _build_script_ai_prompt(message, script, active_section, setup, techniques)
    try:
        raw = classifier._call_api(prompt)
        parsed = _load_json_payload_local(raw)
        result = _normalize_script_ai_result(parsed, raw, active_section)
        return jsonify({
            'ok': True,
            'result': result,
            'raw': raw,
            'model': classifier.model,
            'techniques': techniques,
        })
    except Exception as e:
        return jsonify({'ok': False, 'error': str(e)[:500]}), 502


@app.route('/api/business-profile', methods=['GET'])
def business_profile_get():
    global _business_profile
    try:
        storage = 'local'
        warning = ''
        if USE_SUPABASE:
            remote_profile, warning = _load_business_profile_from_supabase()
            if remote_profile:
                _business_profile = {**_default_business_profile(), **remote_profile}
                _save_business_profile()
                storage = 'supabase'
            else:
                _business_profile = _default_business_profile()
        profile = _business_profile if any((_business_profile or {}).values()) else _default_business_profile()
        payload = {'ok': True, 'profile': profile, 'storage': storage}
        if warning:
            payload['warning'] = warning
        return jsonify(payload)
    except Exception as e:
        return jsonify({'ok': False, 'error': str(e)}), 500


@app.route('/api/business-profile', methods=['POST'])
def business_profile_save():
    global _business_profile
    try:
        body = request.get_json() or {}
        _business_profile = _clean_business_profile(body)
        _save_business_profile()

        supabase_ok, supabase_error = _save_business_profile_to_supabase(_business_profile)
        storage = 'supabase' if supabase_ok else 'local'
        payload = {'ok': True, 'profile': _business_profile, 'storage': storage}
        if supabase_error:
            payload['warning'] = f'Đã lưu local, Supabase chưa ghi được: {supabase_error}'
        return jsonify(payload)
    except Exception as e:
        return jsonify({'ok': False, 'error': str(e)}), 500


@app.route('/api/business-profile/generate-text', methods=['POST'])
def business_profile_generate_text():
    global _business_profile
    try:
        body = request.get_json() or {}
        profile = _clean_business_profile(body)
        if not any(profile.values()):
            return jsonify({'ok': False, 'error': 'Nhập ít nhất một thông tin trước khi tạo văn bản'}), 400

        classifier = _get_classifier()
        if not classifier.api_key:
            return jsonify({'ok': False, 'error': 'Chưa cấu hình API key — thêm GEMINI_API_KEY vào .env hoặc key trong UI'}), 400

        generated = classifier.generate_business_text(profile)
        if classifier.last_error and not generated:
            return jsonify({'ok': False, 'error': classifier.last_error}), 502
        if not generated:
            return jsonify({'ok': False, 'error': 'AI chưa tạo được văn bản phù hợp'}), 502

        _business_profile = _clean_business_profile(generated)
        _save_business_profile()

        supabase_ok, supabase_error = _save_business_profile_to_supabase(_business_profile)
        storage = 'supabase' if supabase_ok else 'local'
        payload = {'ok': True, 'profile': _business_profile, 'storage': storage}
        if supabase_error:
            payload['warning'] = f'Đã lưu local, Supabase chưa ghi được: {supabase_error}'
        return jsonify(payload)
    except Exception as e:
        return jsonify({'ok': False, 'error': str(e)}), 500


@app.route('/api/telegram/test/<chat_id>', methods=['POST'])
def tg_test(chat_id):
    try:
        r = _req.post(
            f'https://api.telegram.org/bot{BOT_TOKEN}/sendMessage',
            json={'chat_id': chat_id, 'text': '✅ Kết nối Telegram thành công!'},
            timeout=10,
        )
        return jsonify({'ok': r.ok})
    except Exception as e:
        return jsonify({'ok': False, 'error': str(e)}), 500


# ── AI Routes ──────────────────────────────────────────
@app.route('/api/ai/providers')
def ai_providers():
    return jsonify(PROVIDERS)


@app.route('/api/ai/models')
def ai_models():
    provider = str(request.args.get('provider') or _ai_config.get('provider') or 'gemini').strip().lower()
    if provider == 'groq':
        models, warning = _list_groq_models_from_api()
    else:
        provider = 'gemini'
        models, warning = _list_gemini_models_from_api()
    payload = {'ok': True, 'provider': provider, 'models': models}
    if warning:
        payload['warning'] = warning
    return jsonify(payload)


@app.route('/api/ai/config', methods=['GET'])
def ai_config_get():
    safe, storage, warning = _effective_ai_config()
    safe_keys = {}
    for k, v in safe.get('keys', {}).items():
        safe_keys[k] = ('***' + v[-4:]) if v and len(v) > 4 else ('***' if v else '')
    safe.pop('keys', None)
    safe['keys_masked'] = safe_keys
    safe['storage'] = storage
    if warning:
        safe['warning'] = warning
    return jsonify(safe)


@app.route('/api/ai/config', methods=['POST'])
def ai_config_save():
    global _ai_config
    body = request.get_json() or {}
    if 'auto_classify' in body:
        _ai_config['auto_classify'] = bool(body['auto_classify'])
    if 'categories' in body and isinstance(body['categories'], list):
        _ai_config['categories'] = body['categories']
    storage, warning = _save_customer_ai_config(body)
    if 'auto_classify' in body or ('categories' in body and isinstance(body['categories'], list)):
        _save_ai_config()
    payload = {'ok': True, 'storage': storage}
    if warning:
        payload['warning'] = (
            f'Đã lưu tạm cấu hình AI, Supabase chưa ghi bảng {SUPABASE_CUSTOMER_AI_TABLE}: {warning}'
        )
    return jsonify(payload)


@app.route('/api/ai/test', methods=['POST'])
def ai_test():
    body = request.get_json(silent=True) or {}
    cfg, _, _ = _effective_ai_config()
    provider = str(body.get('provider') or cfg.get('provider') or 'gemini').strip().lower()
    if provider not in PROVIDERS:
        provider = 'gemini'
    default_model = PROVIDERS.get(provider, {}).get('default_model', DEFAULT_MODEL)
    model = str(body.get('model') or cfg.get('model') or default_model).strip() or default_model
    keys = dict(cfg.get('keys') or {})
    test_key = str(body.get('key') or '').strip()
    if test_key:
        keys[provider] = test_key
    api_key = _get_ai_key_from_config(provider, {**cfg, 'keys': keys})
    classifier = AIClassifier(provider, model, api_key, cfg.get('categories', DEFAULT_CATEGORIES))
    if not classifier.api_key:
        provider_label = PROVIDERS.get(provider, {}).get('name') or provider.upper()
        return jsonify({'ok': False, 'error': f'Chưa nhập API key cho {provider_label}', 'provider': provider, 'model': model})
    result = classifier.test_connection()
    result['provider'] = provider
    result['model'] = model
    return jsonify(result)


@app.route('/api/ai/key/<provider>', methods=['DELETE'])
def ai_key_delete(provider):
    global _ai_config
    cfg, _, _ = _effective_ai_config()
    keys = dict(cfg.get('keys') or {})
    if provider in keys:
        keys[provider] = ''
    storage = 'global'
    warning = ''
    staff_key = _current_staff_ai_key()
    active_provider = str(cfg.get('provider') or provider or 'gemini').strip().lower()
    if USE_SUPABASE and staff_key:
        staff = _current_staff()
        try:
            sb.upsert_customer_ai_settings({
                'staff_key': staff_key,
                'staff_id': str(staff.get('id') or ''),
                'username': str(staff.get('username') or ''),
                'customer_name': cfg.get('customer_name') or _current_staff_display_name(),
                'provider': active_provider,
                'model': cfg.get('model') or PROVIDERS.get(active_provider, {}).get('default_model') or DEFAULT_MODEL,
                'api_key': keys.get(active_provider, ''),
                'api_keys': keys,
            }, SUPABASE_CUSTOMER_AI_TABLE)
            storage = 'supabase'
        except Exception as e:
            warning = f'{str(e)[:300]} ({_supabase_debug_context(SUPABASE_CUSTOMER_AI_TABLE)})'
    _ai_config.setdefault('keys', {}).update(keys)
    _save_ai_config()
    payload = {'ok': True, 'storage': storage}
    if warning:
        payload['warning'] = warning
    return jsonify(payload)


@app.route('/api/ai/classify', methods=['POST'])
def ai_classify():
    global _classifications
    body = request.get_json() or {}
    posts = body.get('posts', [])
    force = body.get('force', False)
    if not posts:
        return jsonify({'ok': False, 'error': 'Không có bài viết'})
    classifier = _get_classifier()
    if not classifier.api_key:
        return jsonify({'ok': False, 'error': 'Chưa cấu hình API key'})
    to_classify = [p for p in posts if force or p.get('id') not in _classifications]
    if not to_classify:
        return jsonify({'ok': True, 'classifications': {pid: _classifications[pid] for pid in [p['id'] for p in posts] if pid in _classifications}})
    results = classifier.classify_posts(to_classify)
    if classifier.last_error and not results:
        return jsonify({'ok': False, 'error': classifier.last_error}), 502
    _classifications.update(results)
    _save_classifications(results)
    all_results = {p['id']: _classifications.get(p['id'], '') for p in posts}
    return jsonify({'ok': True, 'classifications': all_results})


@app.route('/api/ai/classifications', methods=['GET'])
def ai_classifications_get():
    return jsonify(_classifications)


@app.route('/api/ai/leads', methods=['GET'])
def ai_leads_get():
    remote, warning = _load_leads_from_supabase()
    if remote:
        merged = {**_leads}
        for post_id, items in remote.items():
            merged_items = merged.setdefault(post_id, [])
            by_key = {str(item.get('lead_key') or _lead_key(item)): item for item in merged_items}
            for item in items:
                by_key[str(item.get('lead_key') or _lead_key(item))] = item
            merged[post_id] = list(by_key.values())
        return jsonify(_filter_leads_for_current_staff(_public_leads_dict(merged)))
    return jsonify(_filter_leads_for_current_staff(_public_leads_dict(_leads)))


@app.route('/api/ai/reply-suggestions', methods=['GET'])
def ai_reply_suggestions_get():
    return jsonify(_reply_suggestions)


@app.route('/api/ai/comment-summaries', methods=['GET'])
def ai_comment_summaries_get():
    return jsonify(_comment_summaries)


@app.route('/api/ai/suggest-reply', methods=['POST'])
def ai_suggest_reply():
    global _reply_suggestions
    try:
        body = request.get_json() or {}
        post = body.get('post') or {}
        manual_comment = (body.get('comment') or '').strip()
        if not post:
            return jsonify({'ok': False, 'error': 'Không có bài viết'}), 400

        classifier = _get_classifier()
        if not classifier.api_key:
            return jsonify({'ok': False, 'error': 'Chưa cấu hình API key — thêm GEMINI_API_KEY vào .env hoặc key trong UI'}), 400

        suggestion = classifier.suggest_reply(post, manual_comment, _business_profile)
        if classifier.last_error and not suggestion:
            return jsonify({'ok': False, 'error': classifier.last_error}), 502
        if not suggestion:
            return jsonify({'ok': False, 'error': 'AI chưa tạo được gợi ý phù hợp'}), 502

        pid = suggestion.get('post_id') or post.get('id')
        suggestion['post_id'] = pid
        suggestion['group_id'] = post.get('_group_id', '')
        suggestion['post_url'] = post.get('permalink_url', '')
        _reply_suggestions[pid] = suggestion
        _save_reply_suggestions()

        supabase_ok, supabase_error = _save_reply_suggestion_to_supabase(suggestion)
        storage = 'supabase' if supabase_ok else 'local'
        payload = {'ok': True, 'suggestion': suggestion, 'storage': storage}
        if supabase_error:
            payload['warning'] = f'Đã lưu local, Supabase chưa ghi được: {supabase_error}'
        return jsonify(payload)
    except Exception as e:
        return jsonify({'ok': False, 'error': str(e)}), 500


@app.route('/api/ai/summarize-comments', methods=['POST'])
def ai_summarize_comments():
    global _comment_summaries
    try:
        body = request.get_json() or {}
        post = body.get('post') or {}
        force = bool(body.get('force', True))
        if not post or not post.get('id'):
            return jsonify({'ok': False, 'error': 'Không có bài viết'}), 400
        post_id = str(post.get('id'))
        page_id = str(post.get('_page_id') or body.get('page_id') or '').strip()
        group_id = str(post.get('_group_id') or page_id or DEFAULT_GROUP)
        if not force and post_id in _comment_summaries:
            return jsonify({'ok': True, 'summary': _comment_summaries[post_id], 'storage': 'local'})

        classifier = _get_classifier()
        if not classifier.api_key:
            return jsonify({'ok': False, 'error': 'Chưa cấu hình API key — thêm GEMINI_API_KEY vào .env hoặc key trong UI'}), 400

        if page_id:
            page_token = _page_token_from_cache(page_id)
            if not page_token:
                return jsonify({
                    'ok': False,
                    'error': 'Chưa có token Page. Bấm Tải lại bài viết hoặc kiểm tra cookie nhân sự và quyền quản trị Page.',
                }), 502
            loaded = get_api(DEFAULT_GROUP).get_post_comments(post_id, limit=500, access_token=page_token)
        else:
            loaded = get_api(group_id).get_post_comments(post_id, limit=500)
        if loaded is None:
            return jsonify({'ok': False, 'error': 'Không đọc được bình luận từ Facebook. Kiểm tra cookie/quyền nhóm hoặc quyền quản trị Page.'}), 502
        comments = loaded.get('comments') or []
        total_count = int(loaded.get('total_count') or len(comments))

        post_for_ai = {**post, 'comments': {'data': comments, 'summary': {'total_count': total_count}}}
        summary = classifier.summarize_post_comments(post_for_ai, comments, total_count)
        if classifier.last_error and not summary:
            return jsonify({'ok': False, 'error': classifier.last_error}), 502
        if not summary:
            return jsonify({'ok': False, 'error': 'AI chưa tóm tắt được bình luận'}), 502

        staff = _current_staff()
        summary['created_by_staff_id'] = staff.get('id', '')
        summary['created_by_staff_name'] = staff.get('name', '')
        summary['created_at'] = datetime.utcnow().isoformat(timespec='seconds') + 'Z'
        _comment_summaries[post_id] = summary
        _save_comment_summaries()

        supabase_ok, supabase_error = _save_comment_summary_to_supabase(summary)
        storage = 'supabase' if supabase_ok else 'local'
        payload = {'ok': True, 'summary': summary, 'storage': storage}
        if supabase_error:
            payload['warning'] = f'Đã lưu local, Supabase chưa ghi được: {supabase_error}'
        return jsonify(payload)
    except Exception as e:
        return jsonify({'ok': False, 'error': str(e)}), 500


@app.route('/api/ai/extract-leads', methods=['POST'])
def ai_extract_leads():
    global _leads
    body = request.get_json() or {}
    posts = body.get('posts', [])
    force = body.get('force', False)
    if not posts:
        return jsonify({'ok': False, 'error': 'Không có bài viết'})
    classifier = _get_classifier()
    if not classifier.api_key:
        return jsonify({'ok': False, 'error': 'Chưa cấu hình API key'})

    to_extract = [p for p in posts if force or p.get('id') not in _leads]
    if to_extract:
        results = classifier.extract_leads(to_extract)
        if classifier.last_error and not results:
            return jsonify({'ok': False, 'error': classifier.last_error}), 502
        for post in to_extract:
            pid = post.get('id')
            if pid:
                _leads[pid] = results.get(pid, [])
        _save_leads()
        flat_leads = [lead for items in results.values() for lead in (items or [])]
        supabase_ok, supabase_error = _save_leads_to_supabase(flat_leads)
    else:
        supabase_ok, supabase_error = True, ''

    all_results = {p['id']: _leads.get(p['id'], []) for p in posts if p.get('id')}
    payload = {'ok': True, 'leads': all_results}
    if classifier.last_error:
        payload['warning'] = classifier.last_error
    if not supabase_ok and supabase_error:
        payload['warning'] = f"{payload.get('warning', '')} Đã lưu local, Supabase chưa ghi lead được: {supabase_error}".strip()
    return jsonify(payload)


@app.route('/api/leads/bulk-delete', methods=['POST'])
def leads_bulk_delete():
    body = request.get_json(silent=True) or {}
    items = body.get('items') or []
    if not isinstance(items, list) or not items:
        return jsonify({'ok': False, 'error': 'Không có lead nào'}), 400
    deleted = 0
    failed = 0
    warnings: list[str] = []
    for raw in items:
        if not isinstance(raw, dict):
            failed += 1
            continue
        post_id = str(raw.get('post_id') or '').strip()
        lead_key = str(raw.get('lead_key') or '').strip()
        if not lead_key:
            failed += 1
            continue
        if not _lead_exists_anywhere(post_id, lead_key):
            failed += 1
            continue
        result = _delete_single_lead(post_id, lead_key)
        deleted += 1
        warning = str(result.get('warning') or '').strip()
        if warning and warning not in warnings:
            warnings.append(warning)
    if deleted <= 0:
        return jsonify({'ok': False, 'error': 'Không xoá được lead nào', 'failed': failed}), 404
    payload = {'ok': True, 'deleted': deleted, 'failed': failed}
    if warnings:
        payload['warning'] = '; '.join(warnings[:3])
    return jsonify(payload)


@app.route('/api/leads/from-comments', methods=['POST'])
def leads_from_comments():
    source = str((request.get_json(silent=True) or {}).get('source') or request.args.get('source') or '').strip().lower()
    post_id = str((request.get_json(silent=True) or {}).get('post_id') or request.args.get('post_id') or '').strip()
    rows, warning = _load_post_comment_rows(source=source, post_id=post_id, limit=5000)
    leads = _comment_rows_to_phone_leads(rows)
    changed = _merge_leads_into_memory(leads)
    supabase_ok, supabase_error = _save_leads_to_supabase(leads)
    grouped = {}
    for lead in leads:
        grouped.setdefault(str(lead.get('post_id') or ''), []).append(lead)
    payload = {
        'ok': True,
        'count': len(leads),
        'new_count': changed,
        'leads': grouped,
        'storage': 'supabase' if supabase_ok else 'local',
    }
    final_warning = supabase_error or warning
    if final_warning:
        payload['warning'] = final_warning
    return jsonify(payload)


@app.route('/api/leads/<lead_key>', methods=['DELETE'])
def leads_delete(lead_key):
    post_id = str(request.args.get('post_id') or '').strip()
    key = str(lead_key or '').strip()
    if not key:
        return jsonify({'ok': False, 'error': 'Thiếu lead_key'}), 400
    if not _lead_exists_anywhere(post_id, key):
        return jsonify({'ok': False, 'error': 'Không tìm thấy lead'}), 404
    result = _delete_single_lead(post_id, key)
    return jsonify({'ok': True, **result})


# ── Marketing Content Pipeline ─────────────────────────

def _zalo_deep_links(phone: str) -> dict:
    digits = re.sub(r'\D+', '', phone or '')
    if digits.startswith('84'):
        local = '0' + digits[2:]
    else:
        local = digits
    return {
        'ok': bool(local),
        'phone': local,
        'web_url': f'https://zalo.me/{local}' if local else '',
        'app_url': f'zalo://conversation?phone={local}' if local else '',
        'note': 'zalo.me/{phone} là universal link ổn định nhất; zalo:// phụ thuộc thiết bị đã cài Zalo.',
    }

@app.route('/api/zalo/deeplink', methods=['GET', 'POST'])
def api_zalo_deeplink():
    body = request.get_json(silent=True) or {}
    phone = request.args.get('phone') or body.get('phone') or body.get('zalo') or ''
    payload = _zalo_deep_links(str(phone))
    if not payload.get('ok'):
        return jsonify({'ok': False, 'error': 'Thiếu số điện thoại Zalo'}), 400
    return jsonify(payload)

@app.route('/api/tiktok/publish/capability', methods=['GET'])
def api_tiktok_publish_capability():
    return jsonify({
        'ok': True,
        'supported': False,
        'current_flow': 'comment/read/reply via browser extension or Playwright worker',
        'required_for_direct_publish': [
            'TikTok Content Posting API app approval',
            'OAuth user consent',
            'Scopes such as video.upload/video.publish or current TikTok-approved equivalents',
            'Public video file URL or inbox upload flow required by TikTok API',
        ],
        'recommendation': 'Không dùng cookie để publish video TikTok hàng loạt trên production. Cần làm OAuth Content Posting API hoặc dùng Zapier/Make nếu tài khoản được hỗ trợ.',
    })

@app.route('/api/integrations/capabilities', methods=['GET'])
def api_integration_capabilities():
    return jsonify({
        'ok': True,
        'facebook': {
            'fanpage': {'publish_text': True, 'publish_link_preview': True, 'publish_native_video_file_url': True, 'tested': True},
            'group': {'publish_text': True, 'publish_link_preview': True, 'publish_native_video_file_url': True, 'tested_link_preview': True},
            'video_rule': 'Only direct .mp4/.mov/.webm URLs are native video. YouTube/TikTok/Facebook watch URLs are link previews.',
        },
        'tiktok': {
            'direct_publish_ready': False,
            'reason': 'Needs TikTok Content Posting API OAuth/app approval. Current system supports comment workflows, not direct video publishing.',
            'zapier_note': 'Zapier has TikTok-related integrations, but direct organic video publishing depends on Zapier app availability, TikTok account permissions, and approved scopes.',
        },
        'zalo': {
            'deep_link_ready': True,
            'format': 'https://zalo.me/{phone}',
            'app_scheme': 'zalo://conversation?phone={phone}',
        },
    })

@app.route('/api/content-pipeline', methods=['GET'])
def content_pipeline_get():
    articles = sorted(_content_pipeline.get('articles') or [], key=lambda item: str(item.get('published_at') or item.get('created_at') or ''), reverse=True)
    posts = sorted(_content_pipeline.get('posts') or [], key=lambda item: str(item.get('created_at') or ''), reverse=True)
    return jsonify({
        'ok': True,
        'sources': _content_pipeline.get('sources') or [],
        'articles': articles[:100],
        'posts': posts[:100],
        'stats': {
            'sources': len([s for s in (_content_pipeline.get('sources') or []) if s.get('active') is not False]),
            'articles': len(articles),
            'new_articles': len([a for a in articles if a.get('status') == 'new']),
            'draft_posts': len([p for p in posts if p.get('status') == 'draft']),
        },
    })


@app.route('/api/content-pipeline/research', methods=['POST'])
def content_pipeline_research():
    global _content_pipeline
    body = request.get_json(silent=True) or {}
    source_filter = str(body.get('source_filter') or body.get('sourceFilter') or 'all').strip().lower()
    sources = [s for s in (_content_pipeline.get('sources') or []) if s.get('active') is not False]
    if source_filter not in ('', 'all'):
        sources = [s for s in sources if str(s.get('id') or '').lower() == source_filter or str(s.get('type') or '').lower() == source_filter]

    existing = {str(item.get('id')): item for item in (_content_pipeline.get('articles') or [])}
    added = 0
    errors = []
    for source in sources:
        try:
            for article in _fetch_pipeline_rss(source, limit=12):
                if article['id'] not in existing:
                    existing[article['id']] = article
                    added += 1
        except Exception as e:
            errors.append(f"{source.get('name') or source.get('id')}: {e}")

    _content_pipeline['articles'] = sorted(existing.values(), key=lambda item: str(item.get('published_at') or item.get('created_at') or ''), reverse=True)[:250]
    _save_content_pipeline()
    payload = {'ok': True, 'added': added, 'article_count': len(_content_pipeline['articles'])}
    if errors:
        payload['warning'] = '; '.join(errors[:3])
    return jsonify(payload)


@app.route('/api/content-pipeline/write', methods=['POST'])
def content_pipeline_write():
    global _content_pipeline
    body = request.get_json(silent=True) or {}
    selections = body.get('selections') or []
    if not isinstance(selections, list) or not selections:
        return jsonify({'ok': False, 'error': 'Chọn ít nhất một tin để AI viết bài'}), 400

    articles_by_id = {str(item.get('id')): item for item in (_content_pipeline.get('articles') or [])}
    posts = list(_content_pipeline.get('posts') or [])
    created = []
    warnings = []
    staff = _current_staff()
    for item in selections[:10]:
        article_id = str((item or {}).get('id') or '').strip()
        fmt = str((item or {}).get('format') or 'pov').strip()
        article = articles_by_id.get(article_id)
        if not article:
            continue
        result = _pipeline_write_article(article, fmt)
        if result.get('ai_error'):
            warnings.append(result['ai_error'])
        post = {
            'id': _pipeline_post_id(article_id, fmt),
            'article_id': article_id,
            'article_title': article.get('title') or '',
            'article_url': article.get('url') or '',
            'source_name': article.get('source_name') or '',
            'format': fmt,
            'content': result.get('content') or '',
            'hashtags': result.get('hashtags') or '',
            'status': 'draft',
            'created_by_staff_id': staff.get('id', ''),
            'created_by_staff_name': staff.get('name', ''),
            'created_at': datetime.utcnow().isoformat(timespec='seconds') + 'Z',
        }
        posts.append(post)
        article['status'] = 'written'
        created.append(post)

    _content_pipeline['articles'] = list(articles_by_id.values())
    _content_pipeline['posts'] = sorted(posts, key=lambda row: str(row.get('created_at') or ''), reverse=True)[:250]
    _save_content_pipeline()
    payload = {'ok': True, 'count': len(created), 'posts': created}
    if warnings:
        payload['warning'] = '; '.join(dict.fromkeys(warnings))[:500]
    return jsonify(payload)



@app.route('/api/content-pipeline/posts', methods=['POST'])
def content_pipeline_post_create():
    global _content_pipeline
    body = request.get_json(silent=True) or {}
    title = str(body.get('title') or body.get('article_title') or '').strip()
    content = str(body.get('content') or '').strip()
    media_url = str(body.get('media_url') or body.get('mediaUrl') or '').strip()
    native_video_url = str(body.get('native_video_url') or body.get('nativeVideoUrl') or '').strip()
    media_urls = _extract_media_urls(body)
    hashtags = str(body.get('hashtags') or '').strip()
    scheduled_at = str(body.get('scheduled_at') or body.get('scheduledAt') or '').strip()
    targets = body.get('targets') or []
    status = str(body.get('status') or ('scheduled' if scheduled_at else 'draft')).strip() or 'draft'
    if not title or not content:
        return jsonify({'ok': False, 'error': 'Nhập đủ tiêu đề và nội dung'}), 400
    if scheduled_at and not _parse_iso_datetime(scheduled_at):
        return jsonify({'ok': False, 'error': 'Thời gian lên lịch không hợp lệ'}), 400
    if targets and not isinstance(targets, list):
        return jsonify({'ok': False, 'error': 'Danh sách nơi đăng không hợp lệ'}), 400
    staff = _current_staff()
    now = datetime.utcnow().isoformat(timespec='seconds') + 'Z'
    post = {
        'id': f"manual_{uuid.uuid4().hex[:12]}",
        'article_title': title,
        'article_url': media_url or native_video_url or (media_urls[0] if media_urls else ''),
        'source_name': 'Manual composer',
        'format': 'manual',
        'content': content,
        'media_url': '' if media_urls else media_url,
        'native_video_url': '' if media_urls else native_video_url,
        'media_urls': media_urls,
        'hashtags': hashtags,
        'status': status,
        'scheduled_at': scheduled_at,
        'scheduled_targets': targets if isinstance(targets, list) else [],
        'created_by_staff_id': staff.get('id', ''),
        'created_by_staff_name': staff.get('name', ''),
        'created_at': now,
        'updated_at': now,
    }
    posts = list(_content_pipeline.get('posts') or [])
    posts.insert(0, post)
    _content_pipeline['posts'] = posts[:250]
    _save_content_pipeline()
    return jsonify({'ok': True, 'post': post})

@app.route('/api/content-pipeline/posts/<post_id>', methods=['PATCH'])
def content_pipeline_post_update(post_id):
    body = request.get_json(silent=True) or {}
    changed = False
    for post in _content_pipeline.get('posts') or []:
        if str(post.get('id')) == str(post_id):
            for key in (
                'content',
                'hashtags',
                'status',
                'scheduled_at',
                'scheduled_targets',
                'publish_results',
                'published_at',
                'article_title',
                'media_url',
                'article_url',
            ):
                if key in body:
                    post[key] = body.get(key)
                    changed = True
            post['updated_at'] = datetime.utcnow().isoformat(timespec='seconds') + 'Z'
            break
    if changed:
        _save_content_pipeline()
    return jsonify({'ok': changed})


@app.route('/api/content-pipeline/posts/<post_id>', methods=['DELETE'])
def content_pipeline_post_delete(post_id):
    before = len(_content_pipeline.get('posts') or [])
    _content_pipeline['posts'] = [post for post in (_content_pipeline.get('posts') or []) if str(post.get('id')) != str(post_id)]
    if len(_content_pipeline['posts']) != before:
        _save_content_pipeline()
    return jsonify({'ok': True, 'deleted': before - len(_content_pipeline['posts'])})


@app.route('/api/content-pipeline/posts/<post_id>/publish', methods=['POST'])
def content_pipeline_post_publish(post_id):
    body = request.get_json(silent=True) or {}
    targets = body.get('targets') or []
    if not isinstance(targets, list) or not targets:
        return jsonify({'ok': False, 'error': 'Chọn ít nhất một Page hoặc nhóm để đăng'}), 400
    for post in _content_pipeline.get('posts') or []:
        if str(post.get('id')) == str(post_id):
            result = _publish_content_pipeline_post(post, targets)
            post['publish_results'] = result.get('results') or []
            post['published_at'] = datetime.utcnow().isoformat(timespec='seconds') + 'Z'
            post['status'] = 'posted' if result.get('ok') else 'failed'
            post['updated_at'] = datetime.utcnow().isoformat(timespec='seconds') + 'Z'
            _save_content_pipeline()
            return jsonify(result)
    return jsonify({'ok': False, 'error': 'Không tìm thấy bản nháp'}), 404


@app.route('/api/content-pipeline/posts/<post_id>/schedule', methods=['POST'])
def content_pipeline_post_schedule(post_id):
    body = request.get_json(silent=True) or {}
    scheduled_at = str(body.get('scheduled_at') or '').strip()
    targets = body.get('targets') or []
    if not _parse_iso_datetime(scheduled_at):
        return jsonify({'ok': False, 'error': 'Thời gian lên lịch không hợp lệ'}), 400
    if not isinstance(targets, list) or not targets:
        return jsonify({'ok': False, 'error': 'Chọn ít nhất một Page hoặc nhóm để lên lịch'}), 400
    for post in _content_pipeline.get('posts') or []:
        if str(post.get('id')) == str(post_id):
            post['status'] = 'scheduled'
            post['scheduled_at'] = scheduled_at
            post['scheduled_targets'] = targets
            post['updated_at'] = datetime.utcnow().isoformat(timespec='seconds') + 'Z'
            _save_content_pipeline()
            return jsonify({'ok': True, 'post': post})
    return jsonify({'ok': False, 'error': 'Không tìm thấy bản nháp'}), 404


def _staff_for_scheduled_post(post: dict) -> dict:
    staff_id = str(post.get('created_by_staff_id') or '').strip()
    staff = _find_local_staff_account(staff_id) if staff_id else None
    if staff:
        return _sync_staff_cookie_fields(dict(staff))
    return _active_staff()


def _run_due_scheduled_posts() -> dict:
    if not _scheduled_posts_lock.acquire(blocking=False):
        return {'ok': True, 'ran': 0, 'busy': True, 'results': []}
    now = datetime.now(timezone.utc)
    ran = 0
    results = []
    previous_staff = getattr(_runtime_staff_context, 'staff', None)
    try:
        for post in _content_pipeline.get('posts') or []:
            if str(post.get('status') or '') != 'scheduled':
                continue
            due_at = _parse_iso_datetime(post.get('scheduled_at'))
            if not due_at or due_at > now:
                continue
            targets = post.get('scheduled_targets') or []
            staff = _staff_for_scheduled_post(post)
            if staff:
                _runtime_staff_context.staff = staff
                result = _publish_content_pipeline_post(post, targets if isinstance(targets, list) else [])
            else:
                if hasattr(_runtime_staff_context, 'staff'):
                    delattr(_runtime_staff_context, 'staff')
                result = {'ok': False, 'error': 'Không tìm thấy nhân sự/cookie đã tạo lịch', 'results': []}
            post['publish_results'] = result.get('results') or []
            post['published_at'] = datetime.utcnow().isoformat(timespec='seconds') + 'Z'
            post['status'] = 'posted' if result.get('ok') else 'failed'
            post['updated_at'] = datetime.utcnow().isoformat(timespec='seconds') + 'Z'
            results.append({'id': post.get('id'), **result})
            ran += 1
        if ran:
            _save_content_pipeline()
        return {'ok': True, 'ran': ran, 'results': results}
    finally:
        if previous_staff:
            _runtime_staff_context.staff = previous_staff
        elif hasattr(_runtime_staff_context, 'staff'):
            delattr(_runtime_staff_context, 'staff')
        _scheduled_posts_lock.release()


@app.route('/api/content-pipeline/scheduled/run', methods=['GET', 'POST'])
def content_pipeline_run_scheduled():
    return jsonify(_run_due_scheduled_posts())


# ── Supabase ───────────────────────────────────────────
@app.route('/api/supabase/health')
def supabase_health():
    return jsonify({
        'enabled': USE_SUPABASE,
        'project_ref': _supabase_project_ref(),
        'key_source': _supabase_key_source(),
        'customer_ai_table': SUPABASE_CUSTOMER_AI_TABLE,
        **sb.ping(),
    })


@app.route('/api/saved-posts')
def saved_posts():
    if not USE_SUPABASE:
        return jsonify({'ok': False, 'error': 'Supabase chưa được cấu hình'}), 400
    limit = request.args.get('limit', 100, type=int)
    group_id = (request.args.get('group_id') or '').strip() or None
    try:
        rows = sb.list_saved_posts(limit=limit, group_id=group_id)
        return jsonify({'ok': True, 'count': len(rows), 'posts': rows})
    except Exception as e:
        return jsonify({'ok': False, 'error': str(e)}), 500


# ── Start ──────────────────────────────────────────────
def _scheduled_posts_worker():
    interval = max(10, SCHEDULED_POST_WORKER_INTERVAL_SECONDS)
    time_module.sleep(5)
    while True:
        try:
            with app.app_context():
                result = _run_due_scheduled_posts()
                if result.get('ran'):
                    print(f"[scheduler] published {result.get('ran')} scheduled post(s)")
        except Exception as e:
            print(f'[scheduler] scheduled post worker failed: {e}')
        time_module.sleep(interval)


_load_state()
threading.Thread(target=_poll_telegram, daemon=True).start()
if SCHEDULED_POST_WORKER_INTERVAL_SECONDS > 0:
    threading.Thread(target=_scheduled_posts_worker, daemon=True).start()

if __name__ == '__main__':
    print(f'[server] supabase={"on" if USE_SUPABASE else "off"} | staff cookie optional | http://localhost:{PORT}')
    app.run(debug=False, host='0.0.0.0', port=PORT, threaded=True)

