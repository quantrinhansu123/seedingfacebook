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

  const tab = await chrome.tabs.create({ url, active: true });
  await waitForTabLoaded(tab.id);
  await sleep(2500);

  const response = await sendMessageWithRetries(tab.id, {
    type: 'STREAL_TIKTOK_DO_COMMENT',
    requestId: request.requestId,
    payload: { ...payload, url, message: text },
  });
  if (response?.ok) return response;
  return publishCommentFromBackground({ ...payload, message: text }, url, response?.error || '');
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
