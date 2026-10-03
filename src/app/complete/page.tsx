import { Brand } from '@/components/Brand';
import { CompleteForm } from '@/components/AuthForms';
import { requireUser } from '@/lib/auth';
import { displayPhone } from '@/lib/identifiers';

export const dynamic = 'force-dynamic';

export default async function CompletePage() {
  const u = await requireUser('/app', { allowIncomplete: true });
  const needPhone = !u.phone_verified;
  return (
    <>
      <header className="dark"><div className="wrap"><div className="bar"><Brand /></div></div></header>
      <main className="wrap" style={{ padding: '40px 20px', maxWidth: 520 }}>
        <h1 style={{ fontSize: 30 }}>أكمل حسابك</h1>
        <p className="muted">بريدك موثَّق. بقي توثيق جوالك بالرمز، ولا يُفعَّل الحساب قبل ذلك ولا يدخل أي صفحة محمية.</p>
        <div className="panel" style={{ marginTop: 18 }}><CompleteForm needPhone={needPhone} prefill={displayPhone(u.phone_verified ? null : u.phone_pending)} /></div>
      </main>
    </>
  );
}
