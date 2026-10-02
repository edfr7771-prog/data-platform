import Link from 'next/link';
import { requireUser } from '@/lib/auth';
import { one, q } from '@/lib/db';
import { can } from '@/lib/rbac';
import { fmt } from '@/components/labels';

export const dynamic = 'force-dynamic';

export default async function Dashboard() {
  const u = await requireUser('/app');
  const org = u.org!.id;
  const [props, imports, last] = await Promise.all([
    one<{ n: string; ppm: string | null }>(`SELECT count(*)::text AS n, round(avg(price_per_sqm) FILTER (WHERE deal='sale'))::text AS ppm FROM properties WHERE org_id=$1 AND deleted_at IS NULL`, [org]),
    one<{ n: string }>(`SELECT count(*)::text AS n FROM imports WHERE org_id=$1 AND status='approved'`, [org]),
    q<{ filename: string; approved_at: Date }>(`SELECT filename, approved_at FROM imports WHERE org_id=$1 AND status='approved' ORDER BY approved_at DESC LIMIT 3`, [org]),
  ]);
  return (
    <div className="stack" style={{ gap: 22 }}>
      <h1 style={{ fontSize: 28 }}>مرحبًا {u.full_name}</h1>
      <div className="grid">
        <div className="panel"><div className="muted">عدد العقارات</div><b style={{ fontSize: 30 }}>{fmt(props?.n)}</b></div>
        <div className="panel"><div className="muted">متوسط سعر المتر (بيع، من بياناتك)</div><b style={{ fontSize: 30 }}>{props?.ppm ? fmt(props.ppm) : '—'}</b><div className="muted" style={{ fontSize: 14 }}>{props?.ppm ? `المصدر: بياناتك المرفوعة · حجم العينة ${fmt(props.n)}` : 'لا بيانات كافية بعد'}</div></div>
        <div className="panel"><div className="muted">عمليات استيراد معتمدة</div><b style={{ fontSize: 30 }}>{fmt(imports?.n)}</b></div>
      </div>
      <div className="note">التحليلات المتقدمة والمطابقة الذكية والخرائط في المراحل التالية. هذه المرحلة: إدارة العقارات واستيراد CSV بتدقيق وعزل بين المؤسسات.</div>
      <div className="row">
        {can(u.org!.role, 'property:read') && <Link className="btn" href="/app/properties">العقارات</Link>}
        {can(u.org!.role, 'import:run') && <Link className="btn gold" href="/app/imports">استيراد ملف CSV</Link>}
      </div>
      {last.length > 0 && <div className="panel"><b>آخر الاستيرادات</b><ul style={{ margin: '8px 0 0', paddingInlineStart: 20 }}>{last.map((l, i) => <li key={i}>{l.filename}</li>)}</ul></div>}
    </div>
  );
}
