'use client';
import { useActionState } from 'react';
import { createInstructorAction } from '@/actions/admin';
import { FormMessage, SubmitButton } from '@/components/form-bits';
import { Alert, Input, Label } from '@/components/ui/primitives';
import { useT } from '@/lib/i18n/provider';

export function CreateInstructorForm() {
  const { t } = useT();
  const [state, action] = useActionState(createInstructorAction, undefined);
  return (
    <form action={action} className="grid gap-3 sm:grid-cols-2">
      <div><Label htmlFor="ci-name">{t('auth.full_name')}</Label><Input id="ci-name" name="fullName" required minLength={2} maxLength={100} /></div>
      <div><Label htmlFor="ci-email">{t('auth.email')}</Label><Input id="ci-email" name="email" type="email" required /></div>
      <div className="space-y-3 sm:col-span-2">
        <FormMessage state={state?.data ? { ...state, message: undefined } : state} />
        {state?.data && (
          <Alert tone="success">
            <p className="font-medium">{t('admin.instructor_invited')}</p>
            <p className="mt-1 text-sm">{t('admin.invite_instructions')}</p>
            <p className="mt-2 font-mono text-sm" dir="ltr">{state.data.email}</p>
          </Alert>
        )}
        <SubmitButton>{t('admin.create_instructor')}</SubmitButton>
      </div>
    </form>
  );
}
