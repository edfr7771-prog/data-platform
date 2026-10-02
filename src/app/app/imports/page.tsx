import { ImportWizard } from '@/components/ImportWizard';
import { requireUser } from '@/lib/auth';
import { can } from '@/lib/rbac';

export const dynamic = 'force-dynamic';

export default async function ImportsPage() {
  const u = await requireUser('/app/imports');
  if (!can(u.org?.role, 'import:run')) return <div role="alert" className="note err">لا تملك صلاحية الاستيراد.</div>;
  return (<div className="stack" style={{ gap: 18 }}><h1 style={{ fontSize: 28 }}>استيراد العقارات</h1><ImportWizard /></div>);
}
