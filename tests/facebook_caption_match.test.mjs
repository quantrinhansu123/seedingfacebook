import assert from 'node:assert/strict';
import test from 'node:test';

await import('../browser-extension/facebook-caption-match.js');

const { normalizeCaptionText, textMatches } = globalThis.STREALFacebookCaptionMatcher;

test('normalizes Facebook invisible characters and whitespace', () => {
  assert.equal(normalizeCaptionText('  Tiêu\u200B đề\n\nNội dung\u2060 ❤️\uFE0F  '), 'Tiêu đề Nội dung ❤');
});

test('matches a caption after Facebook rebuilds paragraph boundaries', () => {
  const expected = 'Tiêu đề bài viết\n\nNội dung cần đăng lên Facebook\n\n#fsolution';
  const actual = 'Tiêu\u200B đề bài viếtNội dung cần đăng lên Facebook#fsolution';
  assert.equal(textMatches(actual, expected), true);
});

test('accepts one complete caption inside editor text', () => {
  assert.equal(textMatches('Mở đầu Caption đầy đủ Kết thúc', 'Caption đầy đủ'), true);
});

test('rejects duplicated captions', () => {
  const caption = 'Tiêu đề dài Nội dung bài viết đầy đủ để kiểm tra đăng Facebook an toàn.';
  assert.equal(textMatches(`${caption} ${caption}`, caption), false);
});

test('rejects captions with a missing middle section', () => {
  const expected = 'Mở đầu bài viết Nội dung ở giữa rất quan trọng và không được phép mất Phần kết thúc bài viết';
  const actual = 'Mở đầu bài viết Phần kết thúc bài viết';
  assert.equal(textMatches(actual, expected), false);
});

test('rejects captions with a small missing fragment', () => {
  const expected = 'Đây là nội dung hoàn chỉnh cần được giữ nguyên khi đăng bài lên Facebook.';
  const actual = 'Đây là nội dung hoàn chỉnh cần giữ nguyên khi đăng bài lên Facebook.';
  assert.equal(textMatches(actual, expected), false);
});
