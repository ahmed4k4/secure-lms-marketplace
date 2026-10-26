'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Check, FileText, Lock, Play } from 'lucide-react';
import { cn, formatDuration } from '@/lib/utils';

export function LessonLink({ href, title, type, done, locked, seconds }: { href: string; title: string; type: 'video' | 'text'; done: boolean; locked: boolean; seconds?: number | null }) {
  const active = usePathname() === href;
  const Icon = done ? Check : locked ? Lock : type === 'video' ? Play : FileText;
  return (
    <Link href={href} aria-current={active ? 'page' : undefined}
      className={cn('flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors duration-fast', active ? 'bg-arc/10 text-arc' : 'text-silver hover:bg-steel/70', locked && !active && 'text-muted-foreground')}>
      <span className={cn('flex h-5 w-5 shrink-0 items-center justify-center rounded-full', done ? 'bg-ok text-primary-foreground' : 'border border-border')}>
        <Icon className="h-3 w-3" strokeWidth={done ? 3 : 2} aria-hidden />
      </span>
      <span className="min-w-0 flex-1 truncate">{title}</span>
      {!!seconds && <span dir="ltr" className="num text-xs text-muted-foreground">{formatDuration(seconds)}</span>}
    </Link>
  );
}
