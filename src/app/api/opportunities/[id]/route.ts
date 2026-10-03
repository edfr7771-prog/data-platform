import { fail, guard, json, readJson } from '@/lib/api';
import { getOpportunity, moveOpportunity } from '@/lib/crm-pipeline';

type P = { params: Promise<{ id: string }> };

/** الفرصة وتاريخ انتقالها بين المراحل */
export async function GET(req: Request, { params }: P) {
  const g = await guard(req, 'crm:read'); if ('res' in g) return g.res;
  const r = await getOpportunity(g.ctx, (await params).id);
  return r ? json({ ok: true, ...r }) : fail(404, 'not_found');
}

/** نقل الفرصة إلى مرحلة: {stage_key | stage_id, note?} */
export async function PATCH(req: Request, { params }: P) {
  const g = await guard(req, 'crm:write'); if ('res' in g) return g.res;
  const b = await readJson(req, 5_000); if (!b) return fail(400, 'bad_json');
  const r = await moveOpportunity(g.ctx, (await params).id, b);
  if (!r) return fail(404, 'not_found');
  return r.ok ? json(r) : fail(r.status, r.error);
}
