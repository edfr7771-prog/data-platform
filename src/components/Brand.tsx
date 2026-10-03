import Link from 'next/link';

export function Brand({ href = '/' }: { href?: string }) {
  return (
    <Link href={href} className="brand">
      <svg width="40" height="40" viewBox="0 0 40 40" aria-hidden="true"><path d="M4 19 L20 6 L36 19" fill="none" stroke="#E0B454" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" /><rect x="11" y="21" width="18" height="12" rx="1.5" fill="none" stroke="currentColor" strokeWidth="2.4" /></svg>
      <span><b>تم الآن</b><small><span>لذكاء البيانات العقارية</span><span dir="ltr">TAMALAAN DATA</span></small></span>
    </Link>
  );
}
