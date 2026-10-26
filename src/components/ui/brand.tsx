import Image from 'next/image';
import * as React from 'react';
import { cn } from '@/lib/utils';

/** Mono spec label, e.g. "// CATALOG". Latin text only. */
export function MonoLabel({ children, className }: { children: React.ReactNode; className?: string }) {
  return <span dir="ltr" className={cn('label-mono inline-block', className)}>{children}</span>;
}

/** Latin technical term inside Arabic copy: ltr span in Arc (design-system mixed-language rule). */
export function Tech({ children }: { children: React.ReactNode }) {
  return <span dir="ltr" className="font-display text-arc">{children}</span>;
}

export function Port({ className }: { className?: string }) {
  return <span aria-hidden className={cn('port', className)} />;
}

/** Brand mark (from the official identity file). A vector master is still recommended by the identity guide. */
export function LogoMark({ size = 40, className }: { size?: number; className?: string }) {
  return <Image src="/brand/mark.png" alt="" width={size} height={size} unoptimized priority className={cn('shrink-0 rounded-[22%]', className)} />;
}

export function Wordmark({ name }: { name: string }) {
  return (
    <span className="flex flex-col leading-none">
      <span dir="ltr" className="font-display text-[19px] font-semibold tracking-tight text-silver">{name}</span>
      <span dir="ltr" className="mt-1 font-mono text-[9px] font-medium tracking-[0.22em] text-muted-foreground">INTEGRATED SYSTEMS</span>
    </span>
  );
}

/** 48/56 container for pictograms: default · active · filled · glass. */
export function IconBox({ children, variant = 'default', size = 48, className }: { children: React.ReactNode; variant?: 'default' | 'active' | 'filled' | 'glass'; size?: 48 | 56; className?: string }) {
  const styles = {
    default: 'bg-deep text-silver border border-border',
    active: 'bg-deep text-arc border border-arc',
    filled: 'bg-arc text-primary-foreground border border-arc',
    glass: 'glass text-silver',
  } as const;
  return (
    <span className={cn('inline-flex shrink-0 items-center justify-center rounded-[14px]', styles[variant], className)} style={{ width: size, height: size }}>
      {children}
    </span>
  );
}

export function Stars({ value, size = 14, className }: { value: number; size?: number; className?: string }) {
  const pct = Math.max(0, Math.min(100, (value / 5) * 100));
  const star = 'M12 2.5l2.9 6.1 6.6.9-4.8 4.6 1.2 6.6L12 17.5 6.1 20.7l1.2-6.6L2.5 9.5l6.6-.9L12 2.5z';
  const row = (fill: string) => (
    <span className="flex">{[0, 1, 2, 3, 4].map((i) => (
      <svg key={i} width={size} height={size} viewBox="0 0 24 24" aria-hidden><path d={star} fill={fill} /></svg>
    ))}</span>
  );
  return (
    <span className={cn('relative inline-flex', className)} role="img" aria-label={`${value.toFixed(1)} / 5`} dir="ltr">
      <span className="text-steel">{row('currentColor')}</span>
      <span className="absolute inset-y-0 start-0 overflow-hidden text-copper" style={{ width: `${pct}%` }}>{row('currentColor')}</span>
    </span>
  );
}

/**
 * "Bus" motif: parallel traces that break at 45° and end in nodes. One Arc trace carries the single glowing port.
 * Decorative only (aria-hidden), mirrored automatically in RTL.
 */
export function Bus({ className, accent = true }: { className?: string; accent?: boolean }) {
  const lines = [0, 1, 2, 3, 4];
  const W = 900, H = 260;
  const path = (i: number) => {
    const y = 130 + i * 16, bx = 380 + i * 14;
    return `M0 ${y} H${bx} L${bx + 70} ${y - 70 - i * 6} H${W}`;
  };
  return (
    <svg aria-hidden viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMaxYMid slice" className={cn('pointer-events-none text-line rtl:-scale-x-100', className)} fill="none">
      {lines.map((i) => <path key={i} d={path(i)} stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" opacity={0.9 - i * 0.12} pathLength={1} />)}
      {lines.map((i) => <circle key={`n${i}`} cx={6 + i * 4} cy={130 + i * 16} r="3" stroke="currentColor" strokeWidth="1.2" />)}
      {accent && (
        <>
          <path d={path(0)} stroke="rgb(var(--arc))" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ filter: 'drop-shadow(0 0 6px rgb(var(--arc) / .6))' }} />
          <circle cx={W - 22} cy={130 - 70} r="14" fill="rgb(var(--arc) / .18)" />
          <circle cx={W - 22} cy={130 - 70} r="6" fill="rgb(var(--arc))" />
        </>
      )}
    </svg>
  );
}
