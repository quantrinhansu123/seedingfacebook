const TIKTOK_HOST = 'https://www.tiktok.com';

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeTikTokUrl(payload) {
  const rawUrl = String(payload.post_url || payload.video_url || payload.url || '').trim();
  if (rawUrl && rawUrl.includes('tiktok.com')) return rawUrl;
  const videoId = String(payload.video_id || payload.post_id || '').replace(/^tiktok_/, '').trim();
  if (videoId) return `${TIKTOK_HOST}/@/video/${encodeURIComponent(videoId)}`;
  return '';
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
    return { ok: false, final: true, error: 'Thieu link hoac ID video TikTok' };
  }
  if (!text) {
    return { ok: false, final: true, error: 'Nhap noi dung binh luan truoc khi gui' };
  }

  const tab = await chrome.tabs.create({ url, active: true });
  await waitForTabLoaded(tab.id);
  await sleep(2500);

  return sendMessageWithRetries(tab.id, {
    type: 'STREAL_TIKTOK_DO_COMMENT',
    requestId: request.requestId,
    payload: { ...payload, url, message: text },
  });
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type !== 'STREAL_EXTENSION_SEND_COMMENT') return false;
  handleSendComment(message)
    .then((response) => sendResponse(response))
    .catch((error) => sendResponse({ ok: false, final: true, error: error?.message || String(error) }));
  return true;
});
