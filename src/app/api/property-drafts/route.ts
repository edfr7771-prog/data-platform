import { fail, guard, json, readJson } from '@/lib/api';
import { createDraft, listDrafts } from '@/lib/property-drafts';

export async function GET(req: Request) {
  const g = await guard(req, 'property:write'); if ('res' in g) return g.res;
  return json({ ok: true, items: await listDrafts(g.ctx) });
}

export async function POST(req: Request) {
  const g = await guard(req, 'property:write'); if ('res' in g) return g.res;
  const b = await readJson(req, 50_000); if (!b) return fail(400, 'bad_json');
  const r = await createDraft(g.ctx, b.data);
  return r.ok ? json({ ok: true, id: r.id }, 201) : fail(409, r.error);
}
