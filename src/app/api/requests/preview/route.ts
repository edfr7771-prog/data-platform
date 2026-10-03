import { fail, guard, json, readJson } from '@/lib/api';
import { previewRequest } from '@/lib/requests';

/** معاينة وصف الطلب قبل حفظه، بلا كتابة */
export async function POST(req: Request) {
  const g = await guard(req, 'request:write'); if ('res' in g) return g.res;
  const b = await readJson(req, 50_000); if (!b) return fail(400, 'bad_json');
  const r = await previewRequest(b);
  return r.ok ? json(r) : fail(400, 'validation', { errors: r.errors });
}
