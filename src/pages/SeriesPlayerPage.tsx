import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, SkipForward, Film } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { isLovablePreview } from '@/lib/utils';

const SeriesPlayerPage = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const { seriesId, episodeId } = useParams();
  const { episode, episodes, series, currentIndex } = location.state || {};

  if (!episode) {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center">
        <div className="text-center">
          <Film className="w-16 h-16 text-muted-foreground mx-auto mb-4" />
          <p className="text-muted-foreground">Episodio no encontrado</p>
          <Button variant="ghost" onClick={() => navigate(-1)} className="mt-4 text-primary">Volver</Button>
        </div>
      </div>
    );
  }

  const videoUrl = isLovablePreview() ? '' : `/api/vod/episodes/stream/${episodeId}`;
  const hasNext = episodes && currentIndex < episodes.length - 1;

  const playNext = () => {
    if (!hasNext) return;
    const next = episodes[currentIndex + 1];
    navigate(`/series/${seriesId}/play/${next.id}`, { state: { episode: next, episodes, series, currentIndex: currentIndex + 1 }, replace: true });
  };

  return (
    <div className="min-h-screen bg-black flex flex-col">
      {/* Top bar */}
      <div className="absolute top-0 left-0 right-0 z-50 bg-gradient-to-b from-black/80 to-transparent p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="icon" onClick={() => navigate(`/series/${seriesId}`)} className="text-white hover:bg-white/10">
              <ArrowLeft className="w-5 h-5" />
            </Button>
            <div>
              <h1 className="text-white font-semibold text-lg">{series?.title}</h1>
              <p className="text-white/60 text-sm">E{episode.episode_number}. {episode.title}</p>
            </div>
          </div>
          {hasNext && (
            <Button variant="ghost" onClick={playNext} className="text-white hover:bg-white/10 gap-2">
              Siguiente <SkipForward className="w-4 h-4" />
            </Button>
          )}
        </div>
      </div>

      {/* Video */}
      <div className="flex-1 flex items-center justify-center">
        {isLovablePreview() ? (
          <div className="text-center">
            <Film className="w-20 h-20 text-muted-foreground mx-auto mb-4" />
            <p className="text-muted-foreground">Reproducción solo disponible en VPS</p>
            <p className="text-muted-foreground text-sm mt-1">E{episode.episode_number}. {episode.title}</p>
          </div>
        ) : (
          <video className="w-full h-full object-contain" src={videoUrl} controls autoPlay playsInline preload="auto"
            onEnded={playNext} />
        )}
      </div>
    </div>
  );
};

export default SeriesPlayerPage;
