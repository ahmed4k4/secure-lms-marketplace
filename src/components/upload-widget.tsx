'use client';
import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Alert, Progress } from '@/components/ui/primitives';
import { useT } from '@/lib/i18n/provider';

const VIDEO_ACCEPT = 'video/mp4,video/webm,video/quicktime';
const RESOURCE_ACCEPT = '.pdf,.zip,.txt,.png,.jpg,.jpeg,.docx,.pptx,.xlsx';
const EXT_TYPES: Record<string, string> = {
  pdf: 'application/pdf', zip: 'application/zip', txt: 'text/plain', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
};

function readDuration(file: File): Promise<number | undefined> {
  return new Promise((resolve) => {
    const v = document.createElement('video');
    v.preload = 'metadata';
    v.onloadedmetadata = () => { URL.revokeObjectURL(v.src); resolve(Number.isFinite(v.duration) ? Math.ceil(v.duration) : undefined); };
    v.onerror = () => resolve(undefined);
    v.src = URL.createObjectURL(file);
  });
}

function putWithProgress(url: string, file: File, headers: Record<string, string>, onProgress: (p: number) => void) {
  return new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', url);
    Object.entries(headers).forEach(([k, v]) => xhr.setRequestHeader(k, v));
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress((e.loaded / e.total) * 100);
    xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(`upload failed (${xhr.status})`)));
    xhr.onerror = () => reject(new Error('network error'));
    xhr.send(file);
  });
}

/** Direct-to-R2 upload: the file never passes through our server. */
export function UploadWidget({ kind, lessonId, label }: { kind: 'video' | 'resource'; lessonId: string; label: string }) {
  const { t } = useT();
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [message, setMessage] = useState<{ tone: 'error' | 'success'; text: string } | null>(null);

  async function onFile(file: File) {
    setMessage(null);
    const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
    const contentType = kind === 'video' ? file.type : EXT_TYPES[ext] ?? file.type;
    try {
      setProgress(0);
      const durationSeconds = kind === 'video' ? await readDuration(file) : undefined;
      const create = await fetch('/api/uploads', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(kind === 'video'
          ? { kind, lessonId, contentType, sizeBytes: file.size, durationSeconds }
          : { kind, lessonId, filename: file.name, contentType, sizeBytes: file.size }),
      });
      const session = await create.json();
      if (!create.ok) throw new Error(session?.error?.message ?? 'upload refused');
      await putWithProgress(session.url, file, session.headers, setProgress);
      const confirm = await fetch('/api/uploads/confirm', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind, id: session.uploadId, durationSeconds }),
      });
      const done = await confirm.json();
      if (!confirm.ok) throw new Error(done?.error?.message ?? 'verification failed');
      setMessage({ tone: 'success', text: t('upload.done') });
      router.refresh();
    } catch (e) {
      setMessage({ tone: 'error', text: (e as Error).message });
    } finally {
      setProgress(null);
      if (input.current) input.current.value = '';
    }
  }

  return (
    <div className="space-y-2">
      <input ref={input} type="file" className="sr-only" id={`file-${kind}`} accept={kind === 'video' ? VIDEO_ACCEPT : RESOURCE_ACCEPT} onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])} />
      <Button type="button" variant="outline" disabled={progress !== null} onClick={() => input.current?.click()}>{label}</Button>
      {progress !== null && <Progress value={progress} label={t('upload.progress')} />}
      {message && <Alert tone={message.tone}>{message.text}</Alert>}
    </div>
  );
}
