import { fail, guard, json, readJson } from '@/lib/api';
import { deleteProperty, getProperty, updateProperty } from '@/lib/properties';

type P = { params: Promise<{ id: string }> };

export async function GET(req: Request, { params }: P) {
  const g = await guard(req, 'property:read'); if ('res' in g) return g.res;
  const p = await getProperty(g.ctx, (await params).id);
  return p ? json({ ok: true, property: p }) : fail(404, 'not_found');
}

export async function PATCH(req: Request, { params }: P) {
  const g = await guard(req, 'property:write'); if ('res' in g) return g.res;
  const b = await readJson(req); if (!b) return fail(400, 'bad_json');
  const r = await updateProperty(g.ctx, (await params).id, b);
  if (!r) return fail(404, 'not_found');
  return r.ok ? json({ ok: true, property: r.property, warnings: r.warnings, fixes: r.fixes }) : fail(400, 'validation', { errors: r.errors });
}

export async function DELETE(req: Request, { params }: P) {
  const g = await guard(req, 'property:delete'); if ('res' in g) return g.res;
  return (await deleteProperty(g.ctx, (await params).id)) ? json({ ok: true }) : fail(404, 'not_found');
}
