import { ContactsList } from '@/components/ContactsList';
import { requireUser } from '@/lib/auth';
import { q } from '@/lib/db';
import { loadGeo } from '@/lib/properties';
import { can } from '@/lib/rbac';

export const dynamic = 'force-dynamic';

export default async function ContactsPage() {
  const u = await requireUser('/app/contacts');
  const role = u.org?.role;
  if (!can(role, 'crm:read')) return <div role="alert" className="note err">لا تملك صلاحية عرض العملاء.</div>;
  const [geo, members] = await Promise.all([loadGeo(), q<{ id: string; full_name: string | null }>(`SELECT u.id, u.full_name FROM organization_members m JOIN users u ON u.id=m.user_id WHERE m.org_id=$1 AND m.deleted_at IS NULL ORDER BY u.full_name`, [u.org!.id])]);
  return (
    <div className="stack" style={{ gap: 18 }}>
      <h1 style={{ fontSize: 28 }}>العملاء</h1>
      <ContactsList cities={geo.cities.map((c) => ({ id: c.id, name_ar: c.name_ar }))} members={members} canWrite={can(role, 'crm:write')} />
    </div>
  );
}
