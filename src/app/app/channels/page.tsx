import { ChannelsView } from '@/components/ChannelsView';
import { requireUser } from '@/lib/auth';
import { can } from '@/lib/rbac';

export const dynamic = 'force-dynamic';

export default async function ChannelsPage() {
  const u = await requireUser('/app/channels');
  const role = u.org?.role;
  if (!can(role, 'crm:read')) return <div role="alert" className="note err">لا تملك صلاحية عرض القنوات.</div>;
  return (
    <div className="stack" style={{ gap: 18 }}>
      <h1 style={{ fontSize: 28 }}>القنوات</h1>
      <ChannelsView canManage={can(role, 'crm:manage')} />
    </div>
  );
}
