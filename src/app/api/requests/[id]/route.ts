import { fail, guard, json, readJson } from '@/lib/api';
import { deleteRequest, getRequest, updateRequest } from '@/lib/requests';

type P = { params: Promise<{ id: string }> };

export async function GET(req: Request, { params }: P) {
  const g = await guard(req, 'request:read'); if ('res' in g) return g.res;
  const r = await getRequest(g.ctx, (await params).id);
  return r ? json({ ok: true, request: r }) : fail(404, 'not_found');
}

export async function PATCH(req: Request, { params }: P) {
  const g = await guard(req, 'request:write'); if ('res' in g) return g.res;
  const b = await readJson(req, 50_000); if (!b) return fail(400, 'bad_json');
  const r = await updateRequest(g.ctx, (await params).id, b);
  if (!r) return fail(404, 'not_found');
  return r.ok ? json({ ok: true, request: r.request }) : fail(400, 'validation', { errors: r.errors });
}

export async function DELETE(req: Request, { params }: P) {
  const g = await guard(req, 'request:write'); if ('res' in g) return g.res;
  return (await deleteRequest(g.ctx, (await params).id)) ? json({ ok: true }) : fail(404, 'not_found');
}
