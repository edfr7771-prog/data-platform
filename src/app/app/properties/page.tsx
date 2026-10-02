import { PropertiesManager } from '@/components/PropertiesManager';
import { requireUser } from '@/lib/auth';
import { loadGeo } from '@/lib/properties';
import { can } from '@/lib/rbac';

export const dynamic = 'force-dynamic';

export default async function PropertiesPage() {
  const u = await requireUser('/app/properties');
  const role = u.org?.role;
  if (!can(role, 'property:read')) return <div role="alert" className="note err">لا تملك صلاحية عرض العقارات.</div>;
  const geo = await loadGeo();
  return (
    <div className="stack" style={{ gap: 18 }}>
      <h1 style={{ fontSize: 28 }}>العقارات</h1>
      <PropertiesManager districts={geo.districts.map((d) => ({ id: d.id, name_ar: d.name_ar }))} canWrite={can(role, 'property:write')} canDelete={can(role, 'property:delete')} canExport={can(role, 'property:export')} />
    </div>
  );
}
