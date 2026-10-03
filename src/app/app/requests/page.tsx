import { RequestsManager } from '@/components/RequestsManager';
import { requireUser } from '@/lib/auth';
import { loadGeo } from '@/lib/properties';
import { can } from '@/lib/rbac';

export const dynamic = 'force-dynamic';

export default async function RequestsPage() {
  const u = await requireUser('/app/requests');
  const role = u.org?.role;
  if (!can(role, 'request:read')) return <div role="alert" className="note err">لا تملك صلاحية عرض الطلبات.</div>;
  const geo = await loadGeo();
  return (
    <div className="stack" style={{ gap: 18 }}>
      <h1 style={{ fontSize: 28 }}>الطلبات والمطابقة</h1>
      <RequestsManager cities={geo.cities.map((c) => ({ id: c.id, name_ar: c.name_ar }))} districts={geo.districts.map((d) => ({ id: d.id, city_id: d.city_id, name_ar: d.name_ar }))} canWrite={can(role, 'request:write')} />
    </div>
  );
}
