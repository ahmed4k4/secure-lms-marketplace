'use client';
import { useActionState, useEffect, useRef, type ReactNode } from 'react';
import { FormMessage, SubmitButton } from '@/components/form-bits';
import type { ActionState } from '@/lib/validation';
import type { ButtonProps } from '@/components/ui/button';

/** Progressive-enhancement form bound to a server action, with inline status messages. */
export function ActionForm({
  action, children, submitLabel, variant, className, resetOnSuccess = false, hideSubmit = false,
}: {
  action: (state: ActionState, formData: FormData) => Promise<ActionState>;
  children?: ReactNode;
  submitLabel: string;
  variant?: ButtonProps['variant'];
  className?: string;
  resetOnSuccess?: boolean;
  hideSubmit?: boolean;
}) {
  const [state, formAction] = useActionState(action, undefined);
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (resetOnSuccess && state?.ok) ref.current?.reset();
  }, [state, resetOnSuccess]);
  return (
    <form ref={ref} action={formAction} className={className ?? 'space-y-4'}>
      {children}
      <FormMessage state={state} />
      {!hideSubmit && <SubmitButton variant={variant}>{submitLabel}</SubmitButton>}
    </form>
  );
}

export function Field({ label, htmlFor, children, hint }: { label: string; htmlFor: string; children: ReactNode; hint?: string }) {
  return (
    <div>
      <label htmlFor={htmlFor} className="mb-1.5 block text-sm font-medium">{label}</label>
      {children}
      {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}
