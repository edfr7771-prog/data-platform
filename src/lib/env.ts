import 'server-only';

/** رابط المنصة من البيئة فقط: لا نطاق ثابت في الكود. في الإنتاج يجب ضبطه صراحة. */
export function appUrl(): string {
  const v = process.env.APP_URL;
  if (v) return v.replace(/\/$/, '');
  if (process.env.NODE_ENV === 'production') throw new Error('APP_URL must be set in production');
  return 'http://localhost:3000';
}

export function secret(): string {
  const s = process.env.APP_SECRET;
  if (!s || s.length < 32) throw new Error('APP_SECRET must be set (32+ chars)');
  return s;
}

export const secureCookies = () => appUrl().startsWith('https://');
