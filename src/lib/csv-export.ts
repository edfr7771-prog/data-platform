/** تصدير CSV محصَّن من حقن الصيغ (CSV/Formula Injection): أي خلية تبدأ بـ = + - @ أو Tab/CR تُسبق بفاصلة عليا. */
export function csvCell(v: unknown): string {
  let s = v === null || v === undefined ? '' : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
/** يضيف BOM ليفتح Excel الترميز العربي صحيحًا */
export const toCsv = (rows: unknown[][]): string => '\uFEFF' + rows.map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
