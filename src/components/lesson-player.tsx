"use client";
import { useCallback, useEffect, useRef, useState } from "react";

export function LessonPlayer({ lessonId, locale }: { lessonId: string; locale: string }) {
  const ar = locale === "ar";
  const videoRef = useRef<HTMLVideoElement>(null);
  const playerUrlRef = useRef("");
  const lastSavedAt = useRef(0);
  const saveInFlight = useRef(false);
  const [playerUrl, setPlayerUrl] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [watermark, setWatermark] = useState("");
  const [progressSaved, setProgressSaved] = useState(false);
  const [canTrackProgress, setCanTrackProgress] = useState(false);

  const loadPlayback = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const response = await fetch("/api/r2/playback-url", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lessonId }), cache: "no-store",
      });
      const data = await response.json() as { videoUrl?: string; error?: string; watermark?: string; canTrackProgress?: boolean };
      if (!response.ok || !data.videoUrl) throw new Error(data.error || (ar ? "تعذر السماح بتشغيل الفيديو" : "Playback authorization failed"));
      playerUrlRef.current = data.videoUrl;
      setPlayerUrl(data.videoUrl); setWatermark(data.watermark ?? ""); setCanTrackProgress(data.canTrackProgress === true);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : (ar ? "تعذر تشغيل الفيديو" : "Playback unavailable"));
    } finally { setLoading(false); }
  }, [lessonId, ar]);

  useEffect(() => { void loadPlayback(); }, [loadPlayback]);

  useEffect(() => {
    if (!playerUrl || !canTrackProgress) return;
    const video = videoRef.current;
    if (!video) return;
    let cancelled = false;
    async function save(completed = false) {
      if (saveInFlight.current || cancelled) return;
      saveInFlight.current = true;
      try {
        const response = await fetch("/api/lessons/progress", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ lessonId, positionSeconds: Math.floor(video?.currentTime || 0), completed }), cache: "no-store",
        });
        if (response.ok && !cancelled) setProgressSaved(true);
      } catch { /* Progress failures should never interrupt playback. */ }
      finally { saveInFlight.current = false; }
    }
    const onTimeUpdate = () => {
      if (Date.now() - lastSavedAt.current >= 15_000) {
        lastSavedAt.current = Date.now(); void save(false);
      }
    };
    const onEnded = () => { void save(true); };
    video.addEventListener("timeupdate", onTimeUpdate);
    video.addEventListener("ended", onEnded);
    return () => {
      video.removeEventListener("timeupdate", onTimeUpdate);
      video.removeEventListener("ended", onEnded);
      void save(false);
      cancelled = true;
    };
  }, [lessonId, playerUrl, canTrackProgress]);

  if (loading) return <div className="empty" role="status">{ar ? "جارٍ التحقق من صلاحية المشاهدة..." : "Checking playback access..."}</div>;
  if (error) return <div role="alert" className="notice notice-error">{error}<div style={{ marginTop: 12 }}><button type="button" className="button" onClick={() => void loadPlayback()}>{ar ? "إعادة المحاولة" : "Try again"}</button></div></div>;
  return <div className="stream-player-wrap">
    <div className="stream-player-shell r2-video-shell">
      <video ref={videoRef} key={playerUrl} src={playerUrl} controls playsInline preload="metadata" controlsList="nodownload" aria-label={ar ? "فيديو الدرس" : "Lesson video"} onError={() => setError(ar ? "تعذر تحميل الفيديو. قد يكون الرابط المؤقت انتهى أو إعدادات CORS غير مكتملة." : "Could not load this video. The temporary link may have expired or R2 CORS may be misconfigured.")} />
      <span className="video-watermark" aria-label={ar ? "علامة تعريف المشاهد" : "Viewer watermark"}>{ar ? "معرّف المشاهد" : "Viewer ID"} · {watermark}</span>
    </div>
    {progressSaved && <p className="progress-save-status" role="status">✓ {ar ? "تم حفظ تقدم المشاهدة" : "Viewing progress saved"}</p>}
  </div>;
}
