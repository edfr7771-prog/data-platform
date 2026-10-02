import Link from 'next/link';
import { Brand } from '@/components/Brand';
import { RegisterForm } from '@/components/AuthForms';
import { appUrl } from '@/lib/env';
import { registrationOpen } from '@/lib/contact-policy';

export const dynamic = 'force-dynamic';

export default function RegisterPage() {
  const open = registrationOpen(process.env, appUrl());
  return (
    <>
      <header className="dark"><div className="wrap"><div className="bar"><Brand /></div></div></header>
      <main className="wrap" style={{ padding: '40px 20px', maxWidth: 520 }}>
        <h1 style={{ fontSize: 30 }}>إنشاء حساب</h1>
        <p className="muted">الاسم والبريد والجوال إلزامية وموثَّقة لكل حساب: رمز للبريد ثم رمز للجوال. بلا كلمات مرور. لديك حساب؟ <Link href="/login">سجّل الدخول</Link></p>
        <div className="panel" style={{ marginTop: 18 }}>
          {open ? <RegisterForm /> : <div role="alert" className="note err">التسجيل غير متاح مؤقتًا: تسليم البريد أو رسائل الجوال قيد الإعداد. لا يُقبل حساب لا نستطيع توثيق بريده وجواله.</div>}
        </div>
      </main>
    </>
  );
}
