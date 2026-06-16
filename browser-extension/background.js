const TIKTOK_HOST = 'https://www.tiktok.com';

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeTikTokUrl(payload) {
  const rawUrl = String(payload.post_url || payload.video_url || payload.url || '').trim();
  const videoIdFromUrl = rawUrl.match(/\/video\/(\d+)/)?.[1] || '';
  const rawVideoId = String(payload.video_id || payload.post_id || '').replace(/^tiktok_/, '').trim();
  const videoId = videoIdFromUrl || rawVideoId.match(/\d{8,}/)?.[0] || '';
  const channelName = String(payload.channel_name || payload.channel || payload.author_unique_id || payload.username || '')
    .trim()
    .replace(/^@+/, '')
    .replace(/\s+/g, '')
    .replace(/[^a-zA-Z0-9._-]/g, '');

  if (rawUrl && rawUrl.includes('tiktok.com') && !rawUrl.includes('/@/video/')) return rawUrl;
  if (videoId && channelName) return `${TIKTOK_HOST}/@${encodeURIComponent(channelName)}/video/${encodeURIComponent(videoId)}`;
  if (rawUrl && rawUrl.includes('tiktok.com')) return rawUrl;
  return '';
}

function getVideoId(payload, url) {
  const raw = String(payload.video_id || payload.post_id || url || '')
    .replace(/^tiktok_/, '')
    .trim();
  return raw.match(/\d{8,}/)?.[0] || '';
}

function friendlyTikTokError(payload, fallback) {
  const text = String(payload?.status_msg || payload?.message || fallback || '').trim();
  if (!text) return 'TikTok khong nhan binh luan qua phien Chrome hien tai.';
  if (/login|session|expired|auth|verify|captcha/i.test(text)) {
    return 'TikTok yeu cau dang nhap/xac minh/captcha lai tren Chrome truoc khi gui binh luan.';
  }
  return text;
}


function conciseSendError(apiError, domError) {
  const joined = [apiError, domError].filter(Boolean).join(' | ');
  if (/403|status_code.*?214|khong nhan binh luan|kh?ng nh?n b?nh lu?n/i.test(joined)) {
    return 'TikTok tu choi gui tu dong bang phien Chrome hien tai (403). Da mo video va copy noi dung, hay dan Ctrl+V de gui thu cong.';
  }
  if (/login|session|captcha|verify|dang nhap|xac minh/i.test(joined)) {
    return 'TikTok yeu cau dang nhap/xac minh/captcha lai tren Chrome truoc khi gui binh luan.';
  }
  return joined || 'Khong gui duoc comment TikTok qua API/extension.';
}

function getTikTokCookies() {
  return new Promise((resolve) => {
    chrome.cookies.getAll({ domain: '.tiktok.com' }, (cookies) => {
      if (chrome.runtime.lastError) {
        resolve({ cookieHeader: '', csrf: '', error: chrome.runtime.lastError.message });
        return;
      }
      const rows = Array.isArray(cookies) ? cookies : [];
      const cookieHeader = rows.map((item) => `${item.name}=${item.value}`).join('; ');
      const csrf =
        rows.find((item) => item.name === 'tt_csrf_token')?.value ||
        rows.find((item) => item.name === 'csrf_session_id')?.value ||
        '';
      resolve({ cookieHeader, csrf, error: '' });
    });
  });
}

function getFacebookCookies() {
  return new Promise((resolve) => {
    chrome.cookies.getAll({ domain: '.facebook.com' }, (cookies) => {
      if (chrome.runtime.lastError) {
        resolve({ ok: false, cookie: '', c_user: '', error: chrome.runtime.lastError.message });
        return;
      }
      const rows = Array.isArray(cookies) ? cookies : [];
      const cookie = rows.map((item) => `${item.name}=${item.value}`).join('; ');
      const cUser = rows.find((item) => item.name === 'c_user')?.value || '';
      if (!cookie || !cUser) {
        resolve({
          ok: false,
          cookie: '',
          c_user: '',
          error: 'Chrome chua dang nhap Facebook hoac extension chua du quyen doc cookie facebook.com.',
        });
        return;
      }
      resolve({ ok: true, cookie, c_user: cUser, error: '' });
    });
  });
}

async function publishCommentFromBackground(payload, url, previousError) {
  const text = String(payload.message || payload.text || '').trim();
  const videoId = getVideoId(payload, url);
  if (!videoId) {
    return { ok: false, final: true, error: `${previousError || ''} Khong xac dinh duoc ID video TikTok.`.trim() };
  }

  const cookieInfo = await getTikTokCookies();
  if (!cookieInfo.cookieHeader) {
    return {
      ok: false,
      final: true,
      error: `${previousError || ''} Khong doc duoc cookie TikTok trong Chrome. Hay cap quyen cookies cho extension va reload extension.`.trim(),
    };
  }

  const params = new URLSearchParams({
    aweme_id: videoId,
    aid: '1988',
    app_language: 'vi-VN',
    browser_language: 'vi-VN',
    device_platform: 'webapp',
    region: 'VN',
    os: 'windows',
  });
  const body = new URLSearchParams({ aweme_id: videoId, text });
  const headers = {
    'Accept': 'application/json, text/plain, */*',
    'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
    'Origin': TIKTOK_HOST,
    'Referer': url,
  };
  if (cookieInfo.csrf) {
    headers['X-Secsdk-Csrf-Token'] = cookieInfo.csrf;
    headers['x-secsdk-csrf-token'] = cookieInfo.csrf;
  }

  let response;
  try {
    response = await fetch(`${TIKTOK_HOST}/api/comment/publish/?${params.toString()}`, {
      method: 'POST',
      credentials: 'include',
      headers,
      body,
    });
  } catch (error) {
    return {
      ok: false,
      final: true,
      error: `${previousError || ''} Background API loi ket noi TikTok: ${error?.message || String(error)}`.trim(),
    };
  }

  let data = {};
  try {
    data = await response.json();
  } catch (error) {
    data = {};
  }
  if (!response.ok) {
    return {
      ok: false,
      final: true,
      error: `${previousError || ''} Background API TikTok loi ${response.status}: ${friendlyTikTokError(data, response.statusText)}`.trim(),
    };
  }
  const statusCode = data.status_code;
  const comment = data.comment || data.comments?.[0] || {};
  if (statusCode !== 0 && statusCode !== '0' && statusCode !== undefined) {
    return {
      ok: false,
      final: true,
      error: `${previousError || ''} Background API TikTok: ${friendlyTikTokError(data, 'TikTok khong nhan binh luan.')}`.trim(),
    };
  }
  if ((data.status_msg || data.message) && !comment.cid && !comment.id && !comment.comment_id) {
    return {
      ok: false,
      final: true,
      error: `${previousError || ''} Background API TikTok: ${friendlyTikTokError(data, 'TikTok khong nhan binh luan.')}`.trim(),
    };
  }

  return {
    ok: true,
    final: true,
    comment_id: String(comment.cid || comment.id || comment.comment_id || `extension_bg_${Date.now()}`),
    message: 'Extension da gui binh luan TikTok bang background Chrome',
    url,
    method: 'background-api',
  };
}

function normalizeTikTokApiComment(item, videoId, depth = 0, parentId = '') {
  const user = item?.user || {};
  const cid = String(item?.cid || item?.id || item?.comment_id || '').trim();
  const text = String(item?.text || item?.share_info?.desc || '').trim();
  if (!cid || !text) return null;
  const authorName = String(user.nickname || user.unique_id || user.uid || 'Ẩn danh').trim();
  return {
    id: cid,
    cid,
    text,
    author_name: authorName,
    author_id: String(user.uid || user.sec_uid || user.unique_id || authorName || '').trim(),
    create_time: item.create_time || null,
    depth,
    parent_comment_id: parentId,
    source: 'chrome_api',
    video_id: videoId,
  };
}

async function fetchTikTokCommentsByApi(video, limit, cookieInfo) {
  const url = normalizeTikTokUrl(video) || String(video.post_url || video.url || '').trim();
  const videoId = getVideoId(video, url);
  if (!videoId || !url) {
    return { ok: false, comments: [], error: 'Khong xac dinh duoc video TikTok de doc API.' };
  }
  if (!cookieInfo?.cookieHeader) {
    return { ok: false, comments: [], error: 'Chrome chua co cookie TikTok de doc API nhanh.' };
  }

  const comments = [];
  const headers = {
    'Accept': 'application/json, text/plain, */*',
    'Referer': url,
    'Origin': TIKTOK_HOST,
  };
  if (cookieInfo.csrf) {
    headers['X-Secsdk-Csrf-Token'] = cookieInfo.csrf;
    headers['x-secsdk-csrf-token'] = cookieInfo.csrf;
  }

  async function requestJson(path, params) {
    const response = await fetch(`${TIKTOK_HOST}${path}?${params.toString()}`, {
      method: 'GET',
      credentials: 'include',
      headers,
    });
    let data = {};
    try {
      data = await response.json();
    } catch {
      data = {};
    }
    if (!response.ok) {
      throw new Error(`TikTok API ${path} loi ${response.status}: ${friendlyTikTokError(data, response.statusText)}`);
    }
    const statusCode = data.status_code;
    if (statusCode !== 0 && statusCode !== '0' && statusCode !== undefined) {
      throw new Error(`TikTok API ${path}: ${friendlyTikTokError(data, 'TikTok khong tra comment.')}`);
    }
    return data;
  }

  async function fetchReplies(parentId, remain) {
    const rows = [];
    let cursor = 0;
    for (let page = 0; page < 3 && rows.length < remain; page += 1) {
      const count = Math.min(30, remain - rows.length);
      const params = new URLSearchParams({
        item_id: videoId,
        comment_id: parentId,
        cursor: String(cursor),
        count: String(count),
        aid: '1988',
        app_language: 'vi-VN',
        browser_language: 'vi-VN',
        device_platform: 'webapp',
        region: 'VN',
        os: 'windows',
      });
      const data = await requestJson('/api/comment/list/reply/', params);
      const batch = Array.isArray(data.comments) ? data.comments : [];
      if (!batch.length) break;
      for (const item of batch) {
        const row = normalizeTikTokApiComment(item, videoId, 1, parentId);
        if (row) rows.push(row);
        if (rows.length >= remain) break;
      }
      const nextCursor = Number(data.cursor ?? cursor);
      if (!data.has_more || nextCursor === cursor) break;
      cursor = nextCursor;
    }
    return rows;
  }

  try {
    let cursor = 0;
    for (let page = 0; page < 8 && comments.length < limit; page += 1) {
      const count = Math.min(50, limit - comments.length);
      const params = new URLSearchParams({
        aweme_id: videoId,
        cursor: String(cursor),
        count: String(count),
        aid: '1988',
        app_language: 'vi-VN',
        browser_language: 'vi-VN',
        device_platform: 'webapp',
        region: 'VN',
        os: 'windows',
      });
      const data = await requestJson('/api/comment/list/', params);
      const batch = Array.isArray(data.comments) ? data.comments : [];
      if (!batch.length) {
        const msg = data.status_msg || data.message || 'TikTok API khong tra comment.';
        return { ok: false, comments, error: msg };
      }
      for (const item of batch) {
        const row = normalizeTikTokApiComment(item, videoId, 0, '');
        if (row) comments.push(row);
        const replyTotal = Number(item.reply_comment_total || item.reply_comment_count || 0);
        if (row?.id && replyTotal > 0 && comments.length < limit) {
          try {
            const replies = await fetchReplies(row.id, Math.min(20, limit - comments.length));
            comments.push(...replies);
          } catch {
            // Reply API is best-effort; keep root comments.
          }
        }
        if (comments.length >= limit) break;
      }
      const nextCursor = Number(data.cursor ?? cursor);
      if (!data.has_more || nextCursor === cursor) break;
      cursor = nextCursor;
    }
    return {
      ok: comments.length > 0,
      comments: comments.slice(0, limit),
      error: comments.length ? '' : 'TikTok API khong tra comment.',
      method: 'chrome-api',
    };
  } catch (error) {
    return { ok: false, comments, error: error?.message || String(error), method: 'chrome-api' };
  }
}

function waitForTabLoaded(tabId, timeoutMs = 30000) {
  return new Promise((resolve) => {
    let done = false;
    const timer = setTimeout(() => finish(), timeoutMs);

    function finish() {
      if (done) return;
      done = true;
      clearTimeout(timer);
      chrome.tabs.onUpdated.removeListener(listener);
      resolve();
    }

    function listener(updatedTabId, info) {
      if (updatedTabId === tabId && info.status === 'complete') finish();
    }

    chrome.tabs.onUpdated.addListener(listener);
    chrome.tabs.get(tabId, (tab) => {
      if (chrome.runtime.lastError || tab?.status === 'complete') finish();
    });
  });
}

async function sendMessageWithRetries(tabId, message) {
  let lastError = '';
  for (let i = 0; i < 30; i += 1) {
    const response = await new Promise((resolve) => {
      chrome.tabs.sendMessage(tabId, message, (res) => {
        if (chrome.runtime.lastError) {
          resolve({ ok: false, error: chrome.runtime.lastError.message });
          return;
        }
        resolve(res || { ok: false, error: 'TikTok tab khong tra ket qua' });
      });
    });
    if (response?.ok || response?.final) return response;
    lastError = response?.error || lastError;
    await sleep(1000);
  }
  return {
    ok: false,
    final: true,
    error: lastError || 'Extension chua ket noi duoc tab TikTok. Hay tai lai TikTok roi thu lai.',
  };
}

async function handleSendComment(request) {
  const payload = request.payload || {};
  const url = normalizeTikTokUrl(payload);
  const text = String(payload.message || payload.text || '').trim();

  if (!url) {
    return {
      ok: false,
      final: true,
      error: 'Thieu link video TikTok chuan. Hay lay comment lai bang link video dang https://www.tiktok.com/@kenh/video/id hoac dam bao co ten kenh.',
    };
  }
  if (!text) {
    return { ok: false, final: true, error: 'Nhap noi dung binh luan truoc khi gui' };
  }

  // First try background cookie/API publish to avoid flaky DOM automation.
  const apiResult = await publishCommentFromBackground({ ...payload, message: text }, url, '');
  if (apiResult?.ok) return apiResult;

  const tab = await chrome.tabs.create({ url, active: true });
  await waitForTabLoaded(tab.id);
  await sleep(2500);

  const response = await sendMessageWithRetries(tab.id, {
    type: 'STREAL_TIKTOK_DO_COMMENT',
    requestId: request.requestId,
    payload: { ...payload, url, message: text },
  });
  if (response?.ok) return response;

  return {
    ok: false,
    final: true,
    error: conciseSendError(apiResult?.error, response?.error),
    url,
  };
}

async function openTikTokCommentContext(request) {
  const payload = request.payload || {};
  const url = normalizeTikTokUrl({
    ...payload,
    post_url: payload.post_url || payload.comment_url || payload.url,
  });
  if (!url) {
    return {
      ok: false,
      final: true,
      error: 'Thieu link video TikTok de mo dung comment.',
    };
  }

  const tab = await chrome.tabs.create({ url, active: true });
  await waitForTabLoaded(tab.id);
  await sleep(2500);
  const response = await sendMessageWithRetries(tab.id, {
    type: 'STREAL_TIKTOK_FOCUS_COMMENT',
    requestId: request.requestId,
    payload: { ...payload, url },
  });
  if (response?.ok) return response;
  return {
    ok: false,
    final: true,
    url,
    error: response?.error || 'Da mo video TikTok nhung chua dinh vi duoc comment.',
  };
}

async function collectTikTokChannelVideos(request) {
  const payload = request.payload || {};
  const rawChannel = String(payload.channel || payload.channel_url || payload.url || '').trim();
  const maxVideos = Math.max(1, Math.min(Number(payload.max_videos || 20) || 20, 50));
  const handle = rawChannel.match(/tiktok\.com\/@([^/?#]+)/i)?.[1] || rawChannel.replace(/^@+/, '').trim();
  if (!handle) {
    return { ok: false, final: true, error: 'Thieu link kenh TikTok hoac @username de gom video.' };
  }
  const channelUrl = rawChannel.includes('tiktok.com')
    ? rawChannel
    : `${TIKTOK_HOST}/@${encodeURIComponent(handle)}`;

  const tab = await chrome.tabs.create({ url: channelUrl, active: true });
  await waitForTabLoaded(tab.id, 35000);
  await sleep(4000);

  let result = { ok: false, videos: [], error: 'Khong gom duoc video tu trang TikTok.' };
  try {
    const injected = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      args: [maxVideos],
      func: async (limit) => {
        const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
        const normalize = (href) => {
          try {
            const url = new URL(href, window.location.href);
            const match = url.href.match(/\/@([^/?#]+)\/video\/(\d{8,})/);
            if (!match) return null;
            return {
              video_id: match[2],
              post_url: `https://www.tiktok.com/@${match[1]}/video/${match[2]}`,
              channel_name: `@${match[1]}`,
              video_title: '',
            };
          } catch {
            return null;
          }
        };
        const collect = () => {
          const byId = new Map();
          document.querySelectorAll('a[href*="/video/"]').forEach((a) => {
            const item = normalize(a.href);
            if (!item || byId.has(item.video_id)) return;
            const cardText = (a.closest('div')?.innerText || a.getAttribute('title') || '').trim();
            item.video_title = cardText.slice(0, 180) || `Video ${item.video_id}`;
            byId.set(item.video_id, item);
          });
          return Array.from(byId.values());
        };

        window.scrollTo(0, 0);
        await sleep(1000);
        let rows = collect();
        for (let i = 0; i < 18 && rows.length < limit; i += 1) {
          window.scrollBy(0, Math.max(700, window.innerHeight || 900));
          await sleep(1200);
          rows = collect();
        }
        return {
          ok: rows.length > 0,
          videos: rows.slice(0, limit),
          page_title: document.title,
          url: window.location.href,
        };
      },
    });
    result = injected?.[0]?.result || result;
  } catch (error) {
    result = { ok: false, videos: [], error: error?.message || String(error) };
  }

  try {
    const closeResult = chrome.tabs.remove(tab.id);
    if (closeResult?.catch) closeResult.catch(() => {});
  } catch (error) {
    // Khong chan ket qua gom video neu Chrome khong dong duoc tab phu.
  }
  if (!result.ok) {
    return {
      ok: false,
      final: true,
      error: result.error || 'Chrome da mo kenh TikTok nhung khong thay link video. Hay mo kenh cong khai va thu lai.',
      videos: result.videos || [],
    };
  }
  return {
    ok: true,
    final: true,
    videos: result.videos || [],
    url: result.url || channelUrl,
    message: `Da gom ${result.videos?.length || 0} video tu Chrome`,
  };
}

async function collectTikTokDomComments(request) {
  const payload = request.payload || {};
  const maxVideos = Math.max(1, Math.min(Number(payload.max_videos || 8) || 8, 50));
  const limitPerVideo = Math.max(1, Math.min(Number(payload.limit_per_video || 80) || 80, 300));
  let videos = Array.isArray(payload.videos) ? payload.videos : [];
  if (!videos.length) {
    const collected = await collectTikTokChannelVideos({
      requestId: request.requestId,
      payload: {
        channel: payload.channel || payload.channel_url || payload.url || '',
        max_videos: maxVideos,
      },
    });
    if (!collected?.ok || !collected.videos?.length) {
      return {
        ok: false,
        final: true,
        error: collected?.error || 'Khong gom duoc video TikTok bang Chrome.',
        videos: [],
      };
    }
    videos = collected.videos;
  }

  const results = [];
  const cookieInfo = await getTikTokCookies();
  for (const video of videos.slice(0, maxVideos)) {
    const url = normalizeTikTokUrl(video) || String(video.post_url || video.url || '').trim();
    if (!url) continue;
    const apiResult = await fetchTikTokCommentsByApi(video, limitPerVideo, cookieInfo);
    if (apiResult.ok && apiResult.comments.length) {
      results.push({
        ...video,
        video_id: video.video_id || getVideoId(video, url),
        post_url: url,
        video_title: video.video_title || `Video ${getVideoId(video, url)}`,
        comments: apiResult.comments,
        error: '',
        method: 'chrome-api',
      });
      continue;
    }

    const tab = await chrome.tabs.create({ url, active: true });
    await waitForTabLoaded(tab.id, 35000);
    await sleep(3500);

    let result = { ok: false, comments: [], error: 'Khong scrape duoc comment TikTok.' };
    try {
      const injected = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        args: [limitPerVideo],
        func: async (limit) => {
          const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
          const isVisible = (el) => {
            if (!el) return false;
            const rect = el.getBoundingClientRect();
            const style = window.getComputedStyle(el);
            return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
          };
          const normalize = (value) => String(value || '').replace(/\s+/g, ' ').trim();
          const simpleHash = (value) => {
            let hash = 0;
            const text = String(value || '');
            for (let i = 0; i < text.length; i += 1) hash = ((hash << 5) - hash + text.charCodeAt(i)) | 0;
            return Math.abs(hash).toString(36);
          };
          const clickCommentPanel = () => {
            const selectors = [
              '[data-e2e="comment-icon"]',
              'button[aria-label*="comment" i]',
              'button[aria-label*="bình luận" i]',
              'div[role="button"][aria-label*="comment" i]',
            ];
            for (const selector of selectors) {
              const node = Array.from(document.querySelectorAll(selector)).find(isVisible);
              if (node) {
                try { node.click(); } catch {}
                return true;
              }
            }
            return false;
          };
          const findCommentScroller = () => {
            const candidates = [];
            document.querySelectorAll('[data-e2e*="comment"], [class*="Comment"], [class*="comment"], [role="tabpanel"], aside, section, div').forEach((node) => {
              if (!isVisible(node)) return;
              const rect = node.getBoundingClientRect();
              const extra = node.scrollHeight - node.clientHeight;
              if (rect.left < window.innerWidth * 0.45 || rect.height < 220 || rect.width < 240 || extra < 60) return;
              const attr = `${node.className || ''} ${node.getAttribute('data-e2e') || ''}`.toLowerCase();
              const text = normalize(node.innerText || node.textContent || '').slice(0, 400).toLowerCase();
              let score = extra / 20;
              if (attr.includes('comment')) score += 220;
              if (text.includes('bình luận') || text.includes('comment')) score += 120;
              if (text.includes('bạn có thể thích') || text.includes('you may like')) score -= 260;
              candidates.push({ node, score });
            });
            candidates.sort((a, b) => b.score - a.score);
            return candidates[0]?.score >= 120 ? candidates[0].node : null;
          };
          const expandReplies = () => {
            Array.from(document.querySelectorAll('button, [role="button"], div, span')).slice(0, 1500).forEach((node) => {
              if (!isVisible(node)) return;
              const rect = node.getBoundingClientRect();
              if (rect.left < window.innerWidth * 0.45) return;
              const text = normalize(node.innerText || node.textContent || '').toLowerCase();
              if (/xem\s+\d*\s*(câu\s+)?trả\s+lời/.test(text) || /view\s+\d*\s*repl/.test(text)) {
                try { node.click(); } catch {}
              }
            });
          };
          const parseComment = (node, index) => {
            const rect = node.getBoundingClientRect();
            if (rect.left < window.innerWidth * 0.45) return null;
            const rawLines = String(node.innerText || node.textContent || '')
              .split(/\n+/)
              .map((line) => normalize(line))
              .filter(Boolean);
            const lines = rawLines.filter((line) => {
              const lower = line.toLowerCase();
              if (!lower || lower === 'bình luận' || lower === 'comments' || lower === 'bạn có thể thích') return false;
              if (lower.includes('sponsored') || lower.includes('learn more')) return false;
              if (/^\d+\s*bình luận$/.test(lower)) return false;
              return true;
            });
            if (!lines.length) return null;
            const joined = lines.join(' ');
            if (joined.length < 2 || joined.length > 900) return null;
            if (!/(trả lời|reply|giờ trước|phút trước|ngày trước|tuần trước|-\d|^\w)/i.test(joined)) return null;
            const author = lines[0]?.slice(0, 80) || 'Ẩn danh';
            const messageParts = lines.slice(1).filter((line) => {
              const lower = line.toLowerCase();
              if (/^(trả lời|reply|like|thích|xem.*trả lời|view.*repl)/.test(lower)) return false;
              if (/^\d+(\.\d+)?[kmb]?$/.test(lower)) return false;
              if (/^\d+\s*(giây|phút|giờ|ngày|tuần|tháng|năm)\s+trước$/.test(lower)) return false;
              if (/^\d{1,2}-\d{1,2}$/.test(lower)) return false;
              return true;
            });
            const text = normalize(messageParts.join(' ') || lines.slice(1).join(' ') || joined);
            if (!text || text === author || text.length < 2) return null;
            return {
              id: `dom_${simpleHash(`${author}|${text}|${index}`)}`,
              author_name: author,
              author_id: author,
              text,
              depth: 0,
            };
          };
          const collect = () => {
            const byKey = new Map();
            const selectors = [
              '[data-e2e*="comment-level"]',
              '[data-e2e*="comment-item"]',
              '[class*="CommentItem"]',
              '[class*="DivCommentContent"]',
              '[class*="comment-item"]',
              'div',
            ];
            let index = 0;
            for (const selector of selectors) {
              document.querySelectorAll(selector).forEach((node) => {
                if (byKey.size >= limit) return;
                if (!isVisible(node)) return;
                const item = parseComment(node, index);
                index += 1;
                if (!item) return;
                const key = `${item.author_name}|${item.text}`.toLowerCase();
                if (!byKey.has(key)) byKey.set(key, item);
              });
              if (byKey.size >= limit) break;
            }
            return Array.from(byKey.values()).slice(0, limit);
          };

          clickCommentPanel();
          await sleep(1200);
          let scroller = findCommentScroller();
          if (!scroller) {
            return {
              ok: false,
              comments: [],
              comment_count: 0,
              page_title: document.title,
              url: window.location.href,
              error: 'Khong xac dinh duoc panel binh luan TikTok, bo qua de tranh cuon nham video.',
            };
          }
          let rows = collect();
          for (let i = 0; i < 22 && rows.length < limit; i += 1) {
            expandReplies();
            const delta = Math.max(420, Math.floor((scroller.clientHeight || window.innerHeight || 800) * 0.75));
            try { scroller.scrollBy({ top: delta, behavior: 'smooth' }); } catch { scroller.scrollTop += delta; }
            scroller.dispatchEvent(new Event('scroll', { bubbles: false }));
            await sleep(950);
            scroller = findCommentScroller() || scroller;
            rows = collect();
          }
          return {
            ok: rows.length > 0,
            comments: rows,
            comment_count: rows.length,
            page_title: document.title,
            url: window.location.href,
          };
        },
      });
      result = injected?.[0]?.result || result;
    } catch (error) {
      result = { ok: false, comments: [], error: error?.message || String(error) };
    }

    results.push({
      ...video,
      video_id: video.video_id || getVideoId(video, url),
      post_url: url,
      video_title: video.video_title || result.page_title || `Video ${getVideoId(video, url)}`,
      comments: result.comments || [],
      error: result.error || apiResult.error || '',
      method: result.comments?.length ? 'chrome-dom' : 'chrome-dom-failed',
    });

    try {
      const closeResult = chrome.tabs.remove(tab.id);
      if (closeResult?.catch) closeResult.catch(() => {});
    } catch {}
  }

  const totalComments = results.reduce((sum, item) => sum + (item.comments?.length || 0), 0);
  return {
    ok: totalComments > 0,
    final: true,
    videos: results,
    comment_count: totalComments,
    video_count: results.length,
    message: `Chrome da lay ${totalComments} comment tu ${results.length} video TikTok`,
    error: totalComments ? '' : 'Chrome da mo video TikTok nhung chua scrape duoc comment nao tu DOM.',
  };
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === 'STREAL_EXTENSION_GET_FACEBOOK_COOKIE') {
    getFacebookCookies()
      .then((response) => sendResponse(response))
      .catch((error) => sendResponse({ ok: false, cookie: '', error: error?.message || String(error) }));
    return true;
  }
  if (message?.type === 'STREAL_EXTENSION_COLLECT_TIKTOK_VIDEOS') {
    collectTikTokChannelVideos(message)
      .then((response) => sendResponse(response))
      .catch((error) => sendResponse({ ok: false, final: true, error: error?.message || String(error), videos: [] }));
    return true;
  }
  if (message?.type === 'STREAL_EXTENSION_COLLECT_TIKTOK_DOM_COMMENTS') {
    collectTikTokDomComments(message)
      .then((response) => sendResponse(response))
      .catch((error) => sendResponse({ ok: false, final: true, error: error?.message || String(error), videos: [] }));
    return true;
  }
  if (message?.type === 'STREAL_EXTENSION_OPEN_TIKTOK_COMMENT') {
    openTikTokCommentContext(message)
      .then((response) => sendResponse(response))
      .catch((error) => sendResponse({ ok: false, final: true, error: error?.message || String(error) }));
    return true;
  }
  if (message?.type !== 'STREAL_EXTENSION_SEND_COMMENT') return false;
  handleSendComment(message)
    .then((response) => sendResponse(response))
    .catch((error) => sendResponse({ ok: false, final: true, error: error?.message || String(error) }));
  return true;
});
