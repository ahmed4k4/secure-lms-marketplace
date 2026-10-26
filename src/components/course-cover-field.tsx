'use client';
import Image from 'next/image';
import { useEffect, useState } from 'react';
import { ImagePlus, UploadCloud, CheckCircle2, AlertCircle } from 'lucide-react';
import { Field } from '@/components/action-form';

const MAX_BYTES = 4 * 1024 * 1024;
const TYPES = ['image/jpeg', 'image/png', 'image/webp'];

type Props = {
  currentUrl?: string | null;
  label: string;
  chooseLabel: string;
  hint: string;
  uploadingLabel: string;
  uploadedLabel: string;
  uploadFailedLabel: string;
  invalidFileLabel: string;
  uploadAgainLabel: string;
};

export function CourseCoverField(props: Props) {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(props.currentUrl ?? null);
  const [objectKey, setObjectKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<'idle' | 'uploaded' | 'error'>('idle');
  const [error, setError] = useState('');

  useEffect(() => {
    if (!file) return;
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  async function choose(next: File | null) {
    setFile(next);
    setObjectKey('');
    setStatus('idle');
    setError('');
    if (!next) { setPreview(props.currentUrl ?? null); return; }
    if (!TYPES.includes(next.type) || next.size <= 0 || next.size > MAX_BYTES) {
      setError(props.invalidFileLabel); setStatus('error'); setFile(null); setPreview(props.currentUrl ?? null); return;
    }
    setBusy(true);
    try {
      const body = new FormData(); body.set('file', next);
      const response = await fetch('/api/uploads/cover', { method: 'POST', body, credentials: 'same-origin', cache: 'no-store' });
      const result = await response.json().catch(() => null) as { objectKey?: string; publicUrl?: string; error?: { message?: string } } | null;
      if (!response.ok || !result?.objectKey || !result.publicUrl) throw new Error(result?.error?.message ?? props.uploadFailedLabel);
      setObjectKey(result.objectKey);
      setPreview(result.publicUrl);
      setStatus('uploaded');
    } catch (e) {
      setStatus('error'); setError(e instanceof Error ? e.message : props.uploadFailedLabel);
      setFile(null); setPreview(props.currentUrl ?? null); setObjectKey('');
    } finally { setBusy(false); }
  }

  return (
    <Field label={props.label} htmlFor="coverFile" hint={props.hint}>
      <input type="hidden" name="coverObjectKey" value={objectKey} />
      <input type="hidden" name="coverUploadRequested" value={file ? 'true' : 'false'} />
      <div className="grid gap-4 sm:grid-cols-[180px_1fr] sm:items-center">
        <div className="relative aspect-[4/3] overflow-hidden rounded-xl border border-border bg-steel">
          {preview ? <Image src={preview} alt={props.label} fill unoptimized sizes="180px" className="object-cover" /> :
            <div className="grid h-full place-items-center text-muted-foreground"><ImagePlus className="h-9 w-9" aria-hidden="true" /></div>}
          {busy && <div className="absolute inset-x-0 bottom-0 h-1.5 overflow-hidden bg-carbon"><div className="h-full w-2/5 animate-pulse bg-arc" /></div>}
        </div>
        <div className="space-y-3">
          <label htmlFor="coverFile" className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-border bg-panel px-4 py-2.5 text-sm font-semibold text-silver transition hover:border-arc hover:text-foreground">
            <UploadCloud className="h-4 w-4" aria-hidden="true" />{file && status === 'uploaded' ? props.uploadAgainLabel : props.chooseLabel}
          </label>
          <input id="coverFile" type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" disabled={busy} onChange={(event) => void choose(event.currentTarget.files?.[0] ?? null)} />
          <p className="text-xs text-muted-foreground">JPG, PNG, WebP · 4 MB max · 4:3 recommended</p>
          {busy && <p role="status" className="flex items-center gap-2 text-sm text-silver"><span className="h-2 w-2 animate-pulse rounded-full bg-arc" />{props.uploadingLabel}</p>}
          {status === 'uploaded' && !busy && <p role="status" className="flex items-center gap-2 text-sm text-success"><CheckCircle2 className="h-4 w-4" />{props.uploadedLabel}</p>}
          {status === 'error' && error && <p role="alert" className="flex items-center gap-2 text-sm text-danger"><AlertCircle className="h-4 w-4" />{error || props.uploadFailedLabel}</p>}
        </div>
      </div>
    </Field>
  );
}
