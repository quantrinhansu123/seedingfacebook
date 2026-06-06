(() => {
  const FINAL = true;

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function isVisible(el) {
    if (!el) return false;
    const rect = el.getBoundingClientRect();
    const style = window.getComputedStyle(el);
    return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
  }

  function clickIfVisible(selector) {
    const nodes = Array.from(document.querySelectorAll(selector));
    const target = nodes.find(isVisible);
    if (target) {
      target.click();
      return true;
    }
    return false;
  }

  function maybeOpenCommentPanel() {
    const selectors = [
      '[data-e2e="comment-icon"]',
      'button[aria-label*="comment" i]',
      'button[aria-label*="bình luận" i]',
      'div[role="button"][aria-label*="comment" i]',
    ];
    selectors.some(clickIfVisible);
  }

  function tiktokPageError() {
    const body = (document.body?.innerText || '').toLowerCase();
    return (
      body.includes('đã xảy ra lỗi') ||
      body.includes('vui lòng thử lại sau') ||
      body.includes('something went wrong') ||
      body.includes('please try again later')
    );
  }

  function findCommentInput() {
    const selectors = [
      '[data-e2e="comment-input"] [contenteditable="true"]',
      '[data-e2e="comment-input"] textarea',
      'div.public-DraftEditor-content[contenteditable="true"]',
      'div[contenteditable="true"][role="textbox"]',
      'textarea[placeholder*="comment" i]',
      'textarea[placeholder*="bình luận" i]',
      'div[contenteditable="true"]',
      'textarea',
    ];
    for (const selector of selectors) {
      const found = Array.from(document.querySelectorAll(selector)).find((el) => {
        if (!isVisible(el)) return false;
        const label = `${el.getAttribute('aria-label') || ''} ${el.getAttribute('placeholder') || ''}`.toLowerCase();
        const text = `${el.textContent || ''}`.toLowerCase();
        return !label.includes('search') && !label.includes('tìm kiếm') && !text.includes('search');
      });
      if (found) return found;
    }
    return null;
  }

  function setTextValue(input, value) {
    input.focus();
    if (input.tagName === 'TEXTAREA' || input.tagName === 'INPUT') {
      const descriptor = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), 'value');
      if (descriptor?.set) descriptor.set.call(input, value);
      else input.value = value;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
      return;
    }

    document.execCommand('selectAll', false);
    document.execCommand('insertText', false, value);
    input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: value }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function buttonText(button) {
    return `${button.textContent || ''} ${button.getAttribute('aria-label') || ''} ${button.getAttribute('data-e2e') || ''}`.trim().toLowerCase();
  }

  function isDisabled(button) {
    return button.disabled || button.getAttribute('aria-disabled') === 'true' || button.className?.toString().toLowerCase().includes('disabled');
  }

  function findPostButton() {
    const selectors = [
      '[data-e2e="comment-post"]',
      'button[data-e2e*="comment-post"]',
      'button[aria-label*="post" i]',
      'button[aria-label*="đăng" i]',
      'button[aria-label*="gửi" i]',
    ];
    for (const selector of selectors) {
      const direct = Array.from(document.querySelectorAll(selector)).find((button) => isVisible(button) && !isDisabled(button));
      if (direct) return direct;
    }

    return Array.from(document.querySelectorAll('button, div[role="button"]')).find((button) => {
      if (!isVisible(button) || isDisabled(button)) return false;
      const text = buttonText(button);
      return text === 'post' || text === 'đăng' || text === 'gửi' || text.includes('comment-post');
    });
  }

  async function waitFor(getter, timeoutMs, onTick) {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      const value = getter();
      if (value) return value;
      if (onTick) onTick();
      await sleep(500);
    }
    return null;
  }

  function loginHint() {
    const body = (document.body?.innerText || '').toLowerCase();
    return body.includes('log in') || body.includes('login') || body.includes('đăng nhập');
  }

  function normalizeText(value) {
    return String(value || '')
      .toLowerCase()
      .replace(/\s+/g, ' ')
      .trim();
  }

  function stripTiktokPrefix(value) {
    return String(value || '').replace(/^tiktok_/, '').trim();
  }

  function highlightCommentElement(target, payload) {
    target.scrollIntoView({ behavior: 'smooth', block: 'center' });
    target.style.outline = '4px solid #2563eb';
    target.style.boxShadow = '0 0 0 8px rgba(37, 99, 235, 0.22)';
    target.style.borderRadius = '12px';
    target.style.background = 'rgba(37, 99, 235, 0.08)';
    target.setAttribute('data-streal-focused-comment', 'true');

    const oldBadge = document.querySelector('[data-streal-comment-badge="true"]');
    if (oldBadge) oldBadge.remove();
    const badge = document.createElement('div');
    badge.setAttribute('data-streal-comment-badge', 'true');
    badge.textContent = 'Lead Hunter: comment cần trả lời đang được tô xanh. Câu trả lời đã copy, dán Ctrl+V để gửi thủ công.';
    badge.style.position = 'fixed';
    badge.style.zIndex = '2147483647';
    badge.style.top = '16px';
    badge.style.left = '50%';
    badge.style.transform = 'translateX(-50%)';
    badge.style.maxWidth = '760px';
    badge.style.padding = '12px 16px';
    badge.style.borderRadius = '999px';
    badge.style.background = '#111827';
    badge.style.color = '#fff';
    badge.style.font = '600 14px/1.35 Arial, sans-serif';
    badge.style.boxShadow = '0 12px 30px rgba(0,0,0,.35)';
    document.body.appendChild(badge);
    setTimeout(() => badge.remove(), 12000);

    const commentText = String(payload.comment_text || '').trim();
    if (commentText) {
      try {
        window.sessionStorage.setItem('streal_last_comment_text', commentText);
      } catch (error) {
        // Best effort only.
      }
    }
  }

  function findCommentCandidate(payload) {
    const targetText = normalizeText(payload.comment_text).slice(0, 180);
    const author = normalizeText(payload.author_name).slice(0, 80);
    const rawCommentId = stripTiktokPrefix(payload.comment_id);
    const nodes = Array.from(document.querySelectorAll(
      '[data-e2e*="comment"], [class*="Comment"], [class*="comment"], div, p, span',
    ));
    const scored = [];
    for (const node of nodes) {
      if (!isVisible(node)) continue;
      const text = normalizeText(node.innerText || node.textContent || '');
      if (!text || text.length > 1600) continue;
      let score = 0;
      if (targetText && text.includes(targetText)) score += 1000 - Math.min(text.length, 900);
      if (author && text.includes(author)) score += 120;
      const html = `${node.id || ''} ${node.getAttribute('href') || ''} ${node.getAttribute('data-e2e') || ''}`;
      if (rawCommentId && html.includes(rawCommentId)) score += 300;
      if (score <= 0) continue;
      const container = node.closest('[data-e2e*="comment"], [class*="Comment"], [class*="comment"]') || node;
      scored.push({ node: container, score, length: text.length });
    }
    scored.sort((a, b) => b.score - a.score || a.length - b.length);
    return scored[0]?.node || null;
  }

  async function focusComment(payload) {
    if (tiktokPageError()) {
      return { ok: false, final: FINAL, error: 'Trang TikTok đang báo lỗi, chưa thể định vị comment.' };
    }

    maybeOpenCommentPanel();
    await sleep(1500);
    let target = findCommentCandidate(payload);
    for (let i = 0; i < 28 && !target; i += 1) {
      const scrollers = Array.from(document.querySelectorAll('div')).filter((el) => {
        if (!isVisible(el)) return false;
        return el.scrollHeight > el.clientHeight + 120 && el.getBoundingClientRect().height > 180;
      });
      const panel = scrollers.sort((a, b) => b.scrollHeight - a.scrollHeight)[0];
      if (panel) panel.scrollBy(0, Math.max(320, panel.clientHeight * 0.75));
      else window.scrollBy(0, Math.max(500, window.innerHeight || 800));
      await sleep(900);
      maybeOpenCommentPanel();
      target = findCommentCandidate(payload);
    }

    if (!target) {
      return {
        ok: false,
        final: FINAL,
        error: 'Đã mở video nhưng chưa tìm thấy đúng nội dung comment. Hãy dùng Ctrl+F và dán nội dung comment gốc để tìm nhanh.',
        url: window.location.href,
      };
    }

    highlightCommentElement(target, payload);
    return {
      ok: true,
      final: FINAL,
      message: 'Đã mở video và tô xanh comment cần trả lời.',
      url: window.location.href,
      method: 'focus-comment',
    };
  }

  function readCookie(name) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const match = document.cookie.match(new RegExp(`(?:^|; )${escaped}=([^;]*)`));
    return match ? decodeURIComponent(match[1]) : '';
  }

  function getVideoId(payload) {
    const raw = String(payload.video_id || payload.post_id || window.location.href || '')
      .replace(/^tiktok_/, '')
      .trim();
    return raw.match(/\d{8,}/)?.[0] || '';
  }

  function friendlyPublishError(payload, fallback) {
    const text = String(payload?.status_msg || payload?.message || fallback || '').trim();
    if (!text) return 'TikTok khong nhan binh luan qua phien Chrome hien tai.';
    if (/login|session|expired|auth|verify|captcha/i.test(text)) {
      return 'TikTok yeu cau dang nhap/xac minh lai tren Chrome truoc khi gui binh luan.';
    }
    return text;
  }

  async function publishCommentByApi(payload, reason) {
    const message = String(payload.message || '').trim();
    const videoId = getVideoId(payload);
    if (!videoId) {
      throw new Error(`${reason} Khong xac dinh duoc ID video TikTok de gui bang API.`);
    }

    const params = new URLSearchParams({
      aweme_id: videoId,
      aid: '1988',
      app_language: 'vi-VN',
      browser_language: navigator.language || 'vi-VN',
      device_platform: 'webapp',
      region: 'VN',
      os: 'windows',
    });
    const body = new URLSearchParams({ aweme_id: videoId, text: message });
    const csrf = readCookie('tt_csrf_token') || readCookie('csrf_session_id');
    const headers = { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' };
    if (csrf) {
      headers['X-Secsdk-Csrf-Token'] = csrf;
      headers['x-secsdk-csrf-token'] = csrf;
    }

    const response = await fetch(`/api/comment/publish/?${params.toString()}`, {
      method: 'POST',
      credentials: 'include',
      headers,
      body,
    });
    let data = {};
    try {
      data = await response.json();
    } catch (error) {
      data = {};
    }
    if (!response.ok) {
      throw new Error(`${reason} Gui API TikTok loi ${response.status}: ${friendlyPublishError(data, response.statusText)}`);
    }
    const statusCode = data.status_code;
    const comment = data.comment || data.comments?.[0] || {};
    if (statusCode !== 0 && statusCode !== '0' && statusCode !== undefined) {
      throw new Error(`${reason} ${friendlyPublishError(data, 'TikTok khong nhan binh luan.')}`);
    }
    if ((data.status_msg || data.message) && !comment.cid && !comment.id && !comment.comment_id) {
      throw new Error(`${reason} ${friendlyPublishError(data, 'TikTok khong nhan binh luan.')}`);
    }
    const commentId = comment.cid || comment.id || comment.comment_id || `extension_api_${Date.now()}`;
    return {
      ok: true,
      final: FINAL,
      comment_id: String(commentId),
      message: 'Extension da gui binh luan TikTok bang phien Chrome',
      url: window.location.href,
      method: 'api',
    };
  }

  async function postComment(payload) {
    const message = String(payload.message || '').trim();
    if (!message) throw new Error('Thieu noi dung binh luan');
    if (tiktokPageError()) {
      return publishCommentByApi(payload, 'Khung binh luan TikTok dang loi.');
    }

    maybeOpenCommentPanel();
    let sawTikTokError = false;
    const input = await waitFor(() => {
      if (tiktokPageError()) {
        sawTikTokError = true;
        return null;
      }
      return findCommentInput();
    }, 30000, () => {
      if (!sawTikTokError) maybeOpenCommentPanel();
    });
    if (!input) {
      if (sawTikTokError || tiktokPageError()) {
        return publishCommentByApi(payload, 'Khung binh luan TikTok dang loi.');
      }
      if (loginHint()) {
        throw new Error('Chrome chua dang nhap TikTok hoac TikTok yeu cau dang nhap lai.');
      }
      return publishCommentByApi(payload, 'Khong thay o binh luan TikTok.');
    }

    setTextValue(input, message);
    await sleep(800);

    const button = await waitFor(findPostButton, 12000);
    if (!button) {
      if (tiktokPageError()) {
        return publishCommentByApi(payload, 'Khung binh luan TikTok dang loi.');
      }
      return publishCommentByApi(payload, 'Da dien noi dung nhung khong thay nut dang binh luan TikTok.');
    }

    button.click();
    await sleep(1800);

    return {
      ok: true,
      final: FINAL,
      comment_id: `extension_${Date.now()}`,
      message: 'Extension da bam gui binh luan TikTok',
      url: window.location.href,
    };
  }

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.type === 'STREAL_TIKTOK_FOCUS_COMMENT') {
      focusComment(message.payload || {})
        .then((result) => sendResponse(result))
        .catch((error) => sendResponse({ ok: false, final: FINAL, error: error?.message || String(error) }));
      return true;
    }
    if (message?.type !== 'STREAL_TIKTOK_DO_COMMENT') return false;
    postComment(message.payload || {})
      .then((result) => sendResponse(result))
      .catch((error) => sendResponse({ ok: false, final: FINAL, error: error?.message || String(error) }));
    return true;
  });
})();
