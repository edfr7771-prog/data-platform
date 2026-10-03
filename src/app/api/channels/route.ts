import { guard, json } from '@/lib/api';
import { can } from '@/lib/rbac';
import { channelsOverview } from '@/lib/crm-channels';

/** حالة القنوات الصادقة (متصلة فقط بعد ثبوت الاتصال فعليًا) */
export async function GET(req: Request) {
  const g = await guard(req, 'crm:read'); if ('res' in g) return g.res;
  return json({ ok: true, items: await channelsOverview(g.ctx, can(g.ctx.role, 'crm:manage')) });
}
