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

  function inputHints(el) {
    let hints = `${el.getAttribute('aria-label') || ''} ${el.getAttribute('placeholder') || ''} ${el.getAttribute('data-placeholder') || ''}`;
    let parent = el.parentElement;
    for (let depth = 0; depth < 5 && parent; depth += 1) {
      hints += ` ${parent.getAttribute('aria-label') || ''} ${parent.getAttribute('placeholder') || ''}`;
      const labeled = parent.querySelector?.('[placeholder], [data-placeholder], [aria-label]');
      if (labeled) {
        hints += ` ${labeled.getAttribute('placeholder') || ''} ${labeled.getAttribute('aria-label') || ''} ${labeled.getAttribute('data-placeholder') || ''}`;
      }
      parent = parent.parentElement;
    }
    return normalizeText(hints);
  }

  function isReplyInput(el) {
    const hints = inputHints(el);
    return hints.includes('cau tra loi')
      || hints.includes('add a reply')
      || hints.includes('reply to')
      || (hints.includes('tra loi') && hints.includes('them'));
  }

  function isMainCommentInput(el) {
    const hints = inputHints(el);
    if (isReplyInput(el)) return false;
    return hints.includes('them binh luan') || hints.includes('add comment');
  }

  function findEditableInputs() {
    const selectors = [
      '[data-e2e="comment-input"] [contenteditable="true"]',
      '[data-e2e="comment-input"] textarea',
      '[data-e2e*="reply"] [contenteditable="true"]',
      'div.public-DraftEditor-content[contenteditable="true"]',
      'div[contenteditable="true"][role="textbox"]',
      'textarea[placeholder*="comment" i]',
      'textarea[placeholder*="bình luận" i]',
      'textarea[placeholder*="trả lời" i]',
      'div[contenteditable="true"]',
      'textarea',
    ];
    const seen = new Set();
    const rows = [];
    for (const selector of selectors) {
      for (const el of document.querySelectorAll(selector)) {
        if (!isVisible(el) || seen.has(el)) continue;
        const selfText = normalizeText(`${el.getAttribute('aria-label') || ''} ${el.textContent || ''}`);
        if (selfText.includes('search') || selfText.includes('tìm kiếm')) continue;
        seen.add(el);
        rows.push(el);
      }
    }
    return rows;
  }

  function findReplyInput() {
    return findEditableInputs().find(isReplyInput) || null;
  }

  function findCommentInput(mode = 'any') {
    const inputs = findEditableInputs();
    if (mode === 'reply') return findReplyInput();
    if (mode === 'main') return inputs.find(isMainCommentInput) || inputs[0] || null;
    return findReplyInput() || inputs.find(isMainCommentInput) || inputs[0] || null;
  }

  function findReplySendButton(nearInput) {
    const scopes = [];
    if (nearInput) {
      scopes.push(nearInput.closest('form'));
      scopes.push(nearInput.parentElement);
      scopes.push(nearInput.parentElement?.parentElement);
      scopes.push(nearInput.closest('[class*="comment"], [class*="Comment"], [data-e2e*="comment"]'));
    }
    scopes.push(document.body);
    for (const scope of scopes) {
      if (!scope) continue;
      const buttons = Array.from(scope.querySelectorAll('button, div[role="button"]')).filter(isVisible);
      const match = buttons.find((btn) => {
        if (isDisabled(btn)) return false;
        const text = buttonText(btn);
        if (text.includes('comment-post') || text === 'đăng' || text === 'post' || text === 'gửi') return true;
        const aria = normalizeText(btn.getAttribute('aria-label') || '');
        return aria.includes('post') || aria.includes('gui') || aria.includes('dang');
      });
      if (match) return match;
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
      '[data-e2e*="comment-post"]',
      '[data-e2e*="comment-submit"]',
      'button[data-e2e*="comment-post"]',
      'button[type="submit"]',
      'button[aria-label*="post" i]',
      'button[aria-label*="đăng" i]',
      'button[aria-label*="gửi" i]',
      'div[role="button"][aria-label*="post" i]',
      'div[role="button"][aria-label*="đăng" i]',
      'div[role="button"][aria-label*="gửi" i]',
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

  function submitCommentByKeyboard(input) {
    input.focus();
    const events = [
      new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true, cancelable: true, ctrlKey: true }),
      new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', bubbles: true, cancelable: true, ctrlKey: true }),
      new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true, cancelable: true }),
      new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', bubbles: true, cancelable: true }),
    ];
    events.forEach((event) => input.dispatchEvent(event));
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

  function looseText(value) {
    return String(value || '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/đ/g, 'd')
      .replace(/[^a-z0-9\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function stripTiktokPrefix(value) {
    return String(value || '').replace(/^tiktok_/, '').trim();
  }

  async function copyText(value) {
    const text = String(value || '');
    if (!text) return false;
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (error) {
      const textarea = document.createElement('textarea');
      textarea.value = text;
      textarea.setAttribute('readonly', 'true');
      textarea.style.position = 'fixed';
      textarea.style.left = '-9999px';
      textarea.style.top = '-9999px';
      document.body.appendChild(textarea);
      textarea.select();
      const ok = document.execCommand('copy');
      document.body.removeChild(textarea);
      return ok;
    }
  }

  function compact(value, fallback) {
    const text = String(value || '').replace(/\s+/g, ' ').trim();
    return text || fallback || '-';
  }

  function escapeHtml(value) {
    return String(value || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function renderCommentContextCard(payload, found, scanInfo = {}) {
    const old = document.querySelector('[data-streal-comment-context-card="true"]');
    if (old) old.remove();

    const commentText = compact(payload.comment_text, '(Comment không có nội dung chữ)');
    const replyText = String(payload.reply_text || '').replace(/\s+/g, ' ').trim();
    const authorName = compact(payload.author_name, 'Ẩn danh');
    const scrolled = Number(scanInfo.scrolled || 0);
    const videoChanged = Boolean(scanInfo.videoChanged);
    const card = document.createElement('section');
    card.setAttribute('data-streal-comment-context-card', 'true');
    card.style.position = 'fixed';
    card.style.zIndex = '2147483647';
    card.style.right = '24px';
    card.style.bottom = '24px';
    card.style.width = 'min(420px, calc(100vw - 32px))';
    card.style.maxHeight = 'calc(100vh - 48px)';
    card.style.overflow = 'auto';
    card.style.borderRadius = '18px';
    card.style.background = '#0f172a';
    card.style.color = '#e5e7eb';
    card.style.font = '500 14px/1.45 Arial, sans-serif';
    card.style.boxShadow = '0 24px 70px rgba(0,0,0,.45)';
    card.style.border = '1px solid rgba(148,163,184,.28)';
    card.style.padding = '16px';

    const safeFoundText = found
      ? `Đã tìm thấy comment gần khớp${scanInfo.scrolled ? ` sau ${scanInfo.scrolled} lượt cuộn` : ''}, cuộn tới vị trí đó và tô xanh.`
      : scanInfo.searching
        ? 'Đang tự cuộn panel bình luận TikTok để tìm comment. Có thể mất vài chục giây nếu comment nằm sâu.'
        : videoChanged
          ? 'Đã dừng cuộn vì TikTok đổi video. Mở lại từ web hoặc bấm "Tìm tự động".'
          : `Chưa thấy comment sau ${scanInfo.scanned || 0} lượt quét. Bấm "Tìm tự động" để tiếp tục cuộn panel bình luận và dò comment.`;

    card.innerHTML = `
      <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px;margin-bottom:12px">
        <div>
          <div style="font-size:16px;font-weight:800;color:#fff">Lead Hunter - comment cần xử lý</div>
          <div style="margin-top:4px;color:#93c5fd;font-weight:700">${escapeHtml(authorName)}</div>
        </div>
        <button type="button" data-streal-close-card="true" style="border:0;background:rgba(255,255,255,.08);color:#fff;border-radius:999px;width:32px;height:32px;cursor:pointer;font-size:18px">×</button>
      </div>
      <div style="border-radius:14px;background:rgba(255,255,255,.08);padding:12px;margin-bottom:12px">
        <div style="color:#9ca3af;font-size:12px;text-transform:uppercase;font-weight:800;margin-bottom:6px">Comment gốc</div>
        <div data-streal-original-text="true" style="white-space:pre-wrap;color:#fff">${escapeHtml(commentText)}</div>
      </div>
      <div style="border-radius:14px;background:rgba(37,99,235,.18);padding:12px;margin-bottom:12px">
        <div style="color:#bfdbfe;font-size:12px;text-transform:uppercase;font-weight:800;margin-bottom:6px">Câu trả lời đã copy</div>
        <div data-streal-reply-text="true" style="white-space:pre-wrap;color:#fff">${escapeHtml(replyText || 'Chưa có câu trả lời')}</div>
      </div>
      <div style="color:#cbd5e1;margin-bottom:12px">${safeFoundText}</div>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button type="button" data-streal-type-reply="true" style="border:0;background:#16a34a;color:#fff;border-radius:12px;padding:10px 12px;font-weight:800;cursor:pointer">Trả lời trực tiếp</button>
        <button type="button" data-streal-copy-reply="true" style="border:0;background:#2563eb;color:#fff;border-radius:12px;padding:10px 12px;font-weight:800;cursor:pointer">Copy câu trả lời</button>
        <button type="button" data-streal-copy-comment="true" style="border:1px solid rgba(148,163,184,.5);background:transparent;color:#fff;border-radius:12px;padding:10px 12px;font-weight:800;cursor:pointer">Copy comment gốc</button>
        <button type="button" data-streal-auto-search="true" style="border:1px solid rgba(148,163,184,.5);background:transparent;color:#fff;border-radius:12px;padding:10px 12px;font-weight:800;cursor:pointer">Tìm tự động</button>
        <button type="button" data-streal-open-search="true" style="border:1px solid rgba(148,163,184,.5);background:transparent;color:#fff;border-radius:12px;padding:10px 12px;font-weight:800;cursor:pointer">Copy để tìm</button>
      </div>
      <div data-streal-card-status="true" style="margin-top:10px;color:#86efac;font-size:13px"></div>
    `;

    const status = card.querySelector('[data-streal-card-status="true"]');
    const setStatus = (text) => {
      if (status) status.textContent = text;
    };
    card.querySelector('[data-streal-close-card="true"]')?.addEventListener('click', () => card.remove());
    card.querySelector('[data-streal-type-reply="true"]')?.addEventListener('click', async () => {
      const focused = document.querySelector('[data-streal-focused-comment="true"]');
      const typed = await openReplyAndType(payload, focused);
      if (typed.ok && typed.filled) {
        setStatus(typed.reply_mode
          ? 'Đã gõ vào ô "Thêm câu trả lời...". Kiểm tra rồi bấm gửi.'
          : 'Đã gõ nội dung. Bấm Trả lời trên comment nếu chưa đúng thread.');
      } else if (typed.ok) setStatus('Đã mở ô trả lời. Gõ nội dung rồi bấm gửi.');
      else setStatus(typed.error || 'Không gõ được vào ô comment.');
    });
    card.querySelector('[data-streal-copy-reply="true"]')?.addEventListener('click', async () => {
      await copyText(replyText);
      setStatus('Đã copy câu trả lời. Dán vào ô bình luận TikTok để gửi thủ công.');
    });
    card.querySelector('[data-streal-copy-comment="true"]')?.addEventListener('click', async () => {
      await copyText(commentText);
      setStatus('Đã copy comment gốc. Có thể dùng Ctrl+F để tìm nếu TikTok hỗ trợ.');
    });
    card.querySelector('[data-streal-auto-search="true"]')?.addEventListener('click', async () => {
      setStatus('Đang tự cuộn panel bình luận TikTok để tìm comment...');
      const result = await searchAndFocusComment(payload, {
        maxScrolls: 48,
        delayMs: 850,
        status: setStatus,
      });
      if (result.target) {
        setStatus(`Đã tìm thấy và tô xanh comment sau ${result.scrolled} lượt cuộn.`);
      } else {
        setStatus(`Chưa thấy comment sau ${result.scanned} lượt quét. Có thể TikTok chưa tải comment này, comment đã bị xoá/ẩn hoặc đang nằm trong reply chưa mở.`);
      }
    });
    card.querySelector('[data-streal-open-search="true"]')?.addEventListener('click', async () => {
      await copyText(commentText);
      setStatus('Đã copy comment gốc. Nhấn Ctrl+F trên TikTok và dán để tìm.');
    });
    document.body.appendChild(card);
    if (replyText) void copyText(replyText);
  }

  function nearestScrollableParent(el) {
    let node = el?.parentElement || null;
    while (node && node !== document.body) {
      const style = window.getComputedStyle(node);
      const canScroll = /(auto|scroll)/i.test(`${style.overflowY} ${style.overflow}`) && node.scrollHeight > node.clientHeight + 20;
      if (canScroll) return node;
      node = node.parentElement;
    }
    return document.scrollingElement || document.documentElement;
  }

  function findCommentScroller() {
    const selectorCandidates = [
      '[data-e2e*="comment-list"]',
      '[data-e2e*="CommentList"]',
      '[class*="DivCommentListContainer"]',
      '[class*="CommentList"]',
      '[class*="comment-list"]',
      '[role="tabpanel"]',
      'aside',
      'section',
      'div',
    ];
    const seen = new Set();
    const candidates = [];
    for (const selector of selectorCandidates) {
      document.querySelectorAll(selector).forEach((node) => {
        if (seen.has(node) || !isVisible(node)) return;
        if (node.closest('[data-streal-comment-context-card="true"], [data-streal-comment-badge="true"]')) return;
        seen.add(node);
        const rect = node.getBoundingClientRect();
        const extraScroll = node.scrollHeight - node.clientHeight;
        if (extraScroll < 80 || rect.height < 220 || rect.width < 240) return;
        const attr = `${node.className || ''} ${node.id || ''} ${node.getAttribute('data-e2e') || ''}`.toLowerCase();
        const text = normalizeText(node.innerText || node.textContent || '').slice(0, 500);
        let score = 0;
        if (rect.left > window.innerWidth * 0.48) score += 200;
        if (attr.includes('comment')) score += 180;
        if (text.includes('bình luận') || text.includes('comment')) score += 120;
        if (text.includes('trả lời') || text.includes('reply')) score += 40;
        score += Math.min(extraScroll / 20, 120);
        score -= Math.abs(rect.right - window.innerWidth) / 20;
        candidates.push({ node, score });
      });
    }
    candidates.sort((a, b) => b.score - a.score);
    return candidates[0]?.node || document.scrollingElement || document.documentElement;
  }

  function scrollCommentPanel(scroller) {
    const before = scroller.scrollTop || window.scrollY || 0;
    const delta = Math.max(420, Math.floor((scroller.clientHeight || window.innerHeight || 760) * 0.72));
    try {
      scroller.scrollBy({ top: delta, behavior: 'smooth' });
    } catch (error) {
      scroller.scrollTop = before + delta;
    }
    const eventTarget = scroller === document.scrollingElement || scroller === document.documentElement
      ? document.elementFromPoint(window.innerWidth - 180, Math.max(180, window.innerHeight * 0.45)) || document.body
      : scroller;
    eventTarget.dispatchEvent(new WheelEvent('wheel', {
      bubbles: true,
      cancelable: true,
      deltaY: delta,
      clientX: window.innerWidth - 180,
      clientY: Math.max(180, window.innerHeight * 0.45),
    }));
    return before;
  }

  function expandVisibleReplies(limit = 4) {
    let clicked = 0;
    const buttons = Array.from(document.querySelectorAll('button, [role="button"], div, span')).filter((node) => {
      if (!isVisible(node)) return false;
      if (node.closest('[data-streal-comment-context-card="true"], [data-streal-comment-badge="true"]')) return false;
      const rect = node.getBoundingClientRect();
      if (rect.left < window.innerWidth * 0.48) return false;
      const text = normalizeText(node.innerText || node.textContent || '');
      return (
        /xem\s+\d*\s*(câu\s+)?trả\s+lời/.test(text) ||
        /xem\s+thêm\s+(câu\s+)?trả\s+lời/.test(text) ||
        /view\s+\d*\s*repl/.test(text) ||
        /show\s+\d*\s*repl/.test(text)
      );
    });
    for (const button of buttons.slice(0, limit)) {
      try {
        button.click();
        clicked += 1;
      } catch (error) {
        // Continue best effort.
      }
    }
    return clicked;
  }

  function scrollToCommentElement(target) {
    const scroller = nearestScrollableParent(target);
    const targetRect = target.getBoundingClientRect();
    const scrollerRect = scroller === document.scrollingElement || scroller === document.documentElement
      ? { top: 0, height: window.innerHeight }
      : scroller.getBoundingClientRect();
    const nextTop = scroller.scrollTop + targetRect.top - scrollerRect.top - Math.max(48, scrollerRect.height * 0.25);
    scroller.scrollTo({ top: Math.max(0, nextTop), behavior: 'smooth' });
  }

  function findReplyButton(container) {
    if (!container) return null;
    const scope = container.closest('[data-e2e*="comment"], [class*="Comment"], [class*="comment"]') || container;
    const nodes = Array.from(scope.querySelectorAll('button, div[role="button"], span, a, p, div')).filter(isVisible);
    return nodes.find((btn) => {
      const text = normalizeText(`${btn.textContent || ''} ${btn.getAttribute('aria-label') || ''}`);
      return text === 'trả lời' || text === 'reply';
    }) || null;
  }

  async function fillCommentInput(text, options = {}) {
    const replyText = String(text || '').trim();
    const mode = options.mode || 'any';
    maybeOpenCommentPanel();
    await sleep(options.delayMs || 350);
    const input = await waitFor(
      () => findCommentInput(mode),
      options.timeoutMs || 9000,
      () => maybeOpenCommentPanel(),
    );
    if (!input) {
      return {
        ok: false,
        error: mode === 'reply' ? 'Không thấy ô Thêm câu trả lời' : 'Không thấy ô Thêm bình luận',
      };
    }
    if (replyText) setTextValue(input, replyText);
    else input.focus();
    try {
      input.scrollIntoView({ block: 'center', behavior: 'smooth' });
    } catch (error) {
      // ignore scroll errors
    }
    return { ok: true, filled: Boolean(replyText), reply_mode: isReplyInput(input) };
  }

  async function openReplyAndType(payload, commentElement) {
    let replyOpened = false;
    if (commentElement) {
      const replyBtn = findReplyButton(commentElement);
      if (replyBtn) {
        replyBtn.click();
        replyOpened = true;
        await sleep(900);
      }
    }
    const filled = await fillCommentInput(payload.reply_text || payload.message || '', {
      delayMs: 300,
      mode: replyOpened ? 'reply' : 'any',
      timeoutMs: 12000,
    });
    return { ...filled, reply_opened: replyOpened };
  }

  async function submitReplyFromInput(input, autoSend) {
    if (!autoSend) return { sent: false };
    const button = findReplySendButton(input) || findPostButton();
    if (!button) {
      submitCommentByKeyboard(input);
      await sleep(1200);
      return { sent: true, method: 'keyboard' };
    }
    button.click();
    await sleep(1400);
    return { sent: true, method: 'click' };
  }

  function highlightCommentElement(target, payload) {
    scrollToCommentElement(target);
    target.style.outline = '4px solid #2563eb';
    target.style.boxShadow = '0 0 0 8px rgba(37, 99, 235, 0.22)';
    target.style.borderRadius = '12px';
    target.style.background = 'rgba(37, 99, 235, 0.08)';
    target.setAttribute('data-streal-focused-comment', 'true');

    const oldBadge = document.querySelector('[data-streal-comment-badge="true"]');
    if (oldBadge) oldBadge.remove();
    const badge = document.createElement('div');
    badge.setAttribute('data-streal-comment-badge', 'true');
    badge.textContent = 'Lead Hunter: đã mở Trả lời trực tiếp. Kiểm tra ô "Thêm câu trả lời..." rồi bấm nút gửi.';
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

  function getVideoKey() {
    const match = window.location.href.match(/\/video\/(\d+)/);
    return match?.[1] || window.location.href;
  }

  function findCommentListScroller() {
    const selectors = [
      '[data-e2e="comment-list"]',
      '[data-e2e="browse-comment-list"]',
      '[class*="CommentListContainer"]',
      '[class*="comment-list-container"]',
    ];
    for (const selector of selectors) {
      const el = document.querySelector(selector);
      if (el && isVisible(el) && el.scrollHeight > el.clientHeight + 40) return el;
    }

    const input = findCommentInput();
    let node = input?.parentElement || null;
    for (let depth = 0; depth < 14 && node; depth += 1) {
      const style = window.getComputedStyle(node);
      const scrollable = (style.overflowY === 'auto' || style.overflowY === 'scroll')
        && node.scrollHeight > node.clientHeight + 60;
      if (scrollable && node.querySelector('[data-e2e*="comment"], [class*="Comment"]')) {
        return node;
      }
      node = node.parentElement;
    }

    return Array.from(document.querySelectorAll('div'))
      .filter((el) => {
        if (!isVisible(el)) return false;
        const style = window.getComputedStyle(el);
        const scrollable = (style.overflowY === 'auto' || style.overflowY === 'scroll')
          && el.scrollHeight > el.clientHeight + 100;
        if (!scrollable) return false;
        return Boolean(el.querySelector('[data-e2e*="comment"], [class*="Comment"], [class*="comment"]'));
      })
      .sort((a, b) => b.scrollHeight - a.scrollHeight)[0] || null;
  }

  function findCommentCandidate(payload, root) {
    const targetText = normalizeText(payload.comment_text).slice(0, 180);
    const targetLoose = looseText(payload.comment_text).slice(0, 180);
    const targetLooseShort = targetLoose.slice(0, Math.min(70, Math.max(24, targetLoose.length)));
    const author = normalizeText(payload.author_name).slice(0, 80);
    const authorLoose = looseText(payload.author_name).slice(0, 80);
    const rawCommentId = stripTiktokPrefix(payload.comment_id);
    const scope = root && root.querySelectorAll ? root : document;
    const nodes = Array.from(scope.querySelectorAll(
      '[data-e2e*="comment"], [class*="Comment"], [class*="comment"], div, p, span',
    ));
    const scored = [];
    for (const node of nodes) {
      if (!isVisible(node)) continue;
      if (node.closest('[data-streal-comment-context-card="true"], [data-streal-comment-badge="true"]')) continue;
      const text = normalizeText(node.innerText || node.textContent || '');
      if (!text || text.length > 1600) continue;
      const loose = looseText(text);
      let score = 0;
      if (targetText && text.includes(targetText)) score += 1000 - Math.min(text.length, 900);
      if (targetLoose && loose.includes(targetLoose)) score += 900 - Math.min(text.length, 700);
      if (targetLooseShort && targetLooseShort.length >= 12 && loose.includes(targetLooseShort)) score += 520 - Math.min(text.length, 420);
      if (author && text.includes(author)) score += 120;
      if (authorLoose && loose.includes(authorLoose)) score += 90;
      const html = `${node.id || ''} ${node.getAttribute('href') || ''} ${node.getAttribute('data-e2e') || ''}`;
      if (rawCommentId && html.includes(rawCommentId)) score += 300;
      if (score <= 0) continue;
      const container = node.closest('[data-e2e*="comment"], [class*="Comment"], [class*="comment"]') || node;
      scored.push({ node: container, score, length: text.length });
    }
    scored.sort((a, b) => b.score - a.score || a.length - b.length);
    return scored[0]?.node || null;
  }

  async function searchAndFocusComment(payload, options = {}) {
    const maxScrolls = Number(options.maxScrolls || 32);
    const delayMs = Number(options.delayMs || 900);
    const status = typeof options.status === 'function' ? options.status : null;
    maybeOpenCommentPanel();
    await sleep(900);

    let scroller = findCommentScroller();
    let stagnant = 0;
    let lastTop = -1;
    for (let i = 0; i <= maxScrolls; i += 1) {
      expandVisibleReplies(3);
      await sleep(i === 0 ? 250 : 150);
      const target = findCommentCandidate(payload);
      if (target) {
        highlightCommentElement(target, payload);
        return { target, scanned: i + 1, scrolled: i };
      }

      if (i === maxScrolls) break;
      if (status) status(`Đang tìm comment... lượt ${i + 1}/${maxScrolls + 1}`);
      scroller = findCommentScroller() || scroller;
      const before = scrollCommentPanel(scroller);
      await sleep(delayMs);
      const after = scroller.scrollTop || window.scrollY || 0;
      if (Math.abs(after - lastTop) < 8 || Math.abs(after - before) < 8) stagnant += 1;
      else stagnant = 0;
      lastTop = after;
      if (stagnant >= 6) {
        const fallbackTarget = document.elementFromPoint(window.innerWidth - 160, Math.max(220, window.innerHeight * 0.52)) || scroller;
        fallbackTarget.dispatchEvent(new WheelEvent('wheel', {
          bubbles: true,
          cancelable: true,
          deltaY: 720,
          clientX: window.innerWidth - 160,
          clientY: Math.max(220, window.innerHeight * 0.52),
        }));
        await sleep(900);
        stagnant = 0;
      }
    }
    return { target: null, scanned: maxScrolls + 1, scrolled: maxScrolls };
  }

  async function focusComment(payload) {
    if (tiktokPageError()) {
      return { ok: false, final: FINAL, error: 'Trang TikTok đang báo lỗi, chưa thể định vị comment.' };
    }

    renderCommentContextCard(payload, false, { searching: true });
    const setCardStatus = (text) => {
      const status = document.querySelector('[data-streal-card-status="true"]');
      if (status) status.textContent = text;
    };
    const result = await searchAndFocusComment(payload, { maxScrolls: 28, delayMs: 850, status: setCardStatus });
    const target = result.target;
    let typed = { ok: false, filled: false };
    if (target) {
      typed = await openReplyAndType(payload, target);
    }
    renderCommentContextCard(payload, Boolean(target), { ...result, typed });
    const typedNote = typed.ok && typed.filled ? ' và đã gõ vào ô bình luận' : typed.ok ? ' và đã mở ô bình luận' : '';
    return {
      ok: true,
      final: FINAL,
      target_found: Boolean(target),
      typed: Boolean(typed.ok && typed.filled),
      scrolled: result.scrolled || 0,
      message: target
        ? `Đã mở video, tự cuộn và tô xanh comment sau ${result.scrolled} lượt${typedNote}.`
        : `Đã mở video nhưng chưa thấy comment sau ${result.scanned} lượt quét. Có thể TikTok chưa tải/đã ẩn comment này.`,
      url: window.location.href,
      method: target ? 'auto-scroll-focus-comment' : 'open-context-card',
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
      throw new Error('Khung binh luan TikTok dang loi hoac TikTok chan phien gui tu Chrome.');
    }

    const replyToComment = Boolean(String(payload.comment_text || payload.comment_id || '').trim());
    maybeOpenCommentPanel();
    await sleep(1000);

    let target = null;
    if (replyToComment) {
      target = findCommentCandidate(payload);
      if (!target) {
        const search = await scrollToFindComment(payload, { maxAttempts: 22 });
        target = search.target;
      }
      if (target) {
        const replyBtn = findReplyButton(target);
        if (replyBtn) {
          replyBtn.click();
          await sleep(900);
        }
      }
    }

    let sawTikTokError = false;
    const input = await waitFor(() => {
      if (tiktokPageError()) {
        sawTikTokError = true;
        return null;
      }
      if (replyToComment) return findReplyInput() || findCommentInput('main');
      return findCommentInput('main');
    }, 30000, () => {
      if (!sawTikTokError) maybeOpenCommentPanel();
    });
    if (!input) {
      if (sawTikTokError || tiktokPageError()) {
        throw new Error('Khung binh luan TikTok dang loi hoac TikTok chan phien gui tu Chrome.');
      }
      if (loginHint()) {
        throw new Error('Chrome chua dang nhap TikTok hoac TikTok yeu cau dang nhap lai.');
      }
      throw new Error('Khong thay o binh luan TikTok.');
    }

    setTextValue(input, message);
    await sleep(800);

    const button = findReplySendButton(input) || await waitFor(findPostButton, 12000);
    if (!button) {
      if (tiktokPageError()) {
        throw new Error('Khung binh luan TikTok dang loi hoac TikTok chan phien gui tu Chrome.');
      }
      submitCommentByKeyboard(input);
      await sleep(1800);
      if (!tiktokPageError()) {
        return {
          ok: true,
          final: FINAL,
          comment_id: `extension_keyboard_${Date.now()}`,
          message: 'Extension da thu gui binh luan TikTok bang phim Enter',
          url: window.location.href,
          method: 'dom-keyboard',
        };
      }
      throw new Error('Da dien noi dung nhung TikTok khong hien nut dang binh luan.');
    }

    button.click();
    await sleep(1800);

    return {
      ok: true,
      final: FINAL,
      comment_id: `extension_${Date.now()}`,
      message: replyToComment && isReplyInput(input)
        ? 'Extension da gui tra loi truc tiep vao comment TikTok'
        : 'Extension da bam gui binh luan TikTok',
      url: window.location.href,
      method: replyToComment && isReplyInput(input) ? 'reply-thread' : 'dom-click',
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
