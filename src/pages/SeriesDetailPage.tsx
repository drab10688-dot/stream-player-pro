import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { isLovablePreview } from '@/lib/utils';
import { ArrowLeft, Play, Layers, Tv2, Film } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { motion } from 'framer-motion';

interface Season { id: string; season_number: number; title: string | null; }
interface Episode { id: string; season_id: string; episode_number: number; title: string; description: string | null; video_filename: string; poster_url: string | null; duration_minutes: number | null; }

const SeriesDetailPage = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const [series, setSeries] = useState<any>(null);
  const [seasons, setSeasons] = useState<Season[]>([]);
  const [episodes, setEpisodes] = useState<Episode[]>([]);
  const [activeSeason, setActiveSeason] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      try {
        if (isLovablePreview()) {
          const { data: s } = await supabase.from('vod_series' as any).select('*').eq('id', id).single();
          setSeries(s);
          const { data: sn } = await supabase.from('vod_seasons' as any).select('*').eq('series_id', id).order('season_number');
          const snArr = (sn as any[]) || [];
          setSeasons(snArr);
          if (snArr.length > 0) {
            setActiveSeason(snArr[0].id);
            const { data: ep } = await supabase.from('vod_episodes' as any).select('*').eq('season_id', snArr[0].id).eq('is_active', true).order('episode_number');
            setEpisodes((ep as any[]) || []);
          }
        } else {
          const [sRes, snRes] = await Promise.all([
            fetch(`/api/vod/series/${id}`), fetch(`/api/vod/series/${id}/seasons`)
          ]);
          if (sRes.ok) setSeries(await sRes.json());
          if (snRes.ok) {
            const sn = await snRes.json();
            setSeasons(sn || []);
            if (sn?.length > 0) {
              setActiveSeason(sn[0].id);
              const epRes = await fetch(`/api/vod/seasons/${sn[0].id}/episodes`);
              if (epRes.ok) setEpisodes(await epRes.json());
            }
          }
        }
      } catch { /* ignore */ }
      setLoading(false);
    };
    if (id) load();
  }, [id]);

  const loadEpisodes = async (seasonId: string) => {
    setActiveSeason(seasonId);
    try {
      if (isLovablePreview()) {
        const { data } = await supabase.from('vod_episodes' as any).select('*').eq('season_id', seasonId).eq('is_active', true).order('episode_number');
        setEpisodes((data as any[]) || []);
      } else {
        const res = await fetch(`/api/vod/seasons/${seasonId}/episodes`);
        if (res.ok) setEpisodes(await res.json());
      }
    } catch { /* ignore */ }
  };

  const playEpisode = (ep: Episode, index: number) => {
    navigate(`/series/${id}/play/${ep.id}`, { state: { episode: ep, episodes, series, currentIndex: index } });
  };

  if (loading) return <div className="min-h-screen bg-background flex items-center justify-center"><div className="animate-spin w-8 h-8 border-2 border-primary border-t-transparent rounded-full" /></div>;
  if (!series) return <div className="min-h-screen bg-background flex items-center justify-center text-muted-foreground"><Tv2 className="w-12 h-12 mx-auto mb-3" /><p>Serie no encontrada</p></div>;

  return (
    <div className="min-h-screen bg-background bg-grid">
      {/* Hero */}
      <div className="relative h-48 sm:h-64 bg-gradient-to-b from-primary/10 to-background overflow-hidden">
        {series.poster_url && <img src={series.poster_url} alt="" className="absolute inset-0 w-full h-full object-cover opacity-20" />}
        <div className="absolute inset-0 bg-gradient-to-t from-background to-transparent" />
        <div className="absolute bottom-0 left-0 right-0 p-6">
          <Button variant="ghost" size="icon" onClick={() => navigate(-1)} className="text-foreground mb-3"><ArrowLeft className="w-5 h-5" /></Button>
          <h1 className="text-2xl sm:text-3xl font-bold text-foreground">{series.title}</h1>
          {series.description && <p className="text-muted-foreground text-sm mt-1 max-w-xl">{series.description}</p>}
          <Badge variant="secondary" className="mt-2">{series.category}</Badge>
        </div>
      </div>

      <main className="container px-4 py-6 space-y-6">
        {/* Season Tabs */}
        {seasons.length > 0 && (
          <div className="flex items-center gap-2 overflow-x-auto pb-2">
            {seasons.map(s => (
              <button key={s.id} onClick={() => loadEpisodes(s.id)}
                className={`px-4 py-2 rounded-lg text-sm font-medium whitespace-nowrap transition-all ${
                  activeSeason === s.id ? 'bg-primary text-primary-foreground' : 'bg-secondary/40 text-muted-foreground hover:text-foreground'
                }`}>
                T{s.season_number} {s.title ? `— ${s.title}` : ''}
              </button>
            ))}
          </div>
        )}

        {/* Episodes */}
        {episodes.length === 0 ? (
          <div className="glass-strong rounded-2xl p-12 text-center">
            <Film className="w-12 h-12 text-muted-foreground mx-auto mb-3" />
            <p className="text-muted-foreground">Sin episodios en esta temporada</p>
          </div>
        ) : (
          <div className="space-y-3">
            {episodes.map((ep, i) => (
              <motion.button key={ep.id} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.04 }}
                onClick={() => playEpisode(ep, i)}
                className="w-full glass-strong rounded-xl p-4 text-left hover:border-primary/30 transition-all cursor-pointer group">
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 rounded-lg bg-primary/10 flex items-center justify-center shrink-0 group-hover:bg-primary/20 transition-colors">
                    <Play className="w-5 h-5 text-primary" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-foreground text-sm">E{ep.episode_number}. {ep.title}</p>
                    {ep.description && <p className="text-muted-foreground text-xs mt-0.5 truncate">{ep.description}</p>}
                  </div>
                  {ep.duration_minutes && <span className="text-xs text-muted-foreground shrink-0">{ep.duration_minutes} min</span>}
                </div>
              </motion.button>
            ))}
          </div>
        )}
      </main>
    </div>
  );
};

export default SeriesDetailPage;
