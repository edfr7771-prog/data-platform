import { fail, guard, json, readJson } from '@/lib/api';
import { getContactProfile, updateContact } from '@/lib/crm-contacts';

type P = { params: Promise<{ id: string }> };

/** ملف العميل الموحد */
export async function GET(req: Request, { params }: P) {
  const g = await guard(req, 'crm:read'); if ('res' in g) return g.res;
  const p = await getContactProfile(g.ctx, (await params).id);
  return p ? json({ ok: true, ...p }) : fail(404, 'not_found');
}

export async function PATCH(req: Request, { params }: P) {
  const g = await guard(req, 'crm:write'); if ('res' in g) return g.res;
  const b = await readJson(req, 20_000); if (!b) return fail(400, 'bad_json');
  const r = await updateContact(g.ctx, (await params).id, b);
  if (!r) return fail(404, 'not_found');
  return r.ok ? json({ ok: true, contact: r.contact }) : fail(r.status, r.error, { errors: r.errors });
}
