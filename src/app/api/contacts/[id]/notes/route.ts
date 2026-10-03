import { fail, guard, json, readJson } from '@/lib/api';
import { addNote } from '@/lib/crm-contacts';

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const g = await guard(req, 'crm:write'); if ('res' in g) return g.res;
  const b = await readJson(req, 20_000); if (!b) return fail(400, 'bad_json');
  const r = await addNote(g.ctx, (await params).id, b);
  if (!r) return fail(404, 'not_found');
  return r.ok ? json({ ok: true }, 201) : fail(400, 'validation', { errors: r.errors });
}
