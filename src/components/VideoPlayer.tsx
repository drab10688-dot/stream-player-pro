import { useRef, useEffect, useState } from 'react';
import Hls from 'hls.js';
import mpegts from 'mpegts.js';

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
  if (/\.ts(\?|$)/i.test(url) || /\/\d+\.ts/.test(url)) return 'ts';
  return 'native';
};

const VideoPlayer = ({ src, channelId, muted = false, onError }: VideoPlayerProps) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const hlsRef = useRef<Hls | null>(null);
  const mpegtsRef = useRef<mpegts.Player | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const retryCountRef = useRef(0);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout>>();

  const cleanup = () => {
    if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
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
    if (streamType === 'youtube') return; // handled by iframe render

    setError(null);
    setLoading(true);
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
          abrEwmaDefaultEstimate: 300000,
          abrEwmaFastLive: 2,
          abrEwmaSlowLive: 8,
          abrEwmaFastVoD: 2,
          abrEwmaSlowVoD: 8,
          abrBandWidthFactor: 0.6,
          abrBandWidthUpFactor: 0.4,
          maxBufferLength: 60,
          maxMaxBufferLength: 120,
          maxBufferSize: 60 * 1000 * 1000,
          maxBufferHole: 1,
          fragLoadingMaxRetry: 10,
          fragLoadingRetryDelay: 1500,
          fragLoadingMaxRetryTimeout: 30000,
          manifestLoadingMaxRetry: 6,
          manifestLoadingRetryDelay: 1500,
          levelLoadingMaxRetry: 6,
          levelLoadingRetryDelay: 1500,
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

    // Stall recovery
    const stallCheck = setInterval(() => {
      if (video && !video.paused && video.readyState < 3 && !loading) {
        retryStream();
      }
    }, 10000);

    return () => {
      clearInterval(stallCheck);
      cleanup();
    };
  }, [src]);

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
          src={`https://www.youtube.com/embed/${youtubeId}?autoplay=1&mute=${muted ? 1 : 0}&rel=0&modestbranding=1`}
          title="YouTube video"
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
          allowFullScreen
          style={{ border: 'none' }}
        />
      </div>
    );
  }

  return (
    <div className="relative w-full h-full bg-black">
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
