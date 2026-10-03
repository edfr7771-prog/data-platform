import { RequestsManager } from '@/components/RequestsManager';
import { requireUser } from '@/lib/auth';
import { loadGeo } from '@/lib/properties';
import { one } from '@/lib/db';
import { can } from '@/lib/rbac';

export const dynamic = 'force-dynamic';

export default async function RequestsPage({ searchParams }: { searchParams: Promise<{ customer_id?: string }> }) {
  const u = await requireUser('/app/requests');
  const role = u.org?.role;
  if (!can(role, 'request:read')) return <div role="alert" className="note err">لا تملك صلاحية عرض الطلبات.</div>;
  const geo = await loadGeo();
  const cid = (await searchParams).customer_id;
  // العميل يُعرض فقط إن كان ضمن منشأة المستخدم (والخادم يتحقق مجددًا عند الحفظ)
  const customer = cid && /^[0-9a-f-]{36}$/i.test(cid) && can(role, 'crm:read') ? await one<{ id: string; name: string }>(`SELECT id, name FROM customers WHERE id=$1 AND org_id=$2 AND deleted_at IS NULL`, [cid, u.org!.id]) : null;
  return (
    <div className="stack" style={{ gap: 18 }}>
      <h1 style={{ fontSize: 28 }}>الطلبات والمطابقة</h1>
      <RequestsManager cities={geo.cities.map((c) => ({ id: c.id, name_ar: c.name_ar }))} districts={geo.districts.map((d) => ({ id: d.id, city_id: d.city_id, name_ar: d.name_ar }))} canWrite={can(role, 'request:write')} customer={customer} />
    </div>
  );
}
