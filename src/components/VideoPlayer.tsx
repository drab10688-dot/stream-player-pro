import { useRef, useEffect, useState, useCallback, memo } from 'react';
import Hls from 'hls.js';

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

const isHlsStream = (url: string): boolean => {
  return /\.m3u8(\?|$)/i.test(url) || /\/live\//i.test(url);
};

const VideoPlayer = memo(({ src, channelId, muted = false, onError }: VideoPlayerProps) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const hlsRef = useRef<Hls | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const retryCountRef = useRef(0);
  const maxRetries = 8;

  const cleanup = useCallback(() => {
    if (hlsRef.current) {
      hlsRef.current.destroy();
      hlsRef.current = null;
    }
    retryCountRef.current = 0;
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
        // Stability-first config for IPTV
        maxBufferLength: 30,
        maxMaxBufferLength: 60,
        maxBufferSize: 60 * 1000 * 1000, // 60MB
        maxBufferHole: 0.5,
        lowLatencyMode: false,
        startLevel: 0, // Start at lowest quality for fast start
        capLevelToPlayerSize: true,
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

      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        setLoading(false);
        video.muted = muted;
        video.play().catch(() => {
          video.muted = true;
          video.play().catch(() => { /* user will click play */ });
        });
      });

      hls.on(Hls.Events.ERROR, (_event, data) => {
        console.warn('HLS error:', data.type, data.details, data.fatal);

        if (data.fatal) {
          switch (data.type) {
            case Hls.ErrorTypes.NETWORK_ERROR:
              if (retryCountRef.current < maxRetries) {
                retryCountRef.current++;
                console.log(`HLS: retry ${retryCountRef.current}/${maxRetries}`);
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
        retryCountRef.current = 0; // Reset on success
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
    // Case 3: Direct URL (TS segments, MP4, etc.)
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

  useEffect(() => {
    initStream();
    return () => { cleanup(); };
  }, [src]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (videoRef.current) videoRef.current.muted = muted;
  }, [muted]);

  // Stall detection: restart if stuck for 15s
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    let stallTimer: ReturnType<typeof setTimeout> | null = null;

    const onStall = () => {
      stallTimer = setTimeout(() => {
        console.warn('Stall detected, restarting stream');
        initStream();
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
    <div className="relative w-full h-full bg-black">
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
