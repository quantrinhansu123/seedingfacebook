(() => {
  if (window.__strealFacebookGroupAssistantLoaded) return;
  window.__strealFacebookGroupAssistantLoaded = true;

  const state = {
    requestId: '',
    taskId: '',
    targetType: 'group',
    groupId: '',
    groupName: '',
    message: '',
    media: [],
    editor: null,
    dialog: null,
    postClickedAt: 0,
    completionTimer: null,
    autoSubmitTimer: null,
    submissionAutomatic: false,
    preSubmitFailureNotices: new Set(),
    preparedKey: '',
    mediaAttachedCount: 0,
    cancelledRequestIds: new Set(),
  };

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const normalize = (value) => String(value || '').replace(/\s+/g, ' ').trim();
  const captionTextMatches = globalThis.STREALFacebookCaptionMatcher?.textMatches
    || ((actual, expected) => normalize(actual) === normalize(expected));

  function isVisible(node) {
    if (!(node instanceof Element)) return false;
    const rect = node.getBoundingClientRect();
    const style = window.getComputedStyle(node);
    return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
  }

  function showStatus(message, tone = 'info') {
    let panel = document.getElementById('streal-facebook-assistant-status');
    if (!panel) {
      panel = document.createElement('div');
      panel.id = 'streal-facebook-assistant-status';
      Object.assign(panel.style, {
        position: 'fixed',
        right: '18px',
        bottom: '18px',
        zIndex: '2147483647',
        maxWidth: '360px',
        padding: '12px 14px',
        borderRadius: '12px',
        boxShadow: '0 12px 36px rgba(15, 23, 42, .28)',
        font: '600 14px/1.45 Arial, sans-serif',
        whiteSpace: 'pre-line',
      });
      document.documentElement.appendChild(panel);
    }
    panel.style.background = tone === 'error' ? '#fee2e2' : tone === 'success' ? '#dcfce7' : '#eff6ff';
    panel.style.color = tone === 'error' ? '#991b1b' : tone === 'success' ? '#166534' : '#1e3a8a';
    panel.textContent = message;
  }

  function sendProgress(status, extra = {}) {
    chrome.runtime.sendMessage({
      type: 'STREAL_FACEBOOK_GROUP_QUEUE_EVENT',
      requestId: state.requestId,
      taskId: state.taskId,
      targetType: state.targetType,
      targetId: state.groupId,
      targetName: state.groupName,
      groupId: state.groupId,
      groupName: state.groupName,
      status,
      ...extra,
    });
  }

  const COMPOSER_TITLES = ['tạo bài viết', 'create post', 'đăng bài'];
  const COMMENT_PHRASES = ['bình luận', 'comment', 'trả lời', 'reply'];

  function nodeText(node) {
    return normalize(`${node?.getAttribute?.('aria-label') || ''} ${node?.innerText || node?.textContent || ''}`).toLowerCase();
  }

  function isCommentControl(node) {
    const label = nodeText(node);
    return COMMENT_PHRASES.some((phrase) => label.includes(phrase));
  }

  function composerDialogScore(dialog) {
    if (!isVisible(dialog)) return -1;
    const headings = Array.from(dialog.querySelectorAll('[role="heading"], h1, h2, h3'))
      .filter(isVisible)
      .map(nodeText);
    const hasComposerHeading = headings.some((heading) => COMPOSER_TITLES.includes(heading));
    if (!hasComposerHeading) return -1;

    let score = 100;
    const dialogLabel = normalize(dialog.getAttribute('aria-label') || '').toLowerCase();
    if (COMPOSER_TITLES.some((title) => dialogLabel.includes(title))) score += 30;
    if (Array.from(dialog.querySelectorAll('[contenteditable="true"]')).some((node) => isVisible(node) && !isCommentControl(node))) {
      score += 20;
    }
    const text = nodeText(dialog);
    if (text.includes('thêm vào bài viết') || text.includes('add to your post')) score += 10;
    return score;
  }

  function findComposerDialog() {
    const dialogs = Array.from(document.querySelectorAll('[role="dialog"]')).filter(isVisible);
    const scored = dialogs
      .map((dialog) => ({ dialog, score: composerDialogScore(dialog) }))
      .filter((item) => item.score >= 100)
      .sort((a, b) => b.score - a.score);
    return scored[0]?.dialog || null;
  }

  function findComposerEditors(dialog) {
    if (!dialog || composerDialogScore(dialog) < 100) return null;
    const candidates = Array.from(dialog.querySelectorAll('[contenteditable="true"][role="textbox"], [contenteditable="true"]'))
      .filter((node) => isVisible(node) && !isCommentControl(node))
      .map((node) => {
        const label = nodeText(node);
        if (label.includes('search') || label.includes('tìm kiếm')) return { node, score: -1 };
        let score = node.getAttribute('role') === 'textbox' ? 20 : 0;
        if (node.hasAttribute('data-lexical-editor')) score += 10;
        if (['bạn viết gì đi', 'bạn đang nghĩ gì', "what's on your mind", 'write something']
          .some((phrase) => label.includes(phrase))) score += 50;
        return { node, score };
      })
      .filter((item) => item.score >= 0)
      .sort((a, b) => b.score - a.score);
    return candidates.map((item) => item.node);
  }

  function findComposerEditor(dialog) {
    return findComposerEditors(dialog)?.[0] || null;
  }

  function findComposerEditorContainingMessage(dialog, message) {
    const candidates = [state.editor, ...(findComposerEditors(dialog) || [])]
      .filter((node, index, items) => node?.isConnected && isVisible(node) && items.indexOf(node) === index);
    return candidates.find((node) => editorContainsMessage(node, message)) || null;
  }

  function findComposerTrigger() {
    const phrases = [
      'bạn viết gì đi',
      'bạn đang nghĩ gì',
      'viết gì đó',
      'tạo bài viết',
      'write something',
      "what's on your mind",
      'create post',
    ];
    const nodes = Array.from(document.querySelectorAll('[role="button"], button, [tabindex="0"]'));
    const candidates = nodes
      .filter((node) => {
        if (!isVisible(node) || node.closest('[role="dialog"], [role="article"]') || isCommentControl(node)) return false;
        const text = nodeText(node);
        return phrases.some((phrase) => text.includes(phrase));
      })
      .map((node) => {
        const text = nodeText(node);
        let score = node.closest('main, [role="main"]') ? 20 : 0;
        if (['bạn viết gì đi', 'bạn đang nghĩ gì', "what's on your mind", 'write something']
          .some((phrase) => text.includes(phrase))) score += 80;
        if (text === 'tạo bài viết' || text === 'create post') score += 20;
        return { node, score };
      })
      .sort((a, b) => b.score - a.score);
    return candidates[0]?.node || null;
  }

  function editorContainsMessage(editor, message) {
    return captionTextMatches(editor?.innerText || editor?.textContent, message);
  }

  function selectEditorContents(editor) {
    editor.focus();
    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(editor);
    selection.removeAllRanges();
    selection.addRange(range);
  }

  function clearEditor(editor) {
    selectEditorContents(editor);
    try {
      document.execCommand('delete', false);
    } catch {
      // The DOM fallback below clears editors that ignore execCommand.
    }
    if (normalize(editor.innerText || editor.textContent)) {
      editor.replaceChildren();
      editor.dispatchEvent(new InputEvent('input', {
        bubbles: true,
        inputType: 'deleteContentBackward',
        data: null,
      }));
    }
  }

  async function setEditorText(editor, message) {
    if (editorContainsMessage(editor, message)) return true;

    // Facebook currently uses Lexical. Its paste handler is more stable than
    // mutating innerHTML and preserves the blank line between title and body.
    clearEditor(editor);
    try {
      selectEditorContents(editor);
      const transfer = new DataTransfer();
      transfer.setData('text/plain', message);
      editor.dispatchEvent(new ClipboardEvent('paste', {
        bubbles: true,
        cancelable: true,
        clipboardData: transfer,
      }));
    } catch {
      // Continue with execCommand when synthetic paste is unavailable.
    }
    await sleep(150);

    if (!editorContainsMessage(editor, message)) {
      clearEditor(editor);
      try {
        selectEditorContents(editor);
        document.execCommand('insertText', false, message);
      } catch {
        // Continue with the paragraph-by-paragraph fallback below.
      }
      await sleep(100);
    }

    if (!editorContainsMessage(editor, message)) {
      clearEditor(editor);
      try {
        const lines = message.replace(/\r\n?/g, '\n').split('\n');
        lines.forEach((line, index) => {
          if (line) document.execCommand('insertText', false, line);
          if (index < lines.length - 1) document.execCommand('insertParagraph', false);
        });
      } catch {
        // Continue with the DOM fallback below.
      }
      await sleep(100);
    }

    if (!editorContainsMessage(editor, message)) {
      const fragment = document.createDocumentFragment();
      message.replace(/\r\n?/g, '\n').split('\n').forEach((line) => {
        const row = document.createElement('div');
        if (line) row.textContent = line;
        else row.appendChild(document.createElement('br'));
        fragment.appendChild(row);
      });
      editor.replaceChildren(fragment);
      editor.dispatchEvent(new InputEvent('input', {
        bubbles: true,
        inputType: 'insertFromPaste',
        data: null,
      }));
      await sleep(100);
    }
    editor.dispatchEvent(new Event('change', { bubbles: true }));
    return editorContainsMessage(editor, message);
  }

  function normalizeMedia(items) {
    return (Array.isArray(items) ? items : [])
      .slice(0, 10)
      .map((item) => ({
        url: String(item?.url || '').trim(),
        type: item?.type === 'video' ? 'video' : 'image',
        name: String(item?.name || '').trim(),
      }))
      .filter((item) => /^https?:\/\//i.test(item.url));
  }

  function mediaExtension(type, mimeType) {
    const byMime = {
      'image/jpeg': 'jpg',
      'image/png': 'png',
      'image/webp': 'webp',
      'image/gif': 'gif',
      'video/mp4': 'mp4',
      'video/quicktime': 'mov',
      'video/webm': 'webm',
    };
    return byMime[String(mimeType || '').toLowerCase()] || (type === 'video' ? 'mp4' : 'jpg');
  }

  function mediaFilename(item, index, mimeType) {
    let filename = item.name;
    if (!filename) {
      try {
        filename = decodeURIComponent(new URL(item.url).pathname.split('/').pop() || '');
      } catch {
        filename = '';
      }
    }
    filename = filename.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').trim();
    const extension = mediaExtension(item.type, mimeType);
    if (!filename) filename = `facebook-media-${index + 1}.${extension}`;
    if (!/\.[a-z0-9]{2,5}$/i.test(filename)) filename = `${filename}.${extension}`;
    return filename;
  }

  async function downloadMediaFile(item, index) {
    const response = await fetch(item.url, {
      method: 'GET',
      credentials: 'omit',
      cache: 'no-store',
    });
    if (!response.ok) throw new Error(`không tải được ${item.name || `media ${index + 1}`} (HTTP ${response.status})`);
    const blob = await response.blob();
    if (!blob.size) throw new Error(`${item.name || `media ${index + 1}`} là file rỗng`);
    const fallbackMime = item.type === 'video' ? 'video/mp4' : 'image/jpeg';
    const mimeType = blob.type || fallbackMime;
    if (!/^(image|video)\//i.test(mimeType)) {
      throw new Error(`${item.name || `media ${index + 1}`} không phải file ảnh/video trực tiếp`);
    }
    return new File([blob], mediaFilename(item, index, mimeType), {
      type: mimeType,
      lastModified: Date.now(),
    });
  }

  function findMediaInput(dialog) {
    if (!dialog || composerDialogScore(dialog) < 100) return null;
    const roots = [dialog];
    const candidates = [];
    roots.forEach((root, rootIndex) => {
      root.querySelectorAll('input[type="file"]').forEach((input) => {
        if (candidates.some((item) => item.input === input)) return;
        const accept = String(input.getAttribute('accept') || '').toLowerCase();
        if (!accept.includes('image') && !accept.includes('video')) return;
        let score = rootIndex === 0 ? 20 : 0;
        if (accept.includes('image')) score += 8;
        if (accept.includes('video')) score += 8;
        if (input.multiple) score += 3;
        candidates.push({ input, score });
      });
    });
    candidates.sort((a, b) => b.score - a.score);
    return candidates[0]?.input || null;
  }

  function findNewDetachedMediaInput(previousInputs) {
    const freshInputs = Array.from(document.querySelectorAll('input[type="file"]')).filter((input) => {
      if (previousInputs.has(input)) return false;
      const accept = String(input.getAttribute('accept') || '').toLowerCase();
      return accept.includes('image') || accept.includes('video');
    });
    // Facebook occasionally mounts the picker in a portal outside the dialog.
    // Only accept an unambiguous input created by our media-button click so an
    // existing comment attachment control can never be selected.
    return freshInputs.length === 1 ? freshInputs[0] : null;
  }

  function findMediaTrigger(dialog) {
    if (!dialog) return null;
    const phrases = ['ảnh/video', 'ảnh hoặc video', 'photo/video', 'photo or video', 'add photos', 'add photo'];
    return Array.from(dialog.querySelectorAll('button, [role="button"], [aria-label]')).find((node) => {
      if (!isVisible(node)) return false;
      const text = normalize(`${node.getAttribute('aria-label') || ''} ${node.innerText || node.textContent || ''}`).toLowerCase();
      return phrases.some((phrase) => text.includes(phrase));
    }) || null;
  }

  async function waitForMediaInput(dialog) {
    if (!dialog || composerDialogScore(dialog) < 100) return null;
    let input = findMediaInput(dialog);
    if (input) return input;
    const previousInputs = new Set(document.querySelectorAll('input[type="file"]'));
    const trigger = findMediaTrigger(dialog);
    if (trigger) trigger.click();
    for (let attempt = 0; attempt < 20 && !input; attempt += 1) {
      await sleep(250);
      input = findMediaInput(dialog) || findNewDetachedMediaInput(previousInputs);
    }
    return input;
  }

  async function attachMedia(dialog, items) {
    if (!items.length) return { ok: true, attachedCount: 0, previewDetected: true, mediaNodeCountBefore: 0 };
    const input = await waitForMediaInput(dialog);
    if (!input) return { ok: false, error: 'Không tìm thấy nút chọn ảnh/video trong hộp soạn bài Facebook.' };

    const files = [];
    for (let index = 0; index < items.length; index += 1) {
      showStatus(`Đang tải media ${index + 1}/${items.length} cho ${state.groupName}...`);
      try {
        files.push(await downloadMediaFile(items[index], index));
      } catch (error) {
        return { ok: false, error: error?.message || String(error) };
      }
    }

    const transfer = new DataTransfer();
    files.forEach((file) => transfer.items.add(file));
    const mediaNodeCountBefore = dialog.querySelectorAll('img, video').length;
    let assignedCount = 0;
    try {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'files')?.set;
      if (setter) setter.call(input, transfer.files);
      else input.files = transfer.files;
      assignedCount = Number(input.files?.length || 0);
      if (assignedCount < files.length) {
        return { ok: false, error: 'Facebook không nhận đủ danh sách file ảnh/video.' };
      }
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
    } catch (error) {
      return { ok: false, error: `Facebook không nhận danh sách media: ${error?.message || String(error)}` };
    }

    for (let attempt = 0; attempt < 24; attempt += 1) {
      if (!dialog?.isConnected) return { ok: false, error: 'Hộp soạn bài Facebook đã đóng khi đang gắn media.' };
      const mediaNodeCount = dialog.querySelectorAll('img, video').length;
      const hasMediaControl = Array.from(dialog.querySelectorAll('button, [role="button"], [aria-label]')).some((node) => {
        const label = normalize(`${node.getAttribute('aria-label') || ''} ${node.innerText || node.textContent || ''}`).toLowerCase();
        return ['xóa ảnh', 'xóa video', 'remove photo', 'remove video', 'chỉnh sửa', 'edit photo'].some((phrase) => label.includes(phrase));
      });
      if (mediaNodeCount > mediaNodeCountBefore || hasMediaControl) {
        return { ok: true, attachedCount: assignedCount, previewDetected: true, mediaNodeCountBefore };
      }
      await sleep(250);
    }
    // Facebook often consumes and clears input.files immediately after accepting the
    // change event. Keep the successful hand-off, then let the auto-submit guard wait
    // for a visible preview before it is allowed to click Post.
    return { ok: true, attachedCount: assignedCount, previewDetected: false, mediaNodeCountBefore };
  }

  async function preparePost(payload) {
    const nextRequestId = String(payload.requestId || '');
    const nextTaskId = String(payload.taskId || '');
    const nextTargetType = payload.targetType === 'page' ? 'page' : 'group';
    const nextGroupId = String(payload.targetId || payload.groupId || '');
    const nextGroupName = String(payload.targetName || payload.groupName || nextGroupId || 'Facebook');
    const nextMessage = String(payload.message || '').trim();
    const nextMedia = normalizeMedia(payload.media);
    const preparedKey = `${nextRequestId}:${nextTaskId}`;
    if (state.cancelledRequestIds.has(nextRequestId)) {
      return { ok: false, final: true, cancelled: true };
    }

    if (
      state.preparedKey === preparedKey
      && state.dialog?.isConnected
      && composerDialogScore(state.dialog) >= 100
      && state.editor?.isConnected
      && editorContainsMessage(state.editor, nextMessage)
    ) {
      return { ok: true, ready: true, auto_submit: true, media_attached_count: state.mediaAttachedCount };
    }

    state.requestId = nextRequestId;
    state.taskId = nextTaskId;
    state.targetType = nextTargetType;
    state.groupId = nextGroupId;
    state.groupName = nextGroupName;
    state.message = nextMessage;
    state.media = nextMedia;
    state.preparedKey = '';
    state.mediaAttachedCount = 0;
    state.postClickedAt = 0;
    state.submissionAutomatic = false;
    if (state.completionTimer) clearInterval(state.completionTimer);
    if (state.autoSubmitTimer) clearTimeout(state.autoSubmitTimer);
    state.autoSubmitTimer = null;

    if (!state.message) return { ok: false, error: 'Bài đăng chưa có nội dung.' };

    showStatus(`Đang chuẩn bị bài cho ${state.groupName}...`);
    let dialog = findComposerDialog();
    let editor = findComposerEditor(dialog);
    if (!editor) {
      const trigger = findComposerTrigger();
      if (!trigger) {
        const error = state.targetType === 'page'
          ? 'Không tìm thấy ô tạo bài viết trên Page. Hãy kiểm tra quyền quản trị/chế độ dùng Facebook với tư cách Page.'
          : 'Không tìm thấy ô tạo bài viết. Hãy kiểm tra đã tham gia Group và tải lại trang.';
        showStatus(error, 'error');
        return { ok: false, error };
      }
      trigger.click();
      for (let attempt = 0; attempt < 30 && !editor; attempt += 1) {
        await sleep(300);
        dialog = findComposerDialog();
        editor = findComposerEditor(dialog);
      }
    }
    if (!editor) {
      const error = 'Facebook đã mở nhưng chưa xuất hiện ô nhập bài viết.';
      showStatus(error, 'error');
      return { ok: false, error };
    }
    if (state.cancelledRequestIds.has(nextRequestId)) {
      return { ok: false, final: true, cancelled: true };
    }

    const filled = await setEditorText(editor, state.message);
    if (!filled) {
      const error = 'Không điền được caption. Hãy dán nội dung thủ công rồi bấm Đăng.';
      showStatus(error, 'error');
      return { ok: false, error };
    }
    if (state.cancelledRequestIds.has(nextRequestId)) {
      return { ok: false, final: true, cancelled: true };
    }

    state.editor = editor;
    state.dialog = dialog;
    const mediaResult = await attachMedia(state.dialog, state.media);
    if (state.cancelledRequestIds.has(nextRequestId)) {
      return { ok: false, final: true, cancelled: true };
    }
    if (!mediaResult.ok) {
      const error = `Không gắn được media: ${mediaResult.error}`;
      showStatus(`${error}\nHàng đợi đã dừng để tránh đăng bài thiếu ảnh/video.`, 'error');
      sendProgress('media_error', { error });
      return { ok: false, final: true, error };
    }

    state.preparedKey = preparedKey;
    state.mediaAttachedCount = mediaResult.attachedCount;

    const mediaHint = mediaResult.attachedCount
      ? ` và chọn ${mediaResult.attachedCount} media`
      : '';
    const previewHint = mediaResult.attachedCount && !mediaResult.previewDetected
      ? '\nĐang đợi Facebook hiển thị đủ preview media.'
      : '';
    showStatus(`Đã điền caption${mediaHint} cho ${state.groupName}.${previewHint}\nExtension sẽ tự bấm Đăng khi bài viết sẵn sàng.`);
    state.autoSubmitTimer = setTimeout(() => {
      state.autoSubmitTimer = null;
      autoSubmitPreparedPost(preparedKey, {
        attachedCount: mediaResult.attachedCount,
        mediaNodeCountBefore: Number(mediaResult.mediaNodeCountBefore || 0),
        previewDetected: Boolean(mediaResult.previewDetected),
      }).catch((error) => {
        failAutomaticSubmission(preparedKey, error?.message || String(error));
      });
    }, 1200);
    return {
      ok: true,
      ready: true,
      auto_submit: true,
      media_attached_count: mediaResult.attachedCount,
    };
  }

  function resolvePostButton(node) {
    const element = node instanceof Element ? node : node?.parentElement;
    const button = element?.closest?.('button, [role="button"]') || null;
    if (!button || !isVisible(button)) return null;
    if (button.matches(':disabled, [aria-disabled="true"]')) return null;
    const label = normalize(button.getAttribute('aria-label') || '').toLowerCase();
    const text = normalize(button.innerText || button.textContent || '').toLowerCase();
    const postLabels = ['đăng', 'đăng bài viết', 'post', 'publish'];
    if (![label, text].some((value) => postLabels.includes(value))) return null;

    // Facebook can replace the Lexical editor node after a synthetic paste. Do
    // not require the cached editor element to still be inside the dialog when
    // the user clicks Post. Validate the current composer dialog instead.
    const buttonDialog = button.closest('[role="dialog"]');
    const storedDialogMatches = state.dialog?.isConnected
      && isVisible(state.dialog)
      && state.dialog.contains(button);
    const currentDialogMatches = buttonDialog && composerDialogScore(buttonDialog) >= 100;
    if (!storedDialogMatches && !currentDialogMatches) return null;
    return { button, dialog: buttonDialog || state.dialog };
  }

  function findPostButton(dialog) {
    if (!dialog || composerDialogScore(dialog) < 100) return null;
    const candidates = Array.from(dialog.querySelectorAll('button, [role="button"]'));
    for (const candidate of candidates) {
      const match = resolvePostButton(candidate);
      if (match) return match;
    }
    return null;
  }

  function hasMediaPreview(dialog, mediaNodeCountBefore) {
    if (!dialog?.isConnected || composerDialogScore(dialog) < 100) return false;
    if (dialog.querySelectorAll('img, video').length > mediaNodeCountBefore) return true;
    return Array.from(dialog.querySelectorAll('button, [role="button"], [aria-label]')).some((node) => {
      const label = nodeText(node);
      return ['xóa ảnh', 'xóa video', 'remove photo', 'remove video', 'chỉnh sửa ảnh', 'edit photo']
        .some((phrase) => label.includes(phrase));
    });
  }

  function failAutomaticSubmission(preparedKey, error) {
    if (state.preparedKey !== preparedKey || state.cancelledRequestIds.has(state.requestId)) return;
    state.preparedKey = '';
    state.postClickedAt = 0;
    state.submissionAutomatic = false;
    showStatus(`${error}\nHàng đợi đã dừng để tránh đăng sai hoặc đăng lặp.`, 'error');
    sendProgress('auto_submit_error', { error });
  }

  function beginPostSubmission(match, automatic = false) {
    if (!match || !state.requestId || !state.preparedKey || state.postClickedAt) return false;
    state.dialog = match.dialog;
    state.postClickedAt = Date.now();
    state.submissionAutomatic = automatic;
    state.preSubmitFailureNotices = new Set(
      collectPostFailures().map((notice) => notice.toLowerCase()),
    );
    showStatus(`Đang chờ Facebook xác nhận bài tại ${state.groupName}...`);
    sendProgress('submitting', { automatic });
    watchForCompletion();
    return true;
  }

  async function autoSubmitPreparedPost(preparedKey, mediaState) {
    let stableReadyChecks = 0;
    let lastReason = 'Không tìm thấy nút Đăng hợp lệ trong hộp soạn bài Facebook.';
    for (let attempt = 0; attempt < 60; attempt += 1) {
      if (state.cancelledRequestIds.has(state.requestId) || state.preparedKey !== preparedKey) return;
      const dialog = state.dialog?.isConnected && composerDialogScore(state.dialog) >= 100
        ? state.dialog
        : findComposerDialog();
      const editor = findComposerEditorContainingMessage(dialog, state.message);
      const captionReady = Boolean(editor);
      const previewReady = !mediaState.attachedCount
        || mediaState.previewDetected
        || hasMediaPreview(dialog, mediaState.mediaNodeCountBefore);
      const match = findPostButton(dialog);

      if (!captionReady) lastReason = 'Không xác nhận được caption trong hộp soạn bài Facebook.';
      else if (!previewReady) lastReason = 'Facebook chưa hiển thị preview ảnh/video nên extension không tự đăng.';
      else if (!match) lastReason = 'Nút Đăng chưa xuất hiện hoặc vẫn đang bị vô hiệu hóa.';

      if (captionReady && previewReady && match) {
        state.editor = editor;
        stableReadyChecks += 1;
        if (stableReadyChecks >= 2) {
          if (!beginPostSubmission(match, true)) return;
          try {
            match.button.click();
          } catch (error) {
            state.postClickedAt = 0;
            failAutomaticSubmission(preparedKey, `Không tự bấm được nút Đăng: ${error?.message || String(error)}`);
          }
          return;
        }
      } else {
        stableReadyChecks = 0;
      }
      await sleep(500);
    }
    failAutomaticSubmission(preparedKey, `${lastReason} Đã chờ 30 giây.`);
  }

  function detectPostOutcome() {
    const noticeText = Array.from(document.querySelectorAll('[role="alert"], [role="status"]'))
      .filter(isVisible)
      .map((node) => normalize(node.innerText || node.textContent || '').toLowerCase())
      .join(' ');
    const pendingPhrases = [
      'chờ phê duyệt',
      'chờ kiểm duyệt',
      'chờ quản trị viên',
      'pending approval',
      'submitted for approval',
      'waiting for approval',
    ];
    if (pendingPhrases.some((phrase) => noticeText.includes(phrase))) return 'pending_review';
    const publishedPhrases = [
      'đã đăng',
      'đã chia sẻ',
      'post published',
      'post was published',
      'successfully posted',
    ];
    if (publishedPhrases.some((phrase) => noticeText.includes(phrase))) return 'published';
    return 'submitted';
  }

  function collectPostFailures() {
    const notices = Array.from(document.querySelectorAll('[role="alert"], [role="status"]'))
      .filter(isVisible)
      .map((node) => normalize(node.innerText || node.textContent))
      .filter(Boolean);
    const failurePhrases = [
      'không thể đăng',
      'không thể chia sẻ',
      'đã xảy ra lỗi',
      'thử lại sau',
      'tạm thời bị chặn',
      'chúng tôi hạn chế tần suất',
      "couldn't post",
      'unable to post',
      'something went wrong',
      'try again later',
      'temporarily blocked',
      'we limit how often',
    ];
    return notices.filter((notice) => {
      const normalizedNotice = notice.toLowerCase();
      return failurePhrases.some((phrase) => normalizedNotice.includes(phrase));
    });
  }

  function detectPostFailure() {
    return collectPostFailures().find(
      (notice) => !state.preSubmitFailureNotices.has(notice.toLowerCase()),
    ) || '';
  }

  function watchForCompletion() {
    if (state.completionTimer) clearInterval(state.completionTimer);
    state.completionTimer = setInterval(() => {
      if (!state.postClickedAt) return;
      const facebookFailure = detectPostFailure();
      if (facebookFailure) {
        clearInterval(state.completionTimer);
        state.completionTimer = null;
        state.postClickedAt = 0;
        state.preparedKey = '';
        const error = `Facebook từ chối đăng: ${facebookFailure}`;
        showStatus(`${error}\nHàng đợi đã dừng.`, 'error');
        sendProgress('facebook_error', { error, automatic: state.submissionAutomatic });
        return;
      }
      const dialogGone = !state.dialog || !state.dialog.isConnected || !isVisible(state.dialog);
      if (dialogGone) {
        clearInterval(state.completionTimer);
        state.completionTimer = null;
        setTimeout(() => {
          const delayedFailure = detectPostFailure();
          if (delayedFailure) {
            state.preparedKey = '';
            const error = `Facebook từ chối đăng: ${delayedFailure}`;
            showStatus(`${error}\nHàng đợi đã dừng.`, 'error');
            sendProgress('facebook_error', { error, automatic: state.submissionAutomatic });
            return;
          }
          const outcome = detectPostOutcome();
          const outcomeText = outcome === 'pending_review'
            ? 'Facebook báo đang chờ kiểm duyệt'
            : outcome === 'published' ? 'Facebook báo đã đăng' : 'đã gửi thao tác đăng';
          showStatus(`Đã ghi nhận ${state.groupName}: ${outcomeText}. Đang chuyển nơi tiếp theo...`, 'success');
          sendProgress('confirmed', {
            confirmedAt: new Date().toISOString(),
            outcome,
            automatic: state.submissionAutomatic,
          });
        }, 800);
        return;
      }
      if (Date.now() - state.postClickedAt > 45000) {
        clearInterval(state.completionTimer);
        state.completionTimer = null;
        state.postClickedAt = 0;
        state.preparedKey = '';
        const error = 'Facebook chưa xác nhận đăng xong sau 45 giây.';
        showStatus(`${error}\nHàng đợi đã dừng để tránh đăng lặp.`, 'error');
        sendProgress('confirmation_timeout', { error, automatic: state.submissionAutomatic });
      }
    }, 500);
  }

  function handlePostIntent(event) {
    if (!state.requestId || !state.preparedKey || state.postClickedAt) return;
    const match = resolvePostButton(event.target);
    if (!match) return;
    // Capture pointerdown as well as click because Facebook may replace/remove
    // the composer during its own click handler before a later listener runs.
    beginPostSubmission(match, false);
  }

  document.addEventListener('pointerdown', handlePostIntent, true);
  document.addEventListener('click', handlePostIntent, true);

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === 'STREAL_FACEBOOK_CANCEL_GROUP_POST') {
      if (!message.requestId || message.requestId !== state.requestId) {
        sendResponse({ ok: true, alreadyStopped: true });
        return false;
      }
      if (state.completionTimer) clearInterval(state.completionTimer);
      if (state.autoSubmitTimer) clearTimeout(state.autoSubmitTimer);
      state.cancelledRequestIds.add(message.requestId);
      state.completionTimer = null;
      state.autoSubmitTimer = null;
      state.requestId = '';
      state.taskId = '';
      state.preparedKey = '';
      state.postClickedAt = 0;
      state.submissionAutomatic = false;
      state.preSubmitFailureNotices = new Set();
      showStatus('Đã hủy hàng đợi đăng Facebook. Bài chưa đăng sẽ không tự chuyển sang nơi khác.', 'error');
      sendResponse({ ok: true, cancelled: true });
      return false;
    }
    if (message?.type !== 'STREAL_FACEBOOK_PREPARE_GROUP_POST') return false;
    preparePost(message.payload || {})
      .then((response) => sendResponse(response))
      .catch((error) => sendResponse({ ok: false, error: error?.message || String(error) }));
    return true;
  });
})();
