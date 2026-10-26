'use client';
import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Maximize, ShieldCheck } from 'lucide-react';
import { useT } from '@/lib/i18n/provider';
import { Alert } from '@/components/ui/primitives';
import type Hls from 'hls.js';

type Grant = { url: string; ttlSeconds: number; watermark: string; captureDeterrenceEnabled?: boolean; seekAllowed?: boolean; streamType?: 'hls' | 'mp4' };
type Quality = { index: number; label: string };
export type PlayerHandle = { seek: (seconds: number) => void; getTime: () => number };
const ERR_KEYS: Record<string, string> = {
  TOO_MANY_STREAMS: 'player.too_many', NO_ACCESS: 'player.no_access', VIDEO_NOT_READY: 'player.not_ready',
  VIDEO_PROCESSING: 'player.processing', VIDEO_PROCESSING_FAILED: 'player.failed', PLAYBACK_SESSION_INVALID: 'player.session_expired',
  SUSPICIOUS_SHARING: 'player.blocked', RATE_LIMITED: 'err.rate_limited', LESSON_NOT_OPEN: 'player.not_open', LESSON_CLOSED: 'player.closed',
};

/** HLS/VOD player with manual adaptive-quality selection and deterrence telemetry, not DRM. */
export const VideoPlayer = forwardRef<PlayerHandle, { lessonId: string; startAt: number; onEnded?: () => void }>(function VideoPlayer({ lessonId, startAt, onEnded }, handle) {
  const { t, locale } = useT();
  const router = useRouter();
  const videoRef = useRef<HTMLVideoElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const sessionId = useRef('');
  const hlsRef = useRef<Hls | null>(null);
  const resume = useRef({ pos: startAt, playing: false });
  const lastRefresh = useRef(0);
  const lastAllowedTime = useRef(startAt);
  const seekGuard = useRef(false);
  const eventCooldown = useRef(new Map<string, number>());
  const [grant, setGrant] = useState<Grant | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [wmPos, setWmPos] = useState({ top: 12, left: 12 });
  const [clock, setClock] = useState('');
  const [captureMask, setCaptureMask] = useState(false);
  const [qualities, setQualities] = useState<Quality[]>([]);
  const [quality, setQuality] = useState(-1);

  useImperativeHandle(handle, () => ({
    seek: (s) => { const v = videoRef.current; if (v) { v.currentTime = s; void v.play().catch(() => undefined); } },
    getTime: () => Math.floor(videoRef.current?.currentTime ?? 0),
  }));

  const reportEvent = useCallback((eventType: string, details?: Record<string, string | number | boolean>) => {
    if (!sessionId.current) return;
    const now = Date.now();
    if (now - (eventCooldown.current.get(eventType) ?? 0) < 5000) return;
    eventCooldown.current.set(eventType, now);
    void fetch(`/api/lessons/${lessonId}/security-event`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: sessionId.current, eventType, details }), keepalive: true,
    }).catch(() => undefined);
  }, [lessonId]);

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
    if (res.status === 403) { v.pause(); setGrant(null); setError('player.no_access'); }
  }, [lessonId]);

  useEffect(() => {
    sessionId.current = crypto.randomUUID().replace(/-/g, '');
    let alive = true;
    requestGrant().then((g) => alive && g && setGrant(g));
    return () => { alive = false; };
  }, [requestGrant]);

  const grantUrl = grant?.url;
  const grantStreamType = grant?.streamType;

  useEffect(() => {
    if (!grantUrl || !videoRef.current) return;
    const video = videoRef.current;
    const onEnterPictureInPicture = () => reportEvent('picture_in_picture_attempt');
    video.addEventListener('enterpictureinpicture', onEnterPictureInPicture);
    let cancelled = false;
    setQualities([]);
    setQuality(-1);
    const attach = async () => {
      if (grantStreamType !== 'hls') { video.src = grantUrl; return; }
      try {
        const hlsModule = await import('hls.js');
        if (cancelled) return;
        const HlsPlayer = hlsModule.default;
        if (HlsPlayer.isSupported()) {
          const player = new HlsPlayer({ enableWorker: true, capLevelToPlayerSize: true, maxBufferLength: 30, backBufferLength: 30, manifestLoadingTimeOut: 20000, levelLoadingTimeOut: 20000, fragLoadingTimeOut: 30000 });
          hlsRef.current = player;
          player.on(HlsPlayer.Events.MANIFEST_PARSED, () => {
            const levels = player.levels.map((level, index) => ({ index, label: `${level.height || 'Auto'}p` }));
            const deduped = levels.filter((level, index) => levels.findIndex((candidate) => candidate.label === level.label) === index);
            setQualities([{ index: -1, label: t('player.auto_quality') }, ...deduped]);
            if (resume.current.pos > 0) video.currentTime = resume.current.pos;
          });
          player.on(HlsPlayer.Events.ERROR, (_event, data) => {
            if (data.fatal && data.type === HlsPlayer.ErrorTypes.MEDIA_ERROR) player.recoverMediaError();
            else if (data.fatal) setError('player.not_ready');
          });
          player.loadSource(grantUrl);
          player.attachMedia(video);
        } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
          video.src = grantUrl;
          setQualities([{ index: -1, label: t('player.auto_quality') }]);
        } else setError('player.hls_unsupported');
      } catch {
        if (!cancelled) setError('player.hls_unsupported');
      }
    };
    void attach();
    return () => {
      cancelled = true;
      video.removeEventListener('enterpictureinpicture', onEnterPictureInPicture);
      hlsRef.current?.destroy();
      hlsRef.current = null;
      video.removeAttribute('src');
      video.load();
    };
  }, [grantUrl, grantStreamType, reportEvent, t]);

  useEffect(() => {
    if (!grant) return;
    const id = setTimeout(async () => {
      const v = videoRef.current;
      if (v) resume.current = { pos: v.currentTime, playing: !v.paused };
      const g = await requestGrant();
      if (g) setGrant(g);
    }, Math.max(15000, grant.ttlSeconds * 650));
    return () => clearTimeout(id);
  }, [grant, requestGrant]);

  useEffect(() => {
    const id = setInterval(() => { const v = videoRef.current; if (v && !v.paused && !v.ended) void saveProgress(); }, 20000);
    return () => clearInterval(id);
  }, [saveProgress]);
  useEffect(() => {
    const refreshWatermark = () => { setWmPos({ top: 8 + Math.random() * 72, left: 6 + Math.random() * 65 }); setClock(new Date().toLocaleTimeString(locale === 'ar' ? 'ar-EG' : 'en-US')); };
    refreshWatermark();
    const id = setInterval(refreshWatermark, 8000);
    return () => clearInterval(id);
  }, [locale]);

  useEffect(() => {
    if (!grant?.captureDeterrenceEnabled) return;
    const onKeyDown = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase();
      const captureKey = event.key === 'PrintScreen';
      const macCapture = event.metaKey && event.shiftKey && ['3', '4', '5'].includes(event.key);
      const printDialog = (event.ctrlKey || event.metaKey) && key === 'p';
      const captureShortcut = (event.metaKey || event.ctrlKey) && event.shiftKey && key === 's';
      if (captureKey || macCapture || captureShortcut) {
        event.preventDefault();
        reportEvent(captureKey ? 'print_screen_key' : 'capture_shortcut', { key: event.key, metaKey: event.metaKey, ctrlKey: event.ctrlKey });
        setCaptureMask(true);
        window.setTimeout(() => setCaptureMask(false), 1200);
      } else if (printDialog) {
        event.preventDefault();
        reportEvent('print_dialog_shortcut', { key: event.key });
      }
    };
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') {
        const video = videoRef.current;
        if (video && !video.paused) video.pause();
        reportEvent('tab_hidden');
      }
    };
    const onFullscreen = () => { if (!document.fullscreenElement && grant) reportEvent('fullscreen_exit'); };
    document.addEventListener('keydown', onKeyDown, true);
    document.addEventListener('visibilitychange', onVisibility);
    document.addEventListener('fullscreenchange', onFullscreen);
    return () => {
      document.removeEventListener('keydown', onKeyDown, true);
      document.removeEventListener('visibilitychange', onVisibility);
      document.removeEventListener('fullscreenchange', onFullscreen);
    };
  }, [grant, reportEvent]);

  const onLoaded = () => {
    const v = videoRef.current;
    if (!v) return;
    if (resume.current.pos > 0 && (!Number.isFinite(v.duration) || resume.current.pos < v.duration - 3)) v.currentTime = resume.current.pos;
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
  const onPlayerKeyDown = (e: React.KeyboardEvent) => {
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

  if (error) return <div className="space-y-3"><Alert tone="error">{t(error as never)}</Alert><button type="button" onClick={async () => { setError(null); const g = await requestGrant(); if (g) setGrant(g); }} className="rounded-md border border-border px-4 py-2 text-sm font-semibold hover:border-arc">{t('player.retry')}</button></div>;
  if (!grant) return <div role="status" className="aspect-video animate-pulse rounded-lg bg-steel" aria-busy="true" aria-label={t('player.loading')} />;

  return (
    <div className="space-y-2">
      <div ref={boxRef} tabIndex={0} onKeyDown={onPlayerKeyDown} aria-label={t('player.region')}
        className="chrome-edge relative overflow-hidden rounded-lg bg-black outline-none focus-visible:shadow-[var(--glow)] select-none" onContextMenu={(e) => { e.preventDefault(); reportEvent('copy_attempt', { source: 'contextmenu' }); }} onCopy={(e) => { e.preventDefault(); reportEvent('copy_attempt', { source: 'copy' }); }}>
        <video
          ref={videoRef} key={grant.url} src={grant.streamType === 'mp4' ? grant.url : undefined} controls playsInline preload="metadata"
          controlsList="nodownload nofullscreen noremoteplayback" disablePictureInPicture disableRemotePlayback className="aspect-video w-full"
          onLoadedMetadata={onLoaded} onError={onVideoError}
          onSeeking={() => { const v = videoRef.current; if (!grant.seekAllowed && v && !seekGuard.current && Math.abs(v.currentTime - lastAllowedTime.current) > 1.5) { seekGuard.current = true; v.currentTime = lastAllowedTime.current; queueMicrotask(() => { seekGuard.current = false; }); } }}
          onTimeUpdate={() => { const v = videoRef.current; if (v && !v.seeking) lastAllowedTime.current = v.currentTime; }} onPause={() => void saveProgress()}
          onEnded={() => { void saveProgress(true).then(() => { router.refresh(); onEnded?.(); }); }}
        />
        {grant.watermark && <span aria-hidden className="pointer-events-none absolute select-none rounded bg-black/35 px-2 py-1 font-mono text-xs text-white/65 [text-shadow:0_0_3px_rgba(0,0,0,.8)] transition-all duration-slow" style={{ top: `${wmPos.top}%`, insetInlineStart: `${wmPos.left}%` }}>
          {grant.watermark} · {clock} · {locale === 'ar' ? 'للاستخدام الشخصي' : 'personal use'}
        </span>}
        {captureMask && <div aria-hidden className="pointer-events-none absolute inset-0 grid place-items-center bg-black/95 text-center text-sm font-bold text-white">{locale === 'ar' ? 'محتوى محمي — لا تشارك التسجيل' : 'Protected content — do not share recordings'}</div>}
        <button type="button" onClick={() => void boxRef.current?.requestFullscreen?.()} className="absolute end-2 top-2 rounded-md bg-black/55 p-1.5 text-white hover:bg-black/75" aria-label={t('player.fullscreen')}>
          <Maximize className="h-4 w-4" strokeWidth={1.75} />
        </button>
        <div className="pointer-events-none absolute bottom-2 start-2 flex items-center gap-1 rounded bg-black/45 px-2 py-1 text-[10px] text-white/75"><ShieldCheck className="h-3 w-3" />{locale === 'ar' ? 'تشغيل محمي' : 'Protected playback'}</div>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-card px-3 py-2">
        <p className="text-xs text-muted-foreground">{t('player.protection_notice')}</p>
        {qualities.length > 0 && <label className="flex items-center gap-2 text-sm"><span className="text-muted-foreground">{t('player.quality')}</span><select value={quality} onChange={(event) => { const next = Number(event.target.value); setQuality(next); if (hlsRef.current) hlsRef.current.currentLevel = next; }} className="h-9 rounded-md border border-border bg-background px-2 text-sm">
          {qualities.map((option) => <option key={`${option.index}-${option.label}`} value={option.index}>{option.label}</option>)}
        </select></label>}
      </div>
    </div>
  );
});
