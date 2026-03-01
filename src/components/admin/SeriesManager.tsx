import { useState, useEffect, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { apiGet, apiDelete, getAdminToken } from '@/lib/api';
import { isLovablePreview } from '@/lib/utils';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Plus, Trash2, Edit2, X, Tv2, Upload, Eye, EyeOff,
  ChevronRight, ChevronDown, Layers, Film, ArrowLeft,
} from 'lucide-react';

/* ─── Types ─── */
interface Series {
  id: string; title: string; description: string | null; category: string;
  poster_url: string | null; is_active: boolean; sort_order: number; created_at: string;
}
interface Season {
  id: string; series_id: string; season_number: number; title: string | null;
  poster_url: string | null; sort_order: number;
}
interface Episode {
  id: string; season_id: string; episode_number: number; title: string;
  description: string | null; video_filename: string; poster_url: string | null;
  duration_minutes: number | null; is_active: boolean; sort_order: number;
}

/* ─── Component ─── */
const SeriesManager = () => {
  const { toast } = useToast();
  const [seriesList, setSeriesList] = useState<Series[]>([]);
  const [loading, setLoading] = useState(true);

  // Navigation state
  const [activeSeries, setActiveSeries] = useState<Series | null>(null);
  const [activeSeason, setActiveSeason] = useState<Season | null>(null);
  const [seasons, setSeasons] = useState<Season[]>([]);
  const [episodes, setEpisodes] = useState<Episode[]>([]);

  // Forms
  const [showSeriesForm, setShowSeriesForm] = useState(false);
  const [editingSeriesId, setEditingSeriesId] = useState<string | null>(null);
  const [seriesForm, setSeriesForm] = useState({ title: '', description: '', category: 'Series', sort_order: '0' });

  const [showSeasonForm, setShowSeasonForm] = useState(false);
  const [seasonForm, setSeasonForm] = useState({ season_number: '1', title: '' });

  const [showEpisodeForm, setShowEpisodeForm] = useState(false);
  const [editingEpisodeId, setEditingEpisodeId] = useState<string | null>(null);
  const [episodeForm, setEpisodeForm] = useState({ episode_number: '1', title: '', description: '', duration_minutes: '', sort_order: '0' });
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const videoFileRef = useRef<HTMLInputElement>(null);
  const posterFileRef = useRef<HTMLInputElement>(null);

  /* ─── Fetch helpers ─── */
  const fetchSeries = async () => {
    try {
      if (isLovablePreview()) {
        const { data, error } = await supabase.from('vod_series' as any).select('*').order('sort_order');
        if (error) throw error;
        setSeriesList((data as any[]) || []);
      } else {
        const data = await apiGet('/api/vod/series');
        setSeriesList(data || []);
      }
    } catch (err: any) {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    }
    setLoading(false);
  };

  const fetchSeasons = async (seriesId: string) => {
    try {
      if (isLovablePreview()) {
        const { data, error } = await supabase.from('vod_seasons' as any).select('*').eq('series_id', seriesId).order('season_number');
        if (error) throw error;
        setSeasons((data as any[]) || []);
      } else {
        const data = await apiGet(`/api/vod/series/${seriesId}/seasons`);
        setSeasons(data || []);
      }
    } catch (err: any) {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    }
  };

  const fetchEpisodes = async (seasonId: string) => {
    try {
      if (isLovablePreview()) {
        const { data, error } = await supabase.from('vod_episodes' as any).select('*').eq('season_id', seasonId).order('episode_number');
        if (error) throw error;
        setEpisodes((data as any[]) || []);
      } else {
        const data = await apiGet(`/api/vod/seasons/${seasonId}/episodes`);
        setEpisodes(data || []);
      }
    } catch (err: any) {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    }
  };

  useEffect(() => { fetchSeries(); }, []);

  /* ─── Series CRUD ─── */
  const handleSaveSeries = async () => {
    if (!seriesForm.title.trim()) return;
    const payload: any = { title: seriesForm.title.trim(), description: seriesForm.description.trim() || null, category: seriesForm.category || 'Series', sort_order: parseInt(seriesForm.sort_order) || 0 };
    try {
      if (isLovablePreview()) {
        if (editingSeriesId) {
          await supabase.from('vod_series' as any).update(payload).eq('id', editingSeriesId);
        } else {
          await supabase.from('vod_series' as any).insert({ ...payload, is_active: true });
        }
      } else {
        const token = getAdminToken();
        const url = editingSeriesId ? `/api/vod/series/${editingSeriesId}` : '/api/vod/series';
        await fetch(url, { method: editingSeriesId ? 'PUT' : 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(payload) });
      }
      toast({ title: editingSeriesId ? 'Serie actualizada' : 'Serie creada' });
      setShowSeriesForm(false); setEditingSeriesId(null);
      setSeriesForm({ title: '', description: '', category: 'Series', sort_order: '0' });
      fetchSeries();
    } catch (err: any) { toast({ title: 'Error', description: err.message, variant: 'destructive' }); }
  };

  const toggleSeriesActive = async (s: Series) => {
    try {
      if (isLovablePreview()) {
        await supabase.from('vod_series' as any).update({ is_active: !s.is_active }).eq('id', s.id);
      } else {
        const token = getAdminToken();
        await fetch(`/api/vod/series/${s.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify({ is_active: !s.is_active }) });
      }
      fetchSeries();
      toast({ title: s.is_active ? 'Serie desactivada' : 'Serie activada' });
    } catch (err: any) { toast({ title: 'Error', description: err.message, variant: 'destructive' }); }
  };

  const deleteSeries = async (id: string) => {
    try {
      if (isLovablePreview()) { await supabase.from('vod_series' as any).delete().eq('id', id); }
      else { await apiDelete(`/api/vod/series/${id}`); }
      toast({ title: 'Serie eliminada' }); fetchSeries();
    } catch (err: any) { toast({ title: 'Error', description: err.message, variant: 'destructive' }); }
  };

  /* ─── Season CRUD ─── */
  const handleSaveSeason = async () => {
    if (!activeSeries) return;
    const payload: any = { series_id: activeSeries.id, season_number: parseInt(seasonForm.season_number) || 1, title: seasonForm.title.trim() || null, sort_order: parseInt(seasonForm.season_number) || 1 };
    try {
      if (isLovablePreview()) {
        await supabase.from('vod_seasons' as any).insert(payload);
      } else {
        const token = getAdminToken();
        await fetch(`/api/vod/series/${activeSeries.id}/seasons`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(payload) });
      }
      toast({ title: 'Temporada creada' });
      setShowSeasonForm(false); setSeasonForm({ season_number: '1', title: '' });
      fetchSeasons(activeSeries.id);
    } catch (err: any) { toast({ title: 'Error', description: err.message, variant: 'destructive' }); }
  };

  const deleteSeason = async (id: string) => {
    try {
      if (isLovablePreview()) { await supabase.from('vod_seasons' as any).delete().eq('id', id); }
      else { await apiDelete(`/api/vod/seasons/${id}`); }
      toast({ title: 'Temporada eliminada' });
      if (activeSeries) fetchSeasons(activeSeries.id);
    } catch (err: any) { toast({ title: 'Error', description: err.message, variant: 'destructive' }); }
  };

  /* ─── Episode CRUD ─── */
  const handleSaveEpisode = async () => {
    if (!activeSeason || !episodeForm.title.trim()) return;
    const videoFile = videoFileRef.current?.files?.[0];
    if (!editingEpisodeId && !videoFile) {
      toast({ title: 'Error', description: 'Se requiere un archivo de video', variant: 'destructive' }); return;
    }
    setUploading(true); setUploadProgress(0);
    try {
      if (isLovablePreview()) {
        const payload: any = { season_id: activeSeason.id, episode_number: parseInt(episodeForm.episode_number) || 1, title: episodeForm.title.trim(), description: episodeForm.description.trim() || null, duration_minutes: parseInt(episodeForm.duration_minutes) || null, sort_order: parseInt(episodeForm.sort_order) || 0, video_filename: videoFile?.name || 'preview.mp4' };
        if (editingEpisodeId) { await supabase.from('vod_episodes' as any).update(payload).eq('id', editingEpisodeId); }
        else { await supabase.from('vod_episodes' as any).insert({ ...payload, is_active: true }); }
      } else {
        const formData = new FormData();
        formData.append('season_id', activeSeason.id);
        formData.append('episode_number', episodeForm.episode_number);
        formData.append('title', episodeForm.title.trim());
        formData.append('description', episodeForm.description.trim());
        formData.append('duration_minutes', episodeForm.duration_minutes);
        formData.append('sort_order', episodeForm.sort_order);
        if (videoFile) formData.append('video', videoFile);
        const posterFile = posterFileRef.current?.files?.[0];
        if (posterFile) formData.append('poster', posterFile);
        const token = getAdminToken();
        const url = editingEpisodeId ? `/api/vod/episodes/${editingEpisodeId}` : `/api/vod/seasons/${activeSeason.id}/episodes`;
        const method = editingEpisodeId ? 'PUT' : 'POST';
        const xhr = new XMLHttpRequest();
        xhr.open(method, url);
        if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`);
        xhr.upload.onprogress = (e) => { if (e.lengthComputable) setUploadProgress(Math.round((e.loaded / e.total) * 100)); };
        await new Promise<void>((resolve, reject) => {
          xhr.onload = () => { if (xhr.status >= 200 && xhr.status < 300) resolve(); else reject(new Error('Error del servidor')); };
          xhr.onerror = () => reject(new Error('Error de red'));
          xhr.send(formData);
        });
      }
      toast({ title: editingEpisodeId ? 'Episodio actualizado' : 'Episodio subido 🎬' });
      setShowEpisodeForm(false); setEditingEpisodeId(null);
      setEpisodeForm({ episode_number: '1', title: '', description: '', duration_minutes: '', sort_order: '0' });
      if (videoFileRef.current) videoFileRef.current.value = '';
      if (posterFileRef.current) posterFileRef.current.value = '';
      fetchEpisodes(activeSeason.id);
    } catch (err: any) { toast({ title: 'Error', description: err.message, variant: 'destructive' }); }
    setUploading(false); setUploadProgress(0);
  };

  const toggleEpisodeActive = async (ep: Episode) => {
    try {
      if (isLovablePreview()) { await supabase.from('vod_episodes' as any).update({ is_active: !ep.is_active }).eq('id', ep.id); }
      else {
        const token = getAdminToken();
        await fetch(`/api/vod/episodes/${ep.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify({ is_active: !ep.is_active }) });
      }
      if (activeSeason) fetchEpisodes(activeSeason.id);
      toast({ title: ep.is_active ? 'Episodio desactivado' : 'Episodio activado' });
    } catch (err: any) { toast({ title: 'Error', description: err.message, variant: 'destructive' }); }
  };

  const deleteEpisode = async (id: string) => {
    try {
      if (isLovablePreview()) { await supabase.from('vod_episodes' as any).delete().eq('id', id); }
      else { await apiDelete(`/api/vod/episodes/${id}`); }
      toast({ title: 'Episodio eliminado' });
      if (activeSeason) fetchEpisodes(activeSeason.id);
    } catch (err: any) { toast({ title: 'Error', description: err.message, variant: 'destructive' }); }
  };

  /* ─── Navigate into series / season ─── */
  const openSeries = (s: Series) => { setActiveSeries(s); setActiveSeason(null); fetchSeasons(s.id); };
  const openSeason = (s: Season) => { setActiveSeason(s); fetchEpisodes(s.id); };
  const goBackToSeries = () => { setActiveSeries(null); setActiveSeason(null); setSeasons([]); setEpisodes([]); };
  const goBackToSeasons = () => { setActiveSeason(null); setEpisodes([]); };

  /* ─── RENDER: Episodes view ─── */
  if (activeSeason && activeSeries) {
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={goBackToSeasons}><ArrowLeft className="w-4 h-4" /></Button>
          <div>
            <h2 className="font-display font-semibold text-xl text-foreground">{activeSeries.title}</h2>
            <p className="text-sm text-muted-foreground">Temporada {activeSeason.season_number} {activeSeason.title ? `- ${activeSeason.title}` : ''}</p>
          </div>
          <div className="ml-auto">
            <Button onClick={() => { setShowEpisodeForm(true); setEditingEpisodeId(null); setEpisodeForm({ episode_number: String(episodes.length + 1), title: '', description: '', duration_minutes: '', sort_order: String(episodes.length) }); }} className="gradient-primary text-primary-foreground gap-2">
              <Upload className="w-4 h-4" /> Subir Episodio
            </Button>
          </div>
        </div>

        {showEpisodeForm && (
          <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} className="glass rounded-xl p-5 space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Nº Episodio</label>
                <Input type="number" value={episodeForm.episode_number} onChange={e => setEpisodeForm({ ...episodeForm, episode_number: e.target.value })} className="bg-secondary border-border text-foreground" />
              </div>
              <div className="sm:col-span-2">
                <label className="text-xs text-muted-foreground mb-1 block">Título *</label>
                <Input placeholder="Título del episodio" value={episodeForm.title} onChange={e => setEpisodeForm({ ...episodeForm, title: e.target.value })} className="bg-secondary border-border text-foreground" />
              </div>
            </div>
            <Input placeholder="Descripción (opcional)" value={episodeForm.description} onChange={e => setEpisodeForm({ ...episodeForm, description: e.target.value })} className="bg-secondary border-border text-foreground" />
            <div className="grid grid-cols-2 gap-3">
              <div><label className="text-xs text-muted-foreground mb-1 block">Duración (min)</label><Input type="number" value={episodeForm.duration_minutes} onChange={e => setEpisodeForm({ ...episodeForm, duration_minutes: e.target.value })} className="bg-secondary border-border text-foreground" /></div>
              <div><label className="text-xs text-muted-foreground mb-1 block">Orden</label><Input type="number" value={episodeForm.sort_order} onChange={e => setEpisodeForm({ ...episodeForm, sort_order: e.target.value })} className="bg-secondary border-border text-foreground" /></div>
            </div>
            {!editingEpisodeId && (
              <div><label className="text-xs text-muted-foreground mb-1 block">Archivo de Video *</label>
              <input ref={videoFileRef} type="file" accept="video/*" className="w-full text-sm text-foreground file:mr-4 file:py-2 file:px-4 file:rounded-md file:border-0 file:text-sm file:font-semibold file:bg-primary/10 file:text-primary hover:file:bg-primary/20" /></div>
            )}
            <div><label className="text-xs text-muted-foreground mb-1 block">Poster (opcional)</label>
            <input ref={posterFileRef} type="file" accept="image/*" className="w-full text-sm text-foreground file:mr-4 file:py-2 file:px-4 file:rounded-md file:border-0 file:text-sm file:font-semibold file:bg-primary/10 file:text-primary hover:file:bg-primary/20" /></div>
            {uploading && (
              <div className="space-y-1">
                <div className="w-full bg-secondary rounded-full h-2"><div className="bg-primary h-2 rounded-full transition-all" style={{ width: `${uploadProgress}%` }} /></div>
                <p className="text-xs text-muted-foreground text-center">{uploadProgress}% subido...</p>
              </div>
            )}
            <div className="flex gap-2 justify-end">
              <Button variant="ghost" onClick={() => setShowEpisodeForm(false)} className="text-muted-foreground"><X className="w-4 h-4 mr-1" /> Cancelar</Button>
              <Button onClick={handleSaveEpisode} disabled={uploading} className="gradient-primary text-primary-foreground"><Upload className="w-4 h-4 mr-1" /> {editingEpisodeId ? 'Actualizar' : 'Subir'}</Button>
            </div>
          </motion.div>
        )}

        {episodes.length === 0 ? (
          <div className="glass rounded-xl p-12 text-center"><Film className="w-12 h-12 text-muted-foreground mx-auto mb-3" /><p className="text-muted-foreground">Sin episodios</p></div>
        ) : (
          <div className="space-y-2">
            {episodes.map((ep, i) => (
              <motion.div key={ep.id} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: i * 0.03 }}
                className={`glass rounded-xl p-4 ${!ep.is_active ? 'opacity-50' : ''}`}>
                <div className="flex items-center justify-between gap-4">
                  <div className="flex items-center gap-3 flex-1 min-w-0">
                    <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center shrink-0 text-primary font-bold text-sm">{ep.episode_number}</div>
                    <div className="min-w-0">
                      <p className="font-semibold text-foreground text-sm truncate">{ep.title}</p>
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        {ep.duration_minutes && <span>{ep.duration_minutes} min</span>}
                        {!ep.is_active && <span className="text-destructive font-semibold">INACTIVO</span>}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <Button variant="ghost" size="icon" onClick={() => toggleEpisodeActive(ep)} className="text-muted-foreground hover:text-primary">{ep.is_active ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}</Button>
                    <Button variant="ghost" size="icon" onClick={() => { setEpisodeForm({ episode_number: String(ep.episode_number), title: ep.title, description: ep.description || '', duration_minutes: ep.duration_minutes?.toString() || '', sort_order: ep.sort_order?.toString() || '0' }); setEditingEpisodeId(ep.id); setShowEpisodeForm(true); }} className="text-muted-foreground hover:text-primary"><Edit2 className="w-4 h-4" /></Button>
                    <Button variant="ghost" size="icon" onClick={() => deleteEpisode(ep.id)} className="text-muted-foreground hover:text-destructive"><Trash2 className="w-4 h-4" /></Button>
                  </div>
                </div>
              </motion.div>
            ))}
          </div>
        )}
      </div>
    );
  }

  /* ─── RENDER: Seasons view ─── */
  if (activeSeries) {
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={goBackToSeries}><ArrowLeft className="w-4 h-4" /></Button>
          <h2 className="font-display font-semibold text-xl text-foreground">{activeSeries.title} — Temporadas</h2>
          <div className="ml-auto">
            <Button onClick={() => { setShowSeasonForm(true); setSeasonForm({ season_number: String(seasons.length + 1), title: '' }); }} className="gradient-primary text-primary-foreground gap-2">
              <Plus className="w-4 h-4" /> Agregar Temporada
            </Button>
          </div>
        </div>

        {showSeasonForm && (
          <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} className="glass rounded-xl p-5 space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div><label className="text-xs text-muted-foreground mb-1 block">Nº Temporada</label><Input type="number" value={seasonForm.season_number} onChange={e => setSeasonForm({ ...seasonForm, season_number: e.target.value })} className="bg-secondary border-border text-foreground" /></div>
              <div><label className="text-xs text-muted-foreground mb-1 block">Título (opcional)</label><Input placeholder="ej: La Temporada Final" value={seasonForm.title} onChange={e => setSeasonForm({ ...seasonForm, title: e.target.value })} className="bg-secondary border-border text-foreground" /></div>
            </div>
            <div className="flex gap-2 justify-end">
              <Button variant="ghost" onClick={() => setShowSeasonForm(false)} className="text-muted-foreground"><X className="w-4 h-4 mr-1" /> Cancelar</Button>
              <Button onClick={handleSaveSeason} className="gradient-primary text-primary-foreground"><Plus className="w-4 h-4 mr-1" /> Crear</Button>
            </div>
          </motion.div>
        )}

        {seasons.length === 0 ? (
          <div className="glass rounded-xl p-12 text-center"><Layers className="w-12 h-12 text-muted-foreground mx-auto mb-3" /><p className="text-muted-foreground">Sin temporadas</p></div>
        ) : (
          <div className="space-y-2">
            {seasons.map((s, i) => (
              <motion.div key={s.id} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: i * 0.03 }}
                className="glass rounded-xl p-4 cursor-pointer hover:border-primary/30 transition-colors" onClick={() => openSeason(s)}>
                <div className="flex items-center justify-between gap-4">
                  <div className="flex items-center gap-3 flex-1">
                    <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center shrink-0"><Layers className="w-5 h-5 text-primary" /></div>
                    <div>
                      <p className="font-semibold text-foreground text-sm">Temporada {s.season_number} {s.title ? `— ${s.title}` : ''}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <Button variant="ghost" size="icon" onClick={(e) => { e.stopPropagation(); deleteSeason(s.id); }} className="text-muted-foreground hover:text-destructive"><Trash2 className="w-4 h-4" /></Button>
                    <ChevronRight className="w-4 h-4 text-muted-foreground" />
                  </div>
                </div>
              </motion.div>
            ))}
          </div>
        )}
      </div>
    );
  }

  /* ─── RENDER: Series list ─── */
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="font-display font-semibold text-xl text-foreground">Series ({seriesList.length})</h2>
        <Button onClick={() => { setShowSeriesForm(true); setEditingSeriesId(null); setSeriesForm({ title: '', description: '', category: 'Series', sort_order: '0' }); }} className="gradient-primary text-primary-foreground gap-2">
          <Plus className="w-4 h-4" /> Nueva Serie
        </Button>
      </div>

      {showSeriesForm && (
        <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} className="glass rounded-xl p-5 space-y-3">
          <Input placeholder="Título de la serie" value={seriesForm.title} onChange={e => setSeriesForm({ ...seriesForm, title: e.target.value })} className="bg-secondary border-border text-foreground" />
          <Input placeholder="Descripción (opcional)" value={seriesForm.description} onChange={e => setSeriesForm({ ...seriesForm, description: e.target.value })} className="bg-secondary border-border text-foreground" />
          <div className="grid grid-cols-2 gap-3">
            <Input placeholder="Categoría" value={seriesForm.category} onChange={e => setSeriesForm({ ...seriesForm, category: e.target.value })} className="bg-secondary border-border text-foreground" />
            <div><label className="text-xs text-muted-foreground mb-1 block">Orden</label><Input type="number" value={seriesForm.sort_order} onChange={e => setSeriesForm({ ...seriesForm, sort_order: e.target.value })} className="bg-secondary border-border text-foreground" /></div>
          </div>
          <div className="flex gap-2 justify-end">
            <Button variant="ghost" onClick={() => setShowSeriesForm(false)} className="text-muted-foreground"><X className="w-4 h-4 mr-1" /> Cancelar</Button>
            <Button onClick={handleSaveSeries} className="gradient-primary text-primary-foreground">{editingSeriesId ? 'Actualizar' : 'Crear Serie'}</Button>
          </div>
        </motion.div>
      )}

      {loading ? (
        <div className="text-center py-12 text-muted-foreground">Cargando...</div>
      ) : seriesList.length === 0 ? (
        <div className="glass rounded-xl p-12 text-center"><Tv2 className="w-12 h-12 text-muted-foreground mx-auto mb-3" /><p className="text-muted-foreground">No hay series creadas</p></div>
      ) : (
        <div className="space-y-2">
          {seriesList.map((s, i) => (
            <motion.div key={s.id} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: i * 0.03 }}
              className={`glass rounded-xl p-4 cursor-pointer hover:border-primary/30 transition-colors ${!s.is_active ? 'opacity-50' : ''}`} onClick={() => openSeries(s)}>
              <div className="flex items-center justify-between gap-4">
                <div className="flex items-center gap-3 flex-1 min-w-0">
                  <div className="w-14 h-10 rounded-lg bg-secondary/60 overflow-hidden shrink-0">
                    {s.poster_url ? <img src={s.poster_url} alt={s.title} className="w-full h-full object-cover" /> : <div className="w-full h-full flex items-center justify-center"><Tv2 className="w-5 h-5 text-muted-foreground" /></div>}
                  </div>
                  <div className="min-w-0">
                    <p className="font-semibold text-foreground text-sm truncate">{s.title}</p>
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <Badge variant="secondary" className="text-[10px] py-0">{s.category}</Badge>
                      {!s.is_active && <span className="text-destructive font-semibold">INACTIVA</span>}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <Button variant="ghost" size="icon" onClick={(e) => { e.stopPropagation(); toggleSeriesActive(s); }} className="text-muted-foreground hover:text-primary">{s.is_active ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}</Button>
                  <Button variant="ghost" size="icon" onClick={(e) => { e.stopPropagation(); setSeriesForm({ title: s.title, description: s.description || '', category: s.category, sort_order: s.sort_order?.toString() || '0' }); setEditingSeriesId(s.id); setShowSeriesForm(true); }} className="text-muted-foreground hover:text-primary"><Edit2 className="w-4 h-4" /></Button>
                  <Button variant="ghost" size="icon" onClick={(e) => { e.stopPropagation(); deleteSeries(s.id); }} className="text-muted-foreground hover:text-destructive"><Trash2 className="w-4 h-4" /></Button>
                  <ChevronRight className="w-4 h-4 text-muted-foreground" />
                </div>
              </div>
            </motion.div>
          ))}
        </div>
      )}
    </div>
  );
};

export default SeriesManager;
