import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const field =
  'field-focus w-full rounded-md border border-border bg-deep px-3.5 py-2 text-[15px] text-foreground placeholder:text-muted-foreground/70 transition-[border-color,box-shadow] duration-fast ease-brand disabled:opacity-60 aria-[invalid=true]:border-err';

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(({ className, ...p }, ref) => (
  <input ref={ref} className={cn(field, 'h-11', className)} {...p} />
));
Input.displayName = 'Input';

export const Textarea = React.forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(({ className, ...p }, ref) => (
  <textarea ref={ref} className={cn(field, 'min-h-28 py-3 leading-relaxed', className)} {...p} />
));
Textarea.displayName = 'Textarea';

export const Select = React.forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement>>(({ className, ...p }, ref) => (
  <select ref={ref} className={cn(field, 'h-11', className)} {...p} />
));
Select.displayName = 'Select';

export function Label({ className, ...p }: React.LabelHTMLAttributes<HTMLLabelElement>) {
  return <label className={cn('mb-1.5 block text-sm font-semibold text-silver', className)} {...p} />;
}

export function Card({ className, chrome, ...p }: React.HTMLAttributes<HTMLDivElement> & { chrome?: boolean }) {
  return <div className={cn('rounded-lg border border-border bg-card', chrome && 'chrome-edge', className)} {...p} />;
}
export function CardHeader({ className, ...p }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('border-b border-border px-5 py-4', className)} {...p} />;
}
export function CardBody({ className, ...p }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('p-5', className)} {...p} />;
}

const badgeVariants = cva('inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-semibold leading-5', {
  variants: {
    tone: {
      neutral: 'border-border bg-transparent text-silver',
      brand: 'border-arc/60 bg-arc/10 text-arc',
      copper: 'border-copper/60 bg-copper/10 text-copper',
      success: 'border-ok/40 bg-ok/10 text-success',
      warn: 'border-warn/40 bg-warn/10 text-warn',
      danger: 'border-err/40 bg-err/10 text-err',
    },
  },
  defaultVariants: { tone: 'neutral' },
});
export function Badge({ className, tone, ...p }: React.HTMLAttributes<HTMLSpanElement> & VariantProps<typeof badgeVariants>) {
  return <span className={cn(badgeVariants({ tone }), className)} {...p} />;
}

export function Alert({ tone = 'info', className, children, ...p }: React.HTMLAttributes<HTMLDivElement> & { tone?: 'info' | 'error' | 'success' | 'warn' }) {
  const tones = {
    info: ['border-border bg-steel/60 text-foreground', 'bg-arc'],
    error: ['border-err/40 bg-err/10 text-err', 'bg-err'],
    success: ['border-ok/40 bg-ok/10 text-success', 'bg-ok'],
    warn: ['border-warn/40 bg-warn/10 text-warn', 'bg-warn'],
  } as const;
  return (
    <div role={tone === 'error' ? 'alert' : 'status'} className={cn('flex items-start gap-3 rounded-md border px-4 py-3 text-sm', tones[tone][0], className)} {...p}>
      <span aria-hidden className={cn('mt-2 h-2 w-2 shrink-0 rounded-full', tones[tone][1])} />
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

export function Progress({ value, className, label }: { value: number; className?: string; label?: string }) {
  const v = Math.max(0, Math.min(100, Math.round(value)));
  return (
    <div role="progressbar" aria-valuenow={v} aria-valuemin={0} aria-valuemax={100} aria-label={label} className={cn('h-1.5 w-full overflow-hidden rounded-full bg-steel', className)}>
      <div className="h-full rounded-full bg-arc transition-[width] duration-slow ease-brand" style={{ width: `${v}%`, boxShadow: v > 0 ? '0 0 10px rgb(var(--arc) / .5)' : undefined }} />
    </div>
  );
}

export function EmptyState({ title, hint, children }: { title: string; hint?: string; children?: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-dashed border-border px-6 py-14 text-center">
      <p className="font-display text-lg font-semibold">{title}</p>
      {hint && <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">{hint}</p>}
      {children && <div className="mt-5">{children}</div>}
    </div>
  );
}
