import { fail, guard, json, readJson } from '@/lib/api';
import { deleteDraft, getDraft, updateDraft } from '@/lib/property-drafts';

type P = { params: Promise<{ id: string }> };

export async function GET(req: Request, { params }: P) {
  const g = await guard(req, 'property:write'); if ('res' in g) return g.res;
  const d = await getDraft(g.ctx, (await params).id);
  return d ? json({ ok: true, draft: d }) : fail(404, 'not_found');
}

export async function PUT(req: Request, { params }: P) {
  const g = await guard(req, 'property:write'); if ('res' in g) return g.res;
  const b = await readJson(req, 50_000); if (!b) return fail(400, 'bad_json');
  return (await updateDraft(g.ctx, (await params).id, b.data)) ? json({ ok: true }) : fail(404, 'not_found');
}

export async function DELETE(req: Request, { params }: P) {
  const g = await guard(req, 'property:write'); if ('res' in g) return g.res;
  return (await deleteDraft(g.ctx, (await params).id)) ? json({ ok: true }) : fail(404, 'not_found');
}
