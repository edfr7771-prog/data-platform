import { fail, guard, json, readJson } from '@/lib/api';
import { createRequest, listRequests } from '@/lib/requests';

export async function GET(req: Request) {
  const g = await guard(req, 'request:read'); if ('res' in g) return g.res;
  const sp = new URL(req.url).searchParams;
  return json({ ok: true, ...(await listRequests(g.ctx, { page: Number(sp.get('page') ?? 1) || 1, pageSize: Number(sp.get('pageSize') ?? 25) || 25 })) });
}

export async function POST(req: Request) {
  const g = await guard(req, 'request:write'); if ('res' in g) return g.res;
  const b = await readJson(req, 50_000); if (!b) return fail(400, 'bad_json');
  const r = await createRequest(g.ctx, b);
  return r.ok ? json({ ok: true, request: r.request, ignored: r.ignored }, 201) : fail(400, 'validation', { errors: r.errors });
}
