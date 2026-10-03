import { guard, json } from '@/lib/api';
import { runSweep } from '@/lib/crm-notify';

/** فحص الاستحقاق الآن: مواعيد المتابعة والمهام المتأخرة (بلا تكرار للتنبيه) */
export async function POST(req: Request) {
  const g = await guard(req, 'crm:write'); if ('res' in g) return g.res;
  return json({ ok: true, ...(await runSweep(g.ctx.orgId, true)) });
}
