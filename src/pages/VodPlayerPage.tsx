import { useLocation, useNavigate } from 'react-router-dom';
import { ArrowLeft, Film } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { isLovablePreview } from '@/lib/utils';

const VodPlayerPage = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const vod = location.state?.vod;

  if (!vod) {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center">
        <div className="text-center">
          <Film className="w-16 h-16 text-muted-foreground mx-auto mb-4" />
          <p className="text-muted-foreground">Video no encontrado</p>
          <Button variant="ghost" onClick={() => navigate(-1)} className="mt-4 text-primary">Volver</Button>
        </div>
      </div>
    );
  }

  // Build video URL - in preview use placeholder, in production use server
  const videoUrl = isLovablePreview()
    ? '' // No video streaming in preview
    : `/api/vod/stream/${vod.id}`;

  return (
    <div className="min-h-screen bg-black flex flex-col">
      {/* Top bar */}
      <div className="absolute top-0 left-0 right-0 z-50 bg-gradient-to-b from-black/80 to-transparent p-4">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => navigate(-1)} className="text-white hover:bg-white/10">
            <ArrowLeft className="w-5 h-5" />
          </Button>
          <div>
            <h1 className="text-white font-semibold text-lg">{vod.title}</h1>
            {vod.description && <p className="text-white/60 text-sm">{vod.description}</p>}
          </div>
        </div>
      </div>

      {/* Video player */}
      <div className="flex-1 flex items-center justify-center">
        {isLovablePreview() ? (
          <div className="text-center">
            <Film className="w-20 h-20 text-muted-foreground mx-auto mb-4" />
            <p className="text-muted-foreground">La reproducción de VOD solo funciona en el VPS</p>
            <p className="text-muted-foreground text-sm mt-1">Video: {vod.title}</p>
          </div>
        ) : (
          <video
            className="w-full h-full object-contain"
            src={videoUrl}
            controls
            autoPlay
            playsInline
            preload="auto"
          />
        )}
      </div>
    </div>
  );
};

export default VodPlayerPage;
