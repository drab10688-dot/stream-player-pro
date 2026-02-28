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
          lowLatencyMode: true,
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
            setError('Error al cargar el stream HLS');
            setLoading(false);
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
      // Try muted autoplay
      video.muted = true;
      try {
        await video.play();
        setLoading(false);
      } catch {
        setLoading(false);
        // User needs to click to play
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
