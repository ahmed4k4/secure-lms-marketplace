'use client';
import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Maximize } from 'lucide-react';
import { useT } from '@/lib/i18n/provider';
import { Alert } from '@/components/ui/primitives';

type Grant = { url: string; ttlSeconds: number; watermark: string; seekAllowed?: boolean };
export type PlayerHandle = { seek: (seconds: number) => void; getTime: () => number };
const ERR_KEYS: Record<string, string> = {
  TOO_MANY_STREAMS: 'player.too_many', NO_ACCESS: 'player.no_access', VIDEO_NOT_READY: 'player.not_ready',
  SUSPICIOUS_SHARING: 'player.blocked', RATE_LIMITED: 'err.rate_limited', LESSON_NOT_OPEN: 'player.not_open', LESSON_CLOSED: 'player.closed',
};

/**
 * Protected player. The signed URL is short-lived and re-issued (re-authorizing every time).
 * The visible watermark and disabled download/context-menu controls are deterrents, NOT DRM.
 */
export const VideoPlayer = forwardRef<PlayerHandle, { lessonId: string; startAt: number; onEnded?: () => void }>(function VideoPlayer({ lessonId, startAt, onEnded }, handle) {
  const { t } = useT();
  const router = useRouter();
  const videoRef = useRef<HTMLVideoElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const sessionId = useRef('');
  const resume = useRef({ pos: startAt, playing: false });
  const lastRefresh = useRef(0);
  const lastAllowedTime = useRef(startAt);
  const seekGuard = useRef(false);
  const [grant, setGrant] = useState<Grant | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [wmPos, setWmPos] = useState({ top: 12, left: 12 });

  useImperativeHandle(handle, () => ({
    seek: (s) => { const v = videoRef.current; if (v) { v.currentTime = s; void v.play().catch(() => undefined); } },
    getTime: () => Math.floor(videoRef.current?.currentTime ?? 0),
  }));

  const requestGrant = useCallback(async () => {
    const res = await fetch(`/api/lessons/${lessonId}/playback`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sessionId: sessionId.current }) });
    const body = await res.json();
    if (!res.ok) { setError(ERR_KEYS[body?.error?.code] ?? 'err.generic'); return null; }
    setError(null);
    return body as Grant;
  }, [lessonId]);

  const saveProgress = useCallback(async (completed?: boolean) => {
    const v = videoRef.current;
    if (!v) return;
    const res = await fetch(`/api/lessons/${lessonId}/progress`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: sessionId.current, positionSeconds: Math.floor(v.currentTime), ...(completed ? { completed: true } : {}) }),
    });
    if (res.status === 403) { v.pause(); setGrant(null); setError('player.no_access'); } // access revoked mid-playback
  }, [lessonId]);

  useEffect(() => {
    sessionId.current = crypto.randomUUID().replace(/-/g, '');
    let alive = true;
    requestGrant().then((g) => alive && g && setGrant(g));
    return () => { alive = false; };
  }, [requestGrant]);

  useEffect(() => { // proactive refresh at 80% of the TTL (re-checks access), keeping position
    if (!grant) return;
    const id = setTimeout(async () => {
      const v = videoRef.current;
      if (v) resume.current = { pos: v.currentTime, playing: !v.paused };
      const g = await requestGrant();
      if (g) setGrant(g);
    }, grant.ttlSeconds * 800);
    return () => clearTimeout(id);
  }, [grant, requestGrant]);

  useEffect(() => { // heartbeat for the concurrent-stream limiter + resume position
    const id = setInterval(() => { const v = videoRef.current; if (v && !v.paused && !v.ended) void saveProgress(); }, 20000);
    return () => clearInterval(id);
  }, [saveProgress]);

  useEffect(() => { // move the watermark so it cannot be cropped out
    const id = setInterval(() => setWmPos({ top: 8 + Math.random() * 72, left: 6 + Math.random() * 60 }), 10000);
    return () => clearInterval(id);
  }, []);

  const onLoaded = () => {
    const v = videoRef.current;
    if (!v) return;
    if (resume.current.pos > 0 && resume.current.pos < v.duration - 3) v.currentTime = resume.current.pos;
    if (resume.current.playing) void v.play().catch(() => undefined);
  };

  const onVideoError = async () => {
    if (Date.now() - lastRefresh.current < 30000) return;
    lastRefresh.current = Date.now();
    const v = videoRef.current;
    if (v) resume.current = { pos: v.currentTime, playing: !v.paused };
    const g = await requestGrant();
    if (g) setGrant(g);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    const v = videoRef.current;
    if (!v || (e.target as HTMLElement).tagName === 'INPUT' || e.metaKey || e.ctrlKey || e.altKey) return;
    const jump = (d: number) => { v.currentTime = Math.max(0, Math.min(v.duration || 1e9, v.currentTime + d)); };
    switch (e.key) {
      case ' ': case 'k': e.preventDefault(); if (v.paused) void v.play(); else v.pause(); break;
      case 'ArrowLeft': e.preventDefault(); jump(-5); break;
      case 'ArrowRight': e.preventDefault(); jump(5); break;
      case 'j': jump(-10); break;
      case 'l': jump(10); break;
      case 'm': v.muted = !v.muted; break;
      case 'f': void boxRef.current?.requestFullscreen?.(); break;
      case '>': v.playbackRate = Math.min(2, v.playbackRate + 0.25); break;
      case '<': v.playbackRate = Math.max(0.5, v.playbackRate - 0.25); break;
    }
  };

  if (error) return <Alert tone="error">{t(error as never)}</Alert>;
  if (!grant) return <div role="status" className="aspect-video animate-pulse rounded-lg bg-steel" aria-busy="true" aria-label={t('player.loading')} />;

  return (
    <div ref={boxRef} tabIndex={0} onKeyDown={onKeyDown} aria-label={t('player.region')}
      className="chrome-edge relative overflow-hidden rounded-lg bg-black outline-none focus-visible:shadow-[var(--glow)]" onContextMenu={(e) => e.preventDefault()}>
      <video
        ref={videoRef} key={grant.url} src={grant.url} controls playsInline preload="metadata"
        controlsList="nodownload nofullscreen noremoteplayback" disablePictureInPicture className="aspect-video w-full"
        onLoadedMetadata={onLoaded} onError={onVideoError} onSeeking={() => { const v = videoRef.current; if (!grant.seekAllowed && v && !seekGuard.current && Math.abs(v.currentTime - lastAllowedTime.current) > 1.5) { seekGuard.current = true; v.currentTime = lastAllowedTime.current; queueMicrotask(() => { seekGuard.current = false; }); } }} onTimeUpdate={() => { const v = videoRef.current; if (v && !v.seeking) lastAllowedTime.current = v.currentTime; }} onPause={() => void saveProgress()}
        onEnded={() => { void saveProgress(true).then(() => { router.refresh(); onEnded?.(); }); }}
      />
      <span aria-hidden className="pointer-events-none absolute select-none font-mono text-xs text-white/45 [text-shadow:0_0_3px_rgba(0,0,0,.8)] transition-all duration-slow" style={{ top: `${wmPos.top}%`, insetInlineStart: `${wmPos.left}%` }}>
        {grant.watermark}
      </span>
      <button type="button" onClick={() => void boxRef.current?.requestFullscreen?.()} className="absolute end-2 top-2 rounded-md bg-black/55 p-1.5 text-white hover:bg-black/75" aria-label={t('player.fullscreen')}>
        <Maximize className="h-4 w-4" strokeWidth={1.75} />
      </button>
    </div>
  );
});
