import { fail, guard, json, readJson } from '@/lib/api';
import { board, createOpportunity } from '@/lib/crm-pipeline';

/** لوحة الـPipeline: المراحل وفرص كل مرحلة */
export async function GET(req: Request) {
  const g = await guard(req, 'crm:read'); if ('res' in g) return g.res;
  const sp = new URL(req.url).searchParams;
  return json({ ok: true, ...(await board(g.ctx, { owner_id: sp.get('owner_id') ?? undefined, include_closed: sp.get('include_closed') === '1' })) });
}

export async function POST(req: Request) {
  const g = await guard(req, 'crm:write'); if ('res' in g) return g.res;
  const b = await readJson(req, 10_000); if (!b) return fail(400, 'bad_json');
  const r = await createOpportunity(g.ctx, b);
  return r.ok ? json(r, 201) : fail(r.status, r.error);
}
