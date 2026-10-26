'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';

export function NavLinks({ links, className, itemClass }: { links: { href: string; label: string }[]; className?: string; itemClass?: string }) {
  const pathname = usePathname();
  return (
    <>
      {links.map((l) => {
        const active = pathname === l.href || pathname.startsWith(`${l.href}/`);
        return (
          <Link key={l.href} href={l.href} aria-current={active ? 'page' : undefined}
            className={cn('rounded-md px-3 py-2 text-sm font-semibold transition-colors duration-fast', active ? 'text-arc' : 'text-silver hover:text-foreground', itemClass, className)}>
            {l.label}
          </Link>
        );
      })}
    </>
  );
}
