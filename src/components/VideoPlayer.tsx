import { useRef, useEffect, useState, useCallback, memo } from 'react';
import Hls from 'hls.js';
import { Settings, Wifi, AlertTriangle, RefreshCw } from 'lucide-react';

interface VideoPlayerProps {
  src: string;
  channelId?: string;
  muted?: boolean;
  onError?: (message: string) => void;
}

interface QualityLevel {
  index: number;
  height: number;
  bitrate: number;
  label: string;
}

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

const isHlsStream = (url: string): boolean => {
  return /\.m3u8(\?|$)/i.test(url) || /\/live\//i.test(url) || /\/api\/restream\//i.test(url);
};

const formatBitrate = (bps: number): string => {
  if (bps >= 1000000) return `${(bps / 1000000).toFixed(1)} Mbps`;
  if (bps >= 1000) return `${(bps / 1000).toFixed(0)} Kbps`;
  return `${bps} bps`;
};

const VideoPlayer = memo(({ src, channelId, muted = false, onError }: VideoPlayerProps) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const hlsRef = useRef<Hls | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingTime, setLoadingTime] = useState(0);
  const retryCountRef = useRef(0);
  const maxRetries = 10;
  const loadingTimerRef = useRef<ReturnType<typeof setInterval>>();

  // Quality selector state
  const [qualities, setQualities] = useState<QualityLevel[]>([]);
  const [currentQuality, setCurrentQuality] = useState(-1);
  const [showQualityMenu, setShowQualityMenu] = useState(false);
  const [currentBandwidth, setCurrentBandwidth] = useState(0);
  const [autoLabel, setAutoLabel] = useState('Auto');
  const qualityMenuRef = useRef<HTMLDivElement>(null);

  // Loading time counter
  useEffect(() => {
    if (loading && !error) {
      setLoadingTime(0);
      loadingTimerRef.current = setInterval(() => {
        setLoadingTime(prev => prev + 1);
      }, 1000);
    } else {
      if (loadingTimerRef.current) clearInterval(loadingTimerRef.current);
    }
    return () => { if (loadingTimerRef.current) clearInterval(loadingTimerRef.current); };
  }, [loading, error]);

  const cleanup = useCallback(() => {
    if (hlsRef.current) {
      hlsRef.current.destroy();
      hlsRef.current = null;
    }
    setQualities([]);
    setCurrentQuality(-1);
  }, []);

  const initStream = useCallback(() => {
    const video = videoRef.current;
    if (!video || !src) return;
    if (getYouTubeId(src)) return;

    setError(null);
    setLoading(true);
    cleanup();

    const isHls = isHlsStream(src);

    if (isHls && Hls.isSupported()) {
      const hls = new Hls({
        // Stability config for IPTV via proxy
        maxBufferLength: 15,          // Less buffer = less data usage
        maxMaxBufferLength: 30,
        maxBufferSize: 30 * 1000 * 1000,
        maxBufferHole: 0.5,
        lowLatencyMode: false,
        startLevel: 0,                // Start at lowest quality always
        capLevelToPlayerSize: true,
        abrEwmaDefaultEstimate: 300000, // Assume 300kbps initially
        abrBandWidthUpFactor: 0.6,     // Very conservative upgrade
        abrBandWidthFactor: 0.95,
        // Aggressive recovery for proxy streams
        manifestLoadingMaxRetry: 10,
        manifestLoadingRetryDelay: 1500,
        manifestLoadingMaxRetryTimeout: 30000,
        levelLoadingMaxRetry: 10,
        levelLoadingRetryDelay: 1500,
        levelLoadingMaxRetryTimeout: 30000,
        fragLoadingMaxRetry: 10,
        fragLoadingRetryDelay: 1000,
        fragLoadingMaxRetryTimeout: 30000,
        // Stall recovery
        nudgeMaxRetry: 10,
        nudgeOffset: 0.2,
      });

      hlsRef.current = hls;

      hls.on(Hls.Events.MEDIA_ATTACHED, () => {
        hls.loadSource(src);
      });

      hls.on(Hls.Events.MANIFEST_PARSED, (_event, data) => {
        setLoading(false);
        retryCountRef.current = 0;

        const levels: QualityLevel[] = data.levels.map((level, idx) => ({
          index: idx,
          height: level.height || 0,
          bitrate: level.bitrate || 0,
          label: level.height
            ? `${level.height}p`
            : `${formatBitrate(level.bitrate)}`,
        }));

        levels.sort((a, b) => a.bitrate - b.bitrate);
        setQualities(levels);

        video.muted = muted;
        video.play().catch(() => {
          video.muted = true;
          video.play().catch(() => {});
        });
      });

      hls.on(Hls.Events.LEVEL_SWITCHED, (_event, data) => {
        const level = hls.levels[data.level];
        if (level) {
          const label = level.height ? `${level.height}p` : formatBitrate(level.bitrate);
          setAutoLabel(label);
        }
      });

      hls.on(Hls.Events.FRAG_LOADED, (_event, data) => {
        retryCountRef.current = 0; // Reset retries on successful load
        if (data.frag.stats) {
          const stats = data.frag.stats;
          const duration = (stats.loading.end - stats.loading.start) / 1000;
          if (duration > 0 && stats.total > 0) {
            const bps = (stats.total * 8) / duration;
            setCurrentBandwidth(bps);
          }
        }
      });

      hls.on(Hls.Events.ERROR, (_event, data) => {
        console.warn('HLS error:', data.type, data.details, data.fatal);

        if (data.fatal) {
          switch (data.type) {
            case Hls.ErrorTypes.NETWORK_ERROR:
              if (retryCountRef.current < maxRetries) {
                retryCountRef.current++;
                console.log(`HLS: retry ${retryCountRef.current}/${maxRetries}`);
                // Drop to lowest quality on network issues
                if (hls.currentLevel > 0) {
                  hls.currentLevel = 0;
                }
                const delay = Math.min(1000 * retryCountRef.current, 8000);
                setTimeout(() => hls.startLoad(), delay);
              } else {
                setError('Error de red. El stream puede estar caído o tu conexión es inestable.');
                setLoading(false);
                onError?.('Network error after max retries');
              }
              break;
            case Hls.ErrorTypes.MEDIA_ERROR:
              console.log('HLS: recovering from media error');
              hls.recoverMediaError();
              break;
            default:
              setError('No se pudo reproducir este canal.');
              setLoading(false);
              onError?.('Fatal error');
              break;
          }
        }
      });

      hls.attachMedia(video);
    }
    // Native HLS (Safari/iOS)
    else if (isHls && video.canPlayType('application/vnd.apple.mpegurl')) {
      video.src = src;
      video.addEventListener('loadedmetadata', () => {
        setLoading(false);
        video.muted = muted;
        video.play().catch(() => {
          video.muted = true;
          video.play().catch(() => {});
        });
      }, { once: true });
    }
    // Direct URL
    else {
      video.src = src;
      video.muted = muted;
      video.addEventListener('loadeddata', () => {
        setLoading(false);
        video.play().catch(() => {
          video.muted = true;
          video.play().catch(() => {});
        });
      }, { once: true });
    }
  }, [src, cleanup, onError, muted]);

  const setQuality = useCallback((levelIndex: number) => {
    const hls = hlsRef.current;
    if (!hls) return;

    if (levelIndex === -1) {
      hls.currentLevel = -1;
      hls.nextLevel = -1;
      setCurrentQuality(-1);
    } else {
      hls.currentLevel = levelIndex;
      hls.nextLevel = levelIndex;
      setCurrentQuality(levelIndex);
    }
    setShowQualityMenu(false);
  }, []);

  useEffect(() => {
    initStream();
    return () => { cleanup(); };
  }, [src]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (videoRef.current) videoRef.current.muted = muted;
  }, [muted]);

  // Stall detection — restart after 20s of no playback
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    let stallTimer: ReturnType<typeof setTimeout> | null = null;

    const onStall = () => {
      if (stallTimer) clearTimeout(stallTimer);
      stallTimer = setTimeout(() => {
        console.warn('Stall detected (20s), restarting stream');
        const hls = hlsRef.current;
        if (hls && hls.currentLevel > 0) {
          hls.currentLevel = 0;
          hls.startLoad();
        } else {
          retryCountRef.current = 0;
          initStream();
        }
      }, 20000);
    };

    const onPlaying = () => {
      if (stallTimer) {
        clearTimeout(stallTimer);
        stallTimer = null;
      }
    };

    video.addEventListener('stalled', onStall);
    video.addEventListener('waiting', onStall);
    video.addEventListener('playing', onPlaying);

    return () => {
      video.removeEventListener('stalled', onStall);
      video.removeEventListener('waiting', onStall);
      video.removeEventListener('playing', onPlaying);
      if (stallTimer) clearTimeout(stallTimer);
    };
  }, [initStream]);

  // Loading timeout — show error after 25s
  useEffect(() => {
    if (loadingTime >= 25 && loading) {
      setError('El canal tardó demasiado en responder. Puede estar caído o tu conexión es muy lenta.');
      setLoading(false);
    }
  }, [loadingTime, loading]);

  // Close quality menu on outside click
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (qualityMenuRef.current && !qualityMenuRef.current.contains(e.target as Node)) {
        setShowQualityMenu(false);
      }
    };
    if (showQualityMenu) {
      document.addEventListener('mousedown', handleClick);
      return () => document.removeEventListener('mousedown', handleClick);
    }
  }, [showQualityMenu]);

  // YouTube embed
  const youtubeId = getYouTubeId(src);
  if (youtubeId) {
    return (
      <div className="relative w-full h-full bg-black">
        <iframe
          className="w-full h-full"
          src={`https://www.youtube-nocookie.com/embed/${youtubeId}?autoplay=1&mute=${muted ? 1 : 0}&rel=0&modestbranding=1&playsinline=1`}
          title="YouTube video"
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
        muted={muted}
        onCanPlay={() => setLoading(false)}
        onWaiting={() => setLoading(true)}
        onPlaying={() => { setLoading(false); setError(null); }}
        onError={() => {
          if (!hlsRef.current) {
            setError('No se pudo reproducir este canal.');
            setLoading(false);
          }
        }}
      />

      {/* Quality selector */}
      {qualities.length > 1 && (
        <div ref={qualityMenuRef} className="absolute bottom-16 right-3 z-30">
          {showQualityMenu && (
            <div className="mb-2 bg-black/90 backdrop-blur-sm rounded-lg border border-white/10 overflow-hidden min-w-[180px]">
              <div className="px-3 py-2 border-b border-white/10 flex items-center gap-2">
                <Wifi className="w-3 h-3 text-primary" />
                <span className="text-xs text-white/60">{formatBitrate(currentBandwidth)}</span>
              </div>

              <button
                onClick={() => setQuality(-1)}
                className={`w-full px-3 py-2 text-left text-sm flex items-center justify-between hover:bg-white/10 transition-colors ${
                  currentQuality === -1 ? 'text-primary font-semibold' : 'text-white'
                }`}
              >
                <span>Auto ({autoLabel})</span>
                {currentQuality === -1 && <span className="text-xs text-primary">●</span>}
              </button>

              {[...qualities].reverse().map((q) => (
                <button
                  key={q.index}
                  onClick={() => setQuality(q.index)}
                  className={`w-full px-3 py-2 text-left text-sm flex items-center justify-between hover:bg-white/10 transition-colors ${
                    currentQuality === q.index ? 'text-primary font-semibold' : 'text-white'
                  }`}
                >
                  <span>{q.label}</span>
                  <span className="text-xs text-white/40">{formatBitrate(q.bitrate)}</span>
                </button>
              ))}
            </div>
          )}

          <button
            onClick={() => setShowQualityMenu(!showQualityMenu)}
            className="flex items-center gap-1.5 px-2.5 py-1.5 bg-black/70 hover:bg-black/90 rounded-md text-white text-xs font-medium transition-colors opacity-0 group-hover:opacity-100"
          >
            <Settings className="w-3.5 h-3.5" />
            <span>
              {currentQuality === -1 ? `Auto (${autoLabel})` : qualities.find(q => q.index === currentQuality)?.label || ''}
            </span>
            {currentQuality !== -1 && (
              <span className="text-[10px] text-primary font-bold">FIJO</span>
            )}
          </button>
        </div>
      )}

      {/* Loading overlay with diagnostics */}
      {loading && !error && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/80 pointer-events-none">
          <div className="flex flex-col items-center gap-3">
            <div className="w-10 h-10 border-2 border-primary border-t-transparent rounded-full animate-spin" />
            {loadingTime >= 3 && (
              <div className="text-center">
                <p className="text-white/60 text-xs">Conectando... {loadingTime}s</p>
                {loadingTime >= 8 && (
                  <p className="text-white/40 text-[10px] mt-1">La conexión está lenta</p>
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
            <AlertTriangle className="w-8 h-8 text-destructive mx-auto mb-3" />
            <p className="text-destructive font-semibold mb-2">Error de reproducción</p>
            <p className="text-muted-foreground text-sm mb-4">{error}</p>
            <button
              onClick={() => { retryCountRef.current = 0; initStream(); }}
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
