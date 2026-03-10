import { useRef, useEffect, useState, useCallback, memo } from 'react';
import videojs from 'video.js';
import 'video.js/dist/video-js.css';
import mpegts from 'mpegts.js';
import { Settings, Wifi, AlertTriangle, RefreshCw, ChevronUp } from 'lucide-react';

import type Player from 'video.js/dist/types/player';

interface QualityLevel {
  id: string;
  label: string;
  height: number;
  bandwidth: number;
  enabled: boolean;
}

interface VideoPlayerProps {
  src: string;
  channelId?: string;
  muted?: boolean;
  onError?: (message: string) => void;
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

const VideoPlayer = memo(({ src, channelId, muted = false, onError }: VideoPlayerProps) => {
  const videoContainerRef = useRef<HTMLDivElement>(null);
  const videoElementRef = useRef<HTMLVideoElement>(null);
  const playerRef = useRef<Player | null>(null);
  const mpegtsPlayerRef = useRef<mpegts.Player | null>(null);

  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingTime, setLoadingTime] = useState(0);
  const [engineType, setEngineType] = useState<'videojs' | 'mpegts' | null>(null);
  const [currentBandwidth, setCurrentBandwidth] = useState(0);
  const [qualityLevels, setQualityLevels] = useState<QualityLevel[]>([]);
  const [selectedQuality, setSelectedQuality] = useState<string>('auto');
  const [showQualityMenu, setShowQualityMenu] = useState(false);
  const qualityPollRef = useRef<ReturnType<typeof setInterval>>();

  const retryCountRef = useRef(0);
  const maxRetries = 12;
  const loadingTimerRef = useRef<ReturnType<typeof setInterval>>();
  const retryTimeoutRef = useRef<ReturnType<typeof setTimeout>>();

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

  // Loading timeout — 35s
  useEffect(() => {
    if (loadingTime >= 35 && loading) {
      setError('El canal tardó demasiado en responder. Puede estar caído o tu conexión es muy lenta.');
      setLoading(false);
    }
  }, [loadingTime, loading]);

  const cleanup = useCallback(() => {
    if (retryTimeoutRef.current) {
      clearTimeout(retryTimeoutRef.current);
      retryTimeoutRef.current = undefined;
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

    if (playerRef.current) {
      try {
        playerRef.current.dispose();
      } catch (e) { /* ignore */ }
      playerRef.current = null;
    }

    setEngineType(null);
  }, []);

  // ── mpegts.js engine (for raw .ts streams — VLC-like TS handling) ──
  const initMpegTs = useCallback((streamUrl: string) => {
    if (!videoElementRef.current) return;
    const video = videoElementRef.current;

    if (!mpegts.isSupported()) {
      setError('Tu navegador no soporta reproducción MPEG-TS.');
      setLoading(false);
      return;
    }

    console.log('📡 Engine: mpegts.js (VLC-mode) →', streamUrl);
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

  // ── video.js engine (HLS + general — like VLC's libavformat) ──
  const initVideoJs = useCallback((streamUrl: string, fallbackToTs: boolean = true) => {
    if (!videoContainerRef.current) return;

    console.log('🎬 Engine: video.js (VLC-mode) →', streamUrl);
    setEngineType('videojs');

    // Create fresh video element for video.js
    const existingVideo = videoContainerRef.current.querySelector('video');
    if (existingVideo) existingVideo.remove();

    const videoEl = document.createElement('video');
    videoEl.className = 'video-js vjs-big-play-centered vjs-fluid';
    videoEl.setAttribute('playsinline', '');
    videoContainerRef.current.appendChild(videoEl);
    videoElementRef.current = videoEl;

    const player = videojs(videoEl, {
      autoplay: true,
      muted: muted,
      controls: true,
      fluid: true,
      fill: true,
      preload: 'auto',
      liveui: true,
      liveTracker: {
        trackingThreshold: 0,
        liveTolerance: 15,
      },
      html5: {
        vhs: {
          // VLC-like aggressive settings
          overrideNative: true,
          allowSeeksWithinUnsafeLiveWindow: true,
          handlePartialData: true,
          smoothQualityChange: true,
          bandwidth: 5000000, // Start assuming 5Mbps (be optimistic like VLC)
          enableLowInitialPlaylist: false,
          limitRenditionByPlayerDimensions: true,
          useDevicePixelRatio: true,
          experimentalBufferBasedABR: true,
          // Aggressive retry like VLC
          maxPlaylistRetries: 10,
        },
        nativeAudioTracks: false,
        nativeVideoTracks: false,
      },
      sources: [{
        src: streamUrl,
        type: detectStreamType(streamUrl) === 'hls'
          ? 'application/x-mpegURL'
          : 'video/mp4',
      }],
    });

    playerRef.current = player;

    let hlsTimeoutId: ReturnType<typeof setTimeout> | undefined;

    // Timeout: if video.js can't play in 10s, fallback to mpegts
    if (fallbackToTs) {
      hlsTimeoutId = setTimeout(() => {
        if (loading) {
          console.log('⚠️ video.js timeout → switching to mpegts.js');
          try { player.dispose(); } catch (e) { /* */ }
          playerRef.current = null;

          // Re-create video element for mpegts
          const container = videoContainerRef.current;
          if (container) {
            const existing = container.querySelector('video');
            if (existing) existing.remove();
            const newVid = document.createElement('video');
            newVid.className = 'w-full h-full object-contain';
            newVid.setAttribute('playsinline', '');
            newVid.controls = true;
            container.appendChild(newVid);
            videoElementRef.current = newVid;
          }

          const tsUrl = streamUrl.replace(/\.m3u8(\?|$)/i, '.ts$1');
          initMpegTs(tsUrl !== streamUrl ? tsUrl : streamUrl);
        }
      }, 10000);
      retryTimeoutRef.current = hlsTimeoutId;
    }

    player.on('playing', () => {
      if (hlsTimeoutId) clearTimeout(hlsTimeoutId);
      setLoading(false);
      setError(null);
      retryCountRef.current = 0;
    });

    player.on('waiting', () => {
      setLoading(true);
    });

    player.on('canplay', () => {
      setLoading(false);
    });

    // VLC-like: track bandwidth from VHS tech
    player.on('progress', () => {
      try {
        const tech = player.tech({ IWillNotUseThisInPlugins: true }) as any;
        if (tech?.vhs?.bandwidth) {
          setCurrentBandwidth(tech.vhs.bandwidth);
        }
      } catch (e) { /* ignore */ }
    });

    player.on('error', () => {
      const err = player.error();
      console.warn('video.js error:', err?.code, err?.message);
      if (hlsTimeoutId) clearTimeout(hlsTimeoutId);

      // VLC-like: retry aggressively before giving up
      if (retryCountRef.current < maxRetries) {
        retryCountRef.current++;
        const delay = Math.min(1500 * retryCountRef.current, 10000);
        console.log(`🔄 Retry ${retryCountRef.current}/${maxRetries} in ${delay}ms`);
        
        retryTimeoutRef.current = setTimeout(() => {
          if (fallbackToTs && retryCountRef.current >= 3) {
            // After 3 video.js failures, try mpegts
            console.log('🔄 video.js failed 3x → fallback to mpegts.js');
            try { player.dispose(); } catch (e) { /* */ }
            playerRef.current = null;

            const container = videoContainerRef.current;
            if (container) {
              const existing = container.querySelector('video');
              if (existing) existing.remove();
              const newVid = document.createElement('video');
              newVid.className = 'w-full h-full object-contain';
              newVid.setAttribute('playsinline', '');
              newVid.controls = true;
              container.appendChild(newVid);
              videoElementRef.current = newVid;
            }
            initMpegTs(streamUrl);
          } else {
            try {
              player.src({
                src: streamUrl,
                type: 'application/x-mpegURL',
              });
              player.play()?.catch(() => {});
            } catch (e) { /* ignore */ }
          }
        }, delay);
      } else {
        setError('No se pudo reproducir este canal. El canal puede estar caído.');
        setLoading(false);
        onError?.('video.js error after max retries');
      }
    });

    // Stall detection — VLC recovers after stalls
    let stallTimer: ReturnType<typeof setTimeout> | null = null;

    player.on('stalled', () => {
      if (stallTimer) clearTimeout(stallTimer);
      stallTimer = setTimeout(() => {
        console.warn('⚠️ Stall detectado (20s), reiniciando stream...');
        try {
          player.src({ src: streamUrl, type: 'application/x-mpegURL' });
          player.play()?.catch(() => {});
        } catch (e) { /* ignore */ }
      }, 20000);
    });

    player.on('playing', () => {
      if (stallTimer) { clearTimeout(stallTimer); stallTimer = null; }
    });

  }, [muted, onError, initMpegTs, loading]);

  // ── Main init — VLC-like format detection ──
  const initStream = useCallback(() => {
    if (!src) return;
    if (getYouTubeId(src)) return;

    setError(null);
    setLoading(true);
    cleanup();

    // Create initial video element
    const container = videoContainerRef.current;
    if (container) {
      const existing = container.querySelector('video');
      if (existing) existing.remove();
    }

    const streamType = detectStreamType(src);

    if (streamType === 'ts') {
      // Raw TS → mpegts.js directly (like VLC handles TS natively)
      if (container) {
        const vid = document.createElement('video');
        vid.className = 'w-full h-full object-contain';
        vid.setAttribute('playsinline', '');
        vid.controls = true;
        container.appendChild(vid);
        videoElementRef.current = vid;
      }
      initMpegTs(src);
    } else {
      // HLS or unknown → video.js first (with mpegts fallback)
      initVideoJs(src, true);
    }
  }, [src, cleanup, initMpegTs, initVideoJs]);

  // Initialize on src change
  useEffect(() => {
    initStream();
    return () => { cleanup(); };
  }, [src]); // eslint-disable-line react-hooks/exhaustive-deps

  // Mute sync
  useEffect(() => {
    if (playerRef.current) {
      try { playerRef.current.muted(muted); } catch (e) { /* */ }
    }
    if (videoElementRef.current) {
      videoElementRef.current.muted = muted;
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
      {/* Video.js / mpegts container */}
      <div
        ref={videoContainerRef}
        className="w-full h-full [&_.video-js]:!w-full [&_.video-js]:!h-full [&_.video-js]:!bg-black [&_.vjs-tech]:!object-contain"
        data-vjs-player
      />

      {/* Engine indicator */}
      {engineType && !loading && !error && (
        <div className="absolute top-3 left-3 z-10 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
          <span className="px-2 py-1 bg-black/70 rounded text-[10px] text-white/50 font-mono uppercase">
            {engineType === 'mpegts' ? '📡 MPEG-TS' : '🎬 VJS-HLS'}
            {currentBandwidth > 0 && (
              <span className="ml-2">
                <Wifi className="w-2.5 h-2.5 inline mr-0.5" />
                {formatBitrate(currentBandwidth)}
              </span>
            )}
          </span>
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
                {loadingTime >= 5 && engineType === 'videojs' && (
                  <p className="text-white/40 text-[10px] mt-1">Motor video.js (HLS)...</p>
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
