(() => {
  const SOURCE = 'streal-web-page';
  const EXTENSION_SOURCE = 'streal-tiktok-extension';

  function postToPage(payload) {
    window.postMessage({ ...payload, source: EXTENSION_SOURCE }, window.location.origin);
  }

  window.addEventListener('message', (event) => {
    if (event.source !== window) return;
    const data = event.data || {};
    if (data.source !== SOURCE) return;

    if (data.type === 'STREAL_TIKTOK_BRIDGE_PING') {
      postToPage({
        type: 'STREAL_TIKTOK_BRIDGE_READY',
        requestId: data.requestId || '',
        version: chrome.runtime.getManifest().version,
      });
      return;
    }

    if (data.type === 'STREAL_FACEBOOK_COOKIE_REQUEST') {
      chrome.runtime.sendMessage(
        {
          type: 'STREAL_EXTENSION_GET_FACEBOOK_COOKIE',
          requestId: data.requestId,
        },
        (response) => {
          if (chrome.runtime.lastError) {
            postToPage({
              type: 'STREAL_FACEBOOK_COOKIE_RESPONSE',
              requestId: data.requestId,
              ok: false,
              error: chrome.runtime.lastError.message || 'Extension khong phan hoi',
            });
            return;
          }
          postToPage({
            type: 'STREAL_FACEBOOK_COOKIE_RESPONSE',
            requestId: data.requestId,
            ...(response || { ok: false, error: 'Extension khong tra cookie' }),
          });
        },
      );
      return;
    }

    if (data.type === 'STREAL_TIKTOK_COLLECT_VIDEOS_REQUEST') {
      chrome.runtime.sendMessage(
        {
          type: 'STREAL_EXTENSION_COLLECT_TIKTOK_VIDEOS',
          requestId: data.requestId,
          payload: data.payload || {},
        },
        (response) => {
          if (chrome.runtime.lastError) {
            postToPage({
              type: 'STREAL_TIKTOK_COLLECT_VIDEOS_RESPONSE',
              requestId: data.requestId,
              ok: false,
              videos: [],
              error: chrome.runtime.lastError.message || 'Extension khong phan hoi',
            });
            return;
          }
          postToPage({
            type: 'STREAL_TIKTOK_COLLECT_VIDEOS_RESPONSE',
            requestId: data.requestId,
            ...(response || { ok: false, videos: [], error: 'Extension khong tra danh sach video' }),
          });
        },
      );
      return;
    }

    if (data.type === 'STREAL_TIKTOK_OPEN_COMMENT_REQUEST') {
      chrome.runtime.sendMessage(
        {
          type: 'STREAL_EXTENSION_OPEN_TIKTOK_COMMENT',
          requestId: data.requestId,
          payload: data.payload || {},
        },
        (response) => {
          if (chrome.runtime.lastError) {
            postToPage({
              type: 'STREAL_TIKTOK_OPEN_COMMENT_RESPONSE',
              requestId: data.requestId,
              ok: false,
              error: chrome.runtime.lastError.message || 'Extension khong phan hoi',
            });
            return;
          }
          postToPage({
            type: 'STREAL_TIKTOK_OPEN_COMMENT_RESPONSE',
            requestId: data.requestId,
            ...(response || { ok: false, error: 'Extension khong mo duoc comment TikTok' }),
          });
        },
      );
      return;
    }

    if (data.type !== 'STREAL_TIKTOK_COMMENT_REQUEST') return;

    chrome.runtime.sendMessage(
      {
        type: 'STREAL_EXTENSION_SEND_COMMENT',
        requestId: data.requestId,
        payload: data.payload || {},
      },
      (response) => {
        if (chrome.runtime.lastError) {
          postToPage({
            type: 'STREAL_TIKTOK_COMMENT_RESPONSE',
            requestId: data.requestId,
            ok: false,
            error: chrome.runtime.lastError.message || 'Extension khong phan hoi',
          });
          return;
        }
        postToPage({
          type: 'STREAL_TIKTOK_COMMENT_RESPONSE',
          requestId: data.requestId,
          ...(response || { ok: false, error: 'Extension khong tra ket qua' }),
        });
      },
    );
  });
})();
