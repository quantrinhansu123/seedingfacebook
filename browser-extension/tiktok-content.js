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

  async function postComment(payload) {
    const message = String(payload.message || '').trim();
    if (!message) throw new Error('Thieu noi dung binh luan');

    maybeOpenCommentPanel();
    const input = await waitFor(findCommentInput, 30000, maybeOpenCommentPanel);
    if (!input) {
      if (loginHint()) {
        throw new Error('Chrome chua dang nhap TikTok hoac TikTok yeu cau dang nhap lai.');
      }
      throw new Error('Khong thay o binh luan TikTok. Hay mo video tren TikTok, cho trang tai xong roi bam lai.');
    }

    setTextValue(input, message);
    await sleep(800);

    const button = await waitFor(findPostButton, 12000);
    if (!button) {
      throw new Error('Da dien noi dung nhung khong thay nut dang binh luan TikTok.');
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
    if (message?.type !== 'STREAL_TIKTOK_DO_COMMENT') return false;
    postComment(message.payload || {})
      .then((result) => sendResponse(result))
      .catch((error) => sendResponse({ ok: false, final: FINAL, error: error?.message || String(error) }));
    return true;
  });
})();
