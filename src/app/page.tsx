import Link from 'next/link';
import { Brand } from '@/components/Brand';

// أرقام العرض هنا ثابتة وموسومة «تجريبية»: لا تُعرض على أنها بيانات سوق. اللوحة الحقيقية داخل /app من بيانات المستخدم.
const DEMO = [
  { k: 'متوسط سعر المتر', v: '6,145', u: 'ريال' }, { k: 'عدد العقارات', v: '823', u: 'سجل' }, { k: 'عدد الطلبات', v: '724', u: 'طلب' },
  { k: 'عدد العروض', v: '588', u: 'عرض' }, { k: 'تغير الأسعار', v: '+4.2%', u: 'خلال 12 شهرًا' },
];

export default function Home() {
  return (
    <>
      <header className="dark"><div className="wrap">
        <div className="bar">
          <Brand />
          <nav className="nav" aria-label="الحساب">
            <Link href="/login">تسجيل الدخول</Link>
            <Link href="/register" className="btn gold sm">إنشاء حساب</Link>
          </nav>
        </div>
        <div className="hero">
          <h1>من البيانات إلى القرار العقاري الذكي</h1>
          <p>حلّل السوق، قارن العقارات، اكتشف الفرص، وطابق طلبات العملاء مع أفضل العروض باستخدام علوم البيانات والذكاء الاصطناعي.</p>
          <div className="cta">
            <Link href="/register" className="btn gold">ابدأ التحليل</Link>
            <Link href="/login" className="btn line">جرّب المنصة</Link>
            <a href="#demo" style={{ color: '#B7C7DD', textDecoration: 'underline', textUnderlineOffset: 5, minHeight: 46, display: 'inline-flex', alignItems: 'center' }}>استكشف السوق</a>
          </div>
          <p style={{ fontSize: 14, color: '#B7C7DD', marginTop: 28 }}>منتج قيد التطوير (المرحلة الأولى): الحسابات والعقارات واستيراد CSV تعمل. التحليلات والمطابقة والخرائط في المراحل التالية.</p>
        </div>
      </div></header>

      <section id="demo" className="block"><div className="wrap">
        <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
          <h2 style={{ fontSize: 28 }}>لوحة السوق</h2>
          <span className="demo-tag">بيانات تجريبية لأغراض العرض</span>
        </div>
        <p className="muted" style={{ maxWidth: '40rem' }}>هذه أرقام توضيحية ثابتة، وليست بيانات سوق حقيقية ولا رسمية. بعد إنشاء حسابك تُحسب اللوحة من بياناتك أنت، ويظهر بجانب كل رقم مصدره وحجم عينته.</p>
        <div className="kpis" style={{ marginTop: 18, background: 'var(--navy2)', padding: 16, borderRadius: 14, color: '#fff' }}>
          {DEMO.map((d) => <div className="kpi" key={d.k}><small>{d.k}</small><b>{d.v}</b><small>{d.u}</small></div>)}
        </div>
      </div></section>

      <footer className="site"><div className="wrap">
        <div>تم الآن لذكاء البيانات العقارية | TAMALAAN DATA: معاينة قيد التطوير. لا يُسمّى أي مؤشر رسميًا إلا بمصدره الرسمي.</div>
      </div></footer>
    </>
  );
}
