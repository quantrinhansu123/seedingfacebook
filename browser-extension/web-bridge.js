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
