/** أدوات تطبيع النص العربي والأرقام: نقية وقابلة للاختبار */
const AR = '٠١٢٣٤٥٦٧٨٩', FA = '۰۱۲۳۴۵۶۷۸۹';

export function toLatinDigits(s: string): string {
  return s.replace(/[٠-٩]/g, (d) => String(AR.indexOf(d))).replace(/[۰-۹]/g, (d) => String(FA.indexOf(d))).replace(/٫/g, '.').replace(/٬/g, ',');
}

export function normalizeArabic(s: string): string {
  return toLatinDigits(String(s ?? '')).normalize('NFKC')
    .replace(/[\u064B-\u065F\u0670\u0640]/g, '')            // تشكيل وتطويل
    .replace(/[إأآٱ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه').replace(/ؤ/g, 'و').replace(/ئ/g, 'ي')
    .replace(/\s+/g, ' ').trim().toLowerCase();
}

export function levenshtein(a: string, b: string): number {
  const m = a.length, n = b.length;
  if (!m) return n; if (!n) return m;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[n];
}

/** يحوّل نصًا مثل «1,250,000 ريال» أو «١٫٥ مليون» إلى رقم. يعيد null إن لم يكن رقمًا صالحًا. */
export function parseNumber(input: unknown): number | null {
  if (typeof input === 'number') return Number.isFinite(input) ? input : null;
  let s = toLatinDigits(String(input ?? '')).trim().toLowerCase();
  if (!s) return null;
  let mult = 1;
  if (/مليون|million/.test(s)) mult = 1e6; else if (/الف|ألف|thousand/.test(s)) mult = 1e3;
  s = s.replace(/ريال|ر\.?\s?س|sar|sr|م2|م²|متر مربع|متر|مليون|million|الف|ألف|thousand|سنه|سنة|سنوات|m2|sqm/g, '').replace(/[\s,،]/g, '');
  if (!/^-?\d+(\.\d+)?$/.test(s)) return null;
  const n = parseFloat(s) * mult;
  return Number.isFinite(n) ? n : null;
}
