// اختبار تكاملي: خادم حقيقي + PostgreSQL حقيقية. يشغّله: DATABASE_URL=... TEST_APP_URL=http://localhost:3000 npx tsx scripts/integration.ts
import { Pool } from 'pg';
import { normalizePhone } from '../src/lib/identifiers';

const BASE = process.env.TEST_APP_URL ?? 'http://localhost:3000';
const db = new Pool({ connectionString: process.env.DATABASE_URL });
const sql = async <T extends Record<string, unknown> = Record<string, unknown>>(t: string, p: unknown[] = []) => (await db.query(t, p)).rows as T[];
const val = async (t: string, p: unknown[] = []) => { const r = await sql(t, p); return r[0] ? Object.values(r[0])[0] : null; };

let pass = 0, fail = 0;
const check = (name: string, cond: boolean, extra: unknown = '') => { cond ? pass++ : fail++; console.log(cond ? '  ✓' : '  ✗', name, cond ? '' : `| ${typeof extra === 'string' ? extra : JSON.stringify(extra)}`); };
const section = (s: string) => console.log(`\n${s}`);
const stamp = Date.now().toString(36);
let phoneSeq = Math.floor(10_000_000 + Math.random() * 80_000_000);
const newPhone = () => `05${String(phoneSeq++).padStart(8, '0')}`;
const e164 = (p: string) => normalizePhone(p)!;
let ipSeq = 10;
const newIp = () => `203.0.113.${(ipSeq++ % 250) + 1}`;

class Client {
  cookie = '';
  constructor(public ip?: string) {}
  async req(method: string, path: string, body?: unknown, o: { origin?: string | null; raw?: BodyInit; headers?: Record<string, string> } = {}) {
    const h: Record<string, string> = { ...(o.headers ?? {}) };
    if (o.origin !== null) h.Origin = o.origin ?? BASE;
    if (this.cookie) h.Cookie = this.cookie;
    if (this.ip) h['X-Forwarded-For'] = this.ip;
    let b: BodyInit | undefined = o.raw;
    if (body !== undefined) { h['Content-Type'] = 'application/json'; b = JSON.stringify(body); }
    const r = await fetch(BASE + path, { method, headers: h, body: b, redirect: 'manual' });
    for (const c of r.headers.getSetCookie?.() ?? []) { const [kv] = c.split(';'); const [k, v] = kv.split('='); if (/Max-Age=0|expires=Thu, 01 Jan 1970/i.test(c) || v === '') this.cookie = this.cookie.split('; ').filter((x) => !x.startsWith(k + '=')).join('; '); else this.cookie = [...this.cookie.split('; ').filter((x) => x && !x.startsWith(k + '=')), `${k}=${v}`].join('; '); }
    const bytes = new Uint8Array(await r.arrayBuffer()); const text = new TextDecoder('utf-8', { ignoreBOM: true }).decode(bytes); let data: any = {}; try { data = JSON.parse(text); } catch { /* نص */ }
    return { status: r.status, data, text, bytes, headers: r.headers };
  }
  get = (p: string) => this.req('GET', p);
  post = (p: string, b?: unknown) => this.req('POST', p, b ?? {});
  patch = (p: string, b: unknown) => this.req('PATCH', p, b);
  del = (p: string) => this.req('DELETE', p);
}

type U = { c: Client; email: string; phone: string; name: string };
/** تسجيل كامل بالمسار الحقيقي: رمز البريد ثم رمز الجوال */
async function register(tag: string, ip = newIp(), emailOverride?: string): Promise<U> {
  const c = new Client(ip), email = emailOverride ?? `${tag}-${stamp}@test.local`, phone = newPhone(), name = `مستخدم ${tag}`;
  const s = await c.post('/api/auth/otp/start', { mode: 'register', name, email, phone, consent: true });
  const v = await c.post('/api/auth/otp/verify', { challengeId: s.data.challengeId, code: s.data.devCode });
  if (!v.data.ok) throw new Error(`register verify failed for ${tag}: ${JSON.stringify(v.data)}`);
  const p = await c.post('/api/auth/complete', { kind: 'phone', value: phone });
  const pv = await c.post('/api/auth/otp/verify', { challengeId: p.data.challengeId, code: p.data.devCode });
  if (!pv.data.ok || !pv.data.complete) throw new Error(`phone verify failed for ${tag}: ${JSON.stringify(pv.data)}`);
  return { c, email, phone, name };
}
/** يضع مستخدمًا في مؤسسة بدور محدد مباشرة في القاعدة (إعداد اختبار) */
async function placeInOrg(u: U, orgId: string, role: string) {
  const uid = await val(`SELECT id FROM users WHERE email=$1`, [u.email]);
  await db.query(`UPDATE organization_members SET deleted_at=now() WHERE user_id=$1 AND deleted_at IS NULL`, [uid]);
  await db.query(`INSERT INTO organization_members (org_id, user_id, role) VALUES ($1,$2,$3) ON CONFLICT (org_id, user_id) DO UPDATE SET role=$3, deleted_at=NULL`, [orgId, uid, role]);
}
const orgOf = async (u: U) => (await val(`SELECT m.org_id FROM organization_members m JOIN users x ON x.id=m.user_id WHERE x.email=$1 AND m.deleted_at IS NULL`, [u.email])) as string;
const prop = (o: Record<string, unknown> = {}) => ({ type: 'villa', deal: 'sale', district: 'الفروسية', area_sqm: 300, price: 1_450_000, age_years: 3, rooms: 5, ...o });

async function main() {
  section('1) الصحة والإعدادات');
  const anon = new Client();
  const h = await anon.get('/api/health');
  check('/api/health يعمل والقاعدة متصلة', h.status === 200 && h.data.db === 'up');
  check('عرض رمز التحقق مسموح محليًا فقط، والتسجيل مفتوح بتسليم البريد والرسائل', h.data.otp_dev_display === true && h.data.registration_open === true);
  const secHdr = h.headers;
  check('رؤوس الأمان موجودة (nosniff, frame DENY, HSTS) وبلا X-Powered-By', secHdr.get('x-content-type-options') === 'nosniff' && secHdr.get('x-frame-options') === 'DENY' && !!secHdr.get('strict-transport-security') && !secHdr.get('x-powered-by'));
  const tables = ['property_drafts', 'users', 'organizations', 'organization_members', 'roles', 'cities', 'districts', 'properties', 'property_features', 'property_prices', 'requests', 'offers', 'matches', 'customers', 'customer_interactions', 'imports', 'import_rows', 'data_sources', 'reports', 'analytics_snapshots', 'market_indicators', 'ai_conversations', 'ai_messages', 'notifications', 'subscriptions', 'audit_logs'];
  const have = new Set((await sql<{ t: string }>(`SELECT table_name AS t FROM information_schema.tables WHERE table_schema='public'`)).map((r) => r.t));
  check(`كل الجداول المطلوبة موجودة (25 + مسودات Phase 2)`, tables.every((t) => have.has(t)), tables.filter((t) => !have.has(t)));
  check('الأدوار الثمانية مزروعة', (await val(`SELECT count(*) FROM roles`)) === '8');

  section('2) البوابات قبل المصادقة');
  check('GET /api/properties بلا جلسة = 401', (await anon.get('/api/properties')).status === 401);
  check('POST بلا Origin = 403 bad_origin (CSRF)', (await anon.req('POST', '/api/auth/otp/start', { mode: 'login' }, { origin: null })).data.error === 'bad_origin');
  check('POST بـOrigin غريب = 403 bad_origin', (await anon.req('POST', '/api/auth/otp/start', { mode: 'login' }, { origin: 'https://evil.example' })).data.error === 'bad_origin');
  check('JSON تالف = 400', (await anon.req('POST', '/api/auth/otp/start', undefined, { raw: '{bad' })).status === 400);
  const probe = (h: Record<string, string>) => anon.req('POST', '/api/auth/otp/start', {}, { origin: null, headers: h });
  check('متصفح بلا Origin لكن Sec-Fetch-Site=same-origin: يُقبل (يصل لتحقق المدخلات 400 لا 403)', (await probe({ 'Sec-Fetch-Site': 'same-origin' })).data.error === 'bad_mode');
  check('Sec-Fetch-Site=cross-site يُرفض ولو حمل Origin صحيحًا (المتصفح هو الحَكَم)', (await anon.req('POST', '/api/auth/otp/start', {}, { origin: BASE, headers: { 'Sec-Fetch-Site': 'cross-site' } })).data.error === 'bad_origin');
  check('same-site (نطاق فرعي) وnone يُرفضان', (await probe({ 'Sec-Fetch-Site': 'same-site' })).data.error === 'bad_origin' && (await probe({ 'Sec-Fetch-Site': 'none' })).data.error === 'bad_origin');
  check('Referer بمضيف المنصة يُقبل عند غياب الرؤوس الأخرى، وReferer غريب يُرفض', (await probe({ Referer: BASE + '/app' })).data.error === 'bad_mode' && (await probe({ Referer: 'https://evil.example/x' })).data.error === 'bad_origin');
  check('same-origin مع Origin غريب يُرفض (تناقض)', (await anon.req('POST', '/api/auth/otp/start', {}, { origin: 'https://evil.example', headers: { 'Sec-Fetch-Site': 'same-origin' } })).data.error === 'bad_origin');
  check('بلا أي رأس مصدر = رفض', (await probe({})).data.error === 'bad_origin');

  section('3) التسجيل بتحقق مزدوج (بريد ثم جوال)');
  const cA = new Client(newIp()), emA = `a-${stamp}@test.local`, phA = newPhone();
  check('بلا موافقة = 400', (await cA.post('/api/auth/otp/start', { mode: 'register', name: 'أحمد', email: emA, phone: phA, consent: false })).data.error === 'consent');
  check('بريد غير صالح = 400 وجوال غير سعودي = 400 واسم قصير = 400',
    (await cA.post('/api/auth/otp/start', { mode: 'register', name: 'أحمد', email: 'x', phone: phA, consent: true })).data.error === 'email' &&
    (await cA.post('/api/auth/otp/start', { mode: 'register', name: 'أحمد', email: emA, phone: '123', consent: true })).data.error === 'phone' &&
    (await cA.post('/api/auth/otp/start', { mode: 'register', name: 'أ', email: emA, phone: phA, consent: true })).data.error === 'name');
  const sA = await cA.post('/api/auth/otp/start', { mode: 'register', name: 'أحمد المشتري', email: emA, phone: phA, consent: true, marketing: true });
  check('بدء التسجيل يعيد معرّف التحدي ورمز التطوير محليًا', sA.status === 200 && !!sA.data.challengeId && /^\d{6}$/.test(sA.data.devCode));
  const wrong = String((Number(sA.data.devCode) + 1) % 1_000_000).padStart(6, '0');
  check('رمز خاطئ = 400 invalid ولا جلسة', (await cA.post('/api/auth/otp/verify', { challengeId: sA.data.challengeId, code: wrong })).data.error === 'invalid' && !cA.cookie);
  const vA = await cA.post('/api/auth/otp/verify', { challengeId: sA.data.challengeId, code: sA.data.devCode });
  check('رمز البريد الصحيح ينشئ جلسة ويوجّه إلى /complete (الحساب ناقص)', vA.data.ok === true && vA.data.complete === false && vA.data.next === '/complete' && !!cA.cookie);
  check('الكوكي HttpOnly وSameSite=Lax', (vA.headers.getSetCookie?.() ?? []).some((c) => /HttpOnly/i.test(c) && /SameSite=lax/i.test(c)));
  const meA1 = await cA.get('/api/auth/me');
  check('الحساب ناقص: me يعرض نقص الجوال', meA1.data.status?.complete === false && meA1.data.status.missing.includes('phone'));
  check('حساب ناقص لا يصل إلى أي API محمي (403 account_incomplete)', (await cA.get('/api/properties')).data.error === 'account_incomplete' && (await cA.get('/api/audit')).data.error === 'account_incomplete' && (await cA.post('/api/properties', prop())).data.error === 'account_incomplete');
  check('وحساب ناقص لا يصدّر ولا يستورد', (await cA.get('/api/properties/export')).status === 403 && (await cA.req('POST', '/api/imports', undefined, { raw: new FormData() })).status === 403);
  const pA = await cA.post('/api/auth/complete', { kind: 'phone', value: phA });
  const pvA = await cA.post('/api/auth/otp/verify', { challengeId: pA.data.challengeId, code: pA.data.devCode });
  check('توثيق الجوال يكمل الحساب ويوجّه إلى /app', pvA.data.ok && pvA.data.complete === true && pvA.data.next === '/app');
  const meA2 = await cA.get('/api/auth/me');
  check('بعد الاكتمال: مؤسسة مستقلة ودور مدير المؤسسة', meA2.data.status.complete === true && meA2.data.user.org?.role === 'org_admin' && !!meA2.data.user.org.id);
  const A = { c: cA, email: emA, phone: phA, name: 'أحمد المشتري' } as U;
  const orgA = await orgOf(A);
  check('اشتراك مجاني وسجل تدقيق للتسجيل أُنشئا', (await val(`SELECT count(*) FROM subscriptions WHERE org_id=$1 AND plan='free'`, [orgA])) === '1' && Number(await val(`SELECT count(*) FROM audit_logs WHERE org_id=$1 AND action='user.register'`, [orgA])) === 1);
  check('الموافقة التسويقية منفصلة ومسجَّلة', (await val(`SELECT marketing_consent_at IS NOT NULL FROM users WHERE email=$1`, [emA])) === true);

  const B = await register('b');
  const orgB = await orgOf(B);
  check('مؤسستان مختلفتان لمستخدمين مختلفين', !!orgA && !!orgB && orgA !== orgB);

  section('4) الدخول بالحقلين ورمز واحد لقناة موثَّقة');
  const [T1, T2, T3] = await Promise.all(['t1', 't2', 't3'].map((t) => register(t)));
  const lc = new Client(newIp());
  check('الدخول بالبريد وحده (بلا جوال) = 400 phone وبالجوال وحده = 400 email',
    (await lc.post('/api/auth/otp/start', { mode: 'login', email: T2.email, phone: '', consent: true })).data.error === 'phone' &&
    (await lc.post('/api/auth/otp/start', { mode: 'login', email: '', phone: T2.phone, consent: true })).data.error === 'email');
  const usersBefore = await val(`SELECT count(*) FROM users`);
  const mm = await lc.post('/api/auth/otp/start', { mode: 'login', email: T1.email, phone: B.phone, channel: 'email', consent: true });
  check('بريد حساب وجوال حساب آخر: نفس الاستجابة بلا رمز ولا كشف', mm.status === 200 && mm.data.ok === true && mm.data.devCode === undefined);
  check('ولا رمز يُقبل لهذا الزوج، ولا جلسة', (await lc.post('/api/auth/otp/verify', { challengeId: mm.data.challengeId, code: '000000' })).data.ok !== true && !lc.cookie);
  const ghost = await lc.post('/api/auth/otp/start', { mode: 'login', email: `ghost-${stamp}@test.local`, phone: newPhone(), channel: 'email', consent: true });
  check('زوج غير مسجَّل: استجابة متطابقة ولا حساب يُنشأ عند الدخول', ghost.data.ok === true && ghost.data.devCode === undefined && (await val(`SELECT count(*) FROM users`)) === usersBefore);
  const okl = await T2.c.post('/api/auth/otp/start', { mode: 'login', email: T2.email, phone: T2.phone, channel: 'email', consent: true });
  check('الزوج الصحيح: رمز واحد لقناة البريد', okl.data.ok && /^\d{6}$/.test(okl.data.devCode));
  const before = T2.c.cookie;
  const lv = await T2.c.post('/api/auth/otp/verify', { challengeId: okl.data.challengeId, code: okl.data.devCode });
  const replayOld = new Client(); replayOld.cookie = before;
  check('الدخول ينجح ويفتح /app', lv.data.ok && lv.data.next === '/app' && (await T2.c.get('/api/properties')).status === 200);
  check('الدخول يُنشئ جلسة جديدة ويُبطل القديمة (لا تثبيت جلسة)', T2.c.cookie !== before && (await replayOld.get('/api/properties')).status === 401);
  const sms = new Client(newIp());
  const sl = await sms.post('/api/auth/otp/start', { mode: 'login', email: T2.email, phone: T2.phone, channel: 'sms', consent: true });
  check('قناة SMS خيار مستقل للزوج نفسه', sl.data.ok && !!sl.data.devCode && (await sms.post('/api/auth/otp/verify', { challengeId: sl.data.challengeId, code: sl.data.devCode })).data.ok === true);
  const dupReg = new Client(newIp());
  const dr = await dupReg.post('/api/auth/otp/start', { mode: 'register', name: 'منتحل', email: T3.email, phone: newPhone(), consent: true });
  check('التسجيل ببريد حساب مكتمل لا يمنح دخولًا (لا رمز، لا جلسة)', dr.data.ok === true && dr.data.devCode === undefined && (await dupReg.post('/api/auth/otp/verify', { challengeId: dr.data.challengeId, code: '123456' })).data.ok !== true && !dupReg.cookie);

  section('5) رمز تسجيل قديم لحساب اكتمل لاحقًا (لا يمنح جلسة)');
  const cx = new Client(newIp()), emX = `x-${stamp}@test.local`, phX = newPhone();
  const sx = await cx.post('/api/auth/otp/start', { mode: 'register', name: 'خالد', email: emX, phone: phX, consent: true });
  await cx.post('/api/auth/otp/verify', { challengeId: sx.data.challengeId, code: sx.data.devCode });
  const cy = new Client(newIp());
  const sy = await cy.post('/api/auth/otp/start', { mode: 'register', name: 'اسم آخر', email: emX, phone: newPhone(), consent: true });
  check('حساب ناقص: إعادة التسجيل ببريده تُصدر رمزًا حقيقيًا (استئناف)', !!sy.data.devCode);
  const px = await cx.post('/api/auth/complete', { kind: 'phone', value: phX });
  await cx.post('/api/auth/otp/verify', { challengeId: px.data.challengeId, code: px.data.devCode });
  const ry = await cy.post('/api/auth/otp/verify', { challengeId: sy.data.challengeId, code: sy.data.devCode });
  check('الرمز القديم بعد اكتمال الحساب مرفوض ولا جلسة', ry.data.ok !== true && !cy.cookie, ry.data);
  const cp = new Client(newIp());
  const spp = await cp.post('/api/auth/otp/start', { mode: 'login', email: B.email, phone: B.phone, channel: 'email', consent: true });
  await db.query(`UPDATE users SET phone_verified_at=NULL WHERE email=$1`, [B.email]);
  check('رمز دخول صادر قبل أن يفقد الحساب اكتماله لا يمنح جلسة', (await cp.post('/api/auth/otp/verify', { challengeId: spp.data.challengeId, code: spp.data.devCode })).data.ok !== true && !cp.cookie);
  await db.query(`UPDATE users SET phone_verified_at=now() WHERE email=$1`, [B.email]);

  section('6) حدود الإرسال تحت التزامن');
  const lim = await register('lim');
  const par = await Promise.all(Array.from({ length: 12 }, () => new Client(newIp()).post('/api/auth/otp/start', { mode: 'login', email: lim.email, phone: lim.phone, channel: 'email', consent: true })));
  const rows = Number(await val(`SELECT count(*) FROM otp_challenges WHERE identifier=$1`, [lim.email]));
  check('12 طلبًا متوازيًا لمعرّف واحد: مجموع تحدياته لا يتجاوز 3', rows === 3, rows);
  check('ورُفض الباقي برمز rate_limited (429)', par.filter((r) => r.status === 429 && r.data.error === 'rate_limited').length >= 9, par.map((r) => r.status));
  const ipc = newIp();
  const par2 = await Promise.all(Array.from({ length: 20 }, (_, i) => new Client(ipc).post('/api/auth/otp/start', { mode: 'login', email: `ip${i}-${stamp}@test.local`, phone: newPhone(), channel: 'email', consent: true })));
  const rows2 = Number(await val(`SELECT count(*) FROM otp_challenges WHERE identifier LIKE $1`, [`ip%-${stamp}@test.local`]));
  check('20 طلبًا متوازيًا لمعرّفات مختلفة من عنوان واحد: لا يتجاوز 10', rows2 === 10, rows2);
  check('وبقية الطلبات رُفضت 429', par2.filter((r) => r.status === 429).length === 10, par2.map((r) => r.status));
  const ga = await register('guess');
  const cg = new Client(newIp()); const sg = await cg.post('/api/auth/otp/start', { mode: 'login', email: ga.email, phone: ga.phone, channel: 'email', consent: true });
  const bad = String((Number(sg.data.devCode) + 7) % 1_000_000).padStart(6, '0');
  const guesses = await Promise.all(Array.from({ length: 12 }, () => cg.post('/api/auth/otp/verify', { challengeId: sg.data.challengeId, code: bad })));
  check('تخمين الرمز: 5 محاولات خاطئة تقفل التحدي حتى لو توازت 12', guesses.filter((r) => r.data.error === 'invalid').length === 5 && (await cg.post('/api/auth/otp/verify', { challengeId: sg.data.challengeId, code: sg.data.devCode })).data.ok !== true);

  section('7) العقارات: CRUD وسعر المتر والتدقيق');
  const created = await A.c.post('/api/properties', prop({ external_ref: 'A-001' }));
  const pid = created.data.property?.id as string;
  check('إنشاء عقار سليم = 201', created.status === 201 && !!pid && created.data.property.district_name === 'الفروسية');
  check('سعر المتر يُحسب تلقائيًا (1450000 ÷ 300 = 4833.33)', created.data.property.price_per_sqm === 4833.33);
  check('بقية الحقول محفوظة بأنواعها', created.data.property.area_sqm === 300 && created.data.property.price === 1450000 && created.data.property.usage === 'residential' && created.data.property.status === 'active');
  const got = await A.c.get(`/api/properties/${pid}`);
  check('قراءة عقار بمعرّفه', got.status === 200 && got.data.property.external_ref === 'A-001');
  const upd = await A.c.patch(`/api/properties/${pid}`, { price: '1,200,000 ريال', rooms: 6 });
  check('تعديل السعر يعيد حساب سعر المتر (4000) ويقبل التنسيق العربي', upd.status === 200 && upd.data.property.price_per_sqm === 4000 && upd.data.property.rooms === 6 && upd.data.fixes.some((f: any) => f.code === 'number_normalized'));
  check('تاريخ الأسعار يسجّل التغيير (سجلان)', Number(await val(`SELECT count(*) FROM property_prices WHERE property_id=$1`, [pid])) === 2);
  check('مساحة صفر = 400 مع رسالة', (await A.c.post('/api/properties', prop({ area_sqm: 0 }))).data.errors?.[0]?.code === 'area_invalid');
  check('سعر بيع صفر وسعر سالب ونوع مجهول = 400', (await A.c.post('/api/properties', prop({ price: 0 }))).status === 400 && (await A.c.post('/api/properties', prop({ price: -5 }))).status === 400 && (await A.c.post('/api/properties', prop({ type: 'xyz' }))).status === 400);
  const odd = await A.c.post('/api/properties', prop({ area_sqm: 1000, price: 50000 }));
  check('سعر متر غير منطقي يُقبل مع تحذير صريح', odd.status === 201 && odd.data.warnings.some((w: any) => w.code === 'ppm_out_of_range'));
  const sqli = await A.c.get(`/api/properties?type=${encodeURIComponent("' OR 1=1 --")}&district_id=${encodeURIComponent("x' OR '1'='1")}`);
  check('محاولة حقن SQL في المرشّحات تُهمَل بأمان', sqli.status === 200 && sqli.data.ok === true);
  check('تعديل بحقل غير مسموح (org_id) يُهمَل ولا ينقل العقار', (await A.c.patch(`/api/properties/${pid}`, { org_id: orgB, notes: 'x' })).status === 200 && (await val(`SELECT org_id FROM properties WHERE id=$1`, [pid])) === orgA);
  check('معرّف غير UUID = 404 لا خطأ خادم', (await A.c.get('/api/properties/not-a-uuid')).status === 404);
  const delRes = await A.c.del(`/api/properties/${odd.data.property.id}`);
  check('حذف عقار = 200 وقراءته بعده 404 وهو خارج القائمة', delRes.status === 200 && (await A.c.get(`/api/properties/${odd.data.property.id}`)).status === 404);
  check('الحذف ناعم: السجل باقٍ في القاعدة', (await val(`SELECT deleted_at IS NOT NULL FROM properties WHERE id=$1`, [odd.data.property.id])) === true);
  const acts = (await sql<{ action: string }>(`SELECT action FROM audit_logs WHERE org_id=$1 AND entity='property'`, [orgA])).map((r) => r.action);
  check('التدقيق سجّل الإنشاء والتعديل والحذف', ['property.create', 'property.update', 'property.delete'].every((a) => acts.includes(a)));

  section('8) عزل المؤسسات (مستخدم المؤسسة B يهاجم بيانات A عبر API مباشرة)');
  check('قراءة عقار A من B = 404', (await B.c.get(`/api/properties/${pid}`)).status === 404);
  check('تعديل عقار A من B = 404 والعقار لم يتغير', (await B.c.patch(`/api/properties/${pid}`, { price: 1 })).status === 404 && Number(await val(`SELECT price FROM properties WHERE id=$1`, [pid])) === 1200000);
  check('حذف عقار A من B = 404 والعقار باقٍ', (await B.c.del(`/api/properties/${pid}`)).status === 404 && (await val(`SELECT deleted_at IS NULL FROM properties WHERE id=$1`, [pid])) === true);
  const lb = await B.c.get('/api/properties');
  check('قائمة B لا تحوي عقارات A', lb.status === 200 && !lb.data.items.some((x: any) => x.id === pid));
  const bp = await B.c.post('/api/properties', prop({ external_ref: 'B-001', location: 'سري للمؤسسة B' }));
  check('A لا يرى عقار B', (await A.c.get(`/api/properties/${bp.data.property.id}`)).status === 404 && !(await A.c.get('/api/properties')).data.items.some((x: any) => x.id === bp.data.property.id));
  const expA = await A.c.get('/api/properties/export'); const expB = await B.c.get('/api/properties/export');
  check('تصدير كل مؤسسة لا يحوي سجلات الأخرى', expA.text.includes(pid) && !expA.text.includes(bp.data.property.id) && expB.text.includes(bp.data.property.id) && !expB.text.includes(pid));
  const auditB = await B.c.get('/api/audit');
  check('سجل تدقيق B لا يحوي كيانات A', auditB.status === 200 && !JSON.stringify(auditB.data).includes(pid));
  const adminU = await register('admin', newIp(), 'admin@test.local'); // مدرج في ADMIN_IDENTIFIERS بالبيئة
  check('مدير المنصة يُرقّى بعد التسجيل والتوثيق (من البيئة فقط)', (await val(`SELECT platform_role FROM users WHERE email=$1`, [adminU.email])) === 'super_admin');
  check('ومدير المنصة لا يرى بيانات أي مؤسسة (أقل صلاحية)', (await adminU.c.get(`/api/properties/${pid}`)).status === 404 && !(await adminU.c.get('/api/properties')).data.items.some((x: any) => x.id === pid));

  section('9) الصلاحيات (RBAC) في الخلفية بأدوار حقيقية في المؤسسة A');
  const [viewer, broker, analyst, student, investor] = await Promise.all(['viewer', 'broker', 'analyst', 'student', 'investor'].map((t) => register(t)));
  await placeInOrg(viewer, orgA, 'viewer'); await placeInOrg(broker, orgA, 'broker'); await placeInOrg(analyst, orgA, 'data_analyst'); await placeInOrg(student, orgA, 'student'); await placeInOrg(investor, orgA, 'investor');
  const csvOne = new FormData(); csvOne.append('file', new File(['النوع,نوع العرض,المساحة,السعر\nفيلا,بيع,300,1000000\n'], 'x.csv', { type: 'text/csv' }));
  check('المطّلع: يقرأ فقط', (await viewer.c.get('/api/properties')).status === 200 && (await viewer.c.post('/api/properties', prop())).data.error === 'forbidden' && (await viewer.c.patch(`/api/properties/${pid}`, { notes: 'x' })).data.error === 'forbidden' && (await viewer.c.del(`/api/properties/${pid}`)).data.error === 'forbidden');
  check('المطّلع محجوب عن التصدير والاستيراد والتدقيق', (await viewer.c.get('/api/properties/export')).status === 403 && (await viewer.c.req('POST', '/api/imports', undefined, { raw: csvOne })).status === 403 && (await viewer.c.get('/api/audit')).status === 403);
  check('المستثمر: قراءة فقط', (await investor.c.get(`/api/properties/${pid}`)).status === 200 && (await investor.c.post('/api/properties', prop())).status === 403);
  const bro = await broker.c.post('/api/properties', prop({ external_ref: 'BRK-1' }));
  check('الوسيط: يكتب ويعدّل ولا يحذف ولا يستورد ولا يصدّر', bro.status === 201 && (await broker.c.patch(`/api/properties/${bro.data.property.id}`, { notes: 'ok' })).status === 200 && (await broker.c.del(`/api/properties/${bro.data.property.id}`)).status === 403 && (await broker.c.req('POST', '/api/imports', undefined, { raw: csvOne })).status === 403 && (await broker.c.get('/api/properties/export')).status === 403);
  check('الطالب: لا يصل إلى بيانات المؤسسة إطلاقًا', (await student.c.get('/api/properties')).status === 403 && (await student.c.get(`/api/properties/${pid}`)).status === 403);
  check('محلل البيانات: يحذف ويستورد ويصدّر ولا يرى التدقيق', (await analyst.c.get('/api/properties/export')).status === 200 && (await analyst.c.get('/api/audit')).status === 403 && (await analyst.c.del(`/api/properties/${bro.data.property.id}`)).status === 200);
  check('مدير المؤسسة: يرى التدقيق', (await A.c.get('/api/audit')).status === 200 && (await A.c.get('/api/audit')).data.items.length > 0);
  check('تخفيض الدور يسري فورًا في الخلفية (المحلل ← مطّلع)', (await placeInOrg(analyst, orgA, 'viewer'), (await analyst.c.get('/api/properties/export')).status === 403));

  section('10) استيراد CSV: معاينة وتنظيف وتكرار وموافقة');
  const header = 'رقم العقار,النوع,نوع العرض,المدينة,الحي,المساحة,السعر,العمر,ملاحظات';
  const csv = [header,
    'I1,فيلا,بيع,جدة,النزهة,400,"2,000,000",2,سليم',
    'I2,فيلا,بيع,جدة,النزهة,400.3,2000400,2,مكرر داخل الملف',
    'I3,شقة,بيع,جدة,الفروسيا,120,600000,5,حي بتهجئة خاطئة',
    'I4,xyz,بيع,جدة,الرياض,100,500000,1,نوع غير معروف',
    'I5,فيلا,بيع,جدة,أبحر الشمالية,400,1800000,2,حي غير مرجعي',
    'I6,أرض,بيع,جدة,الصفا,1000,50000,0,سعر متر غير منطقي',
    'I7,فيلا,بيع,جدة,الرحمانية,٣٥٠,"١٬٥٠٠٬٠٠٠ ريال",٤,أرقام عربية',
    'I8,فيلا,بيع,جدة,الفروسية,300,1450000,3,"=HYPERLINK(""http://evil.example"")"'].join('\n');
  const upload = async (u: U, text: string | Uint8Array, name = 'import.csv') => { const fd = new FormData(); fd.append('file', new File([text as BlobPart], name, { type: 'text/csv' })); return u.c.req('POST', '/api/imports', undefined, { raw: fd }); };
  const up = await upload(A, csv);
  const imp = up.data.import; const S = imp?.summary ?? {};
  check('الرفع = 201 مع تخمين أعمدة عربية صحيح', up.status === 201 && imp.mapping.type === 1 && imp.mapping.deal === 2 && imp.mapping.district === 4 && imp.mapping.area_sqm === 5 && imp.mapping.price === 6, up.data);
  check('ملخص الفحص: 8 صفوف، مكرر 1، غير صالح 1', S.total === 8 && S.duplicate === 1 && S.invalid === 1, S);
  check('مُصحَّح (3): الأرقام المنسّقة وتهجئة الحي والأرقام العربية. مراجعة (3): حي غير مرجعي وسعر شاذ وصيغة', S.fixed === 3 && S.review === 3 && S.ok === 0, S);
  const rowsById: Record<number, any> = Object.fromEntries(up.data.rows.map((r: any) => [r.row_number, r]));
  check('كل صف يحمل حالته وأسبابه (التصحيح مكتوب لا مخفي)', rowsById[4].issues.some((i: any) => i.code === 'district_corrected') && rowsById[5].status === 'invalid' && rowsById[3].status === 'duplicate');
  const importId = imp.id as string;
  const rawStored = await val(`SELECT raw FROM import_rows WHERE import_id=$1 AND row_number=4`, [importId]) as string[];
  check('البيانات الأصلية محفوظة كما رُفعت (لا تعديل)', rawStored[4] === 'الفروسيا' && rawStored[5] === '120');
  check('لا عقار دخل قبل الموافقة', (await val(`SELECT count(*) FROM properties WHERE import_id=$1`, [importId])) === '0');
  check('تعديل التطابق بعمود خارج النطاق أو حقل مجهول = 400', (await A.c.patch(`/api/imports/${importId}`, { mapping: { price: 99 } })).status === 400 && (await A.c.patch(`/api/imports/${importId}`, { mapping: { hacker: 1 } })).status === 400);
  const rm = await A.c.patch(`/api/imports/${importId}`, { mapping: imp.mapping });
  check('إعادة التطابق تحفظ الأصل وتعيد التصنيف', rm.status === 200 && rm.data.summary.total === 8 && (await val(`SELECT raw FROM import_rows WHERE import_id=$1 AND row_number=4`, [importId]) as string[])[4] === 'الفروسيا');
  check('استيراد مؤسسة أخرى لا يُرى ولا يُعتمد (404)', (await B.c.get(`/api/imports/${importId}`)).status === 404 && (await B.c.post(`/api/imports/${importId}/approve`, {})).status === 404 && (await B.c.patch(`/api/imports/${importId}`, { mapping: {} })).status === 404);
  const ap = await A.c.post(`/api/imports/${importId}/approve`, {});
  const R = ap.data.report ?? {};
  check('الاعتماد بلا «مراجعة»: يدخل السليم والمُصحَّح فقط (3)', ap.status === 200 && R.imported === 3 && R.imported_fixed === 3 && R.review_skipped === 3 && R.duplicates_ignored === 1 && R.invalid_skipped === 1, R);
  check('العقارات المستوردة مربوطة بالاستيراد وسعر المتر صحيح', (await val(`SELECT count(*) FROM properties WHERE import_id=$1`, [importId])) === '3' && Number(await val(`SELECT price_per_sqm FROM properties WHERE import_id=$1 AND external_ref='I1'`, [importId])) === 5000);
  check('الأرقام العربية دخلت بقيمتها الصحيحة (350 م² و1,500,000)', Number(await val(`SELECT price FROM properties WHERE import_id=$1 AND external_ref='I7'`, [importId])) === 1500000 && Number(await val(`SELECT area_sqm FROM properties WHERE import_id=$1 AND external_ref='I7'`, [importId])) === 350);
  check('تاريخ الأسعار سُجّل للمستوردة', Number(await val(`SELECT count(*) FROM property_prices WHERE import_id=$1`, [importId])) === 3);
  check('الاعتماد مرة ثانية = 409 ولا إدخال مكرر', (await A.c.post(`/api/imports/${importId}/approve`, {})).status === 409 && (await val(`SELECT count(*) FROM properties WHERE import_id=$1`, [importId])) === '3');
  check('التدقيق سجّل المعاينة والاعتماد بأرقام التقرير', Number(await val(`SELECT count(*) FROM audit_logs WHERE org_id=$1 AND action IN ('import.preview','import.approve')`, [orgA])) >= 2);
  const up2 = await upload(A, csv, 'again.csv');
  check('رفع الملف نفسه ثانية: السليمة تصير «مكرر» مقابل الموجود', up2.data.import.summary.duplicate >= 3 && up2.data.import.summary.ok === 0, up2.data.import?.summary);
  const ap2 = await A.c.post(`/api/imports/${up2.data.import.id}/approve`, { include_review: true });
  check('الاعتماد مع «مراجعة»: تدخل 3 صفوف مراجعة ولا يتكرر ما دخل', ap2.data.report.imported === 3 && ap2.data.report.imported_review === 3, ap2.data.report);
  check('الفحص يمنع غير CSV والملفات الثنائية والفارغة', (await upload(A, 'x', 'a.xlsx')).status === 400 && (await upload(A, new Uint8Array([97, 0, 98, 99, 10, 100]), 'bin.csv')).status === 400 && (await upload(A, '', 'e.csv')).status === 400);
  check('ملف بلا صفوف بيانات = 400', (await upload(A, 'النوع,السعر\n', 'h.csv')).status === 400);
  const big = 'النوع,نوع العرض,المساحة,السعر\n' + 'فيلا,بيع,300,1000000\n'.repeat(300_000);
  check('ملف أكبر من الحد (5MB) يُرفض', [400, 413].includes((await upload(A, big, 'big.csv')).status));
  const path = await upload(A, 'النوع,نوع العرض,المساحة,السعر\nفيلا,بيع,300,1000000\n', '../../etc/passwd.csv');
  check('اسم الملف المعاد يُنقَّى من المسارات', path.status === 201 && !path.data.import.filename.includes('/'));

  section('11) تصدير CSV محصَّن من حقن الصيغ');
  await A.c.post('/api/properties', prop({ external_ref: '=cmd|calc', notes: '@SUM(1+1)', location: '+evil' }));
  const ex = await A.c.get('/api/properties/export');
  check('التصدير CSV بترميز UTF-8 وBOM ورؤوس تنزيل آمنة', ex.status === 200 && /text\/csv/.test(ex.headers.get('content-type') ?? '') && ex.bytes[0] === 0xEF && ex.bytes[1] === 0xBB && ex.bytes[2] === 0xBF && /attachment/.test(ex.headers.get('content-disposition') ?? '') && ex.headers.get('x-content-type-options') === 'nosniff');
  check('الخلايا التي تبدأ بـ = + @ تُحصَّن بفاصلة عليا', ex.text.includes("'=cmd|calc") && ex.text.includes("'@SUM(1+1)") && ex.text.includes("'+evil") && !/(^|,)=cmd/m.test(ex.text));
  check('الخلية الواردة بصيغة من الاستيراد حُصّنت أيضًا', ex.text.includes("'=HYPERLINK") && !/,=HYPERLINK/.test(ex.text));
  check('التصدير مُسجَّل في التدقيق', Number(await val(`SELECT count(*) FROM audit_logs WHERE org_id=$1 AND action='property.export'`, [orgA])) >= 1);

  section('12) الترقيم والأداء');
  for (let i = 0; i < 28; i++) await A.c.post('/api/properties', prop({ external_ref: `P-${i}`, price: 1_000_000 + i * 1000 }));
  const p1 = await A.c.get('/api/properties?page=1&pageSize=10'), p3 = await A.c.get('/api/properties?page=3&pageSize=10');
  check('الترقيم يعمل (10 عناصر لكل صفحة والإجمالي أكبر من 30)', p1.data.items.length === 10 && p3.data.items.length === 10 && p1.data.total > 30 && p1.data.items[0].id !== p3.data.items[0].id);
  check('حجم الصفحة الأقصى 100 (لا تحميل الآلاف دفعة واحدة)', (await A.c.get('/api/properties?pageSize=100000')).data.items.length <= 100);
  const idx = (await sql<{ indexname: string }>(`SELECT indexname FROM pg_indexes WHERE tablename='properties'`)).map((r) => r.indexname);
  check('فهارس العقارات (المؤسسة، الحي، التكرار) موجودة', ['properties_org_idx', 'properties_district_idx', 'properties_dedupe_idx'].every((n) => idx.includes(n)));

  section('12ب) الإدخال المنظم (Phase 2): حقول حسب النوع، معاينة، وصف مولَّد، مسودات');
  const ent = await register('entry'); await placeInOrg(ent, orgA, 'employee');
  const fur = await val(`SELECT id FROM districts WHERE slug='al-furusiyyah'`) as string, jed = await val(`SELECT id FROM cities WHERE slug='jeddah'`) as string;
  const villaIn = { deal: 'sale', kind: 'villa', city_id: jed, district_id: fur, area_sqm: '٣٧٥', price: '2,300,000', ad_license_no: '7200001234', notes: 'ملاحظة حرة للمعلن',
    attributes: { floors_count: 2, bedrooms: '5', living_rooms: 2, bathrooms: 6, annex: true, pool: false, parking_spaces: 2, land_use: 'commercial' } };
  const nBefore = Number(await val(`SELECT count(*) FROM properties WHERE org_id=$1`, [orgA]));
  const pv = await ent.c.post('/api/properties/preview', villaIn);
  check('المعاينة تُرجع وصفًا مرتبًا ولا تكتب في القاعدة', pv.status === 200 && pv.data.description.title === 'فيلا للبيع في حي الفروسية، جدة' && pv.data.description.sections[0].key === 'location' && Number(await val(`SELECT count(*) FROM properties WHERE org_id=$1`, [orgA])) === nBefore, pv.data);
  check('المعاينة تذكر الحقول التي لا تخص النوع ولا تعرضها', pv.data.ignored?.includes('land_use') && !pv.data.description.sections.some((x: any) => x.lines.some((l: string) => l.startsWith('الاستخدام'))));
  const pvBad = await ent.c.post('/api/properties/preview', { ...villaIn, kind: 'apartment', attributes: { bathrooms: 1 } });
  check('المعاينة بإدخال ناقص = 400 بأخطاء الحقول المطلوبة للنوع', pvBad.status === 400 && ['bedrooms', 'floor_number'].every((k) => pvBad.data.errors.some((e: any) => e.field === k)), pvBad.data);
  const cv = await ent.c.post('/api/properties', villaIn);
  const vid = cv.data.property?.id as string;
  check('نشر فيلا منظمة = 201 بنوعها التفصيلي ونوعها الأساسي', cv.status === 201 && cv.data.property.kind === 'villa' && cv.data.property.type === 'villa' && cv.data.property.area_sqm === 375, cv.data);
  check('البيانات المنظمة محفوظة بقيم موحدة (أرقام لا نصوص)', (await val(`SELECT jsonb_typeof(attributes->'bedrooms') FROM properties WHERE id=$1`, [vid])) === 'number' && cv.data.property.attributes.bedrooms === 5 && cv.data.property.attributes.annex === true && cv.data.property.attributes.pool === false);
  check('حقل نوع آخر (land_use) لم يُحفظ', !('land_use' in cv.data.property.attributes));
  check('الوصف المحفوظ = وصف المعاينة حرفيًا', cv.data.property.description === pv.data.description.text);
  check('الملاحظات الإضافية منفصلة: في notes ولا تدخل الوصف', cv.data.property.notes === 'ملاحظة حرة للمعلن' && !cv.data.property.description.includes('ملاحظة حرة'));
  check('أعمدة التوافق مملوءة من الحقول المنظمة (الغرف) وسعر المتر محسوب', cv.data.property.rooms === 5 && cv.data.property.price_per_sqm === 6133.33);
  check('الحي مطلوب في الإدخال المنظم', (await ent.c.post('/api/properties', { ...villaIn, district_id: undefined })).data.errors?.some((e: any) => e.code === 'district_required'));
  check('حي غير موجود في المرجع = خطأ لا تحذير', (await ent.c.post('/api/properties', { ...villaIn, district_id: undefined, district: 'حي وهمي جدا' })).status === 400);
  const rentIn = { deal: 'rent', kind: 'apartment', city: 'جدة', district: 'الصفا', area_sqm: 140, price: 45000, attributes: { floor_number: 2, bedrooms: 3, bathrooms: 2, furnished: 'unfurnished' } };
  check('الإيجار بلا مدة الإيجار = 400', (await ent.c.post('/api/properties', rentIn)).data.errors?.some((e: any) => e.field === 'rent_period'));
  const cr = await ent.c.post('/api/properties', { ...rentIn, rent_period: 'yearly' });
  check('شقة للإيجار بالأسماء العربية للمدينة والحي = 201 ووصفها يذكر المدة', cr.status === 201 && cr.data.property.description.includes('الإيجار: 45,000 ريال سنويًا') && cr.data.property.attributes.rent_period === 'yearly', cr.data);
  const ch = await ent.c.post('/api/properties', { deal: 'investment', kind: 'hotel', city_id: jed, district_id: fur, area_sqm: 2500, price: 38_000_000, attributes: { rooms_count: 120, suites_count: 10, hotel_rating: '4', annual_income: 6_500_000, occupancy_pct: 78, operating_status: 'operating' } });
  check('فندق للاستثمار = 201 بعملية investment ونوع أساسي تجاري', ch.status === 201 && ch.data.property.deal === 'investment' && ch.data.property.type === 'commercial' && ch.data.property.usage === 'commercial', ch.data);
  const fl = await ent.c.get('/api/properties?deal=investment&kind=hotel&pageSize=100');
  check('التصفية بالعملية والنوع التفصيلي', fl.status === 200 && fl.data.items.length >= 1 && fl.data.items.every((x: any) => x.kind === 'hotel' && x.deal === 'investment'));
  const upS = await ent.c.patch(`/api/properties/${vid}`, { attributes: { bedrooms: 6, pool: null } });
  check('تعديل الحقول المنظمة يعيد توليد الوصف (حقل محذوف يختفي)', upS.status === 200 && upS.data.property.description.includes('غرف النوم: 6') && !upS.data.property.description.includes('مسبح') && upS.data.property.rooms === 6, upS.data);
  check('تغيير النوع إلى أرض بلا حقلها المطلوب = 400 والعقار لم يتغير', (await ent.c.patch(`/api/properties/${vid}`, { kind: 'land' })).status === 400 && (await val(`SELECT kind FROM properties WHERE id=$1`, [vid])) === 'villa');
  const toLand = await ent.c.patch(`/api/properties/${vid}`, { kind: 'land', attributes: { land_use: 'residential', streets_count: 1, street_widths: '20' } });
  check('تغيير النوع إلى أرض: تبقى حقول الأرض فقط والنوع الأساسي يتبع', toLand.status === 200 && toLand.data.property.type === 'land' && Object.keys(toLand.data.property.attributes).sort().join() === 'ad_license_no,land_use,street_widths,streets_count' && toLand.data.property.description.startsWith('أرض للبيع'), toLand.data);
  check('المؤسسة B لا تعاين ولا تعدّل عقار A المنظم', (await B.c.patch(`/api/properties/${vid}`, { attributes: { land_use: 'commercial' } })).status === 404);
  check('المطّلع لا يعاين (صلاحية كتابة)', (await viewer.c.post('/api/properties/preview', villaIn)).status === 403);
  const d1 = await ent.c.post('/api/property-drafts', { data: { kind: 'villa', deal: 'sale', area_sqm: '300', evil: 'x', attributes: { bedrooms: '4', land_use: 'commercial', hacker: 1 } } });
  const did = d1.data.id as string;
  check('حفظ مسودة ناقصة = 201', d1.status === 201 && !!did);
  const gd = await ent.c.get(`/api/property-drafts/${did}`);
  check('المسودة تعود كما حُفظت بالمفاتيح المعروفة فقط (وحقول الأنواع الأخرى للرجوع)', gd.status === 200 && gd.data.draft.data.attributes.bedrooms === '4' && gd.data.draft.data.attributes.land_use === 'commercial' && !('hacker' in gd.data.draft.data.attributes) && !('evil' in gd.data.draft.data));
  check('تحديث المسودة والقائمة تعرضها بنوعها', (await ent.c.req('PUT', `/api/property-drafts/${did}`, { data: { ...gd.data.draft.data, price: '1,900,000' } })).status === 200 && (await ent.c.get('/api/property-drafts')).data.items.some((x: any) => x.id === did && x.kind_label === 'فيلا'));
  check('مستخدم آخر في المؤسسة نفسها لا يرى مسودتي', (await broker.c.get(`/api/property-drafts/${did}`)).status === 404 && !(await broker.c.get('/api/property-drafts')).data.items.some((x: any) => x.id === did));
  check('مؤسسة أخرى لا ترى المسودة ولا تحذفها', (await B.c.get(`/api/property-drafts/${did}`)).status === 404 && (await B.c.del(`/api/property-drafts/${did}`)).status === 404);
  check('المطّلع محجوب عن المسودات', (await viewer.c.get('/api/property-drafts')).status === 403);
  const pub = await ent.c.post('/api/properties', { deal: 'sale', kind: 'villa', city_id: jed, district_id: fur, area_sqm: 300, price: 1_900_000, attributes: { bedrooms: 4, bathrooms: 5 }, draft_id: did });
  check('النشر من المسودة ينشئ العقار ويحذف المسودة', pub.status === 201 && (await ent.c.get(`/api/property-drafts/${did}`)).status === 404, pub.data);
  check('التدقيق يسجل النوع التفصيلي عند الإنشاء', (await val(`SELECT meta->>'kind' FROM audit_logs WHERE entity_id=$1 AND action='property.create'`, [pub.data.property.id])) === 'villa');
  check('المسار القديم (بلا kind) يعمل كما هو', (await ent.c.post('/api/properties', prop({ external_ref: 'LEGACY-1' }))).data.property?.kind === null);
  const idx2 = (await sql<{ indexname: string }>(`SELECT indexname FROM pg_indexes WHERE tablename IN ('properties','property_drafts')`)).map((r) => r.indexname);
  check('فهارس النوع التفصيلي والبيانات المنظمة والمسودات موجودة', ['properties_kind_idx', 'properties_attributes_idx', 'property_drafts_owner_idx'].every((n) => idx2.includes(n)));

  section('12ج) Phase 2: الطلبات المنظمة والمطابقة والذكاء السعري والخريطة والمقارنة (مؤسسة جديدة ببيانات معروفة)');
  const M = await register('mkt'); const orgM = await orgOf(M);
  const fu = await val(`SELECT id FROM districts WHERE slug='al-furusiyyah'`) as string, sa = await val(`SELECT id FROM districts WHERE slug='al-safa'`) as string, jd = await val(`SELECT id FROM cities WHERE slug='jeddah'`) as string;
  const mk = async (o: Record<string, unknown>) => { const r = await M.c.post('/api/properties', { city_id: jd, deal: 'sale', kind: 'villa', district_id: fu, ...o }); if (r.status !== 201) throw new Error('offer failed ' + JSON.stringify(r.data)); return r.data.property.id as string; };
  const v1 = await mk({ area_sqm: 300, price: 2_000_000, lat: 21.601, lng: 39.121, attributes: { bedrooms: 5, bathrooms: 5, pool: true, ac_type: 'central', finishing: 'super_deluxe', features: ['smart_home', 'cctv'] } });
  const v2 = await mk({ area_sqm: 320, price: 2_400_000, lat: 21.603, lng: 39.124, attributes: { bedrooms: 4, bathrooms: 4, pool: false, ac_type: 'split' } });
  const v3 = await mk({ area_sqm: 280, price: 1_800_000, lat: 21.599, lng: 39.118, attributes: { bedrooms: 3, bathrooms: 3, pool: true } });
  const v4 = await mk({ area_sqm: 400, price: 3_000_000, lat: 21.605, lng: 39.126, attributes: { bedrooms: 6, bathrooms: 6, pool: true, ac_type: 'central' } });
  const vn = await mk({ area_sqm: 310, price: 2_100_000, lat: 21.602, lng: 39.122, notes: 'فيلا فيها مسبح كبير وتكييف مركزي', attributes: { bedrooms: 5, bathrooms: 5 } });
  const vs = await mk({ district_id: sa, area_sqm: 350, price: 2_200_000, lat: 21.585, lng: 39.205, attributes: { bedrooms: 4, bathrooms: 4, ac_type: 'central' } });
  const legacy = (await M.c.post('/api/properties', prop({ external_ref: 'M-LEG' }))).data.property.id as string; // فيلا قديمة بلا kind ولا إحداثيات في الفروسية (غرف 5، 1,450,000)
  const a1 = await mk({ deal: 'rent', kind: 'apartment', district_id: sa, area_sqm: 120, price: 45_000, rent_period: 'yearly', lat: 21.586, lng: 39.207, attributes: { floor_number: 2, bedrooms: 3, bathrooms: 2, furnished: 'unfurnished' } });
  const a2 = await mk({ deal: 'rent', kind: 'apartment', district_id: sa, area_sqm: 130, price: 4_000, rent_period: 'monthly', lat: 21.587, lng: 39.208, attributes: { floor_number: 1, bedrooms: 3, bathrooms: 2, furnished: 'furnished' } });
  const a3 = await mk({ deal: 'rent', kind: 'apartment', district_id: sa, area_sqm: 150, price: 60_000, rent_period: 'yearly', lat: 21.584, lng: 39.206, attributes: { floor_number: 3, bedrooms: 4, bathrooms: 3, furnished: 'unfurnished' } });
  const ht = await mk({ deal: 'investment', kind: 'hotel', area_sqm: 2000, price: 30_000_000, lat: 21.604, lng: 39.125, attributes: { rooms_count: 90, ac_type: 'central', finishing: 'deluxe', annual_income: 4_200_000 } });
  check('عرض بالمواصفات التفصيلية: التكييف والتشطيب والمزايا محفوظة بمفاتيحها ومذكورة في الوصف', (await M.c.get(`/api/properties/${v1}`)).data.property.attributes.finishing === 'super_deluxe' && (await M.c.get(`/api/properties/${v1}`)).data.property.description.includes('المزايا: منزل ذكي، كاميرات مراقبة'));
  check('«عرض استثماري» يُقبل اسمًا عربيًا للعملية', (await M.c.post('/api/properties/preview', { city_id: jd, district_id: fu, deal: 'عرض استثماري', kind: 'shop', area_sqm: 80, price: 900000 })).data.description?.title === 'محل للاستثمار في حي الفروسية، جدة');

  const r1In = { purpose: 'buy', kinds: ['villa', 'duplex'], city_id: jd, district_ids: [fu, sa], district_importance: 'must', budget_max: 2_500_000, notes: 'أفضّل قرب مسجد',
    criteria: { bedrooms: { value: 4, importance: 'must' }, pool: { value: true, importance: 'preferred' }, ac_type: { value: ['central'], importance: 'preferred' }, finishing: { value: 'deluxe', importance: 'any' } } };
  const rpv = await M.c.post('/api/requests/preview', r1In);
  check('معاينة الطلب: وصف مرتب بالأحياء والشروط، بلا «لا يهم» وبلا الملاحظات', rpv.status === 200 && rpv.data.description.title === 'مطلوب فيلا أو دوبلكس للشراء في حي الفروسية أو حي الصفا، جدة' && rpv.data.description.text.includes('غرف النوم: 4 على الأقل') && !rpv.data.description.text.includes('التشطيب') && !rpv.data.description.text.includes('مسجد'), rpv.data);
  const r1 = await M.c.post('/api/requests', r1In);
  const r1id = r1.data.request?.id as string;
  check('حفظ طلب منظم = 201 وشروطه بقيم موحدة، والملاحظات منفصلة', r1.status === 201 && r1.data.request.criteria.bedrooms.op === 'min' && r1.data.request.criteria.bedrooms.value === 4 && r1.data.request.notes === 'أفضّل قرب مسجد' && !('finishing' in r1.data.request.criteria), r1.data);
  check('طلب بلا ميزانية = 400، واستئجار بلا مدة = 400، وحي من مدينة أخرى/مجهول = 400', (await M.c.post('/api/requests', { ...r1In, budget_max: undefined })).status === 400 && (await M.c.post('/api/requests', { ...r1In, purpose: 'rent' })).data.errors?.some((e: any) => e.field === 'rent_period') && (await M.c.post('/api/requests', { ...r1In, district_ids: ['حي غير موجود'] })).status === 400);
  const m1 = await M.c.get(`/api/requests/${r1id}/matches`);
  const ids1 = m1.data.matches?.map((x: any) => x.property_id) ?? [];
  check('المطابقة: الأفضل أولًا (فيلا بكل المفضّلات = 100)', m1.status === 200 && ids1[0] === v1 && m1.data.matches[0].score === 100, m1.data.matches?.map((x: any) => [x.property_id === v1 ? 'v1' : x.property_id, x.score]));
  check('المطابقة تستبعد: 3 غرف (إلزامي 4)، وفوق الميزانية، وغير الفلل', !ids1.includes(v3) && !ids1.includes(v4) && !ids1.includes(a1) && !ids1.includes(ht) && m1.data.excluded.criterion >= 1 && m1.data.excluded.budget >= 1);
  check('المطابقة تشمل: مفضّل غير متحقق بدرجة أقل، وحي الصفا، والعرض القديم بغرف عمود Phase 1', ids1.includes(v2) && ids1.includes(vs) && ids1.includes(legacy) && m1.data.matches.find((x: any) => x.property_id === v2).score < 100);
  check('أسباب الدرجة مفسَّرة لكل شرط (المسبح غير مذكور في عرض ملاحظاته تذكر مسبحًا)', m1.data.matches.find((x: any) => x.property_id === vn)?.reasons.find((r: any) => r.key === 'pool')?.status === 'unknown');
  check('لقطة المطابقات محفوظة في matches بعدد المؤهل', Number(await val(`SELECT count(*) FROM matches WHERE request_id=$1 AND org_id=$2`, [r1id, orgM])) === m1.data.total_eligible && m1.data.total_eligible === ids1.length);
  const r2 = await M.c.post('/api/requests', { ...r1In, criteria: { ...r1In.criteria, pool: { value: true, importance: 'must' } } });
  const ids2 = (await M.c.get(`/api/requests/${r2.data.request.id}/matches`)).data.matches.map((x: any) => x.property_id);
  check('المسبح إلزامي: النص الحر «فيها مسبح» لا يكفي، والمسبح المنظم يكفي (المطابقة على البيانات المنظمة)', !ids2.includes(vn) && ids2.includes(v1) && !ids2.includes(legacy) && !ids2.includes(v2), ids2.length);
  const r3 = await M.c.post('/api/requests', { purpose: 'rent', rent_period: 'yearly', kinds: ['apartment'], city_id: jd, district_ids: [sa], budget_max: 50_000, criteria: { bedrooms: { value: 3, importance: 'must' } } });
  const ids3 = (await M.c.get(`/api/requests/${r3.data.request.id}/matches`)).data.matches.map((x: any) => x.property_id);
  check('الإيجار يوحَّد سنويًا: 45,000 سنويًا و4,000 شهريًا (48,000) ضمن 50,000، و60,000 خارجها', ids3.includes(a1) && ids3.includes(a2) && !ids3.includes(a3), ids3);
  const r4 = await M.c.post('/api/requests', { purpose: 'investment', kinds: ['hotel'], city_id: jd, budget_max: 35_000_000, criteria: { rooms_count: { value: 80, importance: 'must' } } });
  check('طلب استثمار يطابق العرض الاستثماري (فندق 90 غرفة والمطلوب 80)', (await M.c.get(`/api/requests/${r4.data.request.id}/matches`)).data.matches.some((x: any) => x.property_id === ht));
  const pr = await M.c.patch(`/api/requests/${r1id}`, { criteria: { bedrooms: { value: 5, importance: 'must' } } });
  check('تعديل شروط الطلب يعيد توليد الوصف ويغيّر المطابقة', pr.status === 200 && pr.data.request.description.includes('غرف النوم: 5 على الأقل') && !(await M.c.get(`/api/requests/${r1id}/matches`)).data.matches.some((x: any) => x.property_id === v2));
  check('قائمة الطلبات وقراءة طلب', (await M.c.get('/api/requests')).data.items.length === 4 && (await M.c.get(`/api/requests/${r1id}`)).data.request.id === r1id);

  // الذكاء السعري: مطابقة حرفية لحساب PostgreSQL المباشر على البيانات نفسها
  const pi = await M.c.get('/api/analytics/prices?market=sale&kind=villa');
  const sqlMed = Number(await val(`SELECT round(percentile_cont(0.5) WITHIN GROUP (ORDER BY price/area_sqm)::numeric, 2) FROM properties WHERE org_id=$1 AND deleted_at IS NULL AND status='active' AND deal IN ('sale','investment') AND district_id=$2 AND (kind='villa' OR (kind IS NULL AND type='villa'))`, [orgM, fu]));
  const sqlN = Number(await val(`SELECT count(*) FROM properties WHERE org_id=$1 AND deleted_at IS NULL AND status='active' AND deal IN ('sale','investment') AND district_id=$2 AND (kind='villa' OR (kind IS NULL AND type='villa'))`, [orgM, fu]));
  const fuRow = pi.data.districts?.find((d: any) => d.district_id === fu);
  check('وسيط سعر المتر للفلل في الفروسية = حساب percentile_cont في القاعدة', pi.status === 200 && fuRow.summary.n === sqlN && sqlN === 6 && fuRow.summary.median === sqlMed, { api: fuRow?.summary, sqlMed, sqlN });
  const saRow = pi.data.districts.find((d: any) => d.district_id === sa);
  check('حي بعينة أقل من 3 = بلا وسيط ومعلَّم غير كافٍ (فيلا واحدة في الصفا)', saRow.summary.n === 1 && saRow.summary.median === null && saRow.summary.sufficient === false);
  const rent = await M.c.get('/api/analytics/prices?market=rent');
  const rentSa = rent.data.districts.find((d: any) => d.district_id === sa).summary;
  check('سعر متر الإيجار سنوي (4,000 شهريًا على 130م² = 369.23) والوسيط من 3 شقق', rentSa.n === 3 && rentSa.median === 375 && rentSa.min === 369.23 && rent.data.unit.includes('سنويًا'), rentSa);
  check('الاتجاه الشهري موجود ومن البيانات', pi.data.trend.length >= 1 && pi.data.trend.at(-1).summary.n === sqlN + 1);
  const da = await M.c.get('/api/analytics/districts');
  const daFu = da.data.items.find((d: any) => d.district_id === fu), daSa = da.data.items.find((d: any) => d.district_id === sa);
  check('تحليلات الأحياء: العروض حسب العملية، والطلبات المفتوحة، ونسبة الطلب للعرض', daFu.offers.sale === 6 && daFu.offers.investment === 1 && daFu.requests === 2 && daSa.offers.rent === 3 && daSa.requests === 3 && daFu.demand_supply === Math.round((2 / 7) * 100) / 100, { daFu, daSa });
  check('أكثر الأنواع في الحي من البيانات (فيلا أولًا في الفروسية: 5 منظمة + 1 قديمة)', daFu.top_kinds[0].label === 'فيلا' && daFu.top_kinds[0].n === 6, daFu.top_kinds);
  const e1 = await M.c.get(`/api/properties/${v1}/estimate`);
  check('تقدير القيمة من مقارنات الحي الفعلية (5 فلل أخرى)', e1.status === 200 && e1.data.estimate.ok === true && e1.data.estimate.level === 'district' && e1.data.estimate.n === 5 && !e1.data.estimate.comparables.includes(v1), e1.data);
  check('تقدير بلا عينة كافية = رفض صريح بلا رقم (فندق وحيد)', (await M.c.get(`/api/properties/${ht}/estimate`)).data.estimate.ok === false);

  const mp = await M.c.get('/api/map');
  const legPt = mp.data.offers?.find((o: any) => o.id === legacy);
  check('الخريطة: كل العروض موضوعة، والعرض بلا إحداثيات على مركز حيه ومعلَّم تقريبيًا', mp.status === 200 && mp.data.offers.length === 11 && mp.data.unplaced_offers === 0 && legPt?.approx === true && Math.abs(legPt.lat - 21.6023) < 0.01, { n: mp.data.offers?.length, legPt });
  check('الخريطة تبدأ بجدة وتتسع للنقاط، والطلبات على مراكز أحيائها', mp.data.start.south < 21.6 && mp.data.bounds.south <= 21.584 && mp.data.requests.length >= 5 && mp.data.unplaced_requests === 1);
  check('طبقة الأسعار: فقاعة لكل حي فيه نقاط، والكثافة مطبّعة', mp.data.districts.length === 2 && Math.max(...mp.data.heat.cells.flat()) === 1);
  const mapM = await M.c.get(`/api/map?request_id=${r2.data.request.id}`);
  check('طبقة المطابقة على الخريطة = نتائج المطابقة نفسها', JSON.stringify(mapM.data.matching.matches.map((x: any) => x.property_id).sort()) === JSON.stringify([...ids2].sort()));
  check('تصفية الخريطة بالعملية', (await M.c.get('/api/map?deal=rent')).data.offers.every((o: any) => o.deal === 'rent'));
  const cmp = await M.c.get(`/api/compare?ids=${v1},${v2},${a1}`);
  check('المقارنة: 3 عقارات بحقولها المنظمة وسعر المتر ووسيط الحي والتقدير', cmp.status === 200 && cmp.data.items.length === 3 && cmp.data.items[0].attributes.bedrooms === 5 && cmp.data.items[0].district_ppm.n === 5 && cmp.data.items[2].unit_price === 375 && cmp.data.items[0].estimate.ok === true);
  check('المقارنة تتطلب 2 إلى 4 عقارات', (await M.c.get(`/api/compare?ids=${v1}`)).status === 400 && (await M.c.get(`/api/compare?ids=${v1},${v2},${v3},${v4},${vn}`)).status === 400);

  check('عزل: المؤسسة B لا ترى طلبات M ولا مطابقاتها ولا تعدّلها', (await B.c.get(`/api/requests/${r1id}`)).status === 404 && (await B.c.get(`/api/requests/${r1id}/matches`)).status === 404 && (await B.c.patch(`/api/requests/${r1id}`, { budget_max: 1 })).status === 404 && (await B.c.del(`/api/requests/${r1id}`)).status === 404);
  check('عزل: B لا تقارن ولا تقدّر عقارات M', (await B.c.get(`/api/compare?ids=${v1},${v2}`)).status === 404 && (await B.c.get(`/api/properties/${v1}/estimate`)).status === 404);
  const piB = await B.c.get('/api/analytics/prices?market=sale&kind=villa');
  check('عزل: تحليلات B لا تحسب عقارات M', piB.data.districts.find((d: any) => d.district_id === fu).summary.n !== sqlN && !(await B.c.get('/api/map')).data.offers.some((o: any) => o.id === v1));
  check('الصلاحيات: المطّلع يقرأ التحليلات والطلبات ولا يضيف طلبًا، والطالب محجوب', (await viewer.c.get('/api/analytics/districts')).status === 200 && (await viewer.c.get('/api/requests')).status === 200 && (await viewer.c.post('/api/requests', r1In)).status === 403 && (await student.c.get('/api/analytics/prices')).status === 403 && (await student.c.get('/api/map')).status === 403);
  check('حذف الطلب ناعم ويخرجه من القائمة والخريطة', (await M.c.del(`/api/requests/${r1id}`)).status === 200 && (await M.c.get(`/api/requests/${r1id}`)).status === 404 && (await val(`SELECT deleted_at IS NOT NULL FROM requests WHERE id=$1`, [r1id])) === true);
  check('التدقيق سجّل إنشاء الطلب وتعديله وحذفه', Number(await val(`SELECT count(DISTINCT action) FROM audit_logs WHERE org_id=$1 AND action IN ('request.create','request.update','request.delete')`, [orgM])) === 3);

  section('13) الجلسات والخروج');
  const old = A.c.cookie;
  const lo = await A.c.post('/api/auth/logout');
  check('الخروج ينجح ويلغي الجلسة في الخادم', lo.status === 200 && (await val(`SELECT count(*) FROM sessions s JOIN users u ON u.id=s.user_id WHERE u.email=$1 AND s.token_hash=encode(digest($2,'sha256'),'hex')`, [A.email, old.split('=')[1]])) === '0');
  const replay = new Client(); replay.cookie = old;
  check('إعادة استعمال الكوكي القديم بعد الخروج = 401', (await replay.get('/api/properties')).status === 401);
  check('الخروج بلا جلسة = 401', (await new Client().post('/api/auth/logout')).status === 401);

  console.log(`\nالنتيجة: ${pass} نجح، ${fail} فشل`);
  await db.end();
  process.exit(fail ? 1 : 0);
}
main().catch(async (e) => { console.error('انهيار الاختبار:', e); await db.end().catch(() => {}); process.exit(2); });
