import { useRef, useEffect, useState, useCallback, memo } from 'react';
import Hls from 'hls.js';
import { Settings, AlertTriangle, RefreshCw, ChevronDown } from 'lucide-react';

interface VideoPlayerProps {
  src: string;
  channelId?: string;
  muted?: boolean;
  onError?: (channelId: string, message: string) => void;
}

const getYouTubeId = (url: string): string | null => {
  const m = url.match(/(?:youtube\.com\/(?:watch\?v=|embed\/|live\/|shorts\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/);
  return m?.[1] || null;
};

const VideoPlayer = memo(({ src, channelId, muted = false, onError }: VideoPlayerProps) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const hlsRef = useRef<Hls | null>(null);
  const retryTimer = useRef<ReturnType<typeof setTimeout>>();
  const retryCount = useRef(0);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [loadingSec, setLoadingSec] = useState(0);
  const [qualities, setQualities] = useState<{ id: string; label: string; height: number }[]>([]);
  const [activeQuality, setActiveQuality] = useState('auto');
  const [showQMenu, setShowQMenu] = useState(false);

  const isBridge = src?.includes('/api/restream/');
  const streamId = isBridge ? src.match(/\/api\/restream\/([^/?]+)/)?.[1] : null;

  // ── Cleanup ──
  const destroy = useCallback(() => {
    if (retryTimer.current) clearTimeout(retryTimer.current);
    if (hlsRef.current) {
      try { hlsRef.current.destroy(); } catch {}
      hlsRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.removeAttribute('src');
      videoRef.current.load();
    }
  }, []);

  // ── Start playback ──
  const play = useCallback((url: string) => {
    const video = videoRef.current;
    if (!video) return;

    setError(null);
    setLoading(true);
    setLoadingSec(0);
    retryCount.current = 0;
    destroy();

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
      fragLoadingMaxRetry: 6,
      manifestLoadingMaxRetry: 6,
      levelLoadingMaxRetry: 6,
      fragLoadingRetryDelay: 1000,
    });

    hlsRef.current = hls;
    hls.attachMedia(video);

    hls.on(Hls.Events.MEDIA_ATTACHED, () => hls.loadSource(url));

    hls.on(Hls.Events.MANIFEST_PARSED, (_e, data) => {
      // Only show quality menu from manifest if NOT a bridge stream (bridge has server-side qualities)
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
    video.addEventListener('playing', () => setLoading(false), { once: true });

  }, [muted, destroy, channelId, onError, isBridge]);

  // ── Fetch bridge qualities ──
  useEffect(() => {
    if (!streamId) return;
    setQualities([
      { id: 'original', label: 'Original', height: 1080 },
      { id: '720', label: '720p', height: 720 },
      { id: '480', label: '480p', height: 480 },
      { id: '360', label: '360p', height: 360 },
    ]);

    // Try server-provided qualities
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
  }, [streamId]);

  // ── Quality switch ──
  const switchQuality = useCallback((qId: string) => {
    setActiveQuality(qId);
    setShowQMenu(false);

    if (!isBridge && hlsRef.current) {
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
  }, [isBridge, streamId, play]);

  // ── Init on src change ──
  useEffect(() => {
    if (!src || getYouTubeId(src)) return;
    setActiveQuality('auto');
    setQualities([]);
    play(src);
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
    if (loadingSec >= 35 && loading) {
      setError('El canal tardó demasiado en responder.');
      setLoading(false);
    }
  }, [loadingSec, loading]);

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

      {/* Loading */}
      {loading && !error && (
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
              onClick={() => play(src)}
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
