import { AnalyticsView } from '@/components/AnalyticsView';
import { requireUser } from '@/lib/auth';
import { can } from '@/lib/rbac';

export const dynamic = 'force-dynamic';

export default async function AnalyticsPage() {
  const u = await requireUser('/app/analytics');
  if (!can(u.org?.role, 'analytics:read')) return <div role="alert" className="note err">لا تملك صلاحية التحليلات.</div>;
  return (
    <div className="stack" style={{ gap: 18 }}>
      <h1 style={{ fontSize: 28 }}>التحليلات والذكاء السعري</h1>
      <AnalyticsView />
    </div>
  );
}
