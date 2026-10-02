import { fail, guard, json, readJson } from '@/lib/api';
import { getImport, remapImport } from '@/lib/imports';

type P = { params: Promise<{ id: string }> };

export async function GET(req: Request, { params }: P) {
  const g = await guard(req, 'import:run'); if ('res' in g) return g.res;
  const sp = new URL(req.url).searchParams;
  const r = await getImport(g.ctx, (await params).id, { status: sp.get('status') ?? undefined, limit: Number(sp.get('limit') ?? 100) || 100 });
  return r ? json({ ok: true, ...r }) : fail(404, 'not_found');
}

/** تعديل تطابق الأعمدة: {"mapping": {"price": 6, "area_sqm": 5}}؛ الصفوف الأصلية لا تُمسّ. */
export async function PATCH(req: Request, { params }: P) {
  const g = await guard(req, 'import:run'); if ('res' in g) return g.res;
  const b = await readJson(req); if (!b) return fail(400, 'bad_json');
  const r = await remapImport(g.ctx, (await params).id, b.mapping);
  return r.ok ? json({ ok: true, summary: r.summary }) : fail(r.status, r.error);
}
