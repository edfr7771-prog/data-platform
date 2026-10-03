'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

export function AppNav({ items }: { items: { href: string; label: string; badge?: number }[] }) {
  const p = usePathname();
  return <>{items.map((i) => (
    <Link key={i.href} href={i.href} aria-current={p === i.href ? 'page' : undefined}>
      {i.label}{i.badge ? <> <span className="count" aria-label={`${i.badge} غير مقروء`}>{i.badge > 99 ? '99+' : i.badge}</span></> : null}
    </Link>
  ))}</>;
}
