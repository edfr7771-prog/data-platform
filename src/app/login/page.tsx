import Link from 'next/link';
import { Brand } from '@/components/Brand';
import { LoginForm } from '@/components/AuthForms';

export default function LoginPage() {
  return (
    <>
      <header className="dark"><div className="wrap"><div className="bar"><Brand /></div></div></header>
      <main className="wrap" style={{ padding: '40px 20px', maxWidth: 520 }}>
        <h1 style={{ fontSize: 30 }}>تسجيل الدخول</h1>
        <p className="muted">اكتب بريدك وجوالك المسجَّلين معًا؛ نتحقق أنهما لحساب واحد ثم نرسل رمزًا واحدًا إلى الوسيلة التي تختارها. لا حساب لديك؟ <Link href="/register">أنشئ حسابًا</Link></p>
        <div className="panel" style={{ marginTop: 18 }}><LoginForm /></div>
      </main>
    </>
  );
}
