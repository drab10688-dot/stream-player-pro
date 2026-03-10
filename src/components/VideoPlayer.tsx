import { useRef, useEffect, useState, useCallback, memo } from 'react';
import shaka from 'shaka-player';

interface VideoPlayerProps {
  src: string;
  channelId?: string;
  muted?: boolean;
  onError?: (message: string) => void;
}

interface QualityInfo {
  label: string;
  currentIdx: number;
  levels: shaka.extern.TrackList;
  bandwidth: number;
  auto: boolean;
}

interface LoadingDiag {
  phase: string;
  elapsed: number;
}

// ── Helpers ──────────────────────────────────────────

const getYouTubeId = (url: string): string | null => {
  const patterns = [
    /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([a-zA-Z0-9_-]{11})/,
    /youtube\.com\/shorts\/([a-zA-Z0-9_-]{11})/,
    /youtube\.com\/live\/([a-zA-Z0-9_-]{11})/,
  ];
  for (const p of patterns) {
    const m = url.match(p);
    if (m) return m[1];
  }
  return null;
};

const detectStreamType = (url: string): 'hls' | 'ts' | 'youtube' | 'native' => {
  if (getYouTubeId(url)) return 'youtube';
  if (/\.m3u8?(\?|$)/i.test(url)) return 'hls';
  if (/\/api\/restream\//.test(url)) return 'hls';
  if (/\.ts(\?|$)/i.test(url) || /\/\d+\.ts/.test(url)) return 'ts';
  return 'native';
};

const getQualityLabel = (height: number): string => {
  if (height <= 240) return '240p';
  if (height <= 360) return '360p';
  if (height <= 480) return '480p';
  if (height <= 720) return '720p';
  if (height <= 1080) return '1080p';
  return `${height}p`;
};

const getQualityColor = (label: string): string => {
  if (label === '240p') return 'bg-red-500/90';
  if (label === '360p') return 'bg-orange-500/90';
  if (label === '480p') return 'bg-yellow-500/90';
  if (label === '720p') return 'bg-blue-500/90';
  if (label === '1080p' || label === 'HD') return 'bg-green-500/90';
  return 'bg-white/70';
};

const MAX_RETRIES = 5;
const LOADING_TIMEOUT_MS = 25000;

// ── Component ────────────────────────────────────────

const VideoPlayer = memo(({ src, channelId, muted = false, onError }: VideoPlayerProps) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const playerRef = useRef<shaka.Player | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [quality, setQuality] = useState<QualityInfo | null>(null);
  const [showQualityMenu, setShowQualityMenu] = useState(false);
  const [qualityVisible, setQualityVisible] = useState(true);
  const [retryInfo, setRetryInfo] = useState<string | null>(null);
  const [loadingDiag, setLoadingDiag] = useState<LoadingDiag | null>(null);

  const hideTimerRef = useRef<ReturnType<typeof setTimeout>>();
  const retryCountRef = useRef(0);
  const diagIntervalRef = useRef<ReturnType<typeof setInterval>>();
  const loadStartRef = useRef(0);
  const phaseRef = useRef('init');

  // ── Quality visibility timer ──
  const resetHideTimer = useCallback(() => {
    setQualityVisible(true);
    if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    hideTimerRef.current = setTimeout(() => setQualityVisible(false), 5000);
  }, []);

  // ── Diagnostics timer ──
  const startDiagTimer = useCallback(() => {
    loadStartRef.current = Date.now();
    phaseRef.current = 'Conectando...';
    setLoadingDiag({ phase: 'Conectando...', elapsed: 0 });
    if (diagIntervalRef.current) clearInterval(diagIntervalRef.current);
    diagIntervalRef.current = setInterval(() => {
      const elapsed = Math.round((Date.now() - loadStartRef.current) / 1000);
      setLoadingDiag({ phase: phaseRef.current, elapsed });
    }, 1000);
  }, []);

  const stopDiagTimer = useCallback(() => {
    if (diagIntervalRef.current) clearInterval(diagIntervalRef.current);
    setLoadingDiag(null);
  }, []);

  // ── Update quality info from Shaka ──
  const updateQuality = useCallback((player: shaka.Player) => {
    const tracks = player.getVariantTracks();
    if (!tracks.length) return;

    const active = tracks.find(t => t.active);
    if (!active) return;

    const stats = player.getStats();
    const activeIdx = tracks.indexOf(active);

    setQuality({
      label: active.height ? getQualityLabel(active.height) : 'Auto',
      currentIdx: activeIdx,
      levels: tracks,
      bandwidth: Math.round((stats.estimatedBandwidth || 0) / 1000),
      auto: player.getConfiguration().abr?.enabled ?? true,
    });
  }, []);

  // ── Cleanup ──
  const cleanup = useCallback(async () => {
    if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    if (diagIntervalRef.current) clearInterval(diagIntervalRef.current);
    if (playerRef.current) {
      try {
        await playerRef.current.destroy();
      } catch { /* ignore */ }
      playerRef.current = null;
    }
  }, []);

  // ── Init stream ──
  const initStream = useCallback(async () => {
    const video = videoRef.current;
    if (!video || !src) return;

    const streamType = detectStreamType(src);
    if (streamType === 'youtube') return;

    setError(null);
    setLoading(true);
    setQuality(null);
    setRetryInfo(null);
    retryCountRef.current = 0;
    await cleanup();
    startDiagTimer();

    // Install polyfills once
    shaka.polyfill.installAll();

    if (!shaka.Player.isBrowserSupported()) {
      setError('Tu navegador no es compatible con el reproductor.');
      setLoading(false);
      stopDiagTimer();
      onError?.('Browser not supported');
      return;
    }

    const player = new shaka.Player();
    await player.attach(video);
    playerRef.current = player;

    // ── Shaka configuration — optimized for slow connections (1-2 Mbps) ──
    player.configure({
      streaming: {
        bufferingGoal: 6,                     // 6s buffer before playback
        rebufferingGoal: 2,                    // Only need 2s to resume after stall
        bufferBehind: 10,                      // Keep 10s behind
        retryParameters: {
          maxAttempts: 8,
          baseDelay: 500,
          backoffFactor: 1.5,
          fuzzFactor: 0.3,
          timeout: 15000,
        },
        failureCallback: (err: shaka.extern.Error) => {
          console.warn('Shaka streaming failure:', err);
        },
        lowLatencyMode: false,                 // Stability over latency
        autoLowLatencyMode: false,
        stallEnabled: true,                    // Detect and recover from stalls
        stallThreshold: 1,
        stallSkip: 0.2,
      },
      abr: {
        enabled: true,
        defaultBandwidthEstimate: 150_000,     // Start conservative: 150kbps
        switchInterval: 4,                     // Don't switch quality more than every 4s
        bandwidthUpgradeTarget: 0.8,           // Need 80% of next level's bandwidth to upgrade
        bandwidthDowngradeTarget: 0.6,         // Downgrade if bandwidth drops below 60%
        restrictToElementSize: true,           // Don't load 1080p for a 360px player
        restrictToScreenSize: true,
      },
      manifest: {
        retryParameters: {
          maxAttempts: 10,
          baseDelay: 500,
          backoffFactor: 1.5,
          fuzzFactor: 0.3,
          timeout: 20000,
        },
        availabilityWindowOverride: 120,
        defaultPresentationDelay: 4,
      },
    });

    // ── Event listeners ──
    player.addEventListener('error', (event: Event) => {
      const detail = (event as shaka.PlayerEvents.ErrorEvent).detail;
      console.error('Shaka error:', detail.code, detail.message);

      if (retryCountRef.current < MAX_RETRIES) {
        retryCountRef.current++;
        phaseRef.current = `Reintento ${retryCountRef.current}/${MAX_RETRIES}`;
        setRetryInfo(`Reintentando (${retryCountRef.current}/${MAX_RETRIES})...`);
        setTimeout(async () => {
          try {
            await player.load(src);
          } catch { /* handled by error event */ }
        }, 2000 * retryCountRef.current);
      } else {
        setError(`Error del stream: ${detail.message || 'No se pudo cargar el canal'}`);
        setLoading(false);
        stopDiagTimer();
        onError?.(detail.message || 'Stream error');
      }
    });

    player.addEventListener('adaptation', () => {
      updateQuality(player);
      resetHideTimer();
    });

    player.addEventListener('loading', () => {
      phaseRef.current = 'Descargando manifiesto...';
    });

    player.addEventListener('buffering', (e: Event) => {
      const buffering = (e as shaka.PlayerEvents.BufferingEvent).buffering;
      if (buffering) {
        setLoading(true);
        phaseRef.current = 'Buffering...';
      } else {
        setLoading(false);
        setRetryInfo(null);
        stopDiagTimer();
        retryCountRef.current = 0;
      }
    });

    // ── Load source ──
    phaseRef.current = 'Cargando manifiesto...';
    try {
      // For TS streams, try native or fallback
      if (streamType === 'ts') {
        // Shaka doesn't handle raw .ts — use native <video> fallback
        video.src = src;
        phaseRef.current = 'Reproduciendo stream TS...';
      } else {
        // HLS / native — Shaka handles these
        await player.load(src);
        phaseRef.current = 'Manifiesto cargado, iniciando...';
      }

      updateQuality(player);
    } catch (err) {
      console.error('Shaka load error:', err);
      if (retryCountRef.current < MAX_RETRIES) {
        retryCountRef.current++;
        phaseRef.current = `Error de carga, reintento ${retryCountRef.current}...`;
        setRetryInfo(`Reintentando (${retryCountRef.current}/${MAX_RETRIES})...`);
        setTimeout(() => initStream(), 3000);
        return;
      }
      const msg = 'No se pudo cargar el stream. Verifica que el canal esté activo.';
      setError(msg);
      setLoading(false);
      stopDiagTimer();
      onError?.(msg);
      return;
    }

    // ── Attempt autoplay ──
    phaseRef.current = 'Iniciando reproducción...';
    try {
      video.muted = false;
      await video.play();
    } catch {
      video.muted = true;
      try {
        await video.play();
        setTimeout(() => { video.muted = false; }, 500);
      } catch {
        // User will need to click play
      }
    }
    setLoading(false);
    setRetryInfo(null);
    stopDiagTimer();
    resetHideTimer();

    // ── Loading timeout ──
    const loadingTimeout = setTimeout(() => {
      if (loading && !error) {
        phaseRef.current = 'Tiempo de espera agotado';
        setError('El stream no respondió en 25s. El canal puede estar caído o tu conexión es muy lenta.');
        setLoading(false);
        stopDiagTimer();
        onError?.('Loading timeout');
      }
    }, LOADING_TIMEOUT_MS);

    // ── Periodic quality update ──
    const qualityInterval = setInterval(() => {
      if (playerRef.current) {
        updateQuality(playerRef.current);
      }
    }, 5000);

    // ── Stall detection ──
    let lastTime = 0;
    const stallCheck = setInterval(() => {
      if (!video.paused && video.currentTime > 0) {
        if (lastTime > 0 && Math.abs(video.currentTime - lastTime) < 0.1) {
          console.warn('Stream frozen, reloading...');
          player.load(src).catch(() => {});
        }
        lastTime = video.currentTime;
      }
    }, 15000);

    return () => {
      clearTimeout(loadingTimeout);
      clearInterval(qualityInterval);
      clearInterval(stallCheck);
    };
  }, [src, cleanup, resetHideTimer, onError, startDiagTimer, stopDiagTimer, updateQuality]);

  // ── Mount / src change ──
  useEffect(() => {
    let cleanupFn: (() => void) | undefined;
    const init = async () => {
      cleanupFn = await initStream() || undefined;
    };
    init();
    return () => {
      cleanupFn?.();
      cleanup();
    };
  }, [src]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Muted prop sync ──
  useEffect(() => {
    if (videoRef.current) videoRef.current.muted = muted;
  }, [muted]);

  // ── Switch quality ──
  const switchQuality = useCallback((trackOrAuto: 'auto' | shaka.extern.Track) => {
    const player = playerRef.current;
    if (!player) return;

    if (trackOrAuto === 'auto') {
      player.configure('abr.enabled', true);
    } else {
      player.configure('abr.enabled', false);
      player.selectVariantTrack(trackOrAuto, true);
    }
    setShowQualityMenu(false);
    resetHideTimer();
    setTimeout(() => updateQuality(player), 500);
  }, [resetHideTimer, updateQuality]);

  // ── YouTube embed ──
  const youtubeId = getYouTubeId(src);
  if (youtubeId) {
    return (
      <div className="relative w-full h-full bg-black">
        <iframe
          className="w-full h-full"
          src={`https://www.youtube-nocookie.com/embed/${youtubeId}?autoplay=1&mute=${muted ? 1 : 0}&rel=0&modestbranding=1&playsinline=1&enablejsapi=1&origin=${window.location.origin}`}
          title="YouTube video"
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
          allowFullScreen
          referrerPolicy="no-referrer"
          style={{ border: 'none' }}
        />
      </div>
    );
  }

  // ── Deduplicate quality levels (unique heights) ──
  const uniqueTracks = quality?.levels
    ? [...new Map(quality.levels.map(t => [t.height, t])).values()]
        .sort((a, b) => (a.height ?? 0) - (b.height ?? 0))
    : [];

  return (
    <div
      className="relative w-full h-full bg-black group"
      onMouseMove={resetHideTimer}
      onTouchStart={resetHideTimer}
    >
      <video
        ref={videoRef}
        className="w-full h-full object-contain"
        playsInline
        controls
        controlsList="nodownload noplaybackrate"
        disablePictureInPicture
        onContextMenu={(e) => e.preventDefault()}
        muted={muted}
        preload="auto"
        onCanPlay={() => { setLoading(false); setRetryInfo(null); stopDiagTimer(); }}
        onWaiting={() => setLoading(true)}
        onPlaying={() => { setLoading(false); setRetryInfo(null); stopDiagTimer(); }}
        onError={() => {
          if (!playerRef.current) {
            setError('No se pudo reproducir este canal.');
            setLoading(false);
            stopDiagTimer();
          }
        }}
      />

      {/* Quality Badge */}
      {quality && !error && !loading && (
        <div className="absolute top-3 right-3 z-20">
          <button
            onClick={() => {
              setShowQualityMenu(!showQualityMenu);
              resetHideTimer();
            }}
            className={`${getQualityColor(quality.label)} text-white text-xs font-bold px-3 py-1.5 rounded-lg shadow-lg backdrop-blur-sm flex items-center gap-1.5 hover:scale-105 transition-transform cursor-pointer`}
          >
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-white animate-pulse" />
            {quality.label}
            {quality.auto && uniqueTracks.length > 1 && (
              <span className="text-[10px] opacity-80">AUTO</span>
            )}
            {!quality.auto && (
              <span className="text-[10px] opacity-80">FIJO</span>
            )}
            <svg className={`w-3 h-3 transition-transform ${showQualityMenu ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </button>

          {/* Quality Menu */}
          {showQualityMenu && uniqueTracks.length > 1 && (
            <div className="absolute top-full right-0 mt-1.5 bg-black/95 backdrop-blur-md rounded-xl shadow-2xl border border-white/15 overflow-hidden min-w-[180px] animate-in fade-in slide-in-from-top-2 duration-200">
              <div className="px-3 py-2 border-b border-white/10">
                <p className="text-[10px] text-white/40 uppercase tracking-wider font-semibold">Calidad de Video</p>
              </div>
              {/* Auto */}
              <button
                onClick={() => switchQuality('auto')}
                className={`w-full text-left px-3 py-2.5 text-sm font-medium flex items-center justify-between hover:bg-white/10 transition-colors ${
                  quality.auto ? 'text-primary bg-primary/10' : 'text-white/80'
                }`}
              >
                <div className="flex items-center gap-2">
                  <span className="text-base">🔄</span>
                  <div>
                    <span>Automático</span>
                    <p className="text-[10px] text-white/40">Se ajusta según tu internet</p>
                  </div>
                </div>
                {quality.auto && <span className="text-primary text-lg">●</span>}
              </button>
              <div className="h-px bg-white/10" />
              {/* Quality levels */}
              {uniqueTracks.map((track) => {
                const label = track.height ? getQualityLabel(track.height) : 'Original';
                const isActive = !quality.auto && quality.levels.find(t => t.active)?.height === track.height;
                const bitrateMbps = track.bandwidth ? (track.bandwidth / 1_000_000).toFixed(1) : '?';
                return (
                  <button
                    key={`${track.height}-${track.bandwidth}`}
                    onClick={() => switchQuality(track)}
                    className={`w-full text-left px-3 py-2.5 text-sm font-medium flex items-center justify-between hover:bg-white/10 transition-colors ${
                      isActive ? 'text-primary bg-primary/10' : 'text-white/80'
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <span className={`inline-block w-2 h-2 rounded-full ${getQualityColor(label)}`} />
                      <span>{label}</span>
                    </div>
                    <span className="text-[10px] text-white/40">{bitrateMbps} Mbps</span>
                    {isActive && <span className="text-primary ml-1 text-lg">●</span>}
                  </button>
                );
              })}
              {quality.bandwidth > 0 && (
                <>
                  <div className="h-px bg-white/10" />
                  <div className="px-3 py-2 text-[10px] text-white/30 flex items-center gap-1.5">
                    <span>📶</span> Tu velocidad: {quality.bandwidth} kbps
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      )}

      {/* Loading with diagnostics */}
      {loading && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/80 pointer-events-none">
          <div className="text-center max-w-xs">
            <div className="w-10 h-10 border-2 border-primary border-t-transparent rounded-full animate-spin mx-auto mb-3" />
            <p className="text-muted-foreground text-sm">
              {retryInfo || 'Cargando stream...'}
            </p>
            {loadingDiag && loadingDiag.elapsed >= 3 && (
              <div className="mt-3 px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-[11px] text-white/50 space-y-1">
                <div className="flex justify-between">
                  <span>⏱ Tiempo</span>
                  <span className={loadingDiag.elapsed > 15 ? 'text-red-400' : loadingDiag.elapsed > 8 ? 'text-yellow-400' : 'text-white/60'}>
                    {loadingDiag.elapsed}s
                  </span>
                </div>
                <div className="flex justify-between">
                  <span>📡 Fase</span>
                  <span className="text-white/60 text-right max-w-[140px] truncate">{loadingDiag.phase}</span>
                </div>
                <div className="flex justify-between">
                  <span>🎬 Motor</span>
                  <span className="text-white/60">Shaka Player</span>
                </div>
                {loadingDiag.elapsed > 10 && (
                  <p className="text-yellow-400/80 text-[10px] mt-1 pt-1 border-t border-white/5">
                    ⚠ Conexión lenta — verifica el canal desde el panel admin
                  </p>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Error overlay */}
      {error && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/80">
          <div className="text-center max-w-sm px-4">
            <p className="text-destructive font-semibold mb-2">Error de reproducción</p>
            <p className="text-muted-foreground text-sm mb-4">{error}</p>
            <button
              onClick={() => {
                setError(null);
                retryCountRef.current = 0;
                initStream();
              }}
              className="px-4 py-2 bg-primary text-primary-foreground rounded-md text-sm font-medium hover:bg-primary/90 transition-colors"
            >
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
