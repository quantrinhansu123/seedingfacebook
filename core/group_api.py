import os
import json
import re
import requests
from requests.exceptions import RequestException
from typing import Optional, List, Dict
from urllib.parse import urlparse
from core.token_gen import FacebookTokenGenerator

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TOKEN_FILE = os.path.join(BASE_DIR, 'data', 'token_success.txt')
COOKIE_FILE = os.path.join(BASE_DIR, 'data', 'cookie.txt')
FB_CLIENT_ID = '350685531728'
GRAPH_URL = 'https://graph.facebook.com/v21.0'
VIDEO_EXTS = ('.mp4', '.mov', '.m4v')


def _is_video_url(url: str) -> bool:
    path = urlparse(str(url or '')).path.lower()
    return path.endswith(VIDEO_EXTS)


def _clean_media_urls(media_urls) -> List[str]:
    if not media_urls:
        return []
    if isinstance(media_urls, str):
        raw = media_urls.replace(',', '\n').splitlines()
    else:
        raw = media_urls
    out: List[str] = []
    for item in raw:
        url = str(item or '').strip()
        if url and url not in out:
            out.append(url)
    return out


def _post_object_id(post_id: str) -> str:
    """Facebook feed IDs are often group_id_post_id, while comment edges need post_id."""
    post_id = str(post_id or '').strip()
    if '_' in post_id:
        return post_id.rsplit('_', 1)[-1]
    return post_id


def load_token(token_file: str = None) -> Optional[str]:
    token_file = token_file or TOKEN_FILE
    if not os.path.exists(token_file):
        return None
    with open(token_file, 'r', encoding='utf-8') as f:
        lines = [l.strip() for l in f if l.strip()]
    if not lines:
        return None
    return lines[-1].split('|')[-1]


def load_cookie(cookie: str = None) -> Optional[str]:
    if cookie:
        return cookie.strip() or None
    if not os.path.exists(COOKIE_FILE):
        return None
    with open(COOKIE_FILE, 'r', encoding='utf-8') as f:
        return f.read().strip() or None


_live_api_instances = []


def refresh_token(cookie: str = None, token_file: str = None) -> Optional[str]:
    cookie = load_cookie(cookie)
    if not cookie:
        print('Khong tim thay cookie.txt — can cap nhat cookie thu cong')
        return None
    print('Token het han, dang lay token moi tu cookie...')
    return FacebookTokenGenerator(FB_CLIENT_ID, cookie, token_file).GetToken()


def friendly_graph_error(exc: Exception) -> str:
    raw = re.sub(r'access_token=[^&\s\'"]+', 'access_token=***', str(exc))
    low = raw.lower()
    if 'getaddrinfo failed' in low or 'failed to resolve' in low or 'nameresolution' in low:
        return 'Không phân giải được graph.facebook.com (lỗi DNS/mạng). Kiểm tra internet, DNS hoặc tắt VPN/proxy rồi thử lại.'
    if 'max retries exceeded' in low or 'connectionerror' in low or 'connection refused' in low:
        return 'Không kết nối được Facebook Graph API. Kiểm tra mạng hoặc thử lại sau vài phút.'
    if 'timed out' in low or 'timeout' in low:
        return 'Facebook Graph API phản hồi quá chậm (timeout). Thử lại sau.'
    if len(raw) > 280:
        return raw[:280] + '...'
    return raw


class FacebookGroupAPI:
    def __init__(self, group_id: str, cookie: str = None, token_file: str = None):
        self.group_id = group_id
        self.cookie = load_cookie(cookie)
        self.token_file = token_file
        self.access_token = load_token(token_file) or refresh_token(self.cookie, token_file)
        self.last_graph_error = ''
        _live_api_instances.append(self)

    def _sync_access_token(self, token: str) -> None:
        if not token:
            return
        self.access_token = token
        for inst in _live_api_instances:
            if inst is not self and inst.token_file == self.token_file:
                inst.access_token = token

    def _refresh_access_token(self) -> bool:
        new_token = refresh_token(self.cookie, self.token_file)
        if not new_token:
            print('Khong the refresh token - kiem tra lai cookie')
            return False
        self._sync_access_token(new_token)
        return True

    def _is_expired(self, data: dict) -> bool:
        return data.get('error', {}).get('code') == 190

    def _call(self, method: str, url: str, **kwargs) -> Optional[dict]:
        self.last_graph_error = ''
        for attempt in range(2):
            try:
                kwargs.setdefault('params', {})['access_token'] = self.access_token
                kwargs.setdefault('timeout', 30)
                resp = getattr(requests, method)(url, **kwargs)
                data = resp.json()
            except RequestException as exc:
                self.last_graph_error = friendly_graph_error(exc)
                return None
            except ValueError:
                self.last_graph_error = 'Facebook trả về dữ liệu không hợp lệ.'
                return None
            if self._is_expired(data):
                if attempt == 0 and self._refresh_access_token():
                    continue
                print('Khong the refresh token - kiem tra lai cookie')
                self.last_graph_error = 'Cookie/token Facebook hết hạn hoặc không hợp lệ.'
                return None
            return data
        return None

    def get_posts(self, limit: int = 10) -> Optional[List[Dict]]:
        data = self._call('get', f'{GRAPH_URL}/{self.group_id}/feed', params={
            'fields': 'id,message,from,created_time,updated_time,is_hidden,permalink_url,attachments,comments.limit(50).summary(true){id,message,from,created_time},reactions.limit(0).summary(true),shares',
            'limit': limit,
        })
        posts = data.get('data') if data else None
        if not posts:
            return posts
        for post in posts:
            self._fill_post_engagement(post)
        return posts

    def _fill_post_engagement(self, post: Dict) -> None:
        comments = post.get('comments') or {}
        has_comment_count = isinstance(comments.get('summary'), dict) and comments.get('summary', {}).get('total_count') is not None
        if has_comment_count or not post.get('id'):
            return

        object_id = _post_object_id(post.get('id', ''))
        if not object_id or object_id == post.get('id'):
            return
        data = self._call('get', f'{GRAPH_URL}/{object_id}', params={
            'fields': 'comments.limit(50).summary(true){id,message,from,created_time,attachment},reactions.limit(0).summary(true),shares',
        })
        if not data or data.get('error'):
            return

        fb_comments = data.get('comments')
        if isinstance(fb_comments, dict):
            if not isinstance(fb_comments.get('summary'), dict):
                fb_comments['summary'] = {}
            if fb_comments['summary'].get('total_count') is None:
                fb_comments['summary']['total_count'] = len(fb_comments.get('data') or [])
            post['comments'] = fb_comments
        if data.get('reactions'):
            post['reactions'] = data['reactions']
        if data.get('shares'):
            post['shares'] = data['shares']

    def _post_graph(self, url: str, params: dict, data: dict = None, timeout: int = 30, retry_user_token: bool = True) -> Optional[dict]:
        clean = {k: v for k, v in params.items() if not k.startswith('_')}
        for attempt in range(2):
            resp = requests.post(url, params=clean, data=data, timeout=timeout)
            payload = resp.json()
            if retry_user_token and self._is_expired(payload):
                if attempt == 0 and self._refresh_access_token():
                    clean['access_token'] = self.access_token
                    continue
            return payload
        return None

    def _post_photo(self, target_id: str, photo_url: str, caption: str, token: str, retry_user_token: bool = False) -> Optional[dict]:
        data = {'url': photo_url}
        if caption:
            data['caption'] = caption
        return self._post_graph(
            f'{GRAPH_URL}/{target_id}/photos',
            {'access_token': token},
            data=data,
            timeout=60,
            retry_user_token=retry_user_token,
        )

    def _create_unpublished_photo(self, target_id: str, photo_url: str, token: str, retry_user_token: bool = False) -> Optional[dict]:
        return self._post_graph(
            f'{GRAPH_URL}/{target_id}/photos',
            {'access_token': token},
            data={'url': photo_url, 'published': 'false'},
            timeout=60,
            retry_user_token=retry_user_token,
        )

    def _post_feed_with_media(self, target_id: str, message: str, media_ids: List[str], token: str, retry_user_token: bool = False) -> Optional[dict]:
        data = {}
        if message:
            data['message'] = message
        for idx, media_id in enumerate(media_ids):
            data[f'attached_media[{idx}]'] = json.dumps({'media_fbid': media_id})
        return self._post_graph(
            f'{GRAPH_URL}/{target_id}/feed',
            {'access_token': token},
            data=data,
            timeout=60,
            retry_user_token=retry_user_token,
        )

    def _post_video(self, target_id: str, video_url: str, description: str, token: str, retry_user_token: bool = False) -> Optional[dict]:
        return self._post_graph(
            f'{GRAPH_URL}/{target_id}/videos',
            {'access_token': token, 'description': description, 'file_url': video_url},
            timeout=120,
            retry_user_token=retry_user_token,
        )

    def _post_media(self, target_id: str, message: str, token: str, media_urls, retry_user_token: bool = False) -> Optional[dict]:
        media_urls = _clean_media_urls(media_urls)
        if not media_urls:
            return None
        video_urls = [url for url in media_urls if _is_video_url(url)]
        photo_urls = [url for url in media_urls if url not in video_urls]
        if video_urls and len(media_urls) > 1:
            return {'error': {'message': 'Facebook không hỗ trợ đăng lẫn nhiều ảnh/video trong cùng một bài qua API này'}}
        if video_urls:
            result = self._post_video(target_id, video_urls[0], message, token, retry_user_token)
            if result is not None:
                result['_delivery'] = 'native_video'
            return result
        if len(photo_urls) == 1:
            result = self._post_photo(target_id, photo_urls[0], message, token, retry_user_token)
            if result is not None:
                result['_delivery'] = 'native_photo'
            return result

        media_ids: List[str] = []
        for photo_url in photo_urls:
            photo = self._create_unpublished_photo(target_id, photo_url, token, retry_user_token)
            if not photo or 'id' not in photo:
                return photo
            media_ids.append(photo['id'])
        result = self._post_feed_with_media(target_id, message, media_ids, token, retry_user_token)
        if result is not None:
            result['_delivery'] = 'native_photos'
        return result

    def create_post(self, message: str, page_token: str = None, link_url: str = '', native_video_url: str = '', media_urls=None) -> Optional[dict]:
        token = page_token or self.access_token
        retry_user_token = not page_token
        media_result = self._post_media(self.group_id, message, token, media_urls, retry_user_token)
        if media_result is not None:
            return media_result
        if native_video_url:
            return self._post_video(self.group_id, native_video_url, message, token, retry_user_token)
        params = {'access_token': token, 'message': message}
        if link_url:
            params['link'] = link_url
        return self._post_graph(
            f'{GRAPH_URL}/{self.group_id}/feed',
            params,
            timeout=30,
            retry_user_token=not page_token,
        )

    def create_page_post(self, page_id: str, message: str, page_token: str, link_url: str = '', native_video_url: str = '', media_urls=None) -> Optional[dict]:
        media_result = self._post_media(page_id, message, page_token, media_urls)
        if media_result is not None:
            return media_result
        if native_video_url:
            return self._post_video(page_id, native_video_url, message, page_token)
        params = {'access_token': page_token, 'message': message}
        if link_url:
            params['link'] = link_url
        return self._post_graph(
            f'{GRAPH_URL}/{page_id}/feed',
            params,
            timeout=30,
            retry_user_token=False,
        )

    def get_page_posts(self, page_id: str, page_token: str, limit: int = 10) -> Optional[List[Dict]]:
        token = page_token or self.access_token
        resp = requests.get(
            f'{GRAPH_URL}/{page_id}/posts',
            params={
                'access_token': token,
                'fields': 'id,message,from,created_time,updated_time,is_hidden,permalink_url,attachments,comments.limit(50).summary(true){id,message,from,created_time},reactions.limit(0).summary(true),shares',
                'limit': limit,
            },
            timeout=30,
        )
        data = resp.json()
        if data.get('error'):
            return None
        return data.get('data') or []

    def get_pages(self) -> Optional[list]:
        data = self._call('get', f'{GRAPH_URL}/me/accounts', params={'fields': 'id,name,access_token'})
        return data.get('data') if data else None

    def post_comment(self, post_id: str, message: str, page_token: str = None, attachment_url: str = '') -> Optional[dict]:
        token = page_token or self.access_token
        params = {'access_token': token}
        if message:
            params['message'] = message
        if attachment_url:
            params['attachment_url'] = attachment_url
        resp = requests.post(
            f'{GRAPH_URL}/{post_id}/comments',
            params=params
        )
        return resp.json()

    def get_post_comments(self, post_id: str, limit: int = 500, access_token: str = None) -> Optional[dict]:
        comments: List[Dict] = []
        token = access_token or self.access_token
        fields = 'id,message,from,created_time,attachment,comments.limit(50).summary(true){id,message,from,created_time,attachment}'
        page_limit = min(max(limit, 1), 100)
        params = {
            'access_token': token,
            'fields': fields,
            'limit': page_limit,
            'summary': 'true',
            'filter': 'stream',
        }
        resp = requests.get(f'{GRAPH_URL}/{post_id}/comments', params=dict(params), timeout=30)
        data = resp.json()
        if data and data.get('error') and '_' in str(post_id):
            resp = requests.get(f'{GRAPH_URL}/{_post_object_id(post_id)}/comments', params=dict(params), timeout=30)
            data = resp.json()
        if data and self._is_expired(data) and not access_token:
            new_token = refresh_token(self.cookie, self.token_file)
            if new_token:
                self.access_token = new_token
                params['access_token'] = self.access_token
                resp = requests.get(f'{GRAPH_URL}/{post_id}/comments', params=dict(params), timeout=30)
                data = resp.json()
        if data is None:
            return None
        if data.get('error'):
            return None

        total_count = ((data.get('summary') or {}).get('total_count') or 0)
        while data and len(comments) < limit:
            for item in data.get('data') or []:
                comments.append(item)
                if len(comments) >= limit:
                    break
            next_url = ((data.get('paging') or {}).get('next') or '')
            if not next_url or len(comments) >= limit:
                break
            try:
                resp = requests.get(next_url, timeout=30)
                data = resp.json()
                if self._is_expired(data):
                    import re
                    new_token = refresh_token(self.cookie, self.token_file)
                    if not new_token:
                        break
                    self.access_token = new_token
                    next_url = re.sub(r'access_token=[^&]+', f'access_token={self.access_token}', next_url)
                    resp = requests.get(next_url, timeout=30)
                    data = resp.json()
                if 'error' in data:
                    break
            except Exception:
                break
        return {'comments': comments[:limit], 'total_count': total_count or len(comments)}

    def get_post_reactions(self, post_id: str, limit: int = 100, access_token: str = None) -> Optional[dict]:
        reactions: List[Dict] = []
        token = access_token or self.access_token
        page_limit = min(max(limit, 1), 100)
        params = {
            'access_token': token,
            'fields': 'id,name,type',
            'limit': page_limit,
            'summary': 'true',
        }
        target_ids = [post_id]
        if '_' in str(post_id):
            alt = _post_object_id(post_id)
            if alt and alt not in target_ids:
                target_ids.append(alt)

        data = None
        for target_id in target_ids:
            resp = requests.get(f'{GRAPH_URL}/{target_id}/reactions', params=dict(params), timeout=30)
            data = resp.json()
            if data and not data.get('error'):
                break
        if data and self._is_expired(data) and not access_token:
            new_token = refresh_token(self.cookie, self.token_file)
            if new_token:
                self.access_token = new_token
                params['access_token'] = self.access_token
                resp = requests.get(f'{GRAPH_URL}/{target_ids[0]}/reactions', params=dict(params), timeout=30)
                data = resp.json()
        if data is None or data.get('error'):
            return None

        total_count = ((data.get('summary') or {}).get('total_count') or 0)
        while data and len(reactions) < limit:
            for item in data.get('data') or []:
                reactions.append(item)
                if len(reactions) >= limit:
                    break
            next_url = ((data.get('paging') or {}).get('next') or '')
            if not next_url or len(reactions) >= limit:
                break
            try:
                resp = requests.get(next_url, timeout=30)
                data = resp.json()
                if 'error' in data:
                    break
            except Exception:
                break
        return {'reactions': reactions[:limit], 'total_count': total_count or len(reactions)}

    def get_post_share_count(self, post_id: str, access_token: str = None) -> Optional[int]:
        token = access_token or self.access_token
        target_ids = [post_id]
        if '_' in str(post_id):
            alt = _post_object_id(post_id)
            if alt and alt not in target_ids:
                target_ids.append(alt)
        for target_id in target_ids:
            resp = requests.get(
                f'{GRAPH_URL}/{target_id}',
                params={'access_token': token, 'fields': 'shares'},
                timeout=30,
            )
            data = resp.json()
            if data and not data.get('error'):
                shares = data.get('shares') or {}
                return int(shares.get('count') or 0)
        return None

    def resolve_slug(self, slug: str) -> Optional[dict]:
        data = self._call('get', f'{GRAPH_URL}/{slug}', params={'fields': 'id,name'})
        if data and 'id' in data:
            return data
        return _scrape_group_id(slug, self.cookie)

    def _parse_membership_html(self, html: str, url: str = '') -> Optional[bool]:
        import re
        if not html:
            return None
        if '/login' in (url or '') or re.search(r'login_form|<title>Log in|Đăng nhập', html[:2000], re.I):
            return None
        member_patterns = (
            r'"is_member"\s*:\s*true',
            r'"viewerMembershipState"\s*:\s*"IS_MEMBER"',
            r'"membership_state"\s*:\s*"MEMBER"',
            r'viewer_membership_status["\']?\s*:\s*["\']member',
            r'if_viewer_can_leave_group|leave_group_button|groups_leave',
            r'Đã tham gia|\bJoined\b|rời nhóm|Rời Nhóm|Leave group|leave_group',
        )
        if any(re.search(pattern, html, re.I) for pattern in member_patterns):
            return True
        non_member_patterns = (
            r'"is_member"\s*:\s*false',
            r'"viewerMembershipState"\s*:\s*"(CAN_REQUEST|CAN_JOIN|NON_MEMBER)"',
            r'action="(/a/group/join[^"]*)"',
            r'name="join_group"|groups_join',
        )
        if any(re.search(pattern, html, re.I) for pattern in non_member_patterns):
            return False
        if re.search(r'action="(/groups/[^"]*join[^"]*)"', html, re.I):
            return False
        if re.search(r'Tham gia nhóm|Tham Gia Nhóm', html, re.I):
            if not re.search(r'leave_group|rời nhóm|Đã tham gia', html, re.I):
                return False
        return None

    def _fetch_membership_via_cookie(self, group_id: str) -> Optional[bool]:
        import re
        cookie = load_cookie(self.cookie)
        if not cookie:
            return None
        headers = {
            'User-Agent': (
                'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 '
                '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
            ),
            'Accept': 'text/html,application/xhtml+xml',
            'Accept-Language': 'vi-VN,vi;q=0.9,en-US;q=0.8',
            'Cookie': cookie,
        }
        urls = [
            f'https://www.facebook.com/groups/{group_id}',
            f'https://m.facebook.com/groups/{group_id}',
            f'https://mbasic.facebook.com/groups/{group_id}',
        ]
        saw_login = False
        for url in urls:
            try:
                resp = requests.get(url, headers=headers, timeout=15, allow_redirects=True)
                status = self._parse_membership_html(resp.text, resp.url)
                if status is True:
                    return True
                if status is False:
                    return False
                if '/login' in resp.url:
                    saw_login = True
            except Exception:
                continue
        return None if saw_login else None

    def _can_read_group_feed(self, group_id: str) -> bool:
        feed = self._call('get', f'{GRAPH_URL}/{group_id}/feed', params={'fields': 'id', 'limit': 1})
        if feed is None or feed.get('error'):
            return False
        return bool((feed.get('data') or []))

    def check_membership(self, group_id: str) -> bool:
        """Check if current user is a member of the group."""
        cookie_status = self._fetch_membership_via_cookie(group_id)
        if cookie_status is True:
            return True
        if self._can_read_group_feed(group_id):
            return True
        if cookie_status is False:
            return False
        return False

    def _try_submit_join(self, sess, cookie: str, html: str, page_url: str, referer: str) -> Optional[dict]:
        import re
        from urllib.parse import urljoin

        if self._parse_membership_html(html, page_url) is True:
            return {'ok': True, 'already_member': True, 'msg': 'Đã là thành viên'}

        headers = {
            'User-Agent': (
                'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 '
                '(KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1'
            ),
            'Cookie': cookie,
            'Referer': referer,
            'Accept': 'text/html',
            'Accept-Language': 'vi-VN,vi;q=0.9,en-US;q=0.8',
        }

        form_actions = re.findall(r'action="([^"]*join[^"]*)"', html, re.I)
        for action in form_actions:
            form_url = urljoin(page_url, action.replace('&amp;', '&'))
            inputs = {k: v for k, v in re.findall(r'<input[^>]+name="([^"]+)"[^>]+value="([^"]*)"', html)}
            try:
                resp = sess.post(
                    form_url,
                    data=inputs,
                    headers={**headers, 'Content-Type': 'application/x-www-form-urlencoded'},
                    timeout=15,
                    allow_redirects=True,
                )
                if resp.status_code < 400:
                    if self._parse_membership_html(resp.text, resp.url) is True:
                        return {'ok': True, 'already_member': True, 'msg': 'Đã là thành viên'}
                    return {'ok': True, 'msg': 'Đã gửi yêu cầu tham gia nhóm'}
            except Exception:
                continue

        join_links = re.findall(r'href="([^"]*join[^"]*)"', html, re.I)
        join_links += re.findall(r'"(https://[^"]*facebook\.com[^"]*join[^"]*)"', html, re.I)
        for href in join_links:
            if re.search(r'leave|cancel|unfollow', href, re.I):
                continue
            join_url = urljoin(page_url, href.replace('&amp;', '&'))
            try:
                resp = sess.get(join_url, headers=headers, timeout=15, allow_redirects=True)
                if resp.status_code < 400:
                    if self._parse_membership_html(resp.text, resp.url) is True:
                        return {'ok': True, 'already_member': True, 'msg': 'Đã là thành viên'}
                    return {'ok': True, 'msg': 'Đã gửi yêu cầu tham gia nhóm'}
            except Exception:
                continue
        return None

    def join_group(self, group_id: str) -> dict:
        import re
        cookie = load_cookie(self.cookie)
        if not cookie:
            return {'ok': False, 'error': 'Chưa có cookie Facebook. Vào mục Cookie → Lấy từ Chrome.'}

        cookie_status = self._fetch_membership_via_cookie(group_id)
        if cookie_status is True:
            return {'ok': True, 'already_member': True, 'msg': 'Đã là thành viên'}

        sess = requests.Session()
        desktop_ua = (
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 '
            '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
        )
        mobile_ua = (
            'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 '
            '(KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1'
        )
        pages = [
            (f'https://www.facebook.com/groups/{group_id}', desktop_ua),
            (f'https://m.facebook.com/groups/{group_id}', mobile_ua),
            (f'https://mbasic.facebook.com/groups/{group_id}', mobile_ua),
        ]
        saw_login = False
        for page_url, user_agent in pages:
            try:
                resp = sess.get(
                    page_url,
                    headers={
                        'User-Agent': user_agent,
                        'Cookie': cookie,
                        'Accept': 'text/html',
                        'Accept-Language': 'vi-VN,vi;q=0.9,en-US;q=0.8',
                    },
                    timeout=15,
                    allow_redirects=True,
                )
                html = resp.text
                if '/login' in resp.url or re.search(r'login_form|Đăng nhập|Log in', html[:1500], re.I):
                    saw_login = True
                    continue
                result = self._try_submit_join(sess, cookie, html, resp.url, page_url)
                if result:
                    return result
            except Exception:
                continue

        if saw_login:
            return {
                'ok': False,
                'error': 'Cookie Facebook hết hạn. Vào mục Cookie, lấy cookie mới từ Chrome rồi thử lại.',
            }
        return {
            'ok': False,
            'error': (
                'Facebook không cho tự tham gia nhóm này qua hệ thống. '
                'Bấm Mở FB → Tham gia/ Gửi yêu cầu thủ công. Nhóm kín cần admin duyệt.'
            ),
            'manual_required': True,
            'group_url': f'https://www.facebook.com/groups/{group_id}',
        }


def _scrape_group_id(slug: str, cookie: str = None) -> Optional[dict]:
    cookie = load_cookie(cookie)
    if not cookie:
        return None
    import re as _re
    from collections import Counter
    try:
        resp = requests.get(
            f'https://mbasic.facebook.com/groups/{slug}?v=info',
            headers={
                'user-agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15',
                'accept': 'text/html',
                'accept-language': 'vi-VN,vi;q=0.9,en;q=0.5',
                'Cookie': cookie,
            },
            timeout=15,
            allow_redirects=True,
        )
        html = resp.text
        # Detect login redirect
        if '/login' in resp.url or 'Đăng nhập' in html[:500] or '<title>Log in' in html[:500]:
            return None
        # Detect error pages
        title_m = _re.search(r'<title>([^<]+)</title>', html)
        if title_m:
            title = title_m.group(1).strip()
            # Skip if title is a login/error page
            if any(k in title.lower() for k in ['đăng nhập', 'log in', 'login', 'error', 'not found']):
                return None
        # Lấy số xuất hiện nhiều nhất trong khoảng 10-16 chữ số (độ dài ID group FB)
        candidates = _re.findall(r'\b(\d{10,16})\b', html)
        if not candidates:
            return None
        freq = Counter(candidates)
        gid = freq.most_common(1)[0][0]
        # Lấy tên group từ title
        name = title_m.group(1).replace('| Facebook', '').strip() if title_m else slug
        return {'id': gid, 'name': name}
    except Exception:
        pass
    return None
