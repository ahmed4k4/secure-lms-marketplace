'use client';
import { useFormStatus } from 'react-dom';
import type { ReactNode } from 'react';
import { Button, type ButtonProps } from '@/components/ui/button';
import { Alert } from '@/components/ui/primitives';
import type { ActionState } from '@/lib/validation';

export function SubmitButton({ children, pendingText, ...props }: ButtonProps & { pendingText?: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending || props.disabled} aria-busy={pending} {...props}>
      {pending ? (pendingText ?? '…') : children}
    </Button>
  );
}

export function FormMessage({ state }: { state: ActionState }) {
  if (!state) return null;
  if (state.error) return <Alert tone="error">{state.error}</Alert>;
  if (state.message) return <Alert tone="success">{state.message}</Alert>;
  return null;
}

/** Submit button that asks for confirmation first (destructive actions). */
export function ConfirmSubmit({ children, message, ...props }: ButtonProps & { message: string; children: ReactNode }) {
  const { pending } = useFormStatus();
  return (
    <Button
      type="submit"
      disabled={pending}
      onClick={(e) => {
        if (!window.confirm(message)) e.preventDefault();
      }}
      {...props}
    >
      {children}
    </Button>
  );
}
