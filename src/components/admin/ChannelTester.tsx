import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';
import { motion, AnimatePresence } from 'framer-motion';
import VideoPlayer from '@/components/VideoPlayer';
import {
  Play, Trash2, Download, Search, CheckCircle2, XCircle,
  Loader2, RefreshCw, AlertTriangle, Circle, Zap, Filter
} from 'lucide-react';

const isLovablePreview = () => typeof window !== 'undefined' && window.location.hostname.includes('lovable.app');

interface Channel {
  id: string;
  name: string;
  url: string;
  category: string;
  logo_url: string | null;
  is_active: boolean;
}

type PingStatus = 'unknown' | 'checking' | 'up' | 'down';

const ChannelTester = () => {
  const [channels, setChannels] = useState<Channel[]>([]);
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [pingStatus, setPingStatus] = useState<Record<string, PingStatus>>({});
  const [playingChannel, setPlayingChannel] = useState<Channel | null>(null);
  const [loading, setLoading] = useState(true);
  const [checking, setChecking] = useState(false);
  const [filterDown, setFilterDown] = useState(false);
  const { toast } = useToast();
  const abortRef = useRef<AbortController | null>(null);

  const fetchChannels = useCallback(async () => {
    setLoading(true);
    try {
      if (isLovablePreview()) {
        const { data, error } = await supabase.from('channels').select('id, name, url, category, logo_url, is_active');
        if (error) throw error;
        setChannels(data || []);
      } else {
        const { apiGet } = await import('@/lib/api');
        const data = await apiGet('/api/channels');
        setChannels(data);
      }
    } catch (err: any) {
      toast({ title: 'Error cargando canales', description: err.message, variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => { fetchChannels(); }, [fetchChannels]);

  // Ping all channels
  const runHealthCheck = async () => {
    setChecking(true);
    const initial: Record<string, PingStatus> = {};
    channels.forEach(ch => { initial[ch.id] = 'checking'; });
    setPingStatus(initial);

    try {
      if (isLovablePreview()) {
        const { data, error } = await supabase.functions.invoke('channel-ping', {
          body: { auto_manage: false }
        });
        if (error) throw error;
        const newStatus: Record<string, PingStatus> = {};
        (data.results || []).forEach((r: any) => {
          newStatus[r.id] = r.status === 'online' ? 'up' : 'down';
        });
        setPingStatus(newStatus);
      } else {
        const { apiPost } = await import('@/lib/api');
        const data = await apiPost('/api/channels/ping', { auto_manage: false });
        const newStatus: Record<string, PingStatus> = {};
        (data.results || []).forEach((r: any) => {
          newStatus[r.id] = r.status === 'online' ? 'up' : 'down';
        });
        setPingStatus(newStatus);
      }
    } catch (err: any) {
      toast({ title: 'Error en health check', description: err.message, variant: 'destructive' });
    } finally {
      setChecking(false);
    }
  };

  // Selection helpers
  const toggleSelect = (id: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    const visible = filteredChannels.map(c => c.id);
    const allSelected = visible.every(id => selected.has(id));
    setSelected(prev => {
      const next = new Set(prev);
      visible.forEach(id => allSelected ? next.delete(id) : next.add(id));
      return next;
    });
  };

  const selectDownChannels = () => {
    const downIds = channels.filter(ch => pingStatus[ch.id] === 'down').map(ch => ch.id);
    setSelected(new Set(downIds));
  };

  // Delete channels
  const deleteChannels = async (ids: string[]) => {
    if (!ids.length) return;
    if (!confirm(`¿Eliminar ${ids.length} canal(es)? Esta acción no se puede deshacer.`)) return;
    try {
      if (isLovablePreview()) {
        const { error } = await supabase.from('channels').delete().in('id', ids);
        if (error) throw error;
      } else {
        const { apiDelete } = await import('@/lib/api');
        for (const id of ids) {
          await apiDelete(`/api/channels/${id}`);
        }
      }
      setChannels(prev => prev.filter(ch => !ids.includes(ch.id)));
      setSelected(prev => { const n = new Set(prev); ids.forEach(id => n.delete(id)); return n; });
      if (playingChannel && ids.includes(playingChannel.id)) setPlayingChannel(null);
      toast({ title: `${ids.length} canal(es) eliminado(s)` });
    } catch (err: any) {
      toast({ title: 'Error eliminando', description: err.message, variant: 'destructive' });
    }
  };

  const deleteDownChannels = () => {
    const downIds = channels.filter(ch => pingStatus[ch.id] === 'down').map(ch => ch.id);
    if (!downIds.length) {
      toast({ title: 'No hay canales caídos para eliminar' });
      return;
    }
    deleteChannels(downIds);
  };

  // Export M3U
  const exportM3U = (onlySelected: boolean) => {
    const list = onlySelected
      ? channels.filter(ch => selected.has(ch.id))
      : channels.filter(ch => pingStatus[ch.id] !== 'down');

    if (!list.length) {
      toast({ title: 'No hay canales para exportar' });
      return;
    }

    let m3u = '#EXTM3U\n';
    list.forEach(ch => {
      const logo = ch.logo_url ? ` tvg-logo="${ch.logo_url}"` : '';
      m3u += `#EXTINF:-1${logo} group-title="${ch.category}",${ch.name}\n`;
      m3u += `${ch.url}\n`;
    });

    const blob = new Blob([m3u], { type: 'audio/x-mpegurl' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `canales_limpios_${new Date().toISOString().slice(0, 10)}.m3u`;
    a.click();
    URL.revokeObjectURL(url);
    toast({ title: `Exportados ${list.length} canales` });
  };

  // Filtering
  const filteredChannels = channels.filter(ch => {
    const matchSearch = !search || ch.name.toLowerCase().includes(search.toLowerCase()) || ch.category.toLowerCase().includes(search.toLowerCase());
    const matchDown = !filterDown || pingStatus[ch.id] === 'down';
    return matchSearch && matchDown;
  });

  const upCount = channels.filter(ch => pingStatus[ch.id] === 'up').length;
  const downCount = channels.filter(ch => pingStatus[ch.id] === 'down').length;
  const checkedCount = upCount + downCount;

  const getStatusIcon = (id: string) => {
    const s = pingStatus[id];
    if (s === 'checking') return <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />;
    if (s === 'up') return <Circle className="w-3.5 h-3.5 fill-green-500 text-green-500" />;
    if (s === 'down') return <Circle className="w-3.5 h-3.5 fill-destructive text-destructive" />;
    return <Circle className="w-3.5 h-3.5 text-muted-foreground/40" />;
  };

  return (
    <div className="space-y-6">
      {/* Player */}
      <AnimatePresence>
        {playingChannel && (
          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}>
            <Card className="glass-strong border-primary/20">
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <Play className="w-4 h-4 text-primary" />
                    Probando: {playingChannel.name}
                  </CardTitle>
                  <Button variant="ghost" size="sm" onClick={() => setPlayingChannel(null)}>Cerrar</Button>
                </div>
              </CardHeader>
              <CardContent>
                <div className="aspect-video rounded-lg overflow-hidden bg-black">
                  <VideoPlayer src={playingChannel.url} channelId={playingChannel.id} />
                </div>
              </CardContent>
            </Card>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Actions bar */}
      <div className="flex flex-wrap gap-2">
        <Button onClick={runHealthCheck} disabled={checking} className="gap-2">
          {checking ? <Loader2 className="w-4 h-4 animate-spin" /> : <Zap className="w-4 h-4" />}
          {checking ? 'Verificando...' : 'Check Masivo'}
        </Button>
        <Button variant="outline" onClick={() => setFilterDown(!filterDown)} className="gap-2">
          <Filter className="w-4 h-4" />
          {filterDown ? 'Mostrar todos' : 'Solo caídos'}
        </Button>
        <Button variant="outline" onClick={selectDownChannels} disabled={downCount === 0} className="gap-2">
          <AlertTriangle className="w-4 h-4" /> Seleccionar caídos
        </Button>
        <Button variant="destructive" onClick={deleteDownChannels} disabled={downCount === 0} className="gap-2">
          <Trash2 className="w-4 h-4" /> Eliminar caídos ({downCount})
        </Button>
        {selected.size > 0 && (
          <Button variant="destructive" onClick={() => deleteChannels(Array.from(selected))} className="gap-2">
            <Trash2 className="w-4 h-4" /> Eliminar seleccionados ({selected.size})
          </Button>
        )}
        <div className="flex-1" />
        <Button variant="outline" onClick={() => exportM3U(selected.size > 0)} className="gap-2">
          <Download className="w-4 h-4" />
          Exportar M3U {selected.size > 0 ? `(${selected.size})` : '(limpios)'}
        </Button>
      </div>

      {/* Summary */}
      {checkedCount > 0 && (
        <div className="flex gap-4">
          <Card className="flex-1 glass-strong">
            <CardContent className="p-4 flex items-center gap-3">
              <CheckCircle2 className="w-6 h-6 text-green-500" />
              <div>
                <p className="text-2xl font-bold">{upCount}</p>
                <p className="text-xs text-muted-foreground">Online</p>
              </div>
            </CardContent>
          </Card>
          <Card className="flex-1 glass-strong">
            <CardContent className="p-4 flex items-center gap-3">
              <XCircle className="w-6 h-6 text-destructive" />
              <div>
                <p className="text-2xl font-bold">{downCount}</p>
                <p className="text-xs text-muted-foreground">Caídos</p>
              </div>
            </CardContent>
          </Card>
          <Card className="flex-1 glass-strong">
            <CardContent className="p-4 flex items-center gap-3">
              <RefreshCw className="w-6 h-6 text-primary" />
              <div>
                <p className="text-2xl font-bold">{channels.length}</p>
                <p className="text-xs text-muted-foreground">Total</p>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <Input
          placeholder="Buscar canal o categoría..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="pl-10"
        />
      </div>

      {/* Select all */}
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Checkbox
          checked={filteredChannels.length > 0 && filteredChannels.every(c => selected.has(c.id))}
          onCheckedChange={toggleSelectAll}
        />
        <span>Seleccionar todos ({filteredChannels.length})</span>
      </div>

      {/* Channel list */}
      {loading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="w-8 h-8 animate-spin text-primary" />
        </div>
      ) : (
        <div className="space-y-1">
          {filteredChannels.map(ch => (
            <motion.div
              key={ch.id}
              layout
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className={`flex items-center gap-3 p-3 rounded-lg border transition-colors ${
                selected.has(ch.id) ? 'bg-primary/5 border-primary/20' : 'bg-card/50 border-border/30 hover:bg-accent/30'
              }`}
            >
              <Checkbox
                checked={selected.has(ch.id)}
                onCheckedChange={() => toggleSelect(ch.id)}
              />
              {getStatusIcon(ch.id)}
              {ch.logo_url && (
                <img src={ch.logo_url} alt="" className="w-8 h-8 rounded object-cover flex-shrink-0" />
              )}
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">{ch.name}</p>
                <p className="text-xs text-muted-foreground truncate">{ch.category}</p>
              </div>
              {!ch.is_active && <Badge variant="secondary" className="text-[10px]">Inactivo</Badge>}
              <Button
                variant={playingChannel?.id === ch.id ? 'default' : 'ghost'}
                size="icon"
                className="h-8 w-8 flex-shrink-0"
                onClick={() => setPlayingChannel(playingChannel?.id === ch.id ? null : ch)}
              >
                <Play className="w-4 h-4" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 flex-shrink-0 text-destructive hover:text-destructive"
                onClick={() => deleteChannels([ch.id])}
              >
                <Trash2 className="w-4 h-4" />
              </Button>
            </motion.div>
          ))}
          {filteredChannels.length === 0 && (
            <p className="text-center py-8 text-muted-foreground">No se encontraron canales</p>
          )}
        </div>
      )}
    </div>
  );
};

export default ChannelTester;
