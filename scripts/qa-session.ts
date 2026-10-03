// أداة QA: تسجّل حسابًا بالمسار الحقيقي (محليًا) وتطبع كوكي الجلسة لفحوص المتصفح. الاستعمال: tsx scripts/qa-session.ts [complete|incomplete]
const BASE = process.env.TEST_APP_URL ?? 'http://localhost:3000';
const mode = process.argv[2] ?? 'complete';
let cookie = '';
async function post(path: string, body: unknown) {
  const r = await fetch(BASE + path, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: BASE, Cookie: cookie, 'X-Forwarded-For': `198.51.100.${1 + Math.floor(Math.random() * 250)}` }, body: JSON.stringify(body) });
  for (const c of r.headers.getSetCookie?.() ?? []) { const [kv] = c.split(';'); cookie = kv; }
  return r.json() as Promise<any>;
}
async function main() {
  const id = Date.now().toString(36) + Math.floor(Math.random() * 999);
  const phone = `05${String(10_000_000 + Math.floor(Math.random() * 80_000_000))}`;
  const s = await post('/api/auth/otp/start', { mode: 'register', name: 'مستخدم فحص الواجهة', email: `qa-${id}@test.local`, phone, consent: true });
  await post('/api/auth/otp/verify', { challengeId: s.challengeId, code: s.devCode });
  if (mode === 'complete') {
    const p = await post('/api/auth/complete', { kind: 'phone', value: phone });
    await post('/api/auth/otp/verify', { challengeId: p.challengeId, code: p.devCode });
    const types = ['villa', 'apartment', 'land', 'building', 'office'];
    for (let i = 0; i < 9; i++) await post('/api/properties', { type: types[i % 5], deal: i % 4 === 3 ? 'rent' : 'sale', district: ['الفروسية', 'الرياض', 'الرحمانية', 'النزهة', 'الصفا'][i % 5], area_sqm: 200 + i * 35, price: 900_000 + i * 120_000, age_years: i, rooms: 3 + (i % 4), external_ref: `QA-${i}` });
  }
  console.log(cookie);
}
main().catch((e) => { console.error(e); process.exit(1); });
