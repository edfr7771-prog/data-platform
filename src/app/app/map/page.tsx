import { MarketMap } from '@/components/MarketMap';
import { requireUser } from '@/lib/auth';
import { can } from '@/lib/rbac';

export const dynamic = 'force-dynamic';

export default async function MapPage({ searchParams }: { searchParams: Promise<{ request_id?: string }> }) {
  const u = await requireUser('/app/map');
  if (!can(u.org?.role, 'analytics:read')) return <div role="alert" className="note err">لا تملك صلاحية الخريطة.</div>;
  const sp = await searchParams;
  return (
    <div className="stack" style={{ gap: 18 }}>
      <h1 style={{ fontSize: 28 }}>خريطة السوق: جدة</h1>
      <MarketMap initialRequest={typeof sp.request_id === 'string' ? sp.request_id : undefined} />
    </div>
  );
}
