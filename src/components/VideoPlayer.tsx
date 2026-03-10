import { useRef, useEffect, useState, useCallback, memo } from 'react';
import shaka from 'shaka-player';

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

const VideoPlayer = memo(({ src, channelId, muted = false, onError }: VideoPlayerProps) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const playerRef = useRef<shaka.Player | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const cleanup = useCallback(async () => {
    if (playerRef.current) {
      try { await playerRef.current.destroy(); } catch { /* ignore */ }
      playerRef.current = null;
    }
  }, []);

  const initStream = useCallback(async () => {
    const video = videoRef.current;
    if (!video || !src) return;

    if (getYouTubeId(src)) return;

    setError(null);
    setLoading(true);
    await cleanup();

    shaka.polyfill.installAll();

    if (!shaka.Player.isBrowserSupported()) {
      setError('Tu navegador no es compatible con el reproductor.');
      setLoading(false);
      onError?.('Browser not supported');
      return;
    }

    const player = new shaka.Player();
    await player.attach(video);
    playerRef.current = player;

    player.addEventListener('error', (event: Event) => {
      const detail = (event as any).detail || {};
      console.error('Shaka error:', detail.code, detail.message);
      setError(`Error del stream: ${detail.message || 'No se pudo cargar el canal'}`);
      setLoading(false);
      onError?.(detail.message || 'Stream error');
    });

    player.addEventListener('buffering', (e: Event) => {
      const buffering = (e as any).buffering;
      setLoading(buffering);
    });

    try {
      const isTs = /\.ts(\?|$)/i.test(src) || /\/\d+\.ts/.test(src);
      if (isTs) {
        video.src = src;
      } else {
        await player.load(src);
      }
    } catch (err: any) {
      console.error('Shaka load error:', err);
      setError('No se pudo cargar el stream. Verifica que el canal esté activo.');
      setLoading(false);
      onError?.('Load error');
      return;
    }

    try {
      video.muted = false;
      await video.play();
    } catch {
      video.muted = true;
      try { await video.play(); } catch { /* user will click play */ }
    }
    setLoading(false);
  }, [src, cleanup, onError]);

  useEffect(() => {
    initStream();
    return () => { cleanup(); };
  }, [src]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (videoRef.current) videoRef.current.muted = muted;
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
          if (!playerRef.current) {
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
              onClick={() => initStream()}
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
