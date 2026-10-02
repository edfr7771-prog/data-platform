import { fail, guard, json, readJson } from '@/lib/api';
import { createProperty, listProperties } from '@/lib/properties';

export async function GET(req: Request) {
  const g = await guard(req, 'property:read'); if ('res' in g) return g.res;
  const sp = new URL(req.url).searchParams;
  const data = await listProperties(g.ctx, { page: Number(sp.get('page') ?? 1) || 1, pageSize: Number(sp.get('pageSize') ?? 25) || 25, type: sp.get('type') ?? undefined, deal: sp.get('deal') ?? undefined, district_id: sp.get('district_id') ?? undefined });
  return json({ ok: true, ...data });
}

export async function POST(req: Request) {
  const g = await guard(req, 'property:write'); if ('res' in g) return g.res;
  const b = await readJson(req); if (!b) return fail(400, 'bad_json');
  const r = await createProperty(g.ctx, b);
  return r.ok ? json({ ok: true, property: r.property, warnings: r.warnings, fixes: r.fixes }, 201) : fail(400, 'validation', { errors: r.errors });
}
