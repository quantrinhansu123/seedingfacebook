(() => {
  const INVISIBLE_CHARACTERS = /[\u00AD\u200B-\u200D\u2060\uFE0E\uFE0F\uFEFF]/g;

  function normalizeCaptionText(value) {
    return String(value || '')
      .normalize('NFC')
      .replace(INVISIBLE_CHARACTERS, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function compactCaptionText(value) {
    return normalizeCaptionText(value).replace(/\s+/g, '');
  }

  function containsOnce(actual, expected) {
    const first = actual.indexOf(expected);
    return first >= 0 && first === actual.lastIndexOf(expected);
  }

  function textMatches(actualValue, expectedValue) {
    const actual = normalizeCaptionText(actualValue);
    const expected = normalizeCaptionText(expectedValue);
    if (!actual || !expected) return false;
    if (actual === expected || containsOnce(actual, expected)) return true;

    // Facebook Lexical can rebuild paragraphs and insert zero-width characters,
    // causing innerText to lose whitespace at DOM boundaries. Compare a compact
    // representation while still rejecting duplicated or missing text.
    const actualCompact = compactCaptionText(actual);
    const expectedCompact = compactCaptionText(expected);
    return containsOnce(actualCompact, expectedCompact);
  }

  globalThis.STREALFacebookCaptionMatcher = Object.freeze({
    normalizeCaptionText,
    textMatches,
  });
})();
