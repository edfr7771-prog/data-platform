/**
 * سياسة رمز الدخول (دوال نقية بلا اعتماديات، قابلة للاختبار المباشر).
 * الحكم على «هل البيئة محلية؟» يعتمد على رابط المنصة (APP_URL) لا على NODE_ENV، لأن الخادم المحلي للاختبار يعمل بوضع الإنتاج أيضًا.
 * رابط غير معروف أو غير صالح يُعامل كعام (الفشل الآمن).
 */
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

export function isLocalAppUrl(url: string | undefined | null): boolean {
  if (!url) return false;
  let u: URL;
  try { u = new URL(url); } catch { return false; }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;
  if (u.username || u.password) return false;
  return LOCAL_HOSTS.has(u.hostname.toLowerCase());
}

type Env = { OTP_DEV_SHOW?: string; NODE_ENV?: string };

/** عرض الرمز على الصفحة: يلزم OTP_DEV_SHOW=true **و** رابط منصة محلي. على أي نطاق عام يُتجاهل المتغير تمامًا */
export function otpDevDisplayAllowed(env: Env, appUrl: string): boolean {
  return env.OTP_DEV_SHOW === 'true' && isLocalAppUrl(appUrl);
}

/** طباعة الرمز في سجل الخادم عند غياب مزوّد تسليم: محلي فقط، وفي وضع الإنتاج يلزم OTP_DEV_SHOW=true صراحة */
export function otpConsoleFallbackAllowed(env: Env, appUrl: string): boolean {
  return isLocalAppUrl(appUrl) && (env.NODE_ENV !== 'production' || env.OTP_DEV_SHOW === 'true');
}

/** عناوين الحلقة المحلية والعنوان غير المحدد: لا تدل على عميل حقيقي، فلا تخضع لحد العنوان (الخادم المحلي وCI والمطوّر) */
export function isLoopbackIp(ip: string): boolean {
  const v = ip.trim().toLowerCase().replace(/^::ffff:/, '');
  return v === '::1' || v === '::' || v === '0.0.0.0' || /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(v);
}
