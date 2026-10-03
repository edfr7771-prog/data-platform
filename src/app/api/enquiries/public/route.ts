import { fail, guardPublic, json, readJson } from '@/lib/api';
import { publicEnquiry } from '@/lib/crm-channels';

/** استفسار من نموذج المنصة العام (بمفتاح نموذج المنشأة، من المنصة نفسها: فحص الأصل وحد المعدل) */
export async function POST(req: Request) {
  const g = await guardPublic(req); if ('res' in g) return g.res;
  const b = await readJson(req, 10_000); if (!b) return fail(400, 'bad_json');
  const r = await publicEnquiry(b, g.ipHash);
  return r.ok ? json(r, r.duplicate ? 200 : 201) : fail(r.status, r.error, 'errors' in r ? { errors: r.errors } : {});
}
