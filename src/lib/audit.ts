import 'server-only';
import type { PoolClient } from 'pg';
import { q } from './db';

export type AuditEntry = {
  orgId?: string | null; actorId?: string | null; action: string; entity?: string; entityId?: string;
  meta?: Record<string, unknown>; ipHash?: string | null;
};
const SQL = `INSERT INTO audit_logs (org_id, actor_user_id, action, entity, entity_id, meta, ip_hash) VALUES ($1,$2,$3,$4,$5,$6,$7)`;
const args = (e: AuditEntry) => [e.orgId ?? null, e.actorId ?? null, e.action, e.entity ?? null, e.entityId ?? null, JSON.stringify(e.meta ?? {}), e.ipHash ?? null];

/** للعمليات الحساسة داخل معاملة: يفشل الجميع معًا إن فشل التدقيق، فلا عملية بلا أثر. لا تُسجَّل هنا أسرار ولا بيانات شخصية خام. */
export async function auditTx(c: PoolClient, e: AuditEntry): Promise<void> {
  await c.query(SQL, args(e));
}

/** لأحداث المصادقة خارج المعاملات: فشل التدقيق يُسجَّل في سجل الخادم ولا يكسر الدخول. */
export async function audit(e: AuditEntry): Promise<void> {
  try { await q(SQL, args(e)); } catch (err) { console.error('[audit] failed', (err as Error).message); }
}
