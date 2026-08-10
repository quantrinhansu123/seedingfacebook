type FacebookPostMessageParts = {
  title?: string;
  content?: string;
  hashtags?: string;
};

function cleanPart(value?: string): string {
  return String(value || '').replace(/\r\n?/g, '\n').trim();
}

function stripRepeatedTitle(title: string, content: string): string {
  if (!title || !content) return content;
  const foldedTitle = title.toLocaleLowerCase('vi');
  const foldedContent = content.toLocaleLowerCase('vi');
  if (!foldedContent.startsWith(foldedTitle)) return content;

  const remainder = content.slice(title.length);
  // Long headings are distinctive enough to remove even when pasted content has
  // no whitespace between the heading and its first paragraph.
  const hasSafeBoundary = !remainder || /^[\s:;,.!?\-–—]/u.test(remainder);
  if (title.length < 12 && !hasSafeBoundary) return content;
  return remainder.replace(/^[\s:;,.!?\-–—]+/u, '').trim();
}

export function buildFacebookPostMessage({
  title,
  content,
  hashtags,
}: FacebookPostMessageParts): string {
  const cleanTitle = cleanPart(title);
  const cleanContent = stripRepeatedTitle(cleanTitle, cleanPart(content));
  const cleanHashtags = cleanPart(hashtags);
  return [cleanTitle, cleanContent, cleanHashtags].filter(Boolean).join('\n\n');
}
