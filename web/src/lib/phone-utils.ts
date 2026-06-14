const PHONE_RE = /(?<!\d)(?:\+?84|0)(?:[\s.\-()]?\d){8,10}(?!\d)/g;

export function normalizePhone(raw: string): string {
  let digits = (raw || '').replace(/\D/g, '');
  if (digits.startsWith('0084')) digits = `0${digits.slice(4)}`;
  else if (digits.startsWith('84') && (digits.length === 11 || digits.length === 12)) digits = `0${digits.slice(2)}`;
  if ((digits.length === 10 || digits.length === 11) && digits.startsWith('0')) return digits;
  return '';
}

export function extractPhones(text: string): string[] {
  const seen = new Set<string>();
  const phones: string[] = [];
  for (const match of text.matchAll(PHONE_RE)) {
    const phone = normalizePhone(match[0]);
    if (phone && !seen.has(phone)) {
      seen.add(phone);
      phones.push(phone);
    }
  }
  return phones;
}

export function phonesForComment(row: { phone?: string; phones?: string[] }): string[] {
  if (row.phones?.length) return row.phones;
  if (row.phone) return [row.phone];
  return [];
}
