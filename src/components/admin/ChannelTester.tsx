import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useToast } from '@/hooks/use-toast';
import { motion, AnimatePresence } from 'framer-motion';
import VideoPlayer from '@/components/VideoPlayer';
import { format } from 'date-fns';
import {
  Play, Trash2, Download, Search, CheckCircle2, XCircle,
  Loader2, RefreshCw, AlertTriangle, Circle, Zap, Filter,
  Timer, ShieldCheck, ShieldAlert, PowerOff, RotateCcw,
  Activity, Clock, WifiOff, Wifi
} from 'lucide-react';
import { apiPost, apiGet, apiDelete } from '@/lib/api';

const isLovablePreview = () => {
  const host = window.location.hostname;
  return host.includes('lovable.app') || host.includes('lovable.dev') || host === 'localhost';
};

interface Channel {
  id: string;
  name: string;
  url: string;
  category: string;
  logo_url: string | null;
  is_active: boolean;
}

type PingStatus = 'unknown' | 'checking' | 'up' | 'down';

interface AutoActions {
  disabled: string[];
  reactivated: string[];
}

interface HealthLog {
  id: string;
  channel_id: string;
  status: string;
  error_message: string | null;
  checked_at: string;
  checked_by: string | null;
  channels?: { name: string } | null;
}

interface AutoPingStatus {
  running: boolean;
  interval_minutes: number;
  last_result: {
    timestamp: string;
    total: number;
    online: number;
    offline: number;
    disabled: string[];
    reactivated: string[];
  } | null;
}

interface PingResult {
  id: string;
  name: string;
  status: 'online' | 'offline';
  response_time: number;
  error: string | null;
  was_auto_disabled?: boolean;
  consecutive_failures?: number;
}

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

  // --- Monitor state (merged from ChannelMonitor) ---
  const [autoActions, setAutoActions] = useState<AutoActions | null>(null);
  const [autoPing, setAutoPing] = useState(false);
  const [autoPingInterval, setAutoPingInterval] = useState<ReturnType<typeof setInterval> | null>(null);
  const [serverAutoPing, setServerAutoPing] = useState<AutoPingStatus | null>(null);
  const [togglingServer, setTogglingServer] = useState(false);
  const [logs, setLogs] = useState<HealthLog[]>([]);
  const [loadingLogs, setLoadingLogs] = useState(true);
  const [pingResults, setPingResults] = useState<PingResult[]>([]);
  const [showHistory, setShowHistory] = useState(false);

  // --- Fetch channels ---
  const fetchChannels = useCallback(async () => {
    setLoading(true);
    try {
      if (isLovablePreview()) {
        const { data, error } = await supabase.from('channels').select('id, name, url, category, logo_url, is_active');
        if (error) throw error;
        setChannels(data || []);
      } else {
        const data = await apiGet('/api/channels');
        setChannels(data);
      }
    } catch (err: any) {
      toast({ title: 'Error cargando canales', description: err.message, variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  // --- Fetch health logs ---
  const fetchLogs = useCallback(async () => {
    setLoadingLogs(true);
    try {
      if (isLovablePreview()) {
        const { data } = await supabase
          .from('channel_health_logs')
          .select('*, channels(name)')
          .order('checked_at', { ascending: false })
          .limit(50);
        setLogs(data || []);
      } else {
        const data = await apiGet('/api/channel-health-logs');
        setLogs(data || []);
      }
    } catch {
      // ignore
    }
    setLoadingLogs(false);
  }, []);

  // --- Fetch server auto-ping status ---
  const fetchServerAutoPingStatus = useCallback(async () => {
    if (isLovablePreview()) return;
    try {
      const status = await apiGet('/api/auto-ping/status');
      setServerAutoPing(status);
      setAutoPing(status.running);
    } catch {
      // Server might not support it yet
    }
  }, []);

  useEffect(() => {
    fetchChannels();
    fetchLogs();
    fetchServerAutoPingStatus();

    const channel = supabase
      .channel('channel-health-monitor')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'channel_health_logs' }, () => {
        fetchLogs();
      })
      .subscribe();

    const statusInterval = !isLovablePreview() ? setInterval(fetchServerAutoPingStatus, 30000) : null;

    return () => {
      supabase.removeChannel(channel);
      if (statusInterval) clearInterval(statusInterval);
    };
  }, [fetchChannels, fetchLogs, fetchServerAutoPingStatus]);

  // Cleanup auto-ping interval
  useEffect(() => {
    return () => {
      if (autoPingInterval) clearInterval(autoPingInterval);
    };
  }, [autoPingInterval]);

  // --- Health check (ping all) ---
  const runHealthCheck = useCallback(async () => {
    setChecking(true);
    const initial: Record<string, PingStatus> = {};
    channels.forEach(ch => { initial[ch.id] = 'checking'; });
    setPingStatus(initial);

    try {
      let data: any;
      if (isLovablePreview()) {
        const { data: fnData, error } = await supabase.functions.invoke('channel-ping', {
          body: { auto_manage: true }
        });
        if (error) throw error;
        data = fnData;
      } else {
        data = await apiPost('/api/channels/ping', { auto_manage: true });
      }

      const newStatus: Record<string, PingStatus> = {};
      const results: PingResult[] = data.results || [];
      results.forEach((r: any) => {
        newStatus[r.id] = r.status === 'online' ? 'up' : 'down';
      });
      setPingStatus(newStatus);
      setPingResults(results);
      setAutoActions(data.auto_actions || null);

      const offline = results.filter(r => r.status === 'offline').length;
      const actions = data.auto_actions;
      let description = '';
      if (actions?.disabled?.length > 0) description += `Desactivados: ${actions.disabled.join(', ')}. `;
      if (actions?.reactivated?.length > 0) description += `Reactivados: ${actions.reactivated.join(', ')}`;

      if (offline > 0) {
        toast({ title: `${offline} canal(es) caído(s)`, description: description || undefined, variant: 'destructive' });
      } else {
        toast({ title: `Todos los canales online (${results.length})`, description: description || undefined });
      }
      fetchLogs();
    } catch (err: any) {
      toast({ title: 'Error en health check', description: err.message, variant: 'destructive' });
    } finally {
      setChecking(false);
    }
  }, [channels, toast, fetchLogs]);

  // --- Toggle auto-ping ---
  const toggleAutoPing = useCallback(async (enabled: boolean) => {
    if (!isLovablePreview()) {
      setTogglingServer(true);
      try {
        if (enabled) {
          await apiPost('/api/auto-ping/start', { interval_minutes: 5 });
          toast({ title: 'Auto-ping activado en servidor', description: 'Funciona 24/7, incluso sin sesión abierta' });
        } else {
          await apiPost('/api/auto-ping/stop', {});
          toast({ title: 'Auto-ping detenido en servidor' });
        }
        setAutoPing(enabled);
        await fetchServerAutoPingStatus();
      } catch (err: any) {
        toast({ title: 'Error', description: err.message, variant: 'destructive' });
      }
      setTogglingServer(false);
    } else {
      setAutoPing(enabled);
      if (enabled) {
        runHealthCheck();
        const interval = setInterval(runHealthCheck, 5 * 60 * 1000);
        setAutoPingInterval(interval);
        toast({ title: 'Auto-verificación activada', description: 'Los canales se verificarán cada 5 minutos' });
      } else {
        if (autoPingInterval) {
          clearInterval(autoPingInterval);
          setAutoPingInterval(null);
        }
        toast({ title: 'Auto-verificación desactivada' });
      }
    }
  }, [runHealthCheck, autoPingInterval, toast, fetchServerAutoPingStatus]);

  // --- Clear health logs ---
  const clearLogs = async () => {
    try {
      if (isLovablePreview()) {
        const { error } = await supabase.from('channel_health_logs').delete().neq('id', '00000000-0000-0000-0000-000000000000');
        if (error) throw error;
      } else {
        await apiDelete('/api/channel-health-logs');
      }
      setLogs([]);
      toast({ title: 'Logs limpiados' });
    } catch (err: any) {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    }
  };

  // --- Selection helpers ---
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

  // --- Delete channels ---
  const deleteChannels = async (ids: string[]) => {
    if (!ids.length) return;
    if (!confirm(`¿Eliminar ${ids.length} canal(es)? Esta acción no se puede deshacer.`)) return;
    try {
      if (isLovablePreview()) {
        const { error } = await supabase.from('channels').delete().in('id', ids);
        if (error) throw error;
      } else {
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

  // --- Export M3U ---
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

  // --- Filtering ---
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

  const errorsByChannel = logs.reduce((acc, log) => {
    const name = (log.channels as any)?.name || 'Desconocido';
    if (!acc[name]) acc[name] = [];
    acc[name].push(log);
    return acc;
  }, {} as Record<string, HealthLog[]>);

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

      {/* Auto-ping controls */}
      <div className="glass-strong rounded-2xl p-4 border border-border/30">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-primary/10 flex items-center justify-center">
              <Activity className="w-4 h-4 text-primary" />
            </div>
            <div>
              <h3 className="font-semibold text-sm text-foreground">Auto-gestión de canales</h3>
              <p className="text-[11px] text-muted-foreground">
                Canales con 3 fallos consecutivos se desactivan automáticamente
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <div className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border ${autoPing ? 'bg-primary/10 border-primary/30' : 'bg-secondary/30 border-border/20'}`}>
              <Timer className={`w-4 h-4 ${autoPing ? 'text-primary' : 'text-muted-foreground'}`} />
              <span className={`text-xs ${autoPing ? 'text-primary font-semibold' : 'text-muted-foreground'}`}>
                {autoPing ? 'Auto-ping activo' : 'Auto (5min)'}
              </span>
              {autoPing && !isLovablePreview() && (
                <span className="text-[10px] text-primary/70">24/7</span>
              )}
              <Switch checked={autoPing} onCheckedChange={toggleAutoPing} disabled={togglingServer} />
            </div>
          </div>
        </div>

        {/* Server auto-ping status */}
        {serverAutoPing?.running && serverAutoPing.last_result && (
          <div className="flex items-center gap-3 px-3 py-2 rounded-xl bg-primary/5 border border-primary/20 mt-3">
            <CheckCircle2 className="w-4 h-4 text-primary shrink-0 animate-pulse" />
            <p className="text-[11px] text-muted-foreground">
              Último: {new Date(serverAutoPing.last_result.timestamp).toLocaleTimeString()} —{' '}
              {serverAutoPing.last_result.online}/{serverAutoPing.last_result.total} online
              {serverAutoPing.last_result.disabled.length > 0 && ` · ${serverAutoPing.last_result.disabled.length} desactivados`}
              {serverAutoPing.last_result.reactivated.length > 0 && ` · ${serverAutoPing.last_result.reactivated.length} reactivados`}
            </p>
          </div>
        )}

        {/* Auto-actions feedback */}
        <AnimatePresence>
          {autoActions && (autoActions.disabled.length > 0 || autoActions.reactivated.length > 0) && (
            <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="mt-3 space-y-2">
              {autoActions.disabled.length > 0 && (
                <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-destructive/10 border border-destructive/20 text-sm">
                  <PowerOff className="w-4 h-4 text-destructive shrink-0" />
                  <span className="text-destructive text-xs">
                    <strong>Auto-desactivados:</strong> {autoActions.disabled.join(', ')}
                  </span>
                </div>
              )}
              {autoActions.reactivated.length > 0 && (
                <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-green-500/10 border border-green-500/20 text-sm">
                  <RotateCcw className="w-4 h-4 text-green-500 shrink-0" />
                  <span className="text-green-500 text-xs">
                    <strong>Reactivados:</strong> {autoActions.reactivated.join(', ')}
                  </span>
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>

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
        <Button variant="outline" onClick={() => setShowHistory(!showHistory)} className="gap-2">
          <Clock className="w-4 h-4" />
          {showHistory ? 'Ocultar historial' : 'Historial errores'}
          {logs.length > 0 && <Badge variant="secondary" className="text-[10px] ml-1">{logs.length}</Badge>}
        </Button>
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

      {/* Error History (collapsible) */}
      <AnimatePresence>
        {showHistory && (
          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}>
            <div className="glass-strong rounded-2xl p-5 border border-border/30">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-xl bg-destructive/10 flex items-center justify-center">
                    <AlertTriangle className="w-4 h-4 text-destructive" />
                  </div>
                  <div>
                    <h3 className="font-semibold text-sm text-foreground">Historial de Errores</h3>
                    <span className="text-xs text-muted-foreground">{logs.length} reportes</span>
                  </div>
                </div>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" onClick={fetchLogs} disabled={loadingLogs}>
                    <RefreshCw className={`w-4 h-4 mr-1 ${loadingLogs ? 'animate-spin' : ''}`} />
                    Actualizar
                  </Button>
                  {logs.length > 0 && (
                    <Button variant="destructive" size="sm" onClick={clearLogs}>
                      <Trash2 className="w-4 h-4 mr-1" />
                      Limpiar
                    </Button>
                  )}
                </div>
              </div>

              {logs.length === 0 ? (
                <div className="rounded-xl bg-secondary/20 p-8 text-center">
                  <Wifi className="w-8 h-8 text-primary mx-auto mb-2" />
                  <p className="text-muted-foreground text-sm">Sin errores registrados</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {Object.entries(errorsByChannel).map(([channelName, channelLogs]) => (
                    <div key={channelName} className="rounded-xl border border-border/30 overflow-hidden">
                      <div className="flex items-center gap-3 px-4 py-3 bg-secondary/20 border-b border-border/20">
                        <WifiOff className="w-4 h-4 text-destructive shrink-0" />
                        <span className="font-medium text-foreground text-sm">{channelName}</span>
                        <span className="text-xs bg-destructive/20 text-destructive px-2 py-0.5 rounded-full ml-auto">
                          {channelLogs.length}
                        </span>
                      </div>
                      <ScrollArea className={channelLogs.length > 3 ? 'max-h-32' : ''}>
                        <div className="divide-y divide-border/10">
                          {channelLogs.slice(0, 10).map(log => (
                            <div key={log.id} className="px-4 py-2 flex items-start gap-3 text-xs">
                              <Clock className="w-3 h-3 text-muted-foreground shrink-0 mt-0.5" />
                              <span className="text-muted-foreground shrink-0">
                                {format(new Date(log.checked_at), 'dd/MM HH:mm')}
                              </span>
                              <span className="text-foreground/80 flex-1">{log.error_message || 'Error desconocido'}</span>
                              <span className="text-muted-foreground/50 shrink-0">{log.checked_by || ''}</span>
                            </div>
                          ))}
                        </div>
                      </ScrollArea>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

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
          {filteredChannels.map(ch => {
            const result = pingResults.find(r => r.id === ch.id);
            return (
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
                {/* Failure counter */}
                {result && result.status === 'offline' && (result.consecutive_failures || 0) > 0 && (
                  <div className="flex items-center gap-1 text-xs text-amber-500 shrink-0">
                    <ShieldAlert className="w-3 h-3" />
                    <span>{(result.consecutive_failures || 0) + 1}/3</span>
                  </div>
                )}
                {result?.was_auto_disabled && result.status === 'online' && (
                  <Badge variant="outline" className="text-[10px] border-green-500/30 text-green-500">Recuperado</Badge>
                )}
                {/* Response time */}
                {result && result.status === 'online' && (
                  <span className="text-[11px] text-green-500/80 flex items-center gap-1 shrink-0">
                    <Zap className="w-3 h-3" />{result.response_time}ms
                  </span>
                )}
                {result && result.status === 'offline' && (
                  <span className="text-[11px] text-destructive/80 truncate max-w-[100px] shrink-0">
                    {result.error || 'Sin respuesta'}
                  </span>
                )}
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
            );
          })}
          {filteredChannels.length === 0 && (
            <p className="text-center py-8 text-muted-foreground">No se encontraron canales</p>
          )}
        </div>
      )}
    </div>
  );
};

export default ChannelTester;
