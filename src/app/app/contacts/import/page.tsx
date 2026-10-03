import { ContactsImport } from '@/components/ContactsImport';
import { requireUser } from '@/lib/auth';
import { can } from '@/lib/rbac';

export const dynamic = 'force-dynamic';

export default async function ContactsImportPage() {
  const u = await requireUser('/app/contacts/import');
  if (!can(u.org?.role, 'crm:write')) return <div role="alert" className="note err">لا تملك صلاحية استيراد العملاء.</div>;
  return (
    <div className="stack" style={{ gap: 18 }}>
      <a href="/app/contacts">← كل العملاء</a>
      <h1 style={{ fontSize: 28 }}>استيراد العملاء (CSV)</h1>
      <ContactsImport />
    </div>
  );
}
