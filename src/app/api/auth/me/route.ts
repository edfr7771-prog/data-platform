import { guardSession, json } from '@/lib/api';
import { contactStatus } from '@/lib/contact-policy';

export async function GET(req: Request) {
  const g = await guardSession(req); if ('res' in g) return g.res;
  const u = g.user;
  return json({ ok: true, user: { id: u.id, full_name: u.full_name, email: u.email, phone: u.phone, platform_role: u.platform_role, org: u.org }, status: contactStatus(u) });
}
