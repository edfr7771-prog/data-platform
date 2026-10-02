// سلامة الحزمة: ملف نموذج البيئة موجود بلا أسرار، والملفات المنقولة من «تم الآن» مطابقة لبصماتها المسجَّلة، ومجلد Phase 0R كامل.
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

const ROOT = path.resolve(__dirname, '..');
let pass = 0, fail = 0;
const check = (name: string, cond: boolean, extra = '') => { cond ? pass++ : fail++; console.log(cond ? '  ✓' : '  ✗', name, cond ? '' : `| ${extra}`); };
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const exists = (p: string) => fs.existsSync(path.join(ROOT, p));

console.log('ملف نموذج البيئة (.env.example)');
check('.env.example موجود وغير فارغ (المواصفة تشترطه والـREADME يطلب نسخه)', exists('.env.example') && read('.env.example').trim().length > 200);
if (exists('.env.example')) {
  const env = Object.fromEntries(read('.env.example').split('\n').filter((l) => /^[A-Z0-9_]+=/.test(l)).map((l) => [l.split('=')[0], l.slice(l.indexOf('=') + 1).trim()]));
  const need = ['DATABASE_URL', 'APP_URL', 'APP_SECRET', 'OTP_DEV_SHOW', 'OTP_EMAIL_DELIVERY', 'OTP_SMS_DELIVERY', 'ADMIN_IDENTIFIERS', 'MAX_IMPORT_MB'];
  check('يحوي كل المتغيرات اللازمة', need.every((k) => k in env), need.filter((k) => !(k in env)).join(','));
  check('الأسرار فارغة (APP_SECRET, SMTP_USER, SMTP_PASS, SMS_WEBHOOK_TOKEN, SMS_WEBHOOK_URL, SMTP_HOST, SMTP_FROM)', ['APP_SECRET', 'SMTP_USER', 'SMTP_PASS', 'SMS_WEBHOOK_TOKEN', 'SMS_WEBHOOK_URL', 'SMTP_HOST', 'SMTP_FROM'].every((k) => (env[k] ?? '') === ''), JSON.stringify(Object.entries(env).filter(([k, v]) => /SECRET|PASS|TOKEN/.test(k) && v)));
  check('الافتراضي الآمن: عرض الرمز مغلق (OTP_DEV_SHOW=false) والتسليم محلي console', env.OTP_DEV_SHOW === 'false' && env.OTP_EMAIL_DELIVERY === 'console' && env.OTP_SMS_DELIVERY === 'console');
  check('DATABASE_URL قالب بلا بيانات اعتماد حقيقية (USER:PASSWORD)', /USER:PASSWORD/.test(env.DATABASE_URL ?? ''));
}
check('.gitignore يمنع .env الحقيقي ويُبقي .env.example', /^\.env$/m.test(read('.gitignore')) && /^!\.env\.example$/m.test(read('.gitignore')));
check('README يشير إلى .env.example', read('README.md').includes('.env.example'));

console.log('مصدر الملفات المنقولة من «تم الآن» (الخيار أ: سبعة ملفات فقط)');
const prov = JSON.parse(read('docs/phase0r/provenance.json')) as { files: { file: string; sha256: string; sha256_source: string; identical_to_source: boolean }[] };
check('سجل المصدر يحوي سبعة ملفات بالضبط (لا أكثر)', prov.files.length === 7, String(prov.files.length));
for (const f of prov.files) {
  const buf = exists(f.file) ? fs.readFileSync(path.join(ROOT, f.file)) : null;
  check(`${f.file}: مطابق لبصمته المسجَّلة`, !!buf && createHash('sha256').update(buf).digest('hex') === f.sha256, buf ? 'تغيّر المحتوى: يلزم تجديد الاعتماد وتحديث PROVENANCE' : 'مفقود');
  check(`${f.file}: سُجّل مطابقًا للمصدر (بصمة المصدر = بصمته هنا)`, f.identical_to_source && f.sha256 === f.sha256_source);
}
const approvedList = new Set(prov.files.map((f) => f.file));
const shouldNotExist = ['src/lib/crm', 'src/lib/matching', 'src/app/academy', 'src/lib/market', 'src/lib/marketing'];
check('لا أثر لمجلدات منصة «تم الآن» غير المعتمدة (crm, matching, academy, market, marketing)', shouldNotExist.every((p) => !exists(p)));
check('الملفات المعتمدة موجودة كلها', [...approvedList].every((f) => exists(f)));

console.log('حزمة Phase 0R');
for (const f of ['PROVENANCE.md', 'EXISTING-SYSTEM-AUDIT.md', 'BRAND-NAMING-AUDIT.md', 'provenance.json']) check(`docs/phase0r/${f} موجود`, exists(`docs/phase0r/${f}`));
check('ملف GitHub Actions موجود (.github/workflows/ci.yml)', exists('.github/workflows/ci.yml'));
check('ملف CI يشغّل الفحوص الأساسية (audit وtypecheck وtest:unit وmigrate وbuild وtest:integration)', ['npm audit', 'npm run typecheck', 'npm run test:unit', 'npm run migrate', 'npm run build', 'npm run test:integration'].every((c) => exists('.github/workflows/ci.yml') && read('.github/workflows/ci.yml').includes(c)));
console.log(`\nالنتيجة: ${pass} نجح، ${fail} فشل`);
process.exit(fail ? 1 : 0);
