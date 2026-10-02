import { fail, guard, json, readJson } from '@/lib/api';
import { approveImport } from '@/lib/imports';

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const g = await guard(req, 'import:run'); if ('res' in g) return g.res;
  const b = (await readJson(req)) ?? {};
  const r = await approveImport(g.ctx, (await params).id, { includeReview: b.include_review === true });
  if (!r.ok) return fail(r.error === 'not_found' ? 404 : 409, r.error);
  return json({ ok: true, report: r.report });
}
