import { useRef, useEffect, useState, useCallback, memo } from 'react';
import Hls from 'hls.js';
import { Settings, AlertTriangle, RefreshCw, ChevronDown, Disc, Loader2 } from 'lucide-react';

interface VideoPlayerProps {
  src: string;
  channelId?: string;
  streamMode?: 'direct' | 'buffer' | 'transcode';
  muted?: boolean;
  onError?: (channelId: string, message: string) => void;
}

const getYouTubeId = (url: string): string | null => {
  const m = url.match(/(?:youtube\.com\/(?:watch\?v=|embed\/|live\/|shorts\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/);
  return m?.[1] || null;
};

const VideoPlayer = memo(({ src, channelId, streamMode, muted = false, onError }: VideoPlayerProps) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const hlsRef = useRef<Hls | null>(null);
  const retryTimer = useRef<ReturnType<typeof setTimeout>>();
  const retryCount = useRef(0);
  const stallTimer = useRef<ReturnType<typeof setInterval>>();
  const lastTimeRef = useRef(0);
  const stallCountRef = useRef(0);
  const bufferRetryTimer = useRef<ReturnType<typeof setTimeout>>();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [loadingSec, setLoadingSec] = useState(0);
  const [qualities, setQualities] = useState<{ id: string; label: string; height: number }[]>([]);
  const [activeQuality, setActiveQuality] = useState('auto');
  const [showQMenu, setShowQMenu] = useState(false);
  const [bufferWaiting, setBufferWaiting] = useState(false);
  const [bufferRetries, setBufferRetries] = useState(0);

  const isBufferMode = streamMode === 'buffer' || streamMode === 'transcode';

  // Resolve the actual playback URL
  const resolveUrl = useCallback((rawSrc: string): string => {
    // If it's already a restream URL, use as-is
    if (rawSrc.includes('/api/restream/')) return rawSrc;
    // If we have a channelId and it's not YouTube, route through restream
    if (channelId && !getYouTubeId(rawSrc)) {
      return `/api/restream/${channelId}`;
    }
    return rawSrc;
  }, [channelId]);

  // Bridge streams use port 3002 (xtream-bridge), not the main API
  const resolvedSrc = resolveUrl(src);
  const isBridge = resolvedSrc?.includes(':3002/api/restream/');
  const streamId = resolvedSrc?.match(/\/api\/restream\/([^/?]+)/)?.[1] || channelId;

  // ── Cleanup ──
  const destroy = useCallback(() => {
    if (retryTimer.current) clearTimeout(retryTimer.current);
    if (stallTimer.current) clearInterval(stallTimer.current);
    if (bufferRetryTimer.current) clearTimeout(bufferRetryTimer.current);
    if (hlsRef.current) {
      try { hlsRef.current.destroy(); } catch {}
      hlsRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.removeAttribute('src');
      videoRef.current.load();
    }
    stallCountRef.current = 0;
    lastTimeRef.current = 0;
  }, []);

  // ── Start playback with buffer-aware retry ──
  const play = useCallback((url: string) => {
    const video = videoRef.current;
    if (!video) return;

    setError(null);
    setLoading(true);
    setLoadingSec(0);
    setBufferWaiting(false);
    retryCount.current = 0;
    destroy();

    // For buffer/transcode modes, first check if manifest is ready
    if (isBufferMode && url.includes('/api/restream/')) {
      setBufferWaiting(true);
      setBufferRetries(0);

      const tryFetchManifest = (attempt: number) => {
        fetch(url, { method: 'GET', headers: { 'Accept': 'application/vnd.apple.mpegurl' } })
          .then(res => {
            if (res.ok) {
              // Manifest is ready, proceed with playback
              setBufferWaiting(false);
              setBufferRetries(0);
              startHlsPlayback(url, video);
            } else if (res.status === 504 || res.status === 503 || res.status === 502) {
              // Server still preparing buffer, retry in 5s
              setBufferRetries(attempt + 1);
              if (attempt < 24) { // max ~2 min of retries
                bufferRetryTimer.current = setTimeout(() => tryFetchManifest(attempt + 1), 5000);
              } else {
                setBufferWaiting(false);
                setError('El buffer no pudo inicializarse. Intenta de nuevo.');
                setLoading(false);
              }
            } else {
              setBufferWaiting(false);
              setError(`Error del servidor (${res.status})`);
              setLoading(false);
            }
          })
          .catch(() => {
            setBufferRetries(attempt + 1);
            if (attempt < 24) {
              bufferRetryTimer.current = setTimeout(() => tryFetchManifest(attempt + 1), 5000);
            } else {
              setBufferWaiting(false);
              setError('No se pudo conectar al servidor.');
              setLoading(false);
            }
          });
      };

      tryFetchManifest(0);
      return;
    }

    startHlsPlayback(url, video);
  }, [muted, destroy, isBufferMode]);

  const startHlsPlayback = useCallback((url: string, video: HTMLVideoElement) => {
    // Native HLS (Safari / iOS)
    if (video.canPlayType('application/vnd.apple.mpegurl')) {
      video.src = url;
      video.muted = muted;
      video.play().catch(() => { video.muted = true; video.play().catch(() => {}); });
      return;
    }

    if (!Hls.isSupported()) {
      setError('Tu navegador no soporta reproducción de video.');
      setLoading(false);
      return;
    }

    const hls = new Hls({
      enableWorker: true,
      lowLatencyMode: true,
      backBufferLength: 30,
      maxBufferLength: 20,
      maxMaxBufferLength: 60,
      startLevel: -1,
      fragLoadingMaxRetry: 10,
      manifestLoadingMaxRetry: 10,
      levelLoadingMaxRetry: 10,
      fragLoadingRetryDelay: 1000,
      manifestLoadingRetryDelay: 1000,
      levelLoadingRetryDelay: 1000,
      fragLoadingMaxRetryTimeout: 15000,
      manifestLoadingMaxRetryTimeout: 15000,
      levelLoadingMaxRetryTimeout: 15000,
    });

    hlsRef.current = hls;
    hls.attachMedia(video);

    hls.on(Hls.Events.MEDIA_ATTACHED, () => hls.loadSource(url));

    hls.on(Hls.Events.MANIFEST_PARSED, (_e, data) => {
      if (!isBridge && data.levels.length > 1) {
        setQualities(data.levels.map((l: any, i: number) => ({
          id: String(i),
          label: l.height ? `${l.height}p` : `Nivel ${i + 1}`,
          height: l.height || 0,
        })).sort((a: any, b: any) => b.height - a.height));
      }

      video.muted = muted;
      video.play().then(() => {
        setLoading(false);
        retryCount.current = 0;
      }).catch(() => {
        video.muted = true;
        video.play().then(() => { setLoading(false); retryCount.current = 0; }).catch(() => {});
      });
    });

    hls.on(Hls.Events.ERROR, (_e, data) => {
      if (!data.fatal) return;

      if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
        hls.recoverMediaError();
        return;
      }

      // Network / other fatal → retry
      if (retryCount.current < 8) {
        retryCount.current++;
        const delay = Math.min(retryCount.current * 1500, 8000);
        console.warn(`[Player] Retry ${retryCount.current}/8 en ${delay}ms`);
        retryTimer.current = setTimeout(() => hls.loadSource(url), delay);
      } else {
        setError('No se pudo reproducir. El canal puede estar caído.');
        setLoading(false);
        if (channelId) onError?.(channelId, 'Playback failed after retries');
      }
    });

    // Playing event as backup for loading state
    const onPlaying = () => { setLoading(false); setError(null); setBufferWaiting(false); };
    video.addEventListener('playing', onPlaying, { once: true });
    video.addEventListener('timeupdate', onPlaying, { once: true });

    // ── Stall detection ──
    if (stallTimer.current) clearInterval(stallTimer.current);
    stallCountRef.current = 0;
    lastTimeRef.current = 0;
    stallTimer.current = setInterval(() => {
      if (!video || video.paused || video.ended) return;
      const ct = video.currentTime;
      if (ct > 0 && ct === lastTimeRef.current) {
        stallCountRef.current++;
        if (stallCountRef.current >= 3) {
          console.warn(`[Player] Stall detectado (${stallCountRef.current * 2}s), recuperando...`);
          stallCountRef.current = 0;
          if (hls) {
            try { hls.recoverMediaError(); } catch { hls.loadSource(url); }
          }
        }
      } else {
        stallCountRef.current = 0;
      }
      lastTimeRef.current = ct;
    }, 2000);
  }, [muted, channelId, onError, isBridge]);

  // ── Fetch bridge qualities ──
  useEffect(() => {
    if (!streamId) return;
    // Always set default qualities for restream channels
    if (resolvedSrc.includes('/api/restream/')) {
      setQualities([
        { id: 'original', label: 'Original', height: 1080 },
        { id: '720', label: '720p', height: 720 },
        { id: '480', label: '480p', height: 480 },
        { id: '360', label: '360p', height: 360 },
      ]);

      fetch(`/api/restream/${streamId}/qualities`)
        .then(r => r.ok ? r.json() : null)
        .then((data: any) => {
          if (Array.isArray(data) && data.length > 0) {
            setQualities(data.map((q: any) => ({
              id: q.id,
              label: q.label,
              height: q.height || 0,
            })));
          }
        })
        .catch(() => {});
    }
  }, [streamId, resolvedSrc]);

  // ── Quality switch ──
  const switchQuality = useCallback((qId: string) => {
    setActiveQuality(qId);
    setShowQMenu(false);

    if (!isBridge && !resolvedSrc.includes('/api/restream/') && hlsRef.current) {
      hlsRef.current.currentLevel = qId === 'auto' ? -1 : parseInt(qId, 10);
      return;
    }

    if (streamId) {
      const newUrl = qId === 'auto'
        ? `/api/restream/${streamId}`
        : qId === 'original'
          ? `/api/restream/${streamId}/variant/original.m3u8`
          : `/api/restream/${streamId}/variant/${qId}.m3u8`;
      play(newUrl);
    }
  }, [isBridge, streamId, play, resolvedSrc]);

  // ── Init on src change ──
  useEffect(() => {
    if (!src || getYouTubeId(src)) return;
    setActiveQuality('auto');
    setQualities([]);
    play(resolveUrl(src));
    return () => destroy();
  }, [src]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Mute sync ──
  useEffect(() => {
    if (videoRef.current) videoRef.current.muted = muted;
  }, [muted]);

  // ── Loading timer ──
  useEffect(() => {
    if (!loading || error) return;
    setLoadingSec(0);
    const t = setInterval(() => setLoadingSec(p => p + 1), 1000);
    return () => clearInterval(t);
  }, [loading, error]);

  // ── Loading timeout ──
  useEffect(() => {
    if (loadingSec >= 60 && loading) {
      const video = videoRef.current;
      if (video && video.currentTime > 0 && !video.paused) {
        setLoading(false);
        setError(null);
        return;
      }
      if (!bufferWaiting) {
        setError('El canal tardó demasiado en responder.');
        setLoading(false);
      }
    }
  }, [loadingSec, loading, bufferWaiting]);

  // ── YouTube ──
  const ytId = getYouTubeId(src);
  if (ytId) {
    return (
      <div className="relative w-full h-full bg-black">
        <iframe
          className="w-full h-full"
          src={`https://www.youtube-nocookie.com/embed/${ytId}?autoplay=1&mute=${muted ? 1 : 0}&rel=0&modestbranding=1&playsinline=1`}
          title="YouTube"
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
          allowFullScreen
          style={{ border: 'none' }}
        />
      </div>
    );
  }

  return (
    <div className="relative w-full h-full bg-black group">
      <video
        ref={videoRef}
        className="w-full h-full object-contain"
        playsInline
        controls
      />

      {/* Quality selector — top right, visible on hover */}
      {qualities.length > 0 && !loading && !error && (
        <div className="absolute top-3 right-3 z-10 opacity-0 group-hover:opacity-100 transition-opacity duration-300">
          <button
            onClick={() => setShowQMenu(p => !p)}
            className="flex items-center gap-1.5 px-3 py-2 bg-black/80 hover:bg-black/90 rounded-lg text-xs text-white/90 hover:text-white backdrop-blur-sm border border-white/10 transition-colors"
          >
            <Settings className="w-4 h-4" />
            <span className="font-medium">
              {activeQuality === 'auto' ? 'Auto' : qualities.find(q => q.id === activeQuality)?.label || 'Auto'}
            </span>
            <ChevronDown className={`w-3 h-3 transition-transform ${showQMenu ? 'rotate-180' : ''}`} />
          </button>

          {showQMenu && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setShowQMenu(false)} />
              <div className="absolute right-0 top-full mt-1 z-50 bg-black/95 backdrop-blur-xl rounded-xl border border-white/10 shadow-2xl min-w-[160px] overflow-hidden">
                <div className="px-3 py-2 border-b border-white/10">
                  <span className="text-[10px] text-white/40 font-semibold uppercase tracking-wider">Calidad</span>
                </div>
                <div className="py-1">
                  <button
                    onClick={() => switchQuality('auto')}
                    className={`w-full text-left px-3 py-2.5 text-sm transition-colors ${
                      activeQuality === 'auto' ? 'text-primary bg-primary/10' : 'text-white/80 hover:bg-white/10'
                    }`}
                  >
                    Auto
                  </button>
                  {qualities.map(q => (
                    <button
                      key={q.id}
                      onClick={() => switchQuality(q.id)}
                      className={`w-full text-left px-3 py-2.5 text-sm transition-colors ${
                        activeQuality === q.id ? 'text-primary bg-primary/10' : 'text-white/80 hover:bg-white/10'
                      }`}
                    >
                      {q.label}
                    </button>
                  ))}
                </div>
              </div>
            </>
          )}
        </div>
      )}

      {/* Buffer waiting state */}
      {bufferWaiting && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/80 pointer-events-none z-20">
          <div className="flex flex-col items-center gap-3 max-w-xs text-center">
            <div className="relative">
              <Disc className="w-10 h-10 text-primary animate-spin" style={{ animationDuration: '3s' }} />
              <Loader2 className="w-5 h-5 text-primary/60 animate-spin absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2" />
            </div>
            <p className="text-white/80 text-sm font-medium">
              Iniciando buffer de estabilidad…
            </p>
            <p className="text-white/40 text-xs">
              {bufferRetries > 0 
                ? `Esperando segmentos… intento ${bufferRetries} (reintentando cada 5s)`
                : 'El servidor está preparando los segmentos de video'}
            </p>
          </div>
        </div>
      )}

      {/* Loading */}
      {loading && !error && !bufferWaiting && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/70 pointer-events-none z-20">
          <div className="flex flex-col items-center gap-3">
            <div className="w-10 h-10 border-2 border-primary border-t-transparent rounded-full animate-spin" />
            {loadingSec >= 3 && (
              <p className="text-white/50 text-xs">Conectando… {loadingSec}s</p>
            )}
            {loadingSec >= 15 && (
              <p className="text-white/40 text-[10px]">La conexión está lenta</p>
            )}
          </div>
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/80 z-20">
          <div className="text-center max-w-sm px-4">
            <AlertTriangle className="w-8 h-8 text-destructive mx-auto mb-3" />
            <p className="text-destructive font-semibold mb-2">Error de reproducción</p>
            <p className="text-muted-foreground text-sm mb-4">{error}</p>
            <button
              onClick={() => play(resolveUrl(src))}
              className="inline-flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-md text-sm font-medium hover:bg-primary/90 transition-colors"
            >
              <RefreshCw className="w-4 h-4" />
              Reintentar
            </button>
          </div>
        </div>
      )}
    </div>
  );
});

VideoPlayer.displayName = 'VideoPlayer';

export default VideoPlayer;
