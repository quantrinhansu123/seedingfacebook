import json
import re
import requests
from typing import Optional, Dict, List

DEFAULT_MODEL = 'gemini-3.1-pro-preview'
DEFAULT_API_KEY = ''

PROVIDERS = {
    'gemini': { 'name': 'Google Gemini', 'default_model': DEFAULT_MODEL },
    'openai': { 'name': 'OpenAI',        'default_model': 'gpt-4o-mini' },
    'groq':   { 'name': 'Groq',          'default_model': 'llama-3.3-70b-versatile' },
    'claude': { 'name': 'Claude',        'default_model': 'claude-3-haiku-20240307' },
}

DEFAULT_CATEGORIES = [
    'Mua bán', 'Hỏi đáp', 'Thông báo', 'Tán gẫu',
    'Spam/Quảng cáo', 'Tuyển dụng', 'Chia sẻ kiến thức',
]

PHONE_RE = re.compile(r'(?<!\d)(?:\+?84|0)(?:[\s.\-()]?\d){8,10}(?!\d)')

LEAD_EXTRACTION_PROMPT = """Bạn là AI trích xuất lead/nhu cầu từ bài viết Facebook tiếng Việt.

Quy tắc:
- Trích từng người có nhu cầu thật sự từ bài viết hoặc bình luận.
- Comment không có số điện thoại vẫn được trích nếu có nhu cầu như hỏi giá, cần mua, cần thuê, xin tư vấn, còn hàng, muốn inbox, hỏi địa điểm, hỏi ngân sách.
- Dùng ngữ cảnh bài gốc để hiểu comment ngắn như "xin giá", "ib mình", "còn không", "mình lấy 2".
- Không trích các comment chỉ tag bạn bè, chấm, hóng, emoji, spam không liên quan.
- Không tự bịa tên, số điện thoại, địa điểm, ngân sách. Chỉ dùng dữ liệu có trong nguồn.
- source_id phải giữ nguyên đúng SOURCE_ID được cung cấp.
- confidence là số từ 0 đến 1.

Dữ liệu:
{posts}

Trả về JSON array. Mỗi phần tử có đúng các trường:
[
  {{
    "post_id": "id bài viết",
    "source": "post hoặc comment",
    "source_id": "SOURCE_ID",
    "name": "tên tác giả nguồn",
    "phone": "số đầu tiên nếu có, không có thì chuỗi rỗng",
    "phones": ["các số nếu có"],
    "need": "mô tả ngắn nhu cầu",
    "intent": "buyer|seller|renter|service_request|job|question|other",
    "product_or_service": "sản phẩm/dịch vụ nếu xác định được",
    "location": "địa điểm nếu có",
    "budget": "ngân sách/giá nếu có",
    "urgency": "low|medium|high",
    "contact_status": "has_phone|no_phone",
    "confidence": 0.0,
    "evidence": "câu ngắn chứng minh"
  }}
]

CHỈ trả về JSON, không giải thích."""

CLASSIFY_PROMPT = """Bạn là AI phân loại bài viết Facebook. Phân loại các bài viết sau vào MỘT trong các danh mục: {categories}.

{posts}

Trả về kết quả dưới dạng JSON array, mỗi phần tử là object có "id" và "category".
Ví dụ: [{{"id":"123","category":"Mua bán"}}]
CHỈ trả về JSON, không giải thích."""

REPLY_SUGGESTION_PROMPT = """Bạn là trợ lý sale đọc bài viết và bình luận Facebook tiếng Việt để gợi ý câu trả lời.

Mục tiêu:
- Xác định khách hàng/comment nào đang có nhu cầu rõ nhất.
- Hiểu ý của khách hàng trong ngữ cảnh bài viết.
- Viết câu trả lời ngắn, lịch sự, tự nhiên để sale copy paste.
- Dùng thông tin bên bán nếu có để câu trả lời cụ thể hơn: tên, SĐT, địa chỉ, điểm mạnh/lý do nên chọn.
- Nếu SELLER_PROFILE có PHONE (khác rỗng), bắt buộc ghi số đó vào ít nhất 1 câu trả lời (ưu tiên mẫu "Chốt lịch/inbox" hoặc "Tư vấn"); không đổi số, không bịa số khác.
- Nếu thiếu thông tin quan trọng khác, hỏi thêm đúng 1-2 ý cần thiết.
- Không bịa giá, tồn kho, cam kết, địa chỉ, chính sách nếu dữ liệu không có.
- Không nhồi SĐT vào mọi mẫu nếu không cần; ít nhất một mẫu phải có SĐT khi PHONE đã được cung cấp.
- Không dùng markdown. Không giải thích ngoài JSON.

Dữ liệu:
{context}

Trả về JSON object có đúng các trường:
{{
  "post_id": "id bài viết",
  "target_source": "post|comment|manual_comment",
  "target_source_id": "id nguồn cần trả lời",
  "customer_name": "tên khách nếu có",
  "intent_label": "hỏi giá|cần tư vấn|muốn mua|hỏi còn hàng|hỏi địa điểm|khiếu nại|khác",
  "customer_need": "ý khách hàng, viết 1 câu ngắn",
  "buying_stage": "new_interest|considering|ready_to_buy|support_needed|unknown",
  "urgency": "low|medium|high",
  "confidence": 0.0,
  "recommended_approach": "hướng xử lý cho sale, 1 câu ngắn",
  "business_phone": "số SĐT bên bán từ SELLER_PROFILE PHONE, hoặc rỗng",
  "suggested_replies": [
    {{ "label": "Ngắn gọn", "text": "câu trả lời để copy paste" }},
    {{ "label": "Tư vấn", "text": "câu trả lời để copy paste" }},
    {{ "label": "Chốt lịch/inbox", "text": "câu trả lời để copy paste" }}
  ]
}}

CHỈ trả về JSON object."""

BUSINESS_TEXT_PROMPT = """Bạn là copywriter bán hàng tiếng Việt. Nhiệm vụ của bạn là viết lại thông tin bên bán thành văn bản rõ ràng để AI sale dùng khi trả lời khách.

Ngữ cảnh:
- Người dùng có thể chỉ nhập thông tin thô, rời rạc.
- Viết tự nhiên, đáng tin, không phóng đại.
- Không bịa số điện thoại, địa chỉ, giá, bảo hành, cam kết, chứng nhận nếu đầu vào không có.
- Nếu tên/thương hiệu, SĐT, địa chỉ đã có thì giữ nguyên.
- "why_choose_us" nên là đoạn văn hoặc các ý ngắn nêu lý do nên chọn bên mình, dùng được trực tiếp trong trả lời khách.
- "extra_notes" là ghi chú nội bộ cho sale/AI: cách xưng hô, điểm cần nhấn, điều không được nói, cách chốt inbox/cuộc gọi.
- Không dùng markdown. Không giải thích ngoài JSON.

Thông tin đầu vào:
BUSINESS_NAME: {business_name}
PHONE: {phone}
ADDRESS: {address}
RAW_WHY_CHOOSE_US: {why_choose_us}
RAW_EXTRA_NOTES: {extra_notes}

Trả về JSON object có đúng các trường:
{{
  "business_name": "giữ hoặc chỉnh rất nhẹ tên/thương hiệu",
  "phone": "giữ số điện thoại nếu có",
  "address": "giữ địa chỉ nếu có",
  "why_choose_us": "văn bản bán hàng đã viết lại",
  "extra_notes": "ghi chú nội bộ cho sale/AI"
}}

CHỈ trả về JSON object."""

COMMENT_SUMMARY_PROMPT = """Bạn là AI phân tích một bài viết Facebook và toàn bộ bình luận đã tải được.

Mục tiêu:
- Đọc nội dung bài viết và các bình luận.
- Tóm tắt khách đang quan tâm gì, hỏi gì, phản ứng thế nào.
- Thống kê dựa trên dữ liệu được cung cấp, không bịa số lượng.
- Tách các ý có ích cho sale: nhu cầu, câu hỏi lặp lại, lead tiềm năng, việc nên làm tiếp theo.
- Không dùng markdown. Không giải thích ngoài JSON.

Dữ liệu:
{context}

Trả về JSON object có đúng các trường:
{{
  "summary": "tóm tắt ngắn 2-4 câu",
  "sentiment": "positive|neutral|negative|mixed|unknown",
  "urgency": "low|medium|high",
  "main_topics": ["chủ đề chính"],
  "customer_intents": [
    {{ "intent": "hỏi giá|cần tư vấn|muốn mua|hỏi địa điểm|hỏi cách làm|khiếu nại|khác", "count": 0, "evidence": "bằng chứng ngắn" }}
  ],
  "top_questions": ["câu hỏi/vấn đề được hỏi nhiều"],
  "notable_comments": [
    {{ "author": "tên người bình luận", "text": "nội dung comment", "reason": "vì sao đáng chú ý" }}
  ],
  "lead_signals": [
    {{ "author": "tên nếu có", "need": "nhu cầu", "evidence": "comment liên quan" }}
  ],
  "recommended_action": "việc sale nên làm tiếp theo",
  "spam_or_noise_count": 0
}}

CHỈ trả về JSON object."""


def normalize_phone(raw: str) -> str:
    digits = re.sub(r'\D', '', raw or '')
    if digits.startswith('0084'):
        digits = '0' + digits[4:]
    elif digits.startswith('84') and len(digits) in (11, 12):
        digits = '0' + digits[2:]
    if len(digits) in (10, 11) and digits.startswith('0'):
        return digits
    return ''


def _reply_contains_phone(text: str, phone: str) -> bool:
    if not phone:
        return True
    digits = re.sub(r'\D', '', phone)
    if digits and digits in re.sub(r'\D', '', text or ''):
        return True
    return phone in (text or '')


def _ensure_phone_in_replies(
    replies: List[Dict],
    phone: str,
    business_name: str = '',
) -> List[Dict]:
    """Đảm bảo ít nhất một mẫu trả lời có SĐT khi profile đã cấu hình."""
    phone = normalize_phone(phone)
    if not phone or not replies:
        return replies

    if any(_reply_contains_phone(r.get('text', ''), phone) for r in replies):
        return replies

    name = (business_name or 'bên em').strip()
    phone_snippet = f'liên hệ {name} qua SĐT {phone}' if name else f'liên hệ SĐT {phone}'
    preferred_labels = ('chốt', 'inbox', 'tư vấn', 'liên hệ')
    target_idx = len(replies) - 1
    for idx, item in enumerate(replies):
        label = (item.get('label') or '').lower()
        if any(k in label for k in preferred_labels):
            target_idx = idx
            break

    updated = list(replies)
    item = dict(updated[target_idx])
    text = (item.get('text') or '').strip()
    if text and not text.endswith(('.', '!', '?')):
        text += '.'
    item['text'] = f'{text} {name} có thể {phone_snippet} hoặc inbox để được hỗ trợ nhanh hơn.'.strip()
    updated[target_idx] = item
    return updated


def extract_phones(text: str) -> List[str]:
    seen = set()
    phones = []
    for match in PHONE_RE.finditer(text or ''):
        phone = normalize_phone(match.group())
        if phone and phone not in seen:
            seen.add(phone)
            phones.append(phone)
    return phones


def _compact_text(text: str, limit: int = 900) -> str:
    text = re.sub(r'\s+', ' ', text or '').strip()
    if len(text) > limit:
        return text[:limit].rstrip() + '...'
    return text


def _strip_json_fence(text: str) -> str:
    text = (text or '').strip()
    if text.startswith('```'):
        lines = text.split('\n')
        end = len(lines) - 1 if lines and lines[-1].strip().startswith('```') else len(lines)
        text = '\n'.join(lines[1:end]).strip()
    return text


def _load_json_payload(text: str):
    text = _strip_json_fence(text)
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        pass
    match = re.search(r'(\[.*\]|\{.*\})', text, re.DOTALL)
    if match:
        try:
            return json.loads(match.group())
        except json.JSONDecodeError:
            pass
    return None


def _as_float(value, default: float = 0.0) -> float:
    try:
        parsed = float(value)
    except (TypeError, ValueError):
        return default
    return max(0.0, min(1.0, parsed))


def _friendly_ai_error(message: str) -> str:
    msg = str(message or '').strip()
    lower = msg.lower()
    if 'quota' in lower or 'rate-limit' in lower or 'rate limit' in lower or '429' in lower:
        return 'Gemini đã vượt quota/gói miễn phí. Vui lòng chờ reset quota, đổi API key khác, hoặc nâng gói/bật billing rồi thử lại.'
    if 'api key' in lower and ('invalid' in lower or 'leaked' in lower):
        return 'API key không hợp lệ hoặc đã bị báo lộ. Vui lòng đổi API key mới.'
    return msg or 'AI API error'


def _friendly_openai_error(message: str) -> str:
    msg = str(message or '').strip()
    lower = msg.lower()
    if 'incorrect api key' in lower or 'invalid api key' in lower or '401' in lower:
        return 'OpenAI API key không hợp lệ. Lưu ý: key phải lấy ở platform.openai.com, không phải tài khoản/mật khẩu ChatGPT.'
    if 'quota' in lower or 'billing' in lower or 'insufficient_quota' in lower or '429' in lower:
        return 'OpenAI API key đã hết quota/chưa bật billing hoặc project không còn credit. Kiểm tra Billing trên platform.openai.com rồi thử lại.'
    if 'model' in lower and ('does not exist' in lower or 'not found' in lower or 'access' in lower):
        return f'Model OpenAI đang chọn không dùng được với key này. Đổi về gpt-4o-mini để test. Chi tiết: {msg}'
    return msg or 'OpenAI API error'


class AIClassifier:
    def __init__(self, provider: str, model: str, api_key: str, categories: List[str] = None):
        self.provider = provider
        self.model = model
        self.api_key = api_key
        self.categories = categories or DEFAULT_CATEGORIES
        self.last_error = ''

    def classify_posts(self, posts: List[Dict]) -> Dict[str, str]:
        """Classify multiple posts. Returns {post_id: category}."""
        if not posts or not self.api_key:
            return {}
        posts_text = ""
        for i, post in enumerate(posts, 1):
            text = post.get('message', '') or '[Không có nội dung]'
            pid = post.get('id', f'post_{i}')
            author = (post.get('from') or {}).get('name', 'Ẩn danh')
            posts_text += f'Bài {i} (ID: {pid}):\nTác giả: {author}\nNội dung: {text[:500]}\n\n'

        prompt = CLASSIFY_PROMPT.format(
            categories=', '.join(self.categories),
            posts=posts_text
        )
        try:
            resp = self._call_api(prompt)
            self.last_error = ''
            return self._parse_response(resp)
        except Exception as e:
            self.last_error = str(e)
            print(f'AI classify error: {e}')
            return {}

    def extract_leads(self, posts: List[Dict], batch_size: int = 4) -> Dict[str, List[Dict]]:
        """Extract lead/need records from posts and loaded comments."""
        if not posts or not self.api_key:
            return {}
        results: Dict[str, List[Dict]] = {}
        errors = []
        for start in range(0, len(posts), batch_size):
            batch = posts[start:start + batch_size]
            posts_text, source_meta = self._format_lead_posts(batch)
            if not posts_text.strip():
                continue
            prompt = LEAD_EXTRACTION_PROMPT.format(posts=posts_text)
            try:
                resp = self._call_api(prompt)
                for lead in self._parse_leads_response(resp, source_meta):
                    results.setdefault(lead['post_id'], []).append(lead)
            except Exception as e:
                msg = str(e)
                errors.append(msg)
                print(f'AI lead extract error: {e}')
        self.last_error = '; '.join(dict.fromkeys(errors))[:500] if errors else ''
        return {pid: self._dedupe_leads(items) for pid, items in results.items()}

    def suggest_reply(self, post: Dict, manual_comment: str = '', business_profile: Dict = None) -> Dict:
        """Suggest copy-paste sales replies for a post/comment context."""
        if not post or not self.api_key:
            return {}
        context, source_meta = self._format_reply_context(post, manual_comment, business_profile or {})
        prompt = REPLY_SUGGESTION_PROMPT.format(context=context)
        try:
            resp = self._call_api(prompt)
            self.last_error = ''
            result = self._parse_reply_response(resp, post, source_meta, business_profile or {})
            return result
        except Exception as e:
            self.last_error = str(e)
            print(f'AI reply suggestion error: {e}')
            return {}

    def generate_business_text(self, profile: Dict) -> Dict:
        """Rewrite rough business profile fields into sales-ready text."""
        if not self.api_key:
            return {}
        prompt = BUSINESS_TEXT_PROMPT.format(
            business_name=_compact_text(str(profile.get('business_name') or ''), 160),
            phone=_compact_text(str(profile.get('phone') or ''), 80),
            address=_compact_text(str(profile.get('address') or ''), 240),
            why_choose_us=_compact_text(str(profile.get('why_choose_us') or ''), 1000),
            extra_notes=_compact_text(str(profile.get('extra_notes') or ''), 800),
        )
        try:
            resp = self._call_api(prompt)
            self.last_error = ''
            return self._parse_business_text_response(resp, profile)
        except Exception as e:
            self.last_error = str(e)
            print(f'AI business text error: {e}')
            return {}

    def summarize_post_comments(self, post: Dict, comments: List[Dict], total_count: int = 0) -> Dict:
        """Summarize a post and the comments fetched from Facebook."""
        if not post or not self.api_key:
            return {}
        total_count = int(total_count or len(comments or []))
        context = self._format_comment_summary_context(post, comments or [], total_count)
        prompt = COMMENT_SUMMARY_PROMPT.format(context=context)
        try:
            resp = self._call_api(prompt)
            self.last_error = ''
            return self._parse_comment_summary_response(resp, post, comments or [], total_count)
        except Exception as e:
            self.last_error = str(e)
            print(f'AI comment summary error: {e}')
            return {}

    def _format_lead_posts(self, posts: List[Dict]) -> tuple[str, Dict[str, Dict]]:
        blocks = []
        source_meta: Dict[str, Dict] = {}
        for post_index, post in enumerate(posts, 1):
            pid = str(post.get('id') or f'post_{post_index}')
            author = (post.get('from') or {}).get('name', 'Ẩn danh')
            text = post.get('message', '') or ''
            post_phones = extract_phones(text)
            source_meta[pid] = {
                'post_id': pid,
                'source': 'post',
                'name': author,
                'phones': post_phones,
            }
            lines = [
                f'POST {post_index}',
                f'POST_ID: {pid}',
                f'SOURCE_ID: {pid}',
                f'AUTHOR: {author}',
                f'PHONES_IN_TEXT: {", ".join(post_phones) if post_phones else ""}',
                f'TEXT: {_compact_text(text, 1200) or "[Không có nội dung]"}',
                'COMMENTS:',
            ]

            comments = ((post.get('comments') or {}).get('data') or [])[:50]
            if not comments:
                lines.append('- [Không có bình luận được tải]')
            for idx, comment in enumerate(comments, 1):
                cid = str(comment.get('id') or f'{pid}:comment:{idx}')
                cname = (comment.get('from') or {}).get('name', 'Ẩn danh')
                ctext = comment.get('message', '') or ''
                cphones = extract_phones(ctext)
                source_meta[cid] = {
                    'post_id': pid,
                    'source': 'comment',
                    'name': cname,
                    'comment_author': cname,
                    'comment_text': ctext,
                    'phones': cphones,
                }
                lines.extend([
                    f'- COMMENT {idx}',
                    f'  SOURCE_ID: {cid}',
                    f'  AUTHOR: {cname}',
                    f'  PHONES_IN_TEXT: {", ".join(cphones) if cphones else ""}',
                    f'  TEXT: {_compact_text(ctext, 500) or "[Không có nội dung]"}',
                ])
            blocks.append('\n'.join(lines))
        return '\n\n---\n\n'.join(blocks), source_meta

    def _format_reply_context(self, post: Dict, manual_comment: str = '', business_profile: Dict = None) -> tuple[str, Dict[str, Dict]]:
        pid = str(post.get('id') or '')
        gid = str(post.get('_group_id') or '')
        author = (post.get('from') or {}).get('name', 'Ẩn danh')
        text = post.get('message', '') or ''
        business_profile = business_profile or {}
        source_meta: Dict[str, Dict] = {
            pid: {
                'post_id': pid,
                'source': 'post',
                'name': author,
            }
        }
        lines = [
            f'POST_ID: {pid}',
            f'GROUP_ID: {gid}',
            f'POST_AUTHOR: {author}',
            f'POST_TEXT: {_compact_text(text, 1500) or "[Không có nội dung]"}',
            'SELLER_PROFILE:',
            f'BUSINESS_NAME: {_compact_text(str(business_profile.get("business_name") or ""), 120)}',
            f'PHONE: {_compact_text(str(business_profile.get("phone") or ""), 80)}',
            f'ADDRESS: {_compact_text(str(business_profile.get("address") or ""), 180)}',
            f'WHY_CHOOSE_US: {_compact_text(str(business_profile.get("why_choose_us") or ""), 600)}',
            f'EXTRA_NOTES: {_compact_text(str(business_profile.get("extra_notes") or ""), 400)}',
        ]

        if manual_comment:
            source_id = f'{pid}:manual_comment'
            source_meta[source_id] = {
                'post_id': pid,
                'source': 'manual_comment',
                'name': 'Khách hàng',
            }
            lines.extend([
                'PRIMARY_COMMENT_TO_REPLY:',
                f'SOURCE_ID: {source_id}',
                'AUTHOR: Khách hàng',
                f'TEXT: {_compact_text(manual_comment, 700)}',
            ])

        comments = ((post.get('comments') or {}).get('data') or [])[:60]
        lines.append('COMMENTS:')
        if not comments:
            lines.append('- [Không có bình luận được tải]')
        for idx, comment in enumerate(comments, 1):
            cid = str(comment.get('id') or f'{pid}:comment:{idx}')
            cname = (comment.get('from') or {}).get('name', 'Ẩn danh')
            ctext = comment.get('message', '') or ''
            source_meta[cid] = {
                'post_id': pid,
                'source': 'comment',
                'name': cname,
            }
            lines.extend([
                f'- COMMENT {idx}',
                f'  SOURCE_ID: {cid}',
                f'  AUTHOR: {cname}',
                f'  TEXT: {_compact_text(ctext, 650) or "[Không có nội dung]"}',
            ])
        return '\n'.join(lines), source_meta

    def _format_comment_summary_context(self, post: Dict, comments: List[Dict], total_count: int) -> str:
        pid = str(post.get('id') or '')
        gid = str(post.get('_group_id') or '')
        author = (post.get('from') or {}).get('name', 'Ẩn danh')
        text = post.get('message', '') or ''
        lines = [
            f'POST_ID: {pid}',
            f'GROUP_ID: {gid}',
            f'POST_AUTHOR: {author}',
            f'POST_TEXT: {_compact_text(text, 1800) or "[Không có nội dung]"}',
            f'FACEBOOK_COMMENT_COUNT: {total_count}',
            f'FETCHED_COMMENT_COUNT: {len(comments)}',
            'COMMENTS:',
        ]
        if not comments:
            lines.append('- [Không có bình luận được tải]')
        for idx, comment in enumerate(comments, 1):
            cname = (comment.get('from') or {}).get('name', 'Ẩn danh')
            ctext = comment.get('message', '') or ''
            created = comment.get('created_time') or ''
            cid = comment.get('id') or f'{pid}:comment:{idx}'
            attachment = (comment.get('attachment') or {}).get('type') or ''
            lines.extend([
                f'- COMMENT {idx}',
                f'  COMMENT_ID: {cid}',
                f'  AUTHOR: {cname}',
                f'  CREATED_TIME: {created}',
                f'  ATTACHMENT: {attachment}',
                f'  TEXT: {_compact_text(ctext, 450) or "[Không có nội dung]"}',
            ])
            replies = ((comment.get('comments') or {}).get('data') or [])[:30]
            for ridx, reply in enumerate(replies, 1):
                rname = (reply.get('from') or {}).get('name', 'Ẩn danh')
                rtext = reply.get('message', '') or ''
                lines.extend([
                    f'  - REPLY {ridx}',
                    f'    AUTHOR: {rname}',
                    f'    TEXT: {_compact_text(rtext, 300) or "[Không có nội dung]"}',
                ])
        return '\n'.join(lines)

    def _parse_comment_summary_response(self, text: str, post: Dict, comments: List[Dict], total_count: int) -> Dict:
        payload = _load_json_payload(text)
        if not isinstance(payload, dict):
            return {}

        def list_of_text(name: str, limit: int) -> List[str]:
            value = payload.get(name) or []
            if not isinstance(value, list):
                return []
            return [_compact_text(str(item), limit) for item in value[:12] if str(item or '').strip()]

        def list_of_dict(name: str, allowed: List[str], limit: int = 10) -> List[Dict]:
            value = payload.get(name) or []
            if not isinstance(value, list):
                return []
            rows = []
            for item in value[:limit]:
                if not isinstance(item, dict):
                    continue
                row = {}
                for key in allowed:
                    if key == 'count':
                        row[key] = max(0, int(_as_float(item.get(key), 0)))
                    else:
                        row[key] = _compact_text(str(item.get(key) or ''), 320)
                if any(str(v or '').strip() for k, v in row.items() if k != 'count'):
                    rows.append(row)
            return rows

        authors = {
            ((comment.get('from') or {}).get('name') or '').strip()
            for comment in comments
            if ((comment.get('from') or {}).get('name') or '').strip()
        }
        return {
            'post_id': str(post.get('id') or ''),
            'group_id': str(post.get('_group_id') or ''),
            'post_url': str(post.get('permalink_url') or ''),
            'post_author': _compact_text(str((post.get('from') or {}).get('name') or 'Ẩn danh'), 120),
            'post_text': _compact_text(str(post.get('message') or ''), 2000),
            'comment_count': int(total_count or len(comments)),
            'fetched_comment_count': len(comments),
            'comment_authors_count': len(authors),
            'summary': _compact_text(str(payload.get('summary') or ''), 1200),
            'sentiment': str(payload.get('sentiment') or 'unknown')[:30],
            'urgency': str(payload.get('urgency') or 'low')[:20],
            'main_topics': list_of_text('main_topics', 120),
            'customer_intents': list_of_dict('customer_intents', ['intent', 'count', 'evidence'], 8),
            'top_questions': list_of_text('top_questions', 220),
            'notable_comments': list_of_dict('notable_comments', ['author', 'text', 'reason'], 8),
            'lead_signals': list_of_dict('lead_signals', ['author', 'need', 'evidence'], 10),
            'recommended_action': _compact_text(str(payload.get('recommended_action') or ''), 500),
            'spam_or_noise_count': max(0, int(_as_float(payload.get('spam_or_noise_count'), 0))),
        }

    def _parse_leads_response(self, text: str, source_meta: Dict[str, Dict]) -> List[Dict]:
        payload = _load_json_payload(text)
        if isinstance(payload, dict):
            payload = payload.get('leads') or payload.get('data') or []
        if not isinstance(payload, list):
            return []

        leads = []
        for item in payload:
            if not isinstance(item, dict):
                continue
            source_id = str(item.get('source_id') or '').strip()
            meta = source_meta.get(source_id)
            if not meta:
                continue

            need = _compact_text(str(item.get('need') or item.get('need_summary') or ''), 220)
            if not need:
                continue

            phones = meta.get('phones') or []
            from_comment = meta.get('source') == 'comment'
            lead = {
                'post_id': meta['post_id'],
                'source': meta['source'],
                'source_id': source_id,
                'comment_id': source_id if from_comment else '',
                'name': meta.get('name') or str(item.get('name') or 'Ẩn danh'),
                'comment_author': meta.get('comment_author') or (meta.get('name') if from_comment else ''),
                'comment_text': meta.get('comment_text') or (meta.get('message') if from_comment else ''),
                'phone': phones[0] if phones else '',
                'phones': phones,
                'need': need,
                'intent': str(item.get('intent') or 'other')[:40],
                'product_or_service': _compact_text(str(item.get('product_or_service') or ''), 120),
                'location': _compact_text(str(item.get('location') or ''), 80),
                'budget': _compact_text(str(item.get('budget') or ''), 80),
                'urgency': str(item.get('urgency') or 'low')[:20],
                'contact_status': 'has_phone' if phones else 'no_phone',
                'confidence': _as_float(item.get('confidence'), 0.5),
                'evidence': _compact_text(str(item.get('evidence') or ''), 180),
            }
            leads.append(lead)
        return leads

    def _dedupe_leads(self, leads: List[Dict]) -> List[Dict]:
        seen = set()
        unique = []
        for lead in sorted(leads, key=lambda item: item.get('confidence', 0), reverse=True):
            key = (lead.get('source_id'), lead.get('need', '').lower(), lead.get('phone', ''))
            if key in seen:
                continue
            seen.add(key)
            unique.append(lead)
        return unique

    def _parse_reply_response(
        self,
        text: str,
        post: Dict,
        source_meta: Dict[str, Dict],
        business_profile: Dict = None,
    ) -> Dict:
        payload = _load_json_payload(text)
        if not isinstance(payload, dict):
            return {}

        pid = str(post.get('id') or payload.get('post_id') or '')
        source_id = str(payload.get('target_source_id') or pid).strip()
        meta = source_meta.get(source_id) or source_meta.get(pid) or {}
        replies = payload.get('suggested_replies') or []
        clean_replies = []
        if isinstance(replies, list):
            for idx, item in enumerate(replies[:4], 1):
                if isinstance(item, dict):
                    label = _compact_text(str(item.get('label') or f'Mẫu {idx}'), 40)
                    reply_text = _compact_text(str(item.get('text') or ''), 700)
                else:
                    label = f'Mẫu {idx}'
                    reply_text = _compact_text(str(item), 700)
                if reply_text:
                    clean_replies.append({'label': label, 'text': reply_text})

        if not clean_replies:
            return {}

        business_profile = business_profile or {}
        business_phone = normalize_phone(
            str(payload.get('business_phone') or business_profile.get('phone') or '')
        )
        biz_name = _compact_text(str(business_profile.get('business_name') or ''), 120)
        clean_replies = _ensure_phone_in_replies(clean_replies, business_phone, biz_name)

        return {
            'post_id': pid,
            'target_source': str(payload.get('target_source') or meta.get('source') or 'post')[:30],
            'target_source_id': source_id or pid,
            'customer_name': _compact_text(str(payload.get('customer_name') or meta.get('name') or 'Khách hàng'), 80),
            'intent_label': _compact_text(str(payload.get('intent_label') or 'khác'), 80),
            'customer_need': _compact_text(str(payload.get('customer_need') or ''), 220),
            'buying_stage': str(payload.get('buying_stage') or 'unknown')[:40],
            'urgency': str(payload.get('urgency') or 'low')[:20],
            'confidence': _as_float(payload.get('confidence'), 0.5),
            'recommended_approach': _compact_text(str(payload.get('recommended_approach') or ''), 260),
            'business_phone': business_phone,
            'suggested_replies': clean_replies,
        }

    def _parse_business_text_response(self, text: str, original: Dict) -> Dict:
        payload = _load_json_payload(text)
        if not isinstance(payload, dict):
            return {}

        profile = {
            'business_name': _compact_text(str(payload.get('business_name') or original.get('business_name') or ''), 120),
            'phone': _compact_text(str(payload.get('phone') or original.get('phone') or ''), 60),
            'address': _compact_text(str(payload.get('address') or original.get('address') or ''), 240),
            'why_choose_us': _compact_text(str(payload.get('why_choose_us') or original.get('why_choose_us') or ''), 1000),
            'extra_notes': _compact_text(str(payload.get('extra_notes') or original.get('extra_notes') or ''), 800),
        }
        if not profile['why_choose_us'] and not profile['extra_notes']:
            return {}
        return profile

    def test_connection(self) -> Dict:
        try:
            resp = self._call_api('Trả lời "OK" nếu bạn nhận được tin nhắn này.')
            return {'ok': True, 'response': resp[:100]}
        except Exception as e:
            return {'ok': False, 'error': str(e)}

    def _call_api(self, prompt: str) -> str:
        if self.provider == 'gemini':
            return self._call_gemini(prompt)
        elif self.provider == 'openai':
            return self._call_openai(prompt)
        elif self.provider == 'groq':
            return self._call_groq(prompt)
        elif self.provider == 'claude':
            return self._call_claude(prompt)
        raise ValueError(f'Unknown provider: {self.provider}')

    def _call_gemini(self, prompt: str) -> str:
        model = (self.model or DEFAULT_MODEL).strip()
        model_name = model if model.startswith('models/') else f'models/{model}'
        url = f'https://generativelanguage.googleapis.com/v1beta/{model_name}:generateContent'
        resp = requests.post(url,
            headers={
                'Content-Type': 'application/json',
                'X-goog-api-key': self.api_key,
            },
            json={
                'contents': [{'parts': [{'text': prompt}]}],
            }, timeout=60)
        data = resp.json()
        if 'error' in data:
            raise Exception(_friendly_ai_error(data['error'].get('message', 'Gemini API error')))
        return data['candidates'][0]['content']['parts'][0]['text']

    def _call_openai(self, prompt: str) -> str:
        resp = requests.post('https://api.openai.com/v1/chat/completions',
            headers={
                'Authorization': f'Bearer {self.api_key}',
                'Content-Type': 'application/json',
            },
            json={
                'model': self.model,
                'messages': [{'role': 'user', 'content': prompt}],
                'temperature': 0.3,
            }, timeout=60)
        try:
            data = resp.json()
        except ValueError as e:
            raise Exception(f'OpenAI API trả phản hồi không hợp lệ HTTP {resp.status_code}: {resp.text[:200]}') from e
        if 'error' in data:
            err = data.get('error') or {}
            raise Exception(_friendly_openai_error(err.get('message', 'OpenAI API error')))
        return data['choices'][0]['message']['content']

    def _call_groq(self, prompt: str) -> str:
        resp = requests.post('https://api.groq.com/openai/v1/chat/completions',
            headers={
                'Authorization': f'Bearer {self.api_key}',
                'Content-Type': 'application/json',
            },
            json={
                'model': self.model,
                'messages': [{'role': 'user', 'content': prompt}],
                'temperature': 0.3,
            }, timeout=60)
        data = resp.json()
        if 'error' in data:
            err = data.get('error') or {}
            raise Exception(err.get('message', 'Groq API error'))
        return data['choices'][0]['message']['content']

    def _call_claude(self, prompt: str) -> str:
        resp = requests.post('https://api.anthropic.com/v1/messages',
            headers={
                'x-api-key': self.api_key,
                'anthropic-version': '2023-06-01',
                'content-type': 'application/json',
            },
            json={
                'model': self.model,
                'max_tokens': 4096,
                'messages': [{'role': 'user', 'content': prompt}],
            }, timeout=60)
        data = resp.json()
        if data.get('type') == 'error' or 'error' in data:
            err = data.get('error', {})
            raise Exception(err.get('message', 'Claude API error'))
        return data['content'][0]['text']

    def _parse_response(self, text: str) -> Dict[str, str]:
        results = _load_json_payload(text)
        if isinstance(results, dict):
            results = results.get('data') or results.get('classifications') or []
        if isinstance(results, list):
            return {str(item['id']): item['category'] for item in results
                    if isinstance(item, dict) and 'id' in item and 'category' in item}
        return {}
