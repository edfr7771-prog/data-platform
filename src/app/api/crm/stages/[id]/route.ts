import { fail, guard, json, readJson } from '@/lib/api';
import { updateStage } from '@/lib/crm-pipeline';

/** تسمية أو ترتيب أو أرشفة مرحلة (مدير المنشأة) */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const g = await guard(req, 'crm:manage'); if ('res' in g) return g.res;
  const b = await readJson(req, 5_000); if (!b) return fail(400, 'bad_json');
  const r = await updateStage(g.ctx, (await params).id, b);
  if (!r) return fail(404, 'not_found');
  return r.ok ? json(r) : fail(r.status, r.error, 'count' in r ? { count: r.count } : {});
}
