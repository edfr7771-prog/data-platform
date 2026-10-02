// اختبار بنيوي: كل تفويض يمر بحارس. (دروس منصة «تم الآن»: requireUser وحدها لا تحمي معالجات المسارات.)
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(__dirname, '..', 'src');
let pass = 0, fail = 0;
const check = (name: string, cond: boolean, extra = '') => { cond ? pass++ : fail++; console.log(cond ? '  ✓' : '  ✗', name, cond ? '' : extra); };
const walk = (d: string): string[] => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
const rel = (f: string) => path.relative(ROOT, f).split(path.sep).join('/');
const read = (f: string) => fs.readFileSync(f, 'utf8');
const files = walk(ROOT).filter((f) => /\.(ts|tsx)$/.test(f));

const PUBLIC_ROUTES = new Set(['app/api/health/route.ts']);               // بلا جلسة ولا بيانات حساسة
const DIRECT_DB_ROUTES = new Set(['app/api/health/route.ts', 'app/api/audit/route.ts']); // الوصول المباشر لقاعدة البيانات مقيَّد بـorg_id داخلها
const DISPLAY_ONLY = new Set(['lib/auth.ts', 'lib/api.ts']);               // الوحيدان المسموح لهما باستعمال getCurrentUser (للعرض أو داخل الحارس)

console.log('معالجات المسارات (src/app/api)');
const routes = files.filter((f) => /^app\/api\/.*\/route\.ts$/.test(rel(f)));
check(`وُجد ${routes.length} معالج مسار`, routes.length >= 12);
for (const f of routes) {
  const s = read(f), r = rel(f);
  if (PUBLIC_ROUTES.has(r)) { check(`${r} عام بلا جلسة (مُعلَن)`, !/getCurrentUser|getCompleteUser/.test(s)); continue; }
  check(`${r} يمر بأحد الحراس (guard / guardSession / guardPublic)`, /\bguard(Public|Session)?\(req/.test(s));
  check(`${r} لا يستعمل getCurrentUser مباشرة`, !/\bgetCurrentUser\b/.test(s), 'استعمل guard');
  if (!DIRECT_DB_ROUTES.has(r)) check(`${r} لا يستعلم قاعدة البيانات مباشرة (الوصول عبر مكتبات مقيَّدة بالمؤسسة)`, !/from '@\/lib\/db'/.test(s));
}

console.log('الصفحات المحمية (src/app/app)');
const pages = files.filter((f) => /^app\/app\/.*(page|layout)\.tsx$/.test(rel(f)));
check(`وُجدت ${pages.length} صفحة/تخطيط محمي`, pages.length >= 5);
for (const f of pages) check(`${rel(f)} يستدعي requireUser`, /\brequireUser\(/.test(read(f)));

console.log('بقية الملفات');
for (const f of files.filter((x) => !DISPLAY_ONLY.has(rel(x)) && !/^app\/api\//.test(rel(x)))) check(`${rel(f)} لا يستعمل getCurrentUser`, !/\bgetCurrentUser\b/.test(read(f)), 'استعمل requireUser أو guard');
check('الكود لا يحوي نطاقًا ثابتًا (APP_URL من البيئة فقط)', files.every((f) => !/https?:\/\/(www\.)?tama+l+a*n+[a-z.]*\.(com|sa)/i.test(read(f))));
check('لا أسرار ظاهرة في الكود', files.every((f) => !/(sk-[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16}|-----BEGIN [A-Z ]*PRIVATE KEY-----)/.test(read(f))));
console.log(`\nالنتيجة: ${pass} نجح، ${fail} فشل`);
process.exit(fail ? 1 : 0);
