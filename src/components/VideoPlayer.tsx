import { useRef, useEffect, useState, useCallback } from 'react';
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

const VideoPlayer = ({ src, channelId, muted = false, onError }: VideoPlayerProps) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const hlsRef = useRef<Hls | null>(null);
  const mpegtsRef = useRef<mpegts.Player | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [quality, setQuality] = useState<QualityInfo | null>(null);
  const [showQualityMenu, setShowQualityMenu] = useState(false);
  const [qualityVisible, setQualityVisible] = useState(true);
  const [bufferAhead, setBufferAhead] = useState(0);
  const hideTimerRef = useRef<ReturnType<typeof setTimeout>>();
  const retryCountRef = useRef(0);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout>>();

  // Auto-hide quality badge after 5s of no interaction
  const resetHideTimer = useCallback(() => {
    setQualityVisible(true);
    if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    hideTimerRef.current = setTimeout(() => setQualityVisible(false), 5000);
  }, []);

  const cleanup = () => {
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
  };

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !src) return;

    const streamType = detectStreamType(src);
    if (streamType === 'youtube') return;

    setError(null);
    setLoading(true);
    setQuality(null);
    retryCountRef.current = 0;
    cleanup();

    const reportError = (msg: string) => {
      setError(msg);
      setLoading(false);
      onError?.(msg);
    };

    const retryStream = () => {
      if (retryCountRef.current >= 5) {
        reportError('No se pudo conectar al stream después de varios intentos.');
        return;
      }
      retryCountRef.current++;
      const delay = Math.min(2000 * retryCountRef.current, 10000);
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
      } catch {
        v.muted = true;
        try {
          await v.play();
          setLoading(false);
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
          stashInitialSize: 1024 * 1024,
          liveBufferLatencyChasing: true,
          liveBufferLatencyMaxLatency: 8,
          liveBufferLatencyMinRemain: 1,
          lazyLoad: false,
          autoCleanupSourceBuffer: true,
          autoCleanupMaxBackwardDuration: 30,
          autoCleanupMinBackwardDuration: 15,
        });
        mpegtsRef.current = player;
        player.attachMediaElement(video);
        player.load();

        player.on(mpegts.Events.ERROR, (errorType: string, errorDetail: string) => {
          console.error('mpegts error:', errorType, errorDetail);
          retryStream();
        });

        player.on(mpegts.Events.STATISTICS_INFO, () => {
          if (loading && video.readyState >= 2) {
            setLoading(false);
          }
          // Show TS quality based on video dimensions
          if (video.videoHeight) {
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
          lowLatencyMode: false,
          abrEwmaDefaultEstimate: 500000,
          abrEwmaFastLive: 3,
          abrEwmaSlowLive: 10,
          abrEwmaFastVoD: 3,
          abrEwmaSlowVoD: 10,
          abrBandWidthFactor: 0.7,
          abrBandWidthUpFactor: 0.5,
          // Buffer agresivo: hasta 500 MB / 30 min adelantados
          maxBufferLength: 1800,           // 30 min de buffer objetivo
          maxMaxBufferLength: 3600,        // hasta 60 min si el dispositivo puede
          maxBufferSize: 500 * 1000 * 1000, // 500 MB máximo en memoria
          maxBufferHole: 0.5,
          backBufferLength: 120,           // mantener 2 min de lo ya visto
          fragLoadingMaxRetry: 20,
          fragLoadingRetryDelay: 1000,
          fragLoadingMaxRetryTimeout: 60000,
          manifestLoadingMaxRetry: 15,
          manifestLoadingRetryDelay: 1000,
          levelLoadingMaxRetry: 15,
          levelLoadingRetryDelay: 1000,
          startLevel: 0,
          startFragPrefetch: true,
          testBandwidth: true,
          progressive: true,
        });
        hlsRef.current = hls;
        hls.loadSource(src);
        hls.attachMedia(video);

        hls.on(Hls.Events.MANIFEST_PARSED, () => {
          setLoading(false);
          attemptPlay(video);
          // Set initial quality info
          updateQualityInfo(hls);
        });

        // Track quality level changes
        hls.on(Hls.Events.LEVEL_SWITCHED, () => {
          updateQualityInfo(hls);
          resetHideTimer();
        });

        hls.on(Hls.Events.FRAG_LOADED, () => {
          updateQualityInfo(hls);
          // Track buffer ahead
          if (video.buffered.length > 0) {
            const buffered = video.buffered.end(video.buffered.length - 1) - video.currentTime;
            setBufferAhead(Math.max(0, Math.round(buffered)));
          }
        });

        hls.on(Hls.Events.ERROR, (_, data) => {
          if (data.fatal) {
            switch (data.type) {
              case Hls.ErrorTypes.NETWORK_ERROR:
                retryStream();
                break;
              case Hls.ErrorTypes.MEDIA_ERROR:
                hls.recoverMediaError();
                break;
              default:
                reportError(`Error HLS: ${data.details || 'Error fatal del stream'}`);
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

    const stallCheck = setInterval(() => {
      if (video && !video.paused && video.readyState < 3 && !loading) {
        retryStream();
      }
    }, 10000);

    resetHideTimer();

    return () => {
      clearInterval(stallCheck);
      cleanup();
    };
  }, [src]);

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
      hls.currentLevel = -1; // Auto
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
        crossOrigin="anonymous"
        onCanPlay={() => setLoading(false)}
        onWaiting={() => setLoading(true)}
        onPlaying={() => setLoading(false)}
        onError={() => {
          const msg = 'No se pudo reproducir este canal. Verifica la URL.';
          setError(msg);
          setLoading(false);
          onError?.(msg);
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
              {/* Auto option */}
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
              {/* Quality levels */}
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
              {/* Bandwidth info */}
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

      {loading && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/80 pointer-events-none">
          <div className="text-center">
            <div className="w-10 h-10 border-2 border-primary border-t-transparent rounded-full animate-spin mx-auto mb-3" />
            <p className="text-muted-foreground text-sm">Cargando stream...</p>
          </div>
        </div>
      )}
      {error && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/80">
          <div className="text-center max-w-sm px-4">
            <p className="text-destructive font-semibold mb-2">Error de reproducción</p>
            <p className="text-muted-foreground text-sm">{error}</p>
          </div>
        </div>
      )}
    </div>
  );
};

export default VideoPlayer;
