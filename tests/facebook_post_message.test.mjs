import assert from 'node:assert/strict';
import test from 'node:test';

import { buildFacebookPostMessage } from '../web/src/lib/facebook-post-message.ts';

test('keeps title, body and hashtags in separate paragraphs', () => {
  assert.equal(
    buildFacebookPostMessage({
      title: 'Tiêu đề bài viết',
      content: 'Nội dung bài viết',
      hashtags: '#demo',
    }),
    'Tiêu đề bài viết\n\nNội dung bài viết\n\n#demo',
  );
});

test('does not repeat a long title already pasted at the start of content', () => {
  const title = 'Tự động chuyển địa chỉ cũ sang địa chỉ mới';
  assert.equal(
    buildFacebookPostMessage({
      title,
      content: `${title}Nhận thấy các anh/chị xử lý dữ liệu gặp khó khăn.`,
    }),
    `${title}\n\nNhận thấy các anh/chị xử lý dữ liệu gặp khó khăn.`,
  );
});

test('does not remove a short title that is only a word prefix', () => {
  assert.equal(
    buildFacebookPostMessage({ title: 'Sale', content: 'Salesforce là một nền tảng.' }),
    'Sale\n\nSalesforce là một nền tảng.',
  );
});
