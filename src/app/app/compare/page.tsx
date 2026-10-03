import { CompareView } from '@/components/CompareView';
import { requireUser } from '@/lib/auth';
import { can } from '@/lib/rbac';

export const dynamic = 'force-dynamic';

export default async function ComparePage({ searchParams }: { searchParams: Promise<{ ids?: string }> }) {
  const u = await requireUser('/app/compare');
  if (!can(u.org?.role, 'analytics:read')) return <div role="alert" className="note err">لا تملك صلاحية المقارنة.</div>;
  const ids = String((await searchParams).ids ?? '').split(',').filter(Boolean).slice(0, 4);
  return (
    <div className="stack" style={{ gap: 18 }}>
      <h1 style={{ fontSize: 28 }}>مقارنة العقارات</h1>
      <CompareView ids={ids} />
    </div>
  );
}
