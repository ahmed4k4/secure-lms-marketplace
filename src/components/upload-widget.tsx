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

function putPartWithProgress(url: string, chunk: Blob, onProgress: (loaded: number) => void) {
  return new Promise<string>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', url);
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded);
    xhr.onload = () => {
      const etag = xhr.getResponseHeader('ETag');
      if (xhr.status >= 200 && xhr.status < 300 && etag) resolve(etag);
      else reject(new Error(xhr.status >= 200 && xhr.status < 300 ? 'R2 CORS must expose the ETag response header.' : `upload part failed (${xhr.status})`));
    };
    xhr.onerror = () => reject(new Error('network error during multipart upload'));
    xhr.send(chunk);
  });
}

/** Direct-to-R2 upload: the file never passes through our server. */
export function UploadWidget({ kind, lessonId, label }: { kind: 'video' | 'resource'; lessonId: string; label: string }) {
  const { t, locale } = useT();
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [message, setMessage] = useState<{ tone: 'error' | 'success'; text: string } | null>(null);

  async function onFile(file: File) {
    let multipartSessionId = '';
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
      if (kind === 'video' && session.mode === 'multipart') {
        const partSize = Number(session.partSizeBytes);
        const count = Number(session.partCount);
        if (!session.multipartSessionId || !Number.isFinite(partSize) || partSize < 5 * 1024 * 1024 || !Number.isInteger(count) || count < 1 || count > 10000) throw new Error('Invalid multipart upload session.');
        multipartSessionId = String(session.multipartSessionId);
        const etags: Array<{ partNumber: number; etag: string }> = [];
        const loadedByPart = new Map<number, number>();
        let nextPart = 1;
        const uploadWorker = async () => {
          while (true) {
            const partNumber = nextPart++;
            if (partNumber > count) return;
            const start = (partNumber - 1) * partSize;
            const chunk = file.slice(start, Math.min(file.size, start + partSize));
            const ticketResponse = await fetch('/api/uploads/multipart/part', {
              method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ lessonId, sessionId: session.multipartSessionId, partNumber }),
            });
            const ticket = await ticketResponse.json();
            if (!ticketResponse.ok) throw new Error(ticket?.error?.message ?? `Could not prepare upload part ${partNumber}.`);
            const etag = await putPartWithProgress(ticket.url, chunk, (loaded) => {
              loadedByPart.set(partNumber, loaded);
              const total = [...loadedByPart.values()].reduce((sum, value) => sum + value, 0);
              setProgress(Math.min(99, total / file.size * 100));
            });
            loadedByPart.set(partNumber, chunk.size);
            etags.push({ partNumber, etag });
          }
        };
        await Promise.all(Array.from({ length: Math.min(3, count) }, () => uploadWorker()));
        etags.sort((a, b) => a.partNumber - b.partNumber);
        const complete = await fetch('/api/uploads/multipart/complete', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ lessonId, sessionId: session.multipartSessionId, parts: etags }),
        });
        const completeBody = await complete.json();
        if (!complete.ok) throw new Error(completeBody?.error?.message ?? 'Could not complete multipart upload.');
      } else {
        await putWithProgress(session.url, file, session.headers, setProgress);
      }
      const confirm = await fetch('/api/uploads/confirm', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind, id: session.uploadId, durationSeconds }),
      });
      const done = await confirm.json();
      if (!confirm.ok) throw new Error(done?.error?.message ?? 'verification failed');
      setMessage({ tone: 'success', text: kind === 'video' ? (locale === 'ar' ? 'تم رفع الفيديو. يتم الآن تحويله لجودات متعددة وسيظهر للطلاب بعد اكتمال المعالجة.' : 'Video uploaded. Adaptive qualities are processing and will appear when ready.') : t('upload.done') });
      router.refresh();
    } catch (e) {
      if (multipartSessionId) {
        await fetch('/api/uploads/multipart/abort', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ lessonId, sessionId: multipartSessionId }) }).catch(() => undefined);
      }
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
