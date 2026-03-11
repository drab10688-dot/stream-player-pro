import { useState, useEffect, useRef } from 'react';
import { apiGet, apiPost, apiPut, apiDelete } from '@/lib/api';
import { supabase } from '@/integrations/supabase/client';
import { isLovablePreview } from '@/lib/utils';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Plus, Trash2, Edit2, Save, X, Tv, Upload, Link, FileText, Loader2, Zap, ImagePlus, Play, Square, Activity, HardDrive, CheckSquare, Square as SquareIcon, Radio, Disc, Cpu } from 'lucide-react';
import { Checkbox } from '@/components/ui/checkbox';
import { motion, AnimatePresence } from 'framer-motion';
import VideoPlayer from '@/components/VideoPlayer';
import { Badge } from '@/components/ui/badge';

interface Channel {
  id: string;
  name: string;
  url: string;
  category: string;
  is_active: boolean;
  keep_alive: boolean;
  sort_order: number;
  logo_url: string | null;
  stream_mode: 'direct' | 'buffer' | 'transcode';
}

interface CacheStatus {
  id: string;
  transcoder_active: boolean;
  transcoder_ready: boolean;
  transcoder_type: string | null;
  clients: number;
  uptime_seconds: number;
  cache_segments: number;
  cache_size_mb: number;
  adaptive: boolean;
}

const ChannelsManager = () => {
  const { toast } = useToast();
  const [channels, setChannels] = useState<Channel[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [showM3UImport, setShowM3UImport] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState({ name: '', url: '', category: 'General', sort_order: 0, logo_url: '', stream_mode: 'direct' as 'direct' | 'buffer' | 'transcode' });
  const [m3uContent, setM3uContent] = useState('');
  const [m3uUrl, setM3uUrl] = useState('');
  const [importing, setImporting] = useState(false);
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const [logoPreview, setLogoPreview] = useState<string | null>(null);
  const [previewChannelId, setPreviewChannelId] = useState<string | null>(null);
  const [cacheStatus, setCacheStatus] = useState<CacheStatus[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [filterRunning, setFilterRunning] = useState(false);
  const logoInputRef = useRef<HTMLInputElement>(null);
  const cacheIntervalRef = useRef<ReturnType<typeof setInterval>>();

  const fetchChannels = async () => {
    try {
      if (isLovablePreview()) {
        const { data, error } = await supabase
          .from('channels')
          .select('*')
          .order('sort_order');
        if (error) throw error;
        setChannels((data as any[]) || []);
      } else {
        const data = await apiGet('/api/channels');
        setChannels(data || []);
      }
    } catch (err: any) {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    }
    setLoading(false);
  };

  const fetchCacheStatus = async () => {
    if (isLovablePreview()) return;
    try {
      const data = await apiGet('/api/channels/cache-status');
      setCacheStatus(data || []);
    } catch { /* silent */ }
  };

  useEffect(() => { 
    fetchChannels(); 
    fetchCacheStatus();
    // Auto-refresh cache status every 15s
    if (!isLovablePreview()) {
      cacheIntervalRef.current = setInterval(fetchCacheStatus, 15000);
    }
    return () => { if (cacheIntervalRef.current) clearInterval(cacheIntervalRef.current); };
  }, []);

  const handleSave = async () => {
    if (!form.name.trim() || !form.url.trim()) {
      toast({ title: 'Error', description: 'Nombre y URL son requeridos', variant: 'destructive' });
      return;
    }
    try {
      const payload = { ...form, logo_url: form.logo_url.trim() || null, stream_mode: form.stream_mode };
      if (isLovablePreview()) {
        if (editingId) {
          const { error } = await supabase.from('channels').update(payload).eq('id', editingId);
          if (error) throw error;
          toast({ title: 'Canal actualizado' });
        } else {
          const { error } = await supabase.from('channels').insert({ ...payload, is_active: true });
          if (error) throw error;
          toast({ title: 'Canal creado' });
        }
      } else {
        if (editingId) {
          await apiPut(`/api/channels/${editingId}`, payload);
          toast({ title: 'Canal actualizado' });
        } else {
          await apiPost('/api/channels', payload);
          toast({ title: 'Canal creado' });
        }
      }
      setForm({ name: '', url: '', category: 'General', sort_order: 0, logo_url: '', stream_mode: 'direct' });
      setShowForm(false);
      setEditingId(null);
      fetchChannels();
    } catch (err: any) {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    }
  };

  const handleEdit = (ch: Channel) => {
    setForm({ name: ch.name, url: ch.url, category: ch.category, sort_order: ch.sort_order, logo_url: ch.logo_url || '', stream_mode: ch.stream_mode || 'direct' });
    setLogoPreview(ch.logo_url || null);
    setEditingId(ch.id);
    setShowForm(true);
  };

  const handleDelete = async (id: string) => {
    try {
      if (isLovablePreview()) {
        const { error } = await supabase.from('channels').delete().eq('id', id);
        if (error) throw error;
      } else {
        await apiDelete(`/api/channels/${id}`);
      }
      toast({ title: 'Canal eliminado' });
      fetchChannels();
    } catch (err: any) {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    }
  };

  const handleBatchDelete = async () => {
    if (selectedIds.size === 0) return;
    const count = selectedIds.size;
    if (!confirm(`¿Eliminar ${count} canal(es) seleccionados?`)) return;
    try {
      if (isLovablePreview()) {
        const { error } = await supabase.from('channels').delete().in('id', Array.from(selectedIds));
        if (error) throw error;
      } else {
        await Promise.all(Array.from(selectedIds).map(id => apiDelete(`/api/channels/${id}`)));
      }
      toast({ title: `${count} canales eliminados` });
      setSelectedIds(new Set());
      fetchChannels();
    } catch (err: any) {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    }
  };

  const toggleSelect = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    const visibleChannels = filterRunning 
      ? channels.filter(ch => cacheStatus.some(c => c.id === ch.id && c.transcoder_active))
      : channels;
    if (selectedIds.size === visibleChannels.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(visibleChannels.map(ch => ch.id)));
    }
  };

  const toggleActive = async (ch: Channel) => {
    try {
      const newActive = !ch.is_active;
      const updates: Record<string, any> = { is_active: newActive };
      if (newActive) {
        updates.auto_disabled = false;
        updates.consecutive_failures = 0;
      }
      if (isLovablePreview()) {
        const { error } = await supabase.from('channels').update(updates).eq('id', ch.id);
        if (error) throw error;
      } else {
        await apiPut(`/api/channels/${ch.id}`, updates);
      }
      fetchChannels();
    } catch (err: any) {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    }
  };

  const toggleKeepAlive = async (ch: Channel) => {
    try {
      if (isLovablePreview()) {
        // keep_alive not in supabase schema, skip
        toast({ title: 'Keep Alive solo disponible en VPS', variant: 'destructive' });
        return;
      }
      await apiPut(`/api/channels/${ch.id}`, { keep_alive: !ch.keep_alive });
      toast({ 
        title: !ch.keep_alive ? '💚 Keep Alive activado' : 'Keep Alive desactivado',
        description: !ch.keep_alive 
          ? `${ch.name} se mantendrá conectado permanentemente al origen` 
          : `${ch.name} se conectará solo cuando haya clientes`
      });
      fetchChannels();
    } catch (err: any) {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    }
  };

  const handleM3UImport = async () => {
    if (!m3uContent.trim() && !m3uUrl.trim()) {
      toast({ title: 'Error', description: 'Pega el contenido M3U o ingresa una URL', variant: 'destructive' });
      return;
    }
    setImporting(true);
    try {
      if (isLovablePreview()) {
        const { data, error } = await supabase.functions.invoke('import-m3u', {
          body: { m3u_content: m3uContent.trim() || undefined, m3u_url: m3uUrl.trim() || undefined },
        });
        if (error) throw error;
        toast({ title: '¡Importación completada!', description: `${data.imported} de ${data.total} canales importados` });
      } else {
        const data = await apiPost('/api/channels/import-m3u', {
          m3u_content: m3uContent.trim() || undefined,
          m3u_url: m3uUrl.trim() || undefined,
        });
        toast({ title: '¡Importación completada!', description: `${data.imported} de ${data.total} canales importados` });
      }
      setM3uContent('');
      setM3uUrl('');
      setShowM3UImport(false);
      fetchChannels();
    } catch (err: any) {
      toast({ title: 'Error', description: err.message || 'Error al importar', variant: 'destructive' });
    }
    setImporting(false);
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      setM3uContent(ev.target?.result as string || '');
    };
    reader.readAsText(file);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h2 className="font-display font-semibold text-xl text-foreground">Canales ({channels.length})</h2>
        <div className="flex gap-2 flex-wrap">
          {/* Filter: show only running */}
          {cacheStatus.some(c => c.transcoder_active) && (
            <Button
              onClick={() => setFilterRunning(!filterRunning)}
              variant={filterRunning ? 'default' : 'outline'}
              className={`gap-2 ${filterRunning ? 'gradient-primary text-primary-foreground' : 'border-border text-foreground'}`}
              size="sm"
            >
              <Activity className="w-4 h-4" />
              En vivo ({cacheStatus.filter(c => c.transcoder_active).length})
            </Button>
          )}
          {selectedIds.size > 0 && (
            <Button onClick={handleBatchDelete} variant="destructive" size="sm" className="gap-2">
              <Trash2 className="w-4 h-4" /> Eliminar ({selectedIds.size})
            </Button>
          )}
          <Button onClick={() => { setShowM3UImport(!showM3UImport); setShowForm(false); }} variant="outline" className="gap-2 border-border text-foreground" size="sm">
            <Upload className="w-4 h-4" /> Importar M3U
          </Button>
          <Button onClick={() => { setShowForm(true); setShowM3UImport(false); setEditingId(null); setLogoPreview(null); setForm({ name: '', url: '', category: 'General', sort_order: 0, logo_url: '', stream_mode: 'direct' }); }} className="gradient-primary text-primary-foreground gap-2" size="sm">
            <Plus className="w-4 h-4" /> Agregar Canal
          </Button>
        </div>
      </div>

      {showM3UImport && (
        <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} className="glass rounded-xl p-5 space-y-4">
          <div className="flex items-center gap-2 mb-2">
            <FileText className="w-5 h-5 text-primary" />
            <h3 className="font-semibold text-foreground">Importar Lista M3U / M3U8</h3>
          </div>
          <p className="text-sm text-muted-foreground">Importa canales desde una lista M3U.</p>
          <div className="space-y-2">
            <label className="text-sm font-medium text-foreground flex items-center gap-1">
              <Link className="w-3.5 h-3.5" /> URL de la lista M3U
            </label>
            <Input placeholder="https://ejemplo.com/lista.m3u" value={m3uUrl} onChange={e => setM3uUrl(e.target.value)} className="bg-secondary border-border text-foreground" maxLength={1000} />
          </div>
          <div className="flex items-center gap-3">
            <div className="h-px flex-1 bg-border" />
            <span className="text-xs text-muted-foreground">o pega el contenido</span>
            <div className="h-px flex-1 bg-border" />
          </div>
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-sm font-medium text-foreground">Contenido M3U</label>
              <label className="cursor-pointer text-xs text-primary hover:underline">
                <input type="file" accept=".m3u,.m3u8,.txt" className="hidden" onChange={handleFileUpload} />
                📁 Cargar archivo
              </label>
            </div>
            <Textarea placeholder={`#EXTM3U\n#EXTINF:-1 group-title="Deportes",ESPN\nhttp://ip:port/espn.ts`} value={m3uContent} onChange={e => setM3uContent(e.target.value)} className="bg-secondary border-border text-foreground font-mono text-xs min-h-[150px]" rows={8} />
          </div>
          <div className="flex gap-2 justify-end">
            <Button variant="ghost" onClick={() => setShowM3UImport(false)} className="text-muted-foreground"><X className="w-4 h-4 mr-1" /> Cancelar</Button>
            <Button onClick={handleM3UImport} disabled={importing} className="gradient-primary text-primary-foreground">
              {importing ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Upload className="w-4 h-4 mr-1" />}
              {importing ? 'Importando...' : 'Importar Canales'}
            </Button>
          </div>
        </motion.div>
      )}

      {showForm && (
        <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} className="glass rounded-xl p-5 space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Input placeholder="Nombre del canal" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} className="bg-secondary border-border text-foreground" maxLength={100} />
            <Input placeholder="Categoría" value={form.category} onChange={e => setForm({ ...form, category: e.target.value })} className="bg-secondary border-border text-foreground" maxLength={50} />
          </div>
          <Input placeholder="URL del stream" value={form.url} onChange={e => setForm({ ...form, url: e.target.value })} className="bg-secondary border-border text-foreground" maxLength={500} />
          <div className="flex gap-3 items-end">
            <div className="flex-1 space-y-2">
              <label className="text-xs text-muted-foreground block">Logo del canal (subir archivo o URL)</label>
              <div className="flex gap-2">
                <input
                  ref={logoInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={async (e) => {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    if (file.size > 2 * 1024 * 1024) {
                      toast({ title: 'Error', description: 'El logo no debe superar 2MB', variant: 'destructive' });
                      return;
                    }
                    setUploadingLogo(true);
                    try {
                      if (isLovablePreview()) {
                        const ext = file.name.split('.').pop() || 'png';
                        const fileName = `${crypto.randomUUID()}.${ext}`;
                        const { error } = await supabase.storage.from('channel-logos').upload(fileName, file, { upsert: true });
                        if (error) throw error;
                        const { data: urlData } = supabase.storage.from('channel-logos').getPublicUrl(fileName);
                        setForm(f => ({ ...f, logo_url: urlData.publicUrl }));
                        setLogoPreview(urlData.publicUrl);
                      } else {
                        // VPS: upload via API
                        const formData = new FormData();
                        formData.append('logo', file);
                        const token = localStorage.getItem('admin_token');
                        const res = await fetch('/api/channels/upload-logo', {
                          method: 'POST',
                          headers: token ? { 'Authorization': `Bearer ${token}` } : {},
                          body: formData,
                        });
                        if (!res.ok) throw new Error('Error al subir logo');
                        const data = await res.json();
                        setForm(f => ({ ...f, logo_url: data.url }));
                        setLogoPreview(data.url);
                      }
                      toast({ title: 'Logo subido correctamente' });
                    } catch (err: any) {
                      toast({ title: 'Error', description: err.message, variant: 'destructive' });
                    }
                    setUploadingLogo(false);
                    if (logoInputRef.current) logoInputRef.current.value = '';
                  }}
                />
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => logoInputRef.current?.click()}
                  disabled={uploadingLogo}
                  className="gap-2 border-border text-foreground shrink-0"
                >
                  {uploadingLogo ? <Loader2 className="w-4 h-4 animate-spin" /> : <ImagePlus className="w-4 h-4" />}
                  {uploadingLogo ? 'Subiendo...' : 'Subir Logo'}
                </Button>
                <Input placeholder="o pegar URL del logo" value={form.logo_url} onChange={e => { setForm({ ...form, logo_url: e.target.value }); setLogoPreview(e.target.value); }} className="bg-secondary border-border text-foreground" maxLength={500} />
              </div>
            </div>
            {(logoPreview || form.logo_url) && (
              <div className="w-12 h-12 rounded-lg bg-secondary border border-border overflow-hidden shrink-0">
                <img src={logoPreview || form.logo_url} alt="Preview" className="w-full h-full object-cover" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
              </div>
            )}
          </div>
          <Input type="number" placeholder="Orden" value={form.sort_order} onChange={e => setForm({ ...form, sort_order: parseInt(e.target.value) || 0 })} className="bg-secondary border-border text-foreground w-32" />
          <div className="space-y-2">
            <label className="text-xs text-muted-foreground block">Modo de Transmisión</label>
            <div className="flex gap-2 flex-wrap">
              {([
                { value: 'direct' as const, label: 'Directo (Proxy HLS)', icon: Radio, desc: 'Ideal para deportes' },
                { value: 'buffer' as const, label: 'Buffer de Estabilidad', icon: Disc, desc: 'Grabación circular 10min' },
                { value: 'transcode' as const, label: 'Transcodificación Activa', icon: Cpu, desc: 'H.264/AAC permanente' },
              ]).map(mode => (
                <button
                  key={mode.value}
                  type="button"
                  onClick={() => setForm({ ...form, stream_mode: mode.value })}
                  className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-sm transition-all ${
                    form.stream_mode === mode.value
                      ? 'border-primary bg-primary/10 text-primary'
                      : 'border-border bg-secondary text-muted-foreground hover:border-primary/50'
                  }`}
                >
                  <mode.icon className="w-4 h-4 shrink-0" />
                  <div className="text-left">
                    <div className="font-medium text-xs">{mode.label}</div>
                    <div className="text-[10px] opacity-70">{mode.desc}</div>
                  </div>
                </button>
              ))}
            </div>
          </div>
          <div className="flex gap-2 justify-end">
            <Button variant="ghost" onClick={() => { setShowForm(false); setEditingId(null); }} className="text-muted-foreground"><X className="w-4 h-4 mr-1" /> Cancelar</Button>
            <Button onClick={handleSave} className="gradient-primary text-primary-foreground"><Save className="w-4 h-4 mr-1" /> {editingId ? 'Actualizar' : 'Guardar'}</Button>
          </div>
        </motion.div>
      )}

      {loading ? (
        <div className="text-center py-12 text-muted-foreground">Cargando...</div>
      ) : channels.length === 0 ? (
        <div className="glass rounded-xl p-12 text-center">
          <Tv className="w-12 h-12 text-muted-foreground mx-auto mb-3" />
          <p className="text-muted-foreground">No hay canales. Agrega uno o importa una lista M3U.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {/* Select all checkbox */}
          {channels.length > 1 && (
            <div className="flex items-center gap-2 px-2 py-1">
              <Checkbox
                checked={selectedIds.size > 0 && selectedIds.size === (filterRunning ? channels.filter(ch => cacheStatus.some(c => c.id === ch.id && c.transcoder_active)).length : channels.length)}
                onCheckedChange={toggleSelectAll}
              />
              <span className="text-xs text-muted-foreground">Seleccionar todos</span>
            </div>
          )}
          {channels
            .filter(ch => !filterRunning || cacheStatus.some(c => c.id === ch.id && c.transcoder_active))
            .map((ch, i) => {
            const cache = cacheStatus.find(c => c.id === ch.id);
            const isSelected = selectedIds.has(ch.id);
            return (
              <motion.div key={ch.id} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: i * 0.03 }}
                className={`glass rounded-xl overflow-hidden ${!ch.is_active ? 'opacity-50' : ''} ${isSelected ? 'ring-1 ring-primary' : ''}`}>
                <div className="p-4 flex items-center justify-between">
                  <div className="flex items-center gap-3 flex-1 min-w-0">
                    <Checkbox
                      checked={isSelected}
                      onCheckedChange={() => toggleSelect(ch.id)}
                      className="shrink-0"
                    />
                    <div className="w-10 h-10 rounded-lg bg-secondary flex items-center justify-center shrink-0 overflow-hidden relative">
                      {ch.logo_url ? (
                        <img src={ch.logo_url} alt={ch.name} className="w-full h-full object-cover" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                      ) : (
                        <Tv className="w-5 h-5 text-primary" />
                      )}
                      {cache?.transcoder_active && (
                        <span className={`absolute -top-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border border-background ${cache.transcoder_ready ? 'bg-green-500 animate-pulse' : 'bg-yellow-500'}`} />
                      )}
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="font-semibold text-foreground text-sm truncate">{ch.name}</p>
                        {(ch.stream_mode && ch.stream_mode !== 'direct') && (
                          <Badge variant="outline" className={`text-[10px] py-0 px-1.5 gap-1 ${ch.stream_mode === 'buffer' ? 'border-amber-500/30 text-amber-500' : 'border-cyan-500/30 text-cyan-500'}`}>
                            {ch.stream_mode === 'buffer' ? <Disc className="w-2.5 h-2.5" /> : <Cpu className="w-2.5 h-2.5" />}
                            {ch.stream_mode === 'buffer' ? 'Buffer' : 'Transcode'}
                          </Badge>
                        )}
                        {cache?.transcoder_active && (
                          <div className="flex items-center gap-1">
                            <Badge variant="outline" className="text-[10px] py-0 px-1.5 border-green-500/30 text-green-500 gap-1">
                              <Activity className="w-2.5 h-2.5" />
                              {cache.transcoder_ready ? 'LIVE' : 'Iniciando'}
                            </Badge>
                            {cache.cache_segments > 0 && (
                              <Badge variant="outline" className="text-[10px] py-0 px-1.5 border-blue-500/30 text-blue-500 gap-1">
                                <HardDrive className="w-2.5 h-2.5" />
                                {cache.cache_size_mb}MB · {cache.cache_segments} seg
                              </Badge>
                            )}
                            {cache.clients > 0 && (
                              <Badge variant="outline" className="text-[10px] py-0 px-1.5 border-purple-500/30 text-purple-500">
                                {cache.clients} 👤
                              </Badge>
                            )}
                          </div>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground truncate">{ch.category} · {ch.url.substring(0, 50)}{ch.url.length > 50 ? '...' : ''}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => setPreviewChannelId(previewChannelId === ch.id ? null : ch.id)}
                      className={`${previewChannelId === ch.id ? 'text-red-500 hover:text-red-600' : 'text-green-500 hover:text-green-600'}`}
                      title={previewChannelId === ch.id ? 'Detener preview' : 'Reproducir canal'}
                    >
                      {previewChannelId === ch.id ? <Square className="w-4 h-4" /> : <Play className="w-4 h-4" />}
                    </Button>
                    {!isLovablePreview() && (
                      <div className="flex items-center gap-1.5 mr-2" title={ch.keep_alive ? 'Pre-Caché: ON - Siempre conectado al origen' : 'Pre-Caché: OFF - Conexión bajo demanda'}>
                        <Zap className={`w-3.5 h-3.5 ${ch.keep_alive ? 'text-green-500' : 'text-muted-foreground/40'}`} />
                        <Switch 
                          checked={ch.keep_alive} 
                          onCheckedChange={() => toggleKeepAlive(ch)} 
                          className="scale-75"
                        />
                      </div>
                    )}
                    <Button variant="ghost" size="icon" onClick={() => toggleActive(ch)} title={ch.is_active ? 'Desactivar canal' : 'Activar canal'}>
                      <div className={`w-3 h-3 rounded-full ${ch.is_active ? 'bg-green-500' : 'bg-red-500'}`} />
                    </Button>
                    <Button variant="ghost" size="icon" onClick={() => handleEdit(ch)} className="text-muted-foreground hover:text-primary">
                      <Edit2 className="w-4 h-4" />
                    </Button>
                    <Button variant="ghost" size="icon" onClick={() => handleDelete(ch.id)} className="text-muted-foreground hover:text-destructive">
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>
                </div>
                <AnimatePresence>
                  {previewChannelId === ch.id && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 300, opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.3 }}
                      className="border-t border-border bg-black"
                    >
                      <VideoPlayer src={ch.url} channelId={ch.id} />
                    </motion.div>
                  )}
                </AnimatePresence>
              </motion.div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default ChannelsManager;
