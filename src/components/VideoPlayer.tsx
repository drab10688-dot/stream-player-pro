import { useRef, useEffect, useState, useCallback, memo } from 'react';
import Hls from 'hls.js';
import mpegts from 'mpegts.js';

interface VideoPlayerProps {
  src: string;
  channelId?: string;
  muted?: boolean;
  onError?: (message: string) => void;
}

interface QualityInfo {
  label: string;
  current: number;
  levels: number;
  bandwidth: number;
  auto: boolean;
}

const getYouTubeId = (url: string): string | null => {
  const patterns = [
    /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([a-zA-Z0-9_-]{11})/,
    /youtube\.com\/shorts\/([a-zA-Z0-9_-]{11})/,
    /youtube\.com\/live\/([a-zA-Z0-9_-]{11})/,
  ];
  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match) return match[1];
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

const getQualityLabel = (height: number | undefined, bandwidth: number | undefined): string => {
  if (height) {
    if (height <= 480) return '480p';
    if (height <= 720) return '720p';
    if (height <= 1080) return '1080p';
    return `${height}p`;
  }
  if (bandwidth) {
    if (bandwidth < 1000000) return '480p';
    if (bandwidth < 2500000) return '720p';
    return 'HD';
  }
  return 'Auto';
};

const getQualityColor = (label: string): string => {
  if (label === '480p') return 'bg-yellow-500/90';
  if (label === '720p') return 'bg-blue-500/90';
  if (label === '1080p' || label === 'HD') return 'bg-green-500/90';
  return 'bg-white/70';
};

const MAX_RETRIES = 12;
const MAX_FULL_RECONNECTS = 3;

const VideoPlayer = memo(({ src, channelId, muted = false, onError }: VideoPlayerProps) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const hlsRef = useRef<Hls | null>(null);
  const mpegtsRef = useRef<mpegts.Player | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [quality, setQuality] = useState<QualityInfo | null>(null);
  const [showQualityMenu, setShowQualityMenu] = useState(false);
  const [qualityVisible, setQualityVisible] = useState(true);
  const [bufferAhead, setBufferAhead] = useState(0);
  const [retryInfo, setRetryInfo] = useState<string | null>(null);
  const hideTimerRef = useRef<ReturnType<typeof setTimeout>>();
  const retryCountRef = useRef(0);
  const fullReconnectCountRef = useRef(0);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout>>();
  const isPlayingRef = useRef(false);
  const initializerRef = useRef<(() => void) | null>(null);
  const lastQualityUpdateRef = useRef(0);
  const lastBufferUpdateRef = useRef(0);
  const fragCountRef = useRef(0);

  const resetHideTimer = useCallback(() => {
    setQualityVisible(true);
    if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    hideTimerRef.current = setTimeout(() => setQualityVisible(false), 5000);
  }, []);

  const cleanup = useCallback(() => {
    if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
    if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    if (hlsRef.current) {
      hlsRef.current.destroy();
      hlsRef.current = null;
    }
    if (mpegtsRef.current) {
      try {
        mpegtsRef.current.pause();
        mpegtsRef.current.unload();
        mpegtsRef.current.detachMediaElement();
        mpegtsRef.current.destroy();
      } catch { /* ignore */ }
      mpegtsRef.current = null;
    }
  }, []);

  const initStream = useCallback(() => {
    const video = videoRef.current;
    if (!video || !src) return;

    const streamType = detectStreamType(src);
    if (streamType === 'youtube') return;

    setError(null);
    setLoading(true);
    setQuality(null);
    setRetryInfo(null);
    retryCountRef.current = 0;
    isPlayingRef.current = false;
    fragCountRef.current = 0;
    cleanup();

    const reportError = (msg: string) => {
      setError(msg);
      setLoading(false);
      setRetryInfo(null);
      onError?.(msg);
    };

    const fullReconnect = () => {
      if (fullReconnectCountRef.current >= MAX_FULL_RECONNECTS) {
        reportError('No se pudo conectar al stream después de varios intentos.');
        return;
      }
      fullReconnectCountRef.current++;
      const delay = 3000 * fullReconnectCountRef.current;
      setRetryInfo(`Reconectando (${fullReconnectCountRef.current}/${MAX_FULL_RECONNECTS})...`);
      retryTimerRef.current = setTimeout(() => {
        retryCountRef.current = 0;
        cleanup();
        initStream();
      }, delay);
    };

    const retryStream = () => {
      if (retryCountRef.current >= MAX_RETRIES) {
        fullReconnect();
        return;
      }
      retryCountRef.current++;
      const delay = Math.min(2000 * retryCountRef.current, 10000);
      setRetryInfo(`Reintentando (${retryCountRef.current}/${MAX_RETRIES})...`);
      retryTimerRef.current = setTimeout(() => {
        if (mpegtsRef.current) {
          try {
            mpegtsRef.current.unload();
            mpegtsRef.current.load();
          } catch { /* ignore */ }
        } else if (hlsRef.current) {
          hlsRef.current.startLoad();
        }
      }, delay);
    };

    const attemptPlay = async (v: HTMLVideoElement) => {
      try {
        v.muted = false;
        await v.play();
        setLoading(false);
        setRetryInfo(null);
        isPlayingRef.current = true;
      } catch {
        v.muted = true;
        try {
          await v.play();
          setLoading(false);
          setRetryInfo(null);
          isPlayingRef.current = true;
          setTimeout(() => { v.muted = false; }, 500);
        } catch {
          setLoading(false);
        }
      }
    };

    if (streamType === 'ts') {
      if (mpegts.isSupported()) {
        const player = mpegts.createPlayer({
          type: 'mpegts',
          isLive: true,
          url: src,
        }, {
          enableWorker: true,
          enableStashBuffer: true,
          stashInitialSize: 512 * 1024,        // 512KB initial (was 1MB) — faster start
          liveBufferLatencyChasing: true,
          liveBufferLatencyMaxLatency: 5,       // tighter latency (was 8)
          liveBufferLatencyMinRemain: 0.5,      // closer to live (was 1)
          lazyLoad: false,
          autoCleanupSourceBuffer: true,
          autoCleanupMaxBackwardDuration: 15,   // less back-buffer (was 30)
          autoCleanupMinBackwardDuration: 8,    // (was 15)
        });
        mpegtsRef.current = player;
        player.attachMediaElement(video);
        player.load();

        player.on(mpegts.Events.ERROR, (errorType: string, errorDetail: string) => {
          console.error('mpegts error:', errorType, errorDetail);
          retryStream();
        });

        // Throttle STATISTICS_INFO — only update quality every 3s
        player.on(mpegts.Events.STATISTICS_INFO, () => {
          const now = Date.now();
          if (loading && video.readyState >= 2) {
            setLoading(false);
            setRetryInfo(null);
          }
          if (now - lastQualityUpdateRef.current > 3000 && video.videoHeight) {
            lastQualityUpdateRef.current = now;
            setQuality({
              label: getQualityLabel(video.videoHeight, undefined),
              current: 0,
              levels: 1,
              bandwidth: 0,
              auto: false,
            });
            resetHideTimer();
          }
        });

        attemptPlay(video);
      } else {
        video.src = src;
        attemptPlay(video);
      }
    } else if (streamType === 'hls') {
      if (video.canPlayType('application/vnd.apple.mpegurl')) {
        video.src = src;
        attemptPlay(video);
      } else if (Hls.isSupported()) {
        const hls = new Hls({
          enableWorker: true,
          lowLatencyMode: true,
          // ABR: aggressive downshift for slow connections (DirecTV Go style)
          abrEwmaDefaultEstimate: 500000,       // Start assuming 500kbps (was 1Mbps) — forces lowest quality first
          abrEwmaFastLive: 2,                    // React faster to bandwidth drops (was 3)
          abrEwmaSlowLive: 6,                    // Shorter averaging window (was 9)
          abrEwmaFastVoD: 2,
          abrEwmaSlowVoD: 6,
          abrBandWidthFactor: 0.7,               // More conservative — only upgrade at 70% capacity (was 0.8)
          abrBandWidthUpFactor: 0.5,             // Even more conservative for upgrading (was 0.6)
          // Buffer: small for fast start, reasonable for stability
          maxBufferLength: 30,                   // 30s buffer (was 120s) — less memory, faster adaptation
          maxMaxBufferLength: 60,                // 1 min max (was 300s)
          maxBufferSize: 30 * 1000 * 1000,       // 30MB (was 60MB) — less memory on mobile
          maxBufferHole: 0.3,                    // Tighter hole tolerance (was 0.5)
          backBufferLength: 10,                  // 10s back (was 30s) — save memory
          // Live sync — stay close to live edge
          liveSyncDurationCount: 2,
          liveMaxLatencyDurationCount: 4,        // Tighter (was 5)
          liveDurationInfinity: true,
          // Retries
          fragLoadingMaxRetry: 15,
          fragLoadingRetryDelay: 800,            // Faster retry (was 1000)
          fragLoadingMaxRetryTimeout: 20000,     // Faster give-up (was 30000)
          manifestLoadingMaxRetry: 10,
          manifestLoadingRetryDelay: 800,
          manifestLoadingMaxRetryTimeout: 20000,
          levelLoadingMaxRetry: 10,
          levelLoadingRetryDelay: 800,
          levelLoadingMaxRetryTimeout: 20000,
          startLevel: 0,                         // Always start at lowest quality (360p)
          startFragPrefetch: true,
          testBandwidth: true,
          progressive: true,
          // Segments: prefer smaller for faster switching
          maxFragLookUpTolerance: 0.2,
        });
        hlsRef.current = hls;
        hls.loadSource(src);
        hls.attachMedia(video);

        hls.on(Hls.Events.MANIFEST_PARSED, () => {
          setLoading(false);
          setRetryInfo(null);
          attemptPlay(video);
          updateQualityInfo(hls);
        });

        hls.on(Hls.Events.LEVEL_SWITCHED, () => {
          updateQualityInfo(hls);
          resetHideTimer();
        });

        // Throttle FRAG_LOADED: update buffer/quality every 5th fragment or every 5s
        hls.on(Hls.Events.FRAG_LOADED, () => {
          retryCountRef.current = 0;
          isPlayingRef.current = true;
          fragCountRef.current++;

          const now = Date.now();
          if (fragCountRef.current <= 2 || now - lastQualityUpdateRef.current > 5000) {
            lastQualityUpdateRef.current = now;
            setRetryInfo(null);
            updateQualityInfo(hls);
          }

          // Update buffer display max every 10s
          if (now - lastBufferUpdateRef.current > 10000 && video.buffered.length > 0) {
            lastBufferUpdateRef.current = now;
            const buffered = video.buffered.end(video.buffered.length - 1) - video.currentTime;
            setBufferAhead(Math.max(0, Math.round(buffered)));
          }
        });

        hls.on(Hls.Events.ERROR, (_, data) => {
          if (data.fatal) {
            switch (data.type) {
              case Hls.ErrorTypes.NETWORK_ERROR:
                console.warn('HLS network error, retrying...', data.details);
                retryStream();
                break;
              case Hls.ErrorTypes.MEDIA_ERROR:
                console.warn('HLS media error, recovering...', data.details);
                hls.recoverMediaError();
                break;
              default:
                if (!isPlayingRef.current) {
                  console.warn('HLS fatal error before playback, full reconnect...', data.details);
                  fullReconnect();
                } else {
                  reportError(`Error HLS: ${data.details || 'Error fatal del stream'}`);
                }
                break;
            }
          }
        });

        hls.on(Hls.Events.BUFFER_EOS, () => {
          if (!video.ended) retryStream();
        });
      } else {
        reportError('Tu navegador no soporta HLS');
      }
    } else {
      video.src = src;
      attemptPlay(video);
    }

    // Stall check — only when actively playing, every 15s (was 10s)
    const stallCheck = setInterval(() => {
      if (video && !video.paused && video.readyState < 3 && !loading) {
        retryStream();
      }
    }, 15000);

    resetHideTimer();

    const localCleanup = () => {
      clearInterval(stallCheck);
      cleanup();
    };

    initializerRef.current = localCleanup;
    return localCleanup;
  }, [src, cleanup, resetHideTimer, onError]);

  useEffect(() => {
    fullReconnectCountRef.current = 0;
    const localCleanup = initStream();
    return () => {
      localCleanup?.();
    };
  }, [src]); // eslint-disable-line react-hooks/exhaustive-deps

  const updateQualityInfo = (hls: Hls) => {
    const currentLevel = hls.currentLevel;
    const levels = hls.levels;
    if (!levels || levels.length === 0) return;

    const level = levels[currentLevel] || levels[0];
    const bw = hls.bandwidthEstimate || 0;

    setQuality({
      label: getQualityLabel(level?.height, level?.bitrate),
      current: currentLevel,
      levels: levels.length,
      bandwidth: Math.round(bw / 1000),
      auto: hls.autoLevelEnabled,
    });
  };

  const switchQuality = (levelIndex: number) => {
    const hls = hlsRef.current;
    if (!hls) return;
    if (levelIndex === -1) {
      hls.currentLevel = -1;
    } else {
      hls.currentLevel = levelIndex;
    }
    setShowQualityMenu(false);
    resetHideTimer();
  };

  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.muted = muted;
    }
  }, [muted]);

  // YouTube render
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
        muted={muted}
        preload="auto"
        {...(detectStreamType(src) !== 'ts' && src.startsWith('/') ? { crossOrigin: 'anonymous' as const } : {})}
        onCanPlay={() => { setLoading(false); setRetryInfo(null); }}
        onWaiting={() => setLoading(true)}
        onPlaying={() => { setLoading(false); setRetryInfo(null); isPlayingRef.current = true; }}
        onError={() => {
          if (!hlsRef.current && !mpegtsRef.current) {
            const msg = 'No se pudo reproducir este canal. Verifica la URL.';
            setError(msg);
            setLoading(false);
            onError?.(msg);
          }
        }}
      />

      {/* Quality Badge */}
      {quality && !error && !loading && (
        <div
          className={`absolute top-3 right-3 z-20 transition-opacity duration-300 ${
            qualityVisible || showQualityMenu ? 'opacity-100' : 'opacity-0'
          }`}
        >
          <button
            onClick={() => {
              setShowQualityMenu(!showQualityMenu);
              resetHideTimer();
            }}
            className={`${getQualityColor(quality.label)} text-white text-xs font-bold px-2.5 py-1 rounded-md shadow-lg backdrop-blur-sm flex items-center gap-1.5 hover:scale-105 transition-transform cursor-pointer`}
          >
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-white animate-pulse" />
            {quality.label}
            {bufferAhead > 0 && (
              <span className="text-[10px] opacity-70 ml-0.5">
                {bufferAhead >= 60 ? `${Math.floor(bufferAhead / 60)}m` : `${bufferAhead}s`}
              </span>
            )}
            {quality.auto && quality.levels > 1 && (
              <span className="text-[10px] opacity-80">AUTO</span>
            )}
          </button>

          {/* Quality Selector Menu */}
          {showQualityMenu && hlsRef.current && hlsRef.current.levels.length > 1 && (
            <div className="absolute top-full right-0 mt-1 bg-black/90 backdrop-blur-md rounded-lg shadow-2xl border border-white/10 overflow-hidden min-w-[140px]">
              <button
                onClick={() => switchQuality(-1)}
                className={`w-full text-left px-3 py-2 text-xs font-medium flex items-center justify-between hover:bg-white/10 transition-colors ${
                  quality.auto ? 'text-primary' : 'text-white/80'
                }`}
              >
                <span>Auto</span>
                {quality.auto && <span className="text-primary">●</span>}
              </button>
              <div className="h-px bg-white/10" />
              {hlsRef.current.levels.map((level, idx) => {
                const label = getQualityLabel(level.height, level.bitrate);
                const bitrateMbps = (level.bitrate / 1000000).toFixed(1);
                const isActive = !quality.auto && quality.current === idx;
                return (
                  <button
                    key={idx}
                    onClick={() => switchQuality(idx)}
                    className={`w-full text-left px-3 py-2 text-xs font-medium flex items-center justify-between hover:bg-white/10 transition-colors ${
                      isActive ? 'text-primary' : 'text-white/80'
                    }`}
                  >
                    <span>{label}</span>
                    <span className="text-[10px] text-white/40 ml-2">{bitrateMbps}M</span>
                    {isActive && <span className="text-primary ml-1">●</span>}
                  </button>
                );
              })}
              {quality.bandwidth > 0 && (
                <>
                  <div className="h-px bg-white/10" />
                  <div className="px-3 py-1.5 text-[10px] text-white/30">
                    ↓ {quality.bandwidth} kbps
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      )}

      {/* Loading / Retry indicator */}
      {loading && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/80 pointer-events-none">
          <div className="text-center">
            <div className="w-10 h-10 border-2 border-primary border-t-transparent rounded-full animate-spin mx-auto mb-3" />
            <p className="text-muted-foreground text-sm">
              {retryInfo || 'Cargando stream...'}
            </p>
          </div>
        </div>
      )}
      {error && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/80">
          <div className="text-center max-w-sm px-4">
            <p className="text-destructive font-semibold mb-2">Error de reproducción</p>
            <p className="text-muted-foreground text-sm mb-4">{error}</p>
            <button
              onClick={() => {
                setError(null);
                fullReconnectCountRef.current = 0;
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
