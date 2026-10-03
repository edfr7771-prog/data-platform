import { fail, guard, json, readJson } from '@/lib/api';
import { createStage, listStages } from '@/lib/crm-pipeline';

export async function GET(req: Request) {
  const g = await guard(req, 'crm:read'); if ('res' in g) return g.res;
  return json({ ok: true, items: await listStages(g.ctx, new URL(req.url).searchParams.get('archived') === '1') });
}

/** مرحلة جديدة (مدير المنشأة): المراحل قابلة للتوسعة */
export async function POST(req: Request) {
  const g = await guard(req, 'crm:manage'); if ('res' in g) return g.res;
  const b = await readJson(req, 5_000); if (!b) return fail(400, 'bad_json');
  const r = await createStage(g.ctx, b);
  return r.ok ? json(r, 201) : fail(r.status, r.error);
}
