import { notFound } from 'next/navigation';
import { Brand } from '@/components/Brand';
import { EnquiryForm } from '@/components/EnquiryForm';
import { formKeyExists } from '@/lib/crm-channels';

export const dynamic = 'force-dynamic';

/** نموذج الاستفسار العام للمنشأة (بمفتاح النموذج). لا يكشف اسم المنشأة ولا أي بيانات عقارات. */
export default async function EnquirePage({ params, searchParams }: { params: Promise<{ key: string }>; searchParams: Promise<{ property?: string; request?: string }> }) {
  const { key } = await params;
  if (!(await formKeyExists(key))) notFound();
  const sp = await searchParams;
  return (
    <>
      <header className="dark"><div className="wrap"><div className="bar"><Brand href="/" /></div></div></header>
      <main className="wrap" style={{ padding: '28px 20px 56px', maxWidth: 640 }}>
        <h1 style={{ fontSize: 26, marginBottom: 12 }}>أرسل استفسارك</h1>
        <p className="muted" style={{ marginTop: 0 }}>سيتواصل معك فريق المكتب العقاري. لا تُرسل أي بيانات إلى طرف ثالث.</p>
        <EnquiryForm formKey={key} propertyId={typeof sp.property === 'string' ? sp.property : undefined} requestId={typeof sp.request === 'string' ? sp.request : undefined} />
      </main>
    </>
  );
}
