import { useRef, useEffect, useState } from 'react';
import Hls from 'hls.js';

interface VideoPlayerProps {
  src: string;
  muted?: boolean;
}

const VideoPlayer = ({ src, muted = false }: VideoPlayerProps) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const hlsRef = useRef<Hls | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !src) return;

    setError(null);
    setLoading(true);

    // Cleanup previous HLS instance
    if (hlsRef.current) {
      hlsRef.current.destroy();
      hlsRef.current = null;
    }

    const isHLS = src.includes('.m3u8');

    if (isHLS) {
      if (video.canPlayType('application/vnd.apple.mpegurl')) {
        // Safari native HLS
        video.src = src;
        attemptPlay(video);
      } else if (Hls.isSupported()) {
        const hls = new Hls({
          enableWorker: true,
          lowLatencyMode: false,
          // Adaptive bitrate - like Netflix/YouTube
          abrEwmaDefaultEstimate: 500000, // Start with low estimate (500kbps)
          abrEwmaFastLive: 3,
          abrEwmaSlowLive: 9,
          abrEwmaFastVoD: 3,
          abrEwmaSlowVoD: 9,
          abrBandWidthFactor: 0.7, // Conservative bandwidth usage
          abrBandWidthUpFactor: 0.5, // Slow to upgrade quality
          maxBufferLength: 30, // Buffer up to 30s
          maxMaxBufferLength: 60, // Allow up to 60s buffer
          maxBufferSize: 30 * 1000 * 1000, // 30MB max buffer
          maxBufferHole: 0.5,
          // Recovery settings for bad connections
          fragLoadingMaxRetry: 6,
          fragLoadingRetryDelay: 1000,
          manifestLoadingMaxRetry: 4,
          levelLoadingMaxRetry: 4,
          startLevel: -1, // Auto-select starting quality
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
                // Try to recover from network errors
                hls.startLoad();
                break;
              case Hls.ErrorTypes.MEDIA_ERROR:
                hls.recoverMediaError();
                break;
              default:
                setError('Error al cargar el stream');
                setLoading(false);
                break;
            }
          }
        });
      } else {
        setError('Tu navegador no soporta HLS');
        setLoading(false);
      }
    } else {
      // Direct stream (TS, MP4, etc.)
      video.src = src;
      attemptPlay(video);
    }

    return () => {
      if (hlsRef.current) {
        hlsRef.current.destroy();
        hlsRef.current = null;
      }
    };
  }, [src]);

  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.muted = muted;
    }
  }, [muted]);

  const attemptPlay = async (video: HTMLVideoElement) => {
    try {
      await video.play();
      setLoading(false);
    } catch {
      video.muted = true;
      try {
        await video.play();
        setLoading(false);
      } catch {
        setLoading(false);
      }
    }
  };

  return (
    <div className="relative w-full h-full bg-black">
      <video
        ref={videoRef}
        className="w-full h-full object-contain"
        playsInline
        controls
        muted={muted}
        preload="auto"
        onCanPlay={() => setLoading(false)}
        onError={() => {
          setError('No se pudo reproducir este canal. Verifica la URL.');
          setLoading(false);
        }}
      />
      {loading && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/80">
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
            <p className="text-muted-foreground text-xs mt-2 opacity-60">
              Algunos streams requieren un servidor proxy para reproducirse en el navegador (CORS)
            </p>
          </div>
        </div>
      )}
    </div>
  );
};

export default VideoPlayer;
