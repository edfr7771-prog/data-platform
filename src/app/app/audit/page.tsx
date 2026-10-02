import { requireUser } from '@/lib/auth';
import { q } from '@/lib/db';
import { can } from '@/lib/rbac';

export const dynamic = 'force-dynamic';

export default async function AuditPage() {
  const u = await requireUser('/app/audit');
  if (!can(u.org?.role, 'audit:read')) return <div role="alert" className="note err">سجل التدقيق لمدير المؤسسة وحده.</div>;
  const rows = await q<{ created_at: Date; action: string; entity: string | null; actor: string | null }>(
    `SELECT a.created_at, a.action, a.entity, u.full_name AS actor FROM audit_logs a LEFT JOIN users u ON u.id=a.actor_user_id WHERE a.org_id=$1 ORDER BY a.created_at DESC LIMIT 100`, [u.org!.id]);
  return (
    <div className="stack" style={{ gap: 18 }}>
      <h1 style={{ fontSize: 28 }}>سجل التدقيق</h1>
      <div className="twrap" role="region" aria-label="سجل التدقيق" tabIndex={0}>
        <table><thead><tr><th>الوقت</th><th>العملية</th><th>الكيان</th><th>المنفِّذ</th></tr></thead>
          <tbody>{rows.map((r, i) => <tr key={i}><td dir="ltr">{r.created_at.toISOString().replace('T', ' ').slice(0, 19)}</td><td dir="ltr">{r.action}</td><td dir="ltr">{r.entity ?? '—'}</td><td>{r.actor ?? '—'}</td></tr>)}</tbody></table>
      </div>
    </div>
  );
}
