import { useRef, useEffect, useState, useCallback, memo } from 'react';
import Hls from 'hls.js';
import mpegts from 'mpegts.js';
import { Settings, Wifi, AlertTriangle, RefreshCw, ChevronUp } from 'lucide-react';

interface QualityLevel {
  id: string;
  label: string;
  height: number;
  bandwidth: number;
}

interface VideoPlayerProps {
  src: string;
  channelId?: string;
  muted?: boolean;
  onError?: (message: string) => void;
  onQualityChange?: (quality: string) => void;
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

type StreamType = 'hls' | 'ts' | 'direct';

const detectStreamType = (url: string): StreamType => {
  if (/\.m3u8(\?|$)/i.test(url)) return 'hls';
  if (/\.ts(\?|$)/i.test(url)) return 'ts';
  if (/\/api\/restream\//i.test(url)) return 'hls';
  if (/\/live\//i.test(url)) return 'hls';
  return 'direct';
};

const formatBitrate = (bps: number): string => {
  if (bps >= 1000000) return `${(bps / 1000000).toFixed(1)} Mbps`;
  if (bps >= 1000) return `${(bps / 1000).toFixed(0)} Kbps`;
  return `${bps} bps`;
};

const VideoPlayer = memo(({ src, channelId, muted = false, onError, onQualityChange }: VideoPlayerProps) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const hlsRef = useRef<Hls | null>(null);
  const mpegtsPlayerRef = useRef<mpegts.Player | null>(null);

  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingTime, setLoadingTime] = useState(0);
  const [engineType, setEngineType] = useState<'hls.js' | 'mpegts' | null>(null);
  const [currentBandwidth, setCurrentBandwidth] = useState(0);
  const [qualityLevels, setQualityLevels] = useState<QualityLevel[]>([]);
  const [selectedQuality, setSelectedQuality] = useState<string>('auto');
  const [showQualityMenu, setShowQualityMenu] = useState(false);

  const retryCountRef = useRef(0);
  const maxRetries = 10;
  const loadingTimerRef = useRef<ReturnType<typeof setInterval>>();
  const retryTimeoutRef = useRef<ReturnType<typeof setTimeout>>();

  const isBridgeStream = src?.includes('/api/restream/');
  const bridgeStreamId = isBridgeStream ? src.match(/\/api\/restream\/([^/?]+)/)?.[1] : null;

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

  // Loading timeout — 30s
  useEffect(() => {
    if (loadingTime >= 30 && loading) {
      setError('El canal tardó demasiado en responder. Puede estar caído o tu conexión es muy lenta.');
      setLoading(false);
    }
  }, [loadingTime, loading]);

  const cleanup = useCallback(() => {
    if (retryTimeoutRef.current) {
      clearTimeout(retryTimeoutRef.current);
      retryTimeoutRef.current = undefined;
    }

    if (hlsRef.current) {
      try {
        hlsRef.current.destroy();
      } catch (e) { /* ignore */ }
      hlsRef.current = null;
    }

    if (mpegtsPlayerRef.current) {
      try {
        mpegtsPlayerRef.current.pause();
        mpegtsPlayerRef.current.unload();
        mpegtsPlayerRef.current.detachMediaElement();
        mpegtsPlayerRef.current.destroy();
      } catch (e) { /* ignore */ }
      mpegtsPlayerRef.current = null;
    }

    setEngineType(null);
    setQualityLevels([]);
    setSelectedQuality('auto');
  }, []);

  // ── hls.js engine ──
  const initHls = useCallback((streamUrl: string) => {
    const video = videoRef.current;
    if (!video) return;

    // Check if browser can play HLS natively (Safari)
    if (video.canPlayType('application/vnd.apple.mpegurl')) {
      console.log('🎬 Engine: Native HLS →', streamUrl);
      setEngineType('hls.js');
      video.src = streamUrl;
      video.muted = muted;
      video.play().then(() => {
        setLoading(false);
        retryCountRef.current = 0;
      }).catch(() => {
        video.muted = true;
        video.play().then(() => {
          setLoading(false);
          retryCountRef.current = 0;
        }).catch(() => {});
      });
      return;
    }

    if (!Hls.isSupported()) {
      setError('Tu navegador no soporta reproducción HLS.');
      setLoading(false);
      return;
    }

    console.log('🎬 Engine: hls.js →', streamUrl);
    setEngineType('hls.js');

    const hls = new Hls({
      enableWorker: true,
      lowLatencyMode: true,
      backBufferLength: 30,
      maxBufferLength: 15,
      maxMaxBufferLength: 30,
      maxBufferSize: 30 * 1000 * 1000, // 30MB
      maxBufferHole: 0.5,
      startLevel: -1, // Auto
      // Aggressive recovery
      fragLoadingMaxRetry: 6,
      manifestLoadingMaxRetry: 4,
      levelLoadingMaxRetry: 4,
      fragLoadingRetryDelay: 1000,
      manifestLoadingRetryDelay: 1000,
    });

    hlsRef.current = hls;
    hls.attachMedia(video);

    hls.on(Hls.Events.MEDIA_ATTACHED, () => {
      hls.loadSource(streamUrl);
    });

    hls.on(Hls.Events.MANIFEST_PARSED, (_event, data) => {
      console.log(`✅ hls.js: ${data.levels.length} niveles de calidad detectados`);

      // Build quality levels
      if (data.levels.length > 0) {
        const levels: QualityLevel[] = data.levels.map((level: any, i: number) => ({
          id: String(i),
          label: level.height ? `${level.height}p` : `${Math.round((level.bitrate || level.bandwidth || 0) / 1000)}k`,
          height: level.height || 0,
          bandwidth: level.bitrate || level.bandwidth || 0,
        }));
        levels.sort((a, b) => b.height - a.height || b.bandwidth - a.bandwidth);
        setQualityLevels(levels);
      }

      video.muted = muted;
      video.play().then(() => {
        setLoading(false);
        retryCountRef.current = 0;
      }).catch(() => {
        video.muted = true;
        video.play().then(() => {
          setLoading(false);
          retryCountRef.current = 0;
        }).catch(() => {});
      });
    });

    hls.on(Hls.Events.LEVEL_SWITCHED, (_event, data) => {
      const level = hls.levels[data.level] as any;
      if (level) {
        console.log(`📊 Calidad: ${level.height}p @ ${formatBitrate(level.bitrate || level.bandwidth || 0)}`);
      }
    });

    hls.on(Hls.Events.FRAG_LOADED, (_event, data) => {
      if (data.frag.stats) {
        const bw = data.frag.stats.loading?.end && data.frag.stats.loading?.start
          ? (data.frag.stats.loaded * 8000) / (data.frag.stats.loading.end - data.frag.stats.loading.start)
          : 0;
        if (bw > 0) setCurrentBandwidth(bw);
      }
    });

    hls.on(Hls.Events.ERROR, (_event, data) => {
      console.warn('hls.js error:', data.type, data.details, data.fatal);

      if (data.fatal) {
        switch (data.type) {
          case Hls.ErrorTypes.NETWORK_ERROR:
            if (retryCountRef.current < maxRetries) {
              retryCountRef.current++;
              console.log(`🔄 hls.js retry ${retryCountRef.current}/${maxRetries}`);
              retryTimeoutRef.current = setTimeout(() => {
                hls.startLoad();
              }, Math.min(1000 * retryCountRef.current, 5000));
            } else {
              // Fallback to mpegts.js
              console.log('🔄 hls.js failed → fallback to mpegts.js');
              hls.destroy();
              hlsRef.current = null;
              const tsUrl = streamUrl.replace(/\.m3u8(\?|$)/i, '.ts$1');
              initMpegTs(tsUrl !== streamUrl ? tsUrl : streamUrl);
            }
            break;
          case Hls.ErrorTypes.MEDIA_ERROR:
            console.log('🔄 hls.js media error, recovering...');
            hls.recoverMediaError();
            break;
          default:
            setError('Error de reproducción HLS. El canal puede estar caído.');
            setLoading(false);
            onError?.('HLS fatal error');
            break;
        }
      }
    });

  }, [muted, onError]);

  // ── mpegts.js engine (for raw .ts streams) ──
  const initMpegTs = useCallback((streamUrl: string) => {
    const video = videoRef.current;
    if (!video) return;

    if (!mpegts.isSupported()) {
      setError('Tu navegador no soporta reproducción MPEG-TS.');
      setLoading(false);
      return;
    }

    console.log('📡 Engine: mpegts.js →', streamUrl);
    setEngineType('mpegts');

    const player = mpegts.createPlayer({
      type: 'mpegts',
      isLive: true,
      url: streamUrl,
    }, {
      enableWorker: true,
      liveBufferLatencyChasing: true,
      liveBufferLatencyMaxLatency: 5,
      liveBufferLatencyMinRemain: 1,
      lazyLoadMaxDuration: 30,
      autoCleanupSourceBuffer: true,
      autoCleanupMaxBackwardDuration: 10,
      autoCleanupMinBackwardDuration: 5,
    });

    mpegtsPlayerRef.current = player;
    player.attachMediaElement(video);
    player.load();

    player.on(mpegts.Events.ERROR, (errorType: string, errorDetail: string) => {
      console.warn('mpegts error:', errorType, errorDetail);
      if (retryCountRef.current < maxRetries) {
        retryCountRef.current++;
        const delay = Math.min(1000 * retryCountRef.current, 8000);
        retryTimeoutRef.current = setTimeout(() => {
          try {
            player.unload();
            player.load();
            video.play().catch(() => {});
          } catch (e) { /* ignore */ }
        }, delay);
      } else {
        setError('Error de reproducción MPEG-TS. El canal puede estar caído.');
        setLoading(false);
        onError?.('MPEG-TS error after max retries');
      }
    });

    player.on(mpegts.Events.STATISTICS_INFO, (stats: any) => {
      if (stats.speed) setCurrentBandwidth(stats.speed * 1000);
    });

    video.muted = muted;
    video.play().then(() => {
      setLoading(false);
      retryCountRef.current = 0;
    }).catch(() => {
      video.muted = true;
      video.play().then(() => {
        setLoading(false);
        retryCountRef.current = 0;
      }).catch(() => {});
    });
  }, [muted, onError]);

  // ── Main init ──
  const initStream = useCallback(() => {
    if (!src) return;
    if (getYouTubeId(src)) return;

    setError(null);
    setLoading(true);
    cleanup();

    const streamType = detectStreamType(src);

    if (streamType === 'ts') {
      initMpegTs(src);
    } else {
      initHls(src);
    }
  }, [src, cleanup, initMpegTs, initHls]);

  // Fetch server-side quality options for bridge streams
  useEffect(() => {
    if (!bridgeStreamId) return;

    fetch(`/api/restream/${bridgeStreamId}/qualities`)
      .then(r => r.ok ? r.json() : [])
      .then((serverQualities: any[]) => {
        if (serverQualities.length > 0) {
          setQualityLevels(serverQualities.map((q: any) => ({
            id: q.id,
            label: q.label,
            height: q.height || 0,
            bandwidth: q.bandwidth || 0,
          })));
        }
      })
      .catch(() => {
        setQualityLevels([
          { id: 'original', label: 'Original', height: 0, bandwidth: 5000000 },
          { id: '720', label: '720p', height: 720, bandwidth: 2500000 },
          { id: '480', label: '480p', height: 480, bandwidth: 1200000 },
          { id: '360', label: '360p', height: 360, bandwidth: 600000 },
          { id: '240', label: '240p', height: 240, bandwidth: 300000 },
        ]);
      });
  }, [bridgeStreamId]);

  // Quality selection handler
  const selectQuality = useCallback((qualityId: string) => {
    setSelectedQuality(qualityId);
    setShowQualityMenu(false);

    // hls.js client-side quality switching
    if (hlsRef.current && !isBridgeStream) {
      if (qualityId === 'auto') {
        hlsRef.current.currentLevel = -1; // Auto
      } else {
        const levelIndex = parseInt(qualityId, 10);
        if (!isNaN(levelIndex)) {
          hlsRef.current.currentLevel = levelIndex;
        }
      }
      return;
    }

    // Server-side quality change via bridge URL
    if (bridgeStreamId && videoRef.current) {
      cleanup();
      setLoading(true);
      setError(null);

      const newUrl = qualityId === 'auto'
        ? `/api/restream/${bridgeStreamId}`
        : `/api/restream/${bridgeStreamId}/variant/${qualityId}.m3u8`;

      // Small delay to let cleanup finish
      setTimeout(() => initHls(newUrl), 100);
    }
  }, [isBridgeStream, bridgeStreamId, cleanup, initHls]);

  // Initialize on src change
  useEffect(() => {
    initStream();
    return () => { cleanup(); };
  }, [src]); // eslint-disable-line react-hooks/exhaustive-deps

  // Mute sync
  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.muted = muted;
    }
  }, [muted]);

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
      {/* Video element */}
      <video
        ref={videoRef}
        className="w-full h-full object-contain"
        playsInline
        controls
      />

      {/* Engine indicator + Quality selector */}
      {engineType && !loading && !error && (
        <div className="absolute top-3 left-3 right-3 z-10 flex items-start justify-between opacity-0 group-hover:opacity-100 transition-opacity">
          {/* Engine badge */}
          <span className="px-2 py-1 bg-black/70 rounded text-[10px] text-white/50 font-mono uppercase pointer-events-none">
            {engineType === 'mpegts' ? '📡 MPEG-TS' : '🎬 HLS'}
            {currentBandwidth > 0 && (
              <span className="ml-2">
                <Wifi className="w-2.5 h-2.5 inline mr-0.5" />
                {formatBitrate(currentBandwidth)}
              </span>
            )}
          </span>

          {/* Quality selector */}
          {qualityLevels.length > 1 && (
            <div className="relative">
              <button
                onClick={() => setShowQualityMenu(prev => !prev)}
                className="flex items-center gap-1.5 px-2.5 py-1.5 bg-black/80 hover:bg-black/90 rounded-lg text-xs text-white/80 hover:text-white transition-colors backdrop-blur-sm border border-white/10"
              >
                <Settings className="w-3.5 h-3.5" />
                <span className="font-medium">
                  {selectedQuality === 'auto'
                    ? 'Auto'
                    : qualityLevels.find(q => q.id === selectedQuality)?.label || 'Auto'}
                </span>
                {selectedQuality !== 'auto' && (
                  <span className="text-[9px] text-primary font-bold ml-0.5">FIJO</span>
                )}
                <ChevronUp className={`w-3 h-3 transition-transform ${showQualityMenu ? '' : 'rotate-180'}`} />
              </button>

              {showQualityMenu && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setShowQualityMenu(false)} />
                  <div className="absolute right-0 top-full mt-1 z-50 bg-black/95 backdrop-blur-xl rounded-xl border border-white/10 shadow-2xl overflow-hidden min-w-[180px]">
                    <div className="px-3 py-2 border-b border-white/10">
                      <span className="text-[10px] text-white/40 font-semibold uppercase tracking-wider">Calidad de video</span>
                    </div>
                    <div className="py-1">
                      <button
                        onClick={() => selectQuality('auto')}
                        className={`w-full flex items-center justify-between px-3 py-2 text-sm transition-colors ${
                          selectedQuality === 'auto' ? 'text-primary bg-primary/10' : 'text-white/80 hover:bg-white/10'
                        }`}
                      >
                        <span className="font-medium">Auto</span>
                        <span className="text-[10px] text-white/40">ABR</span>
                      </button>
                      {qualityLevels.map((level) => (
                        <button
                          key={level.id}
                          onClick={() => selectQuality(level.id)}
                          className={`w-full flex items-center justify-between px-3 py-2 text-sm transition-colors ${
                            selectedQuality === level.id ? 'text-primary bg-primary/10' : 'text-white/80 hover:bg-white/10'
                          }`}
                        >
                          <span className="font-medium">{level.label}</span>
                          <span className="text-[10px] text-white/40 font-mono">{formatBitrate(level.bandwidth)}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      )}

      {/* Loading overlay */}
      {loading && !error && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/80 pointer-events-none z-20">
          <div className="flex flex-col items-center gap-3">
            <div className="w-10 h-10 border-2 border-primary border-t-transparent rounded-full animate-spin" />
            {loadingTime >= 3 && (
              <div className="text-center">
                <p className="text-white/60 text-xs">Conectando... {loadingTime}s</p>
                {loadingTime >= 5 && engineType === 'hls.js' && (
                  <p className="text-white/40 text-[10px] mt-1">Cargando HLS...</p>
                )}
                {loadingTime >= 10 && (
                  <p className="text-white/40 text-[10px] mt-1">Probando MPEG-TS...</p>
                )}
                {loadingTime >= 20 && (
                  <p className="text-white/40 text-[10px] mt-1">La conexión está muy lenta</p>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Error overlay */}
      {error && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/80 z-20">
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
