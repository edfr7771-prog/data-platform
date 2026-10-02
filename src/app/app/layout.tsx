import { Brand } from '@/components/Brand';
import { AppNav } from '@/components/AppNav';
import { LogoutButton } from '@/components/AuthForms';
import { ROLE_AR } from '@/components/labels';
import { requireUser } from '@/lib/auth';
import { can } from '@/lib/rbac';

export const dynamic = 'force-dynamic';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const u = await requireUser('/app');
  const role = u.org?.role;
  const items = [{ href: '/app', label: 'لوحتي' }];
  if (can(role, 'property:read')) items.push({ href: '/app/properties', label: 'العقارات' });
  if (can(role, 'import:run')) items.push({ href: '/app/imports', label: 'الاستيراد' });
  if (can(role, 'audit:read')) items.push({ href: '/app/audit', label: 'سجل التدقيق' });
  return (
    <>
      <header className="dark"><div className="wrap"><div className="bar">
        <Brand href="/app" />
        <nav className="nav" aria-label="التنقل الرئيسي"><AppNav items={items} /><LogoutButton /></nav>
      </div>
      <div style={{ paddingBottom: 12, fontSize: 14, color: '#B7C7DD' }}>{u.org?.name} · {role ? ROLE_AR[role] ?? role : 'بلا دور'} · {u.full_name}</div></div></header>
      <main className="wrap" style={{ padding: '28px 20px 56px' }}>{children}</main>
    </>
  );
}
