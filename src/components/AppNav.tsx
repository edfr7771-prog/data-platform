'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

export function AppNav({ items }: { items: { href: string; label: string }[] }) {
  const p = usePathname();
  return <>{items.map((i) => <Link key={i.href} href={i.href} aria-current={p === i.href ? 'page' : undefined}>{i.label}</Link>)}</>;
}
