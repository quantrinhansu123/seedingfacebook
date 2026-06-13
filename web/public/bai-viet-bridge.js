(function () {
  if (window.__sfBaiVietBridgeV2) return;
  window.__sfBaiVietBridgeV2 = true;

  function installDcHook() {
    if (!window.DCLogic || window.DCLogic.__sfHooked) return;
    const proto = window.DCLogic.prototype;
    const originalSetState = proto.setState;
    if (typeof originalSetState !== 'function') return;
    proto.setState = function sfSetState(patch, callback) {
      const result = originalSetState.call(this, patch, callback);
      if (this.state && Array.isArray(this.state.pages)) window.__sfApp = this;
      return result;
    };
    window.DCLogic.__sfHooked = true;
  }

  installDcHook();
  window.setInterval(installDcHook, 250);

  const HISTORY_KEY = 'seeding-post-history-v2';
  const COLORS = ['#2563eb', '#7c3aed', '#0891b2', '#059669', '#d97706', '#e11d48', '#4f46e5'];

  function apiJson(url, options) {
    return fetch(url, {
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', ...(options && options.headers) },
      ...options,
    }).then(async (res) => {
      let payload = {};
      try {
        payload = await res.json();
      } catch {
        payload = {};
      }
      if (!res.ok) throw new Error(payload.error || 'HTTP ' + res.status);
      return payload;
    });
  }

  function extractSlug(raw) {
    const text = String(raw || '').trim();
    const fromUrl = text.match(/\/groups\/(\d+)/i);
    if (fromUrl) return fromUrl[1];
    const digits = text.match(/(\d{10,})/);
    return digits ? digits[1] : text;
  }

  function initials(name) {
    const parts = String(name || '?').trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return '?';
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  }

  function colorFromId(id) {
    const s = String(id || '0');
    let hash = 0;
    for (let i = 0; i < s.length; i++) hash = (hash + s.charCodeAt(i)) % COLORS.length;
    return COLORS[hash];
  }

  function setReactTextareaValue(textarea, value) {
    if (!textarea) return;
    const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set;
    if (setter) setter.call(textarea, value);
    else textarea.value = value;
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
    textarea.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function showStatus(message) {
    let el = document.getElementById('sf-compose-status');
    if (!el) {
      el = document.createElement('div');
      el.id = 'sf-compose-status';
      el.style.cssText =
        'position:fixed;bottom:18px;left:50%;transform:translateX(-50%);z-index:99999;max-width:min(720px,92vw);padding:10px 14px;border-radius:10px;background:#0f172a;color:#fff;font-size:13px;font-weight:600;box-shadow:0 10px 30px rgba(0,0,0,.2);';
      document.body.appendChild(el);
    }
    el.textContent = message || '';
    el.style.display = message ? 'block' : 'none';
    if (message) {
      window.clearTimeout(showStatus._timer);
      showStatus._timer = window.setTimeout(() => {
        if (el.textContent === message) el.style.display = 'none';
      }, 9000);
    }
  }

  function detectVideoMedia(url) {
    const cleanUrl = String(url || '').trim();
    if (!cleanUrl) return { mediaUrl: '', nativeVideoUrl: '' };
    const isDirectVideo = /\.(mp4|mov|m4v|webm|avi|mkv|flv|wmv|3gp|ogv)(\?|$)/i.test(cleanUrl);
    return isDirectVideo
      ? { mediaUrl: '', nativeVideoUrl: cleanUrl }
      : { mediaUrl: cleanUrl, nativeVideoUrl: '' };
  }

  function buildMessage(state) {
    return [
      String(state.title || '').trim(),
      String(state.content || '').trim(),
      String(state.mediaUrl || '').trim(),
      String(state.hashtags || '').trim(),
    ]
      .filter(Boolean)
      .join('\n\n');
  }

  function appendLocalHistory(row) {
    let local = [];
    try {
      local = JSON.parse(window.localStorage.getItem(HISTORY_KEY) || '[]');
      if (!Array.isArray(local)) local = [];
    } catch {
      local = [];
    }
    local.unshift({
      id: 'local-' + Date.now() + '-' + Math.random().toString(16).slice(2),
      createdAt: new Date().toISOString(),
      ...row,
    });
    window.localStorage.setItem(HISTORY_KEY, JSON.stringify(local.slice(0, 80)));
  }

  async function runAiCaptions(app) {
    const state = getAppState(app);
    const base = String(state.content || '').trim() || String(state.title || '').trim();
    const targets = getSelectedTargets(app);
    if (!base) {
      showStatus('Nhập tiêu đề hoặc nội dung trước khi dùng AI viết bài.');
      return;
    }
    if (!targets.length) {
      showStatus('Chọn ít nhất một nhóm hoặc Page để AI tạo biến thể.');
      return;
    }
    showStatus('AI đang viết bài...');
    try {
      const payload = await apiJson('/api/ai/caption-variants', {
        method: 'POST',
        body: JSON.stringify({ content: base, targets }),
      });
      if (!payload.ok) throw new Error(payload.error || 'AI chưa tạo được biến thể');
      const captions = Array.isArray(payload.captions) ? payload.captions : [];
      const first = captions.find((item) => item.caption)?.caption;
      if (first) {
        app.setState({ content: first });
        setReactTextareaValue(document.querySelector('textarea'), first);
      }
      showStatus(
        'Đã tạo ' + captions.length + ' biến thể nội dung.' + (payload.warning ? ' ' + payload.warning : ''),
      );
    } catch (err) {
      showStatus(err?.message || 'Lỗi AI viết bài');
    }
  }

  function checkLinks(app) {
    const url = String(getAppState(app).mediaUrl || mediaUrlInput()?.value || '').trim();
    if (!url) {
      showStatus('Chưa nhập link ảnh/video để kiểm tra.');
      return;
    }
    try {
      const parsed = new URL(url);
      const isVideo =
        /\.(mp4|mov|m4v|webm)(\?|$)/i.test(parsed.pathname) ||
        /youtube|youtu\.be|tiktok|facebook|fb\.watch|fb\.gg|reel|short/i.test(parsed.hostname);
      showStatus(
        isVideo
          ? 'Link video hợp lệ. Hệ thống sẽ đăng native video nếu có quyền, không thì fallback link preview.'
          : 'Link hợp lệ. Khi đăng, link sẽ được chèn vào bài viết dạng preview.',
      );
    } catch {
      showStatus('Link ảnh/video chưa đúng định dạng URL.');
    }
  }

  function patchActionHandlers(app) {
    if (!app || app.__sfActionsPatched) return;
    app.__sfActionsPatched = true;

    app.postNow = async function postNow() {
      const state = getAppState(this);
      const targets = getSelectedTargets(this);
      const message = buildMessage(state);
      if (!message) {
        showStatus('Nhập nội dung bài viết trước khi đăng.');
        return;
      }
      if (!targets.length) {
        showStatus('Chọn ít nhất một nhóm hoặc Page để đăng.');
        return;
      }
      showStatus('Đang đăng tới ' + targets.length + ' nơi...');
      try {
        const media = detectVideoMedia(state.mediaUrl);
        const payload = await apiJson('/api/publish', {
          method: 'POST',
          body: JSON.stringify({
            message,
            media_url: media.mediaUrl,
            native_video_url: media.nativeVideoUrl,
            targets,
          }),
        });
        if (!payload.results) throw new Error(payload.error || 'Lỗi không xác định từ server');
        const okCount = payload.results.filter((item) => item.ok).length;
        const failCount = payload.results.length - okCount;
        appendLocalHistory({
          title: state.title,
          content: state.content,
          mediaUrl: state.mediaUrl,
          hashtags: state.hashtags,
          scheduledAt: '',
          targets: targets.map((item) => ({ type: item.type, id: item.id, name: item.name })),
          status: failCount ? 'Đã đăng ' + okCount + ', lỗi ' + failCount : 'Đã đăng',
          results: payload.results,
        });
        resetHistoryDomPatch();
        await loadHistory(this);
        patchHistoryActions();
        if (failCount) {
          const lines = payload.results
            .filter((item) => !item.ok)
            .map((item) => (item.name || item.id) + ': ' + (item.error || 'lỗi'))
            .join(' · ');
          showStatus('Đã đăng ' + okCount + '/' + payload.results.length + ', lỗi ' + failCount + '. ' + lines);
        } else {
          showStatus('Đã đăng ' + okCount + '/' + payload.results.length + ' nơi.');
        }
      } catch (err) {
        showStatus(err?.message || 'Không đăng được bài');
      }
    };

    app.postSchedule = async function postSchedule() {
      const state = getAppState(this);
      const targets = getSelectedTargets(this);
      const message = buildMessage(state);
      if (!String(state.title || '').trim() || !String(state.content || '').trim()) {
        showStatus('Nhập đủ tiêu đề và nội dung bài viết trước khi đặt lịch.');
        return;
      }
      if (!String(state.schedule || '').trim()) {
        showStatus('Chọn ngày giờ cần đăng.');
        return;
      }
      if (!targets.length) {
        showStatus('Chọn ít nhất một nhóm hoặc Page để đặt lịch.');
        return;
      }
      showStatus('Đang lưu lịch đăng...');
      try {
        const media = detectVideoMedia(state.mediaUrl);
        const payload = await apiJson('/api/content-pipeline/posts', {
          method: 'POST',
          body: JSON.stringify({
            title: state.title,
            content: state.content,
            media_url: media.mediaUrl,
            native_video_url: media.nativeVideoUrl,
            hashtags: state.hashtags,
            scheduled_at: state.schedule,
            targets,
            status: 'scheduled',
          }),
        });
        if (!payload.ok) throw new Error(payload.error || 'Không lưu được lịch đăng');
        appendLocalHistory({
          title: state.title,
          content: state.content,
          mediaUrl: state.mediaUrl,
          hashtags: state.hashtags,
          scheduledAt: state.schedule,
          targets: targets.map((item) => ({ type: item.type, id: item.id, name: item.name })),
          status: 'Đã lưu lịch',
        });
        resetHistoryDomPatch();
        await loadHistory(this);
        patchHistoryActions();
        showStatus('Đã lưu lịch đăng. Hệ thống sẽ tự đăng khi tới giờ.');
      } catch (err) {
        showStatus(err?.message || 'Không đặt lịch được');
      }
    };
  }

  function bindToolbarButtons(app) {
    if (!app) return;
    document.querySelectorAll('button').forEach((btn) => {
      const text = (btn.textContent || '').replace(/\s+/g, ' ').trim();
      if (btn.dataset.sfToolbarBound === '1') return;

      const bind = (handler) => {
        btn.dataset.sfToolbarBound = '1';
        btn.addEventListener(
          'click',
          (event) => {
            event.preventDefault();
            event.stopImmediatePropagation();
            handler();
          },
          true,
        );
      };

      if (text.includes('Đăng ngay')) {
        bind(() => void app.postNow.call(app));
        return;
      }
      if (text.includes('Đặt lịch') && !text.includes('Đặt lịch đăng')) {
        bind(() => void app.postSchedule.call(app));
        return;
      }
      if (text.includes('AI viết bài')) {
        bind(() => void runAiCaptions(app));
        return;
      }
      if (text.includes('Check links')) {
        bind(() => checkLinks(app));
      }
    });
  }

  function setReactInputValue(input, value) {
    if (!input) return;
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
    if (setter) setter.call(input, value);
    else input.value = value;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function setMediaUrl(url) {
    const app = findApp();
    setReactInputValue(mediaUrlInput(), url);
    if (app) app.setState({ mediaUrl: url });
    window.__sfLastMediaUrl = url;
    patchMediaPreview(url);
  }

  const MEDIA_PLACEHOLDER_HTML =
    '<svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"></rect><circle cx="9" cy="9" r="2"></circle><path d="m21 15-3.6-3.6a2 2 0 0 0-2.8 0L6 20"></path></svg>' +
    '<div style="font-size:12.5px;font-weight:600;">Ảnh / video sẽ hiển thị ở đây</div>';

  function youtubeId(url) {
    try {
      const parsed = new URL(url.trim());
      if (parsed.hostname.includes('youtu.be')) return parsed.pathname.replace(/^\//, '').split('/')[0] || '';
      if (parsed.hostname.includes('youtube.com')) return parsed.searchParams.get('v') || '';
    } catch {
      return '';
    }
    return '';
  }

  function resolveMediaPreview(url) {
    const candidate = String(url || '').trim();
    if (!candidate) return { kind: 'none' };

    const yt = youtubeId(candidate);
    if (yt) {
      return {
        kind: 'youtube',
        embedUrl: 'https://www.youtube.com/embed/' + yt,
        poster: 'https://img.youtube.com/vi/' + yt + '/hqdefault.jpg',
      };
    }

    if (/\.(mp4|mov|m4v|webm)(\?|$)/i.test(candidate)) {
      return { kind: 'video', src: candidate };
    }

    if (
      /\.(jpg|jpeg|png|gif|webp|bmp|svg)(\?|$)/i.test(candidate) ||
      /^blob:/i.test(candidate) ||
      /supabase|comment-images|uploads|storage/i.test(candidate)
    ) {
      return { kind: 'image', src: candidate };
    }

    if (/youtube|youtu\.be|tiktok|facebook|fb\.|instagram/i.test(candidate)) {
      return { kind: 'link', src: candidate };
    }

    return { kind: 'image', src: candidate };
  }

  function findMediaPreviewBox() {
    const marked = document.querySelector('[data-sf-preview-box="1"]');
    if (marked) return marked;
    const box = [...document.querySelectorAll('div[style*="aspect-ratio"]')].find((node) =>
      node.textContent?.includes('Ảnh / video'),
    );
    if (box) box.dataset.sfPreviewBox = '1';
    return box;
  }

  function patchMediaPreview(forcedUrl) {
    const app = findApp();
    const inputUrl = mediaUrlInput()?.value || '';
    const url = String(forcedUrl ?? window.__sfLastMediaUrl ?? app?.state?.mediaUrl ?? inputUrl).trim();
    const box = findMediaPreviewBox();
    if (!box) return;
    const isPlaceholder = box.textContent?.includes('Ảnh / video sẽ hiển thị');
    const hasMedia = !!box.querySelector('img, video, iframe');
    if (box.dataset.sfMediaUrl === url && !isPlaceholder && (url ? hasMedia : true)) return;
    box.dataset.sfMediaUrl = url;

    const preview = resolveMediaPreview(url);

    box.style.display = 'flex';
    box.style.flexDirection = 'column';
    box.style.alignItems = 'center';
    box.style.justifyContent = 'center';
    box.style.overflow = 'hidden';
    box.style.background = 'linear-gradient(135deg,#dbe3ef,#c7d2e0)';
    box.style.color = '#7c8aa0';

    if (preview.kind === 'none') {
      box.innerHTML = MEDIA_PLACEHOLDER_HTML;
      return;
    }

    if (preview.kind === 'image') {
      box.style.display = 'block';
      box.style.background = '#0f172a';
      box.innerHTML =
        '<img src="' +
        preview.src.replace(/"/g, '&quot;') +
        '" alt="Preview ảnh" style="width:100%;height:100%;object-fit:contain;display:block;background:#0f172a;" />';
      const img = box.querySelector('img');
      if (img) {
        img.onerror = () => {
          box.style.display = 'flex';
          box.style.background = 'linear-gradient(135deg,#dbe3ef,#c7d2e0)';
          box.innerHTML =
            '<div style="padding:14px;text-align:center;font-size:12px;font-weight:600;color:#475569;">Không tải được preview ảnh.<br><a href="' +
            preview.src.replace(/"/g, '&quot;') +
            '" target="_blank" rel="noreferrer" style="color:#2563eb;">Mở link</a></div>';
        };
      }
      return;
    }

    if (preview.kind === 'video') {
      box.style.display = 'block';
      box.style.background = '#000';
      box.innerHTML =
        '<video src="' +
        preview.src.replace(/"/g, '&quot;') +
        '" controls playsinline style="width:100%;height:100%;object-fit:contain;display:block;background:#000;"></video>';
      return;
    }

    if (preview.kind === 'youtube') {
      box.style.display = 'block';
      box.style.background = '#000';
      box.innerHTML =
        '<iframe src="' +
        preview.embedUrl.replace(/"/g, '&quot;') +
        '" title="YouTube preview" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen style="width:100%;height:100%;border:0;display:block;background:#000;"></iframe>';
      return;
    }

    box.innerHTML =
      '<div style="padding:18px;text-align:center;display:flex;flex-direction:column;gap:8px;align-items:center;justify-content:center;height:100%;">' +
      '<svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path></svg>' +
      '<div style="font-size:12px;font-weight:700;color:#475569;">Link preview video</div>' +
      '<a href="' +
      preview.src.replace(/"/g, '&quot;') +
      '" target="_blank" rel="noreferrer" style="font-size:12px;color:#2563eb;word-break:break-all;">' +
      preview.src +
      '</a></div>';
  }

  function bindMediaUrlInput() {
    const input = mediaUrlInput();
    if (!input || input.dataset.sfMediaBound === '1') return;
    input.dataset.sfMediaBound = '1';
    const sync = () => {
      window.__sfLastMediaUrl = input.value;
      patchMediaPreview(input.value);
    };
    input.addEventListener('input', sync);
    input.addEventListener('change', sync);
    sync();
  }

  function findApp() {
    installDcHook();
    if (window.__sfApp && typeof window.__sfApp.setState === 'function') return window.__sfApp;

    const roots = [document.querySelector('x-dc'), document.body];
    for (const root of roots) {
      if (!root) continue;
      for (const key of Object.keys(root)) {
        const val = root[key];
        if (val && typeof val.setState === 'function' && Array.isArray(val.state?.pages)) {
          window.__sfApp = val;
          return val;
        }
      }
    }

    for (const node of document.querySelectorAll('*')) {
      const key = Object.keys(node).find((k) => k.startsWith('__reactFiber$') || k.startsWith('__reactInternalInstance$'));
      if (!key) continue;
      let fiber = node[key];
      for (let depth = 0; depth < 48 && fiber; depth++) {
        const inst = fiber.stateNode;
        if (inst && typeof inst.setState === 'function' && inst.state && Array.isArray(inst.state.pages)) {
          window.__sfApp = inst;
          return inst;
        }
        fiber = fiber.return;
      }
    }
    return null;
  }

  function mediaUrlInput() {
    return document.querySelector(
      'input[placeholder*="YouTube"], input[placeholder*="link ảnh"], input[placeholder*="TikTok"]',
    );
  }

  function readComposeStateFromDom() {
    const titleInput = [...document.querySelectorAll('input')].find((input) =>
      /tiêu đề/i.test(input.placeholder || ''),
    );
    const hashtagInput = [...document.querySelectorAll('input')].find((input) =>
      /guitar|#/i.test(input.value || '') && input !== titleInput && input !== mediaUrlInput(),
    );
    return {
      title: titleInput?.value || '',
      content: document.querySelector('textarea')?.value || '',
      mediaUrl: mediaUrlInput()?.value || '',
      hashtags: hashtagInput?.value || '',
      schedule: document.querySelector('input[type="datetime-local"]')?.value || '',
    };
  }

  function getAppState(app) {
    if (app?.state) return app.state;
    return readComposeStateFromDom();
  }

  function getSelectedTargets(app) {
    const pages = app?.state?.pages;
    if (Array.isArray(pages) && pages.length) {
      return pages
        .filter((item) => item.selected)
        .map((item) => ({
          type: item.targetType || (item.type === 'Page' ? 'page' : 'group'),
          id: String(item.id),
          name: item.name || item.id,
        }));
    }

    const targets = [];
    document.querySelectorAll('div[onclick]').forEach((row) => {
      const style = row.getAttribute('style') || '';
      if (!style.includes('eff6ff')) return;
      const name = row.querySelector('div[style*="font-weight:700"]')?.textContent?.trim();
      const typeText = row.querySelector('span[style*="text-transform:uppercase"]')?.textContent?.trim() || '';
      if (!name) return;
      targets.push({
        type: /page/i.test(typeText) ? 'page' : 'group',
        id: name,
        name,
      });
    });
    return targets;
  }

  function mapGroup(row) {
    const name = row.name || row.id;
    return {
      id: String(row.id),
      name,
      type: 'Nhóm',
      count: 'Facebook Group',
      initials: initials(name),
      color: colorFromId(row.id),
      selected: true,
      targetType: 'group',
    };
  }

  function mapPage(row) {
    const name = row.name || row.id;
    return {
      id: String(row.id),
      name,
      type: 'Page',
      count: 'Facebook Page',
      initials: initials(name),
      color: colorFromId(row.id),
      selected: false,
      targetType: 'page',
    };
  }

  async function loadTargets(app) {
    const [groupsPayload, pagesPayload] = await Promise.all([
      apiJson('/api/groups').catch(() => []),
      apiJson('/api/pages').catch(() => []),
    ]);
    const groups = Array.isArray(groupsPayload) ? groupsPayload : [];
    const pages = Array.isArray(pagesPayload) ? pagesPayload : [];
    const prevSelected = {};
    (app.state.pages || []).forEach((item) => {
      prevSelected[String(item.id)] = !!item.selected;
    });
    const merged = [...groups.map(mapGroup), ...pages.map(mapPage)].filter((item) => item.id);
    merged.forEach((item) => {
      if (prevSelected[item.id] !== undefined) item.selected = prevSelected[item.id];
    });
    app.setState({ pages: merged });
  }

  async function addGroup() {
    const app = findApp();
    if (!app) return;
    const raw = window.prompt('Nhập link nhóm Facebook hoặc ID nhóm:');
    if (!raw || !raw.trim()) return;
    const slug = extractSlug(raw);
    try {
      const resolved = await apiJson('/api/groups/resolve?slug=' + encodeURIComponent(slug));
      if (!resolved.ok && !resolved.id) throw new Error(resolved.error || 'Không tìm được nhóm');
      const gid = String(resolved.id || slug);
      const gname = resolved.name || gid;
      await apiJson('/api/groups', {
        method: 'POST',
        body: JSON.stringify({ id: gid, name: gname }),
      });
      await loadTargets(app);
      window.alert('Đã thêm nhóm: ' + gname);
    } catch (err) {
      if (/^\d{10,}$/.test(slug)) {
        const gname = window.prompt('Tên hiển thị cho nhóm ' + slug + ':', slug) || slug;
        try {
          await apiJson('/api/groups', {
            method: 'POST',
            body: JSON.stringify({ id: slug, name: gname }),
          });
          await loadTargets(app);
          window.alert('Đã thêm nhóm: ' + gname);
          return;
        } catch (inner) {
          window.alert(inner?.message || 'Không thêm được nhóm');
          return;
        }
      }
      window.alert(err?.message || 'Không thêm được nhóm');
    }
  }

  function formatSchedule(value) {
    if (!value) return '-';
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return String(value);
    return parsed.toLocaleString('vi-VN');
  }

  function statusTone(status) {
    const s = String(status || '').toLowerCase();
    if (s.includes('lỗi') || s.includes('fail') || s.includes('thất bại')) return 'red';
    if (s.includes('lịch') || s.includes('sched') || s.includes('draft')) return 'blue';
    return 'green';
  }

  async function loadHistory(app) {
    const pipeline = await apiJson('/api/content-pipeline').catch(() => ({ posts: [] }));
    const posts = Array.isArray(pipeline.posts) ? pipeline.posts : [];
    let local = [];
    try {
      local = JSON.parse(window.localStorage.getItem(HISTORY_KEY) || '[]');
      if (!Array.isArray(local)) local = [];
    } catch {
      local = [];
    }

    const rows = [];
    const seen = new Set();

    posts.forEach((post) => {
      const id = String(post.id || '');
      if (!id || seen.has(id)) return;
      seen.add(id);
      rows.push({
        _id: id,
        _source: 'pipeline',
        title: post.article_title || post.title || 'Bài đăng',
        content: post.content || '',
        media: post.media_url || post.article_url || '',
        schedule: formatSchedule(post.scheduled_at || post.created_at),
        place: (post.scheduled_targets || []).map((t) => t.name || t.id).filter(Boolean).join(', ') || '-',
        status: post.status || 'draft',
        tone: statusTone(post.status),
        _raw: post,
      });
    });

    local.forEach((row) => {
      const id = String(row.id || '');
      if (!id || seen.has(id)) return;
      seen.add(id);
      rows.push({
        _id: id,
        _source: 'local',
        title: row.title || 'Bài đăng',
        content: row.content || '',
        media: row.mediaUrl || '',
        schedule: formatSchedule(row.scheduledAt || row.createdAt),
        place: (row.targets || []).map((t) => t.name || t.id).filter(Boolean).join(', ') || '-',
        status: row.status || 'local',
        tone: statusTone(row.status),
        _raw: row,
      });
    });

    window.__sfHistoryRows = rows;
    app.setState({ history: rows });
    window.__sfHistoryDomReady = false;
  }

  function btnStyle(bg, color) {
    return 'font-size:11px;font-weight:700;color:' + color + ';background:' + bg + ';border:1px solid ' + color + '22;padding:4px 8px;border-radius:7px;cursor:pointer;font-family:inherit;';
  }

  function resetHistoryDomPatch() {
    document.querySelectorAll('[data-sf-history-patched]').forEach((el) => {
      delete el.dataset.sfHistoryPatched;
      if (el.lastElementChild?.dataset?.sfActionHeader) el.lastElementChild.remove();
    });
    document.querySelectorAll('[data-sf-action-row]').forEach((row) => {
      delete row.dataset.sfActionRow;
      const actionCell = row.querySelector('[data-sf-action-cell]');
      if (actionCell) actionCell.remove();
      row.style.gridTemplateColumns = '1.5fr 1.7fr 1.2fr 1fr 1.1fr 1fr';
    });
  }

  function patchHistoryActions() {
    const history = window.__sfHistoryRows || [];
    if (!history.length) return;

    const headerCell = [...document.querySelectorAll('div')].find(
      (el) => el.textContent?.trim() === 'Tiêu đề' && el.parentElement?.style?.display === 'grid',
    );
    if (!headerCell) return;
    const headerRow = headerCell.parentElement;
    if (!headerRow.dataset.sfHistoryPatched) {
      headerRow.dataset.sfHistoryPatched = '1';
      headerRow.style.gridTemplateColumns = '1.5fr 1.7fr 1.2fr 1fr 1.1fr 1fr 0.75fr';
      const th = document.createElement('div');
      th.dataset.sfActionHeader = '1';
      th.style.cssText = 'padding:12px 16px;font-size:10.5px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;color:#94a3b8;';
      th.textContent = 'Thao tác';
      headerRow.appendChild(th);
    }

    const container = headerRow.parentElement;
    if (!container) return;

    [...container.querySelectorAll(':scope > div')].forEach((row) => {
      if (row === headerRow || row.dataset.sfActionRow) return;
      if (!row.style.gridTemplateColumns || !row.style.gridTemplateColumns.includes('1.5fr')) return;
      const title = row.children[0]?.textContent?.trim();
      if (!title) return;
      const item = history.find((h) => h.title === title);
      if (!item) return;

      row.dataset.sfActionRow = '1';
      row.style.gridTemplateColumns = '1.5fr 1.7fr 1.2fr 1fr 1.1fr 1fr 0.75fr';

      const cell = document.createElement('div');
      cell.dataset.sfActionCell = '1';
      cell.style.cssText = 'padding:10px 16px;display:flex;gap:6px;align-items:center;flex-wrap:wrap;';

      const editBtn = document.createElement('button');
      editBtn.type = 'button';
      editBtn.textContent = 'Sửa';
      editBtn.style.cssText = btnStyle('#eff6ff', '#2563eb');
      editBtn.onclick = () => void editHistoryItem(item);

      const delBtn = document.createElement('button');
      delBtn.type = 'button';
      delBtn.textContent = 'Xóa';
      delBtn.style.cssText = btnStyle('#fff1f2', '#e11d48');
      delBtn.onclick = () => void deleteHistoryItem(item);

      cell.appendChild(editBtn);
      cell.appendChild(delBtn);
      row.appendChild(cell);
    });
  }

  async function editHistoryItem(item) {
    const title = window.prompt('Tiêu đề bài viết:', item.title || '');
    if (title === null) return;
    const content = window.prompt('Nội dung bài viết:', item.content || '');
    if (content === null) return;
    const media = window.prompt('Link ảnh/video:', item.media || '');
    if (media === null) return;

    try {
      if (item._source === 'pipeline') {
        await apiJson('/api/content-pipeline/posts/' + encodeURIComponent(item._id), {
          method: 'PATCH',
          body: JSON.stringify({
            article_title: title,
            content,
            media_url: media,
            article_url: media,
          }),
        });
      } else {
        let local = [];
        try {
          local = JSON.parse(window.localStorage.getItem(HISTORY_KEY) || '[]');
        } catch {
          local = [];
        }
        local = local.map((row) =>
          String(row.id) === String(item._id)
            ? { ...row, title, content, mediaUrl: media }
            : row,
        );
        window.localStorage.setItem(HISTORY_KEY, JSON.stringify(local));
      }
      const app = findApp();
      if (app) {
        resetHistoryDomPatch();
        await loadHistory(app);
        patchHistoryActions();
      }
      window.alert('Đã cập nhật bài viết.');
    } catch (err) {
      window.alert(err?.message || 'Không sửa được bài viết');
    }
  }

  async function deleteHistoryItem(item) {
    if (!window.confirm('Xóa bài "' + (item.title || 'này') + '"?')) return;
    try {
      if (item._source === 'pipeline') {
        await apiJson('/api/content-pipeline/posts/' + encodeURIComponent(item._id), { method: 'DELETE' });
      } else {
        let local = [];
        try {
          local = JSON.parse(window.localStorage.getItem(HISTORY_KEY) || '[]');
        } catch {
          local = [];
        }
        local = local.filter((row) => String(row.id) !== String(item._id));
        window.localStorage.setItem(HISTORY_KEY, JSON.stringify(local));
      }
      const app = findApp();
      if (app) {
        resetHistoryDomPatch();
        await loadHistory(app);
        patchHistoryActions();
      }
    } catch (err) {
      window.alert(err?.message || 'Không xóa được bài viết');
    }
  }

  function injectAddGroupButton() {
    if (document.getElementById('sf-add-group-btn')) return;
    const header = [...document.querySelectorAll('div')].find(
      (el) => el.textContent?.includes('Chọn nhóm / Page') && el.querySelector('button'),
    );
    if (!header) return;
    const btnWrap = header.querySelector('div[style*="display:flex"]');
    if (!btnWrap) return;
    const btn = document.createElement('button');
    btn.id = 'sf-add-group-btn';
    btn.type = 'button';
    btn.textContent = 'Thêm nhóm';
    btn.style.cssText = 'font-size:12px;font-weight:700;color:#fff;background:#2563eb;border:none;padding:5px 11px;border-radius:7px;cursor:pointer;font-family:inherit;';
    btn.onclick = () => void addGroup();
    btnWrap.insertBefore(btn, btnWrap.firstChild);
  }

  async function uploadImage(file) {
    const form = new FormData();
    form.append('image', file);
    const res = await fetch('/api/uploads/comment-image', { method: 'POST', body: form, credentials: 'include' });
    const payload = await res.json().catch(() => ({}));
    if (!res.ok || !payload.ok || !payload.image_url) throw new Error(payload.error || 'Upload ảnh thất bại');
    return payload.image_url;
  }

  function bindFileInput(input) {
    if (!input || input.dataset.sfBound === '1') return;
    input.dataset.sfBound = '1';
    input.accept = 'image/jpeg,image/png,image/webp,image/gif';
    const label = input.closest('label') || input.parentElement;

    const setStatus = (text) => {
      const title = label?.querySelector('div[style*="font-weight:700"]');
      if (title) title.textContent = text;
    };

    const onFile = async (file) => {
      if (!file) return;
      if (!file.type.startsWith('image/')) {
        window.alert('Chỉ hỗ trợ upload ảnh JPG/PNG/WebP/GIF.');
        return;
      }
      setStatus('Đang upload ảnh...');
      const blobUrl = URL.createObjectURL(file);
      patchMediaPreview(blobUrl);
      try {
        const url = await uploadImage(file);
        URL.revokeObjectURL(blobUrl);
        setMediaUrl(url);
        setStatus('Đã tải ảnh lên');
        window.setTimeout(() => setStatus('Kéo thả / chọn ảnh'), 1800);
      } catch (err) {
        URL.revokeObjectURL(blobUrl);
        patchMediaPreview('');
        setStatus('Kéo thả / chọn ảnh');
        window.alert(err?.message || 'Upload ảnh thất bại');
      }
    };

    input.addEventListener('change', () => {
      void onFile(input.files?.[0]);
      input.value = '';
    });
    if (label) {
      label.addEventListener('dragover', (e) => e.preventDefault());
      label.addEventListener('drop', (e) => {
        e.preventDefault();
        void onFile(e.dataTransfer?.files?.[0]);
      });
    }
  }

  function bindDropzones() {
    document.querySelectorAll('label').forEach((label) => {
      if (!label.textContent?.includes('Kéo thả') || label.dataset.sfDropBound === '1') return;
      const input = label.querySelector('input[type="file"]');
      if (!input) return;
      label.dataset.sfDropBound = '1';
      label.style.cursor = 'pointer';
      bindFileInput(input);
    });
  }

  function scanFileInputs() {
    document.querySelectorAll('input[type="file"]').forEach(bindFileInput);
    bindDropzones();
  }

  async function bootstrap() {
    installDcHook();
    scanFileInputs();
    bindMediaUrlInput();
    patchMediaPreview();

    const app = findApp();
    if (!app) return;

    injectAddGroupButton();
    patchActionHandlers(app);
    bindToolbarButtons(app);
    if (!window.__sfDataLoaded) {
      window.__sfDataLoaded = true;
      try {
        await loadTargets(app);
        await loadHistory(app);
      } catch (err) {
        console.error('[bai-viet-bridge] load failed', err);
      }
    }
    patchHistoryActions();
    patchMediaPreview();
  }

  bootstrap();
  window.setInterval(() => { void bootstrap(); }, 2000);
  new MutationObserver(() => { void bootstrap(); }).observe(document.body, { childList: true, subtree: true });
})();
