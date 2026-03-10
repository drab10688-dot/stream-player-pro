import { useRef, useEffect, useState, useCallback, memo } from 'react';
import Hls from 'hls.js';
import { Settings, Wifi } from 'lucide-react';

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
  return /\.m3u8(\?|$)/i.test(url) || /\/live\//i.test(url);
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
  const retryCountRef = useRef(0);
  const maxRetries = 8;

  // Quality selector state
  const [qualities, setQualities] = useState<QualityLevel[]>([]);
  const [currentQuality, setCurrentQuality] = useState(-1); // -1 = auto
  const [showQualityMenu, setShowQualityMenu] = useState(false);
  const [currentBandwidth, setCurrentBandwidth] = useState(0);
  const [autoLabel, setAutoLabel] = useState('Auto');
  const qualityMenuRef = useRef<HTMLDivElement>(null);

  const cleanup = useCallback(() => {
    if (hlsRef.current) {
      hlsRef.current.destroy();
      hlsRef.current = null;
    }
    retryCountRef.current = 0;
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

    // Case 1: HLS stream with hls.js support
    if (isHls && Hls.isSupported()) {
      const hls = new Hls({
        // Stability + low bandwidth config for IPTV
        maxBufferLength: 30,
        maxMaxBufferLength: 60,
        maxBufferSize: 60 * 1000 * 1000,
        maxBufferHole: 0.5,
        lowLatencyMode: false,
        startLevel: 0, // Start at lowest quality
        capLevelToPlayerSize: true,
        abrEwmaDefaultEstimate: 500000, // Start assuming 500kbps
        abrBandWidthUpFactor: 0.7, // Conservative upgrade (default 0.7)
        abrBandWidthFactor: 0.95, // Conservative downgrade
        // Recovery settings
        manifestLoadingMaxRetry: 8,
        manifestLoadingRetryDelay: 1000,
        levelLoadingMaxRetry: 8,
        levelLoadingRetryDelay: 1000,
        fragLoadingMaxRetry: 8,
        fragLoadingRetryDelay: 1000,
        // Stall recovery
        nudgeMaxRetry: 5,
        nudgeOffset: 0.2,
      });

      hlsRef.current = hls;

      hls.on(Hls.Events.MEDIA_ATTACHED, () => {
        hls.loadSource(src);
      });

      hls.on(Hls.Events.MANIFEST_PARSED, (_event, data) => {
        setLoading(false);

        // Extract quality levels
        const levels: QualityLevel[] = data.levels.map((level, idx) => ({
          index: idx,
          height: level.height || 0,
          bitrate: level.bitrate || 0,
          label: level.height
            ? `${level.height}p`
            : `${formatBitrate(level.bitrate)}`,
        }));

        // Sort by bitrate ascending
        levels.sort((a, b) => a.bitrate - b.bitrate);
        setQualities(levels);

        video.muted = muted;
        video.play().catch(() => {
          video.muted = true;
          video.play().catch(() => {});
        });
      });

      // Track current quality and bandwidth
      hls.on(Hls.Events.LEVEL_SWITCHED, (_event, data) => {
        const level = hls.levels[data.level];
        if (level) {
          const label = level.height ? `${level.height}p` : formatBitrate(level.bitrate);
          setAutoLabel(label);
        }
      });

      hls.on(Hls.Events.FRAG_LOADED, (_event, data) => {
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
                // On network errors, try dropping to lowest quality
                if (hls.currentLevel > 0) {
                  hls.currentLevel = 0;
                }
                setTimeout(() => hls.startLoad(), 1000 * retryCountRef.current);
              } else {
                setError('Error de red: no se pudo cargar el stream.');
                setLoading(false);
                onError?.('Network error');
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

      hls.on(Hls.Events.FRAG_BUFFERED, () => {
        retryCountRef.current = 0;
      });

      hls.attachMedia(video);
    }
    // Case 2: Native HLS support (Safari/iOS)
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
    // Case 3: Direct URL
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

  // Set quality level
  const setQuality = useCallback((levelIndex: number) => {
    const hls = hlsRef.current;
    if (!hls) return;

    if (levelIndex === -1) {
      // Auto mode
      hls.currentLevel = -1;
      hls.nextLevel = -1;
      setCurrentQuality(-1);
    } else {
      // Fixed quality
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

  // Stall detection
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    let stallTimer: ReturnType<typeof setTimeout> | null = null;

    const onStall = () => {
      if (stallTimer) clearTimeout(stallTimer);
      stallTimer = setTimeout(() => {
        console.warn('Stall detected, restarting stream');
        // Try dropping quality first before full restart
        const hls = hlsRef.current;
        if (hls && hls.currentLevel > 0) {
          hls.currentLevel = 0;
          hls.startLoad();
        } else {
          initStream();
        }
      }, 15000);
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
        onPlaying={() => setLoading(false)}
        onError={() => {
          if (!hlsRef.current) {
            setError('No se pudo reproducir este canal.');
            setLoading(false);
          }
        }}
      />

      {/* Quality selector button */}
      {qualities.length > 1 && (
        <div ref={qualityMenuRef} className="absolute bottom-16 right-3 z-30">
          {/* Quality menu */}
          {showQualityMenu && (
            <div className="mb-2 bg-black/90 backdrop-blur-sm rounded-lg border border-white/10 overflow-hidden min-w-[180px]">
              {/* Bandwidth indicator */}
              <div className="px-3 py-2 border-b border-white/10 flex items-center gap-2">
                <Wifi className="w-3 h-3 text-primary" />
                <span className="text-xs text-white/60">
                  {formatBitrate(currentBandwidth)}
                </span>
              </div>

              {/* Auto option */}
              <button
                onClick={() => setQuality(-1)}
                className={`w-full px-3 py-2 text-left text-sm flex items-center justify-between hover:bg-white/10 transition-colors ${
                  currentQuality === -1 ? 'text-primary font-semibold' : 'text-white'
                }`}
              >
                <span>Auto ({autoLabel})</span>
                {currentQuality === -1 && <span className="text-xs text-primary">●</span>}
              </button>

              {/* Quality levels */}
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

          {/* Toggle button */}
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

      {loading && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/80 pointer-events-none">
          <div className="w-10 h-10 border-2 border-primary border-t-transparent rounded-full animate-spin" />
        </div>
      )}

      {error && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/80">
          <div className="text-center max-w-sm px-4">
            <p className="text-destructive font-semibold mb-2">Error de reproducción</p>
            <p className="text-muted-foreground text-sm mb-4">{error}</p>
            <button
              onClick={() => { retryCountRef.current = 0; initStream(); }}
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
