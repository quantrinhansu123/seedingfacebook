'use client';

import { useCallback, useRef } from 'react';
import './standard-post-panel.css';

const INLINE_HOOK = `
(function () {
  function installDcHook() {
    if (!window.DCLogic || window.DCLogic.__sfHooked) return;
    var proto = window.DCLogic.prototype;
    var originalSetState = proto.setState;
    if (typeof originalSetState !== 'function') return;
    proto.setState = function (patch, callback) {
      var result = originalSetState.call(this, patch, callback);
      if (this.state && Array.isArray(this.state.pages)) window.__sfApp = this;
      return result;
    };
    window.DCLogic.__sfHooked = true;
  }
  installDcHook();
  window.setInterval(installDcHook, 200);
})();
`;

export function StandardPostPanel() {
  const frameRef = useRef<HTMLIFrameElement>(null);

  const injectBridge = useCallback(() => {
    const doc = frameRef.current?.contentDocument;
    if (!doc) return;

    if (!doc.getElementById('sf-dc-hook')) {
      const hook = doc.createElement('script');
      hook.id = 'sf-dc-hook';
      hook.textContent = INLINE_HOOK;
      (doc.head || doc.documentElement).appendChild(hook);
    }

    if (doc.getElementById('sf-bai-viet-bridge')) return;

    const script = doc.createElement('script');
    script.id = 'sf-bai-viet-bridge';
    script.src = `/bai-viet-bridge.js?v=2`;
    (doc.head || doc.documentElement).appendChild(script);
  }, []);

  const handleLoad = useCallback(() => {
    [0, 800, 2000, 4500, 8000, 12000].forEach((delay) => {
      window.setTimeout(injectBridge, delay);
    });
  }, [injectBridge]);

  return (
    <section className="standard-post-shell" aria-label="Bài viết chuẩn">
      <iframe
        ref={frameRef}
        className="standard-post-frame"
        src="/bai-viet-chuan.html"
        title="Bài viết chuẩn"
        loading="eager"
        onLoad={handleLoad}
      />
    </section>
  );
}
