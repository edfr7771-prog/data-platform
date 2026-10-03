import { fail, guard, json, readJson } from '@/lib/api';
import { setMatchStatus } from '@/lib/crm-pipeline';

/** حالة متابعة المطابقة في الـCRM: {status} */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const g = await guard(req, 'crm:write'); if ('res' in g) return g.res;
  const b = await readJson(req, 2_000); if (!b) return fail(400, 'bad_json');
  const r = await setMatchStatus(g.ctx, (await params).id, b);
  if (!r) return fail(404, 'not_found');
  return r.ok ? json(r) : fail(r.status, r.error);
}
