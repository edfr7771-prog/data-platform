import { NotificationsList } from '@/components/NotificationsList';
import { requireUser } from '@/lib/auth';
import { can } from '@/lib/rbac';

export const dynamic = 'force-dynamic';

export default async function NotificationsPage() {
  const u = await requireUser('/app/notifications');
  if (!can(u.org?.role, 'crm:read')) return <div role="alert" className="note err">لا تملك صلاحية عرض التنبيهات.</div>;
  return (
    <div className="stack" style={{ gap: 18 }}>
      <h1 style={{ fontSize: 28 }}>التنبيهات</h1>
      <NotificationsList />
    </div>
  );
}
