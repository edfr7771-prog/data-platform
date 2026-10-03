import { ContactProfile } from '@/components/ContactProfile';
import { requireUser } from '@/lib/auth';
import { q } from '@/lib/db';
import { can } from '@/lib/rbac';

export const dynamic = 'force-dynamic';

export default async function ContactPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const u = await requireUser(`/app/contacts/${id}`);
  const role = u.org?.role;
  if (!can(role, 'crm:read')) return <div role="alert" className="note err">لا تملك صلاحية عرض العملاء.</div>;
  const members = await q<{ id: string; full_name: string | null }>(`SELECT u.id, u.full_name FROM organization_members m JOIN users u ON u.id=m.user_id WHERE m.org_id=$1 AND m.deleted_at IS NULL ORDER BY u.full_name`, [u.org!.id]);
  return (
    <div className="stack" style={{ gap: 12 }}>
      <a href="/app/contacts">← كل العملاء</a>
      <ContactProfile id={id} members={members} canWrite={can(role, 'crm:write')} canManage={can(role, 'crm:manage')} />
    </div>
  );
}
