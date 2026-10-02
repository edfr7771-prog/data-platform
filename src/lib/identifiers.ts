/** توحيد البريد والجوال السعودي. يعيد null إذا كانت الصيغة غير صالحة. */
const AR_DIGITS = '٠١٢٣٤٥٦٧٨٩';

export function toLatinDigits(s: string): string {
  return s.replace(/[٠-٩]/g, (d) => String(AR_DIGITS.indexOf(d)));
}

export function normalizePhone(raw: string): string | null {
  let s = toLatinDigits(raw).replace(/[\s\-()]/g, '');
  if (s.startsWith('00')) s = '+' + s.slice(2);
  if (/^05\d{8}$/.test(s)) return '+966' + s.slice(1);
  if (/^5\d{8}$/.test(s)) return '+966' + s;
  if (/^\+9665\d{8}$/.test(s)) return s;
  if (/^9665\d{8}$/.test(s)) return '+' + s;
  return null;
}

export function normalizeEmail(raw: string): string | null {
  const s = raw.trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(s) && s.length <= 254 ? s : null;
}

export type Identifier = { value: string; channel: 'email' | 'sms' };

export function parseIdentifier(raw: string): Identifier | null {
  const t = (raw ?? '').trim();
  if (!t) return null;
  if (t.includes('@')) {
    const e = normalizeEmail(t);
    return e ? { value: e, channel: 'email' } : null;
  }
  const p = normalizePhone(t);
  return p ? { value: p, channel: 'sms' } : null;
}

/** عرض الجوال محليًا 05XXXXXXXX */
export function displayPhone(p?: string | null): string {
  if (!p) return '';
  return p.startsWith('+966') ? '0' + p.slice(4) : p;
}

export function maskIdentifier(v: string): string {
  if (v.includes('@')) {
    const [u, d] = v.split('@');
    return u.slice(0, 2) + '•••@' + d;
  }
  const local = displayPhone(v);
  return local.slice(0, 3) + '•••••' + local.slice(-2);
}
