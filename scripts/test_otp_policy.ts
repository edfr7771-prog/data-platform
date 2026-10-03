// اختبار وحدة: سياسة عرض رمز الدخول وطباعته. الأهم: على أي رابط عام لا يظهر الرمز حتى مع OTP_DEV_SHOW=true
import { isLocalAppUrl, isLoopbackIp, otpConsoleFallbackAllowed, otpDevDisplayAllowed } from '../src/lib/otp-policy';

let pass = 0, fail = 0;
const check = (name: string, cond: boolean, extra = '') => { cond ? pass++ : fail++; console.log(cond ? '  ✓' : '  ✗', name, cond ? '' : extra); };

console.log('isLocalAppUrl');
for (const u of ['http://localhost:3000', 'http://127.0.0.1:3000', 'http://[::1]:3000', 'https://localhost', 'HTTP://LOCALHOST:3000', 'http://localhost']) check(`محلي: ${u}`, isLocalAppUrl(u) === true);
for (const u of ['https://tamaalann.com.sa', 'https://www.tamaalann.com.sa', 'https://tamaalann.com', 'http://localhost.evil.com', 'http://127.0.0.1.nip.io', 'http://localhost@evil.com', 'http://user:pw@localhost', 'http://evil.com/localhost', 'http://evil.com?u=http://localhost', 'https://192.168.1.10', 'http://0.0.0.0:3000', 'http://localhost.', 'ftp://localhost', 'javascript:localhost', 'localhost:3000', '', undefined, null, 'not a url'])
  check(`ليس محليًا: ${String(u)}`, isLocalAppUrl(u as string) === false);

console.log('otpDevDisplayAllowed: الحالة الحاسمة');
const PUBLIC = 'https://tamaalann.com.sa', LOCAL = 'http://localhost:3000';
check('رابط عام + OTP_DEV_SHOW=true ← لا يظهر الرمز', otpDevDisplayAllowed({ OTP_DEV_SHOW: 'true', NODE_ENV: 'production' }, PUBLIC) === false);
check('رابط عام + OTP_DEV_SHOW=true (وضع تطوير) ← لا يظهر الرمز', otpDevDisplayAllowed({ OTP_DEV_SHOW: 'true', NODE_ENV: 'development' }, PUBLIC) === false);
check('رابط خادع (localhost.evil.com) + OTP_DEV_SHOW=true ← لا يظهر', otpDevDisplayAllowed({ OTP_DEV_SHOW: 'true' }, 'http://localhost.evil.com') === false);
check('محلي + OTP_DEV_SHOW=true ← يظهر (التطوير وCI)', otpDevDisplayAllowed({ OTP_DEV_SHOW: 'true', NODE_ENV: 'production' }, LOCAL) === true);
check('محلي + بلا OTP_DEV_SHOW ← لا يظهر', otpDevDisplayAllowed({ NODE_ENV: 'production' }, LOCAL) === false);
for (const v of ['false', '1', 'TRUE', 'yes', '', undefined]) check(`محلي + OTP_DEV_SHOW=${String(v)} ← لا يظهر (لا يُقبل إلا «true» حرفيًا)`, otpDevDisplayAllowed({ OTP_DEV_SHOW: v as string }, LOCAL) === false);

console.log('otpConsoleFallbackAllowed: طباعة الرمز في سجل الخادم');
check('رابط عام + إنتاج + OTP_DEV_SHOW=true ← لا طباعة', otpConsoleFallbackAllowed({ NODE_ENV: 'production', OTP_DEV_SHOW: 'true' }, PUBLIC) === false);
check('رابط عام + تطوير ← لا طباعة', otpConsoleFallbackAllowed({ NODE_ENV: 'development' }, PUBLIC) === false);
check('محلي + إنتاج بلا OTP_DEV_SHOW ← لا طباعة (كما كان)', otpConsoleFallbackAllowed({ NODE_ENV: 'production' }, LOCAL) === false);
check('محلي + إنتاج + OTP_DEV_SHOW=true ← طباعة (CI)', otpConsoleFallbackAllowed({ NODE_ENV: 'production', OTP_DEV_SHOW: 'true' }, LOCAL) === true);
check('محلي + تطوير ← طباعة (مطوّر)', otpConsoleFallbackAllowed({ NODE_ENV: 'development' }, LOCAL) === true);

console.log('isLoopbackIp: عناوين لا تُحتسب حدًّا على العنوان');
for (const v of ['::1', '127.0.0.1', '127.5.5.5', '::ffff:127.0.0.1', '0.0.0.0', '::']) check(`loopback: ${v}`, isLoopbackIp(v) === true);
for (const v of ['203.0.113.9', '198.51.100.7', '2001:db8::1', '10.0.0.5', '128.0.0.1', '1.127.0.1']) check(`ليس loopback: ${v}`, isLoopbackIp(v) === false);

console.log(`\nالنتيجة: ${pass} نجح، ${fail} فشل`);
process.exit(fail ? 1 : 0);
