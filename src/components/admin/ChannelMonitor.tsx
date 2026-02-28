import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { apiPost, apiGet, apiDelete } from '@/lib/api';
import { AlertTriangle, Wifi, WifiOff, RefreshCw, Trash2, Activity, Clock, Zap } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useToast } from '@/hooks/use-toast';
import { format } from 'date-fns';
import { motion, AnimatePresence } from 'framer-motion';

interface PingResult {
  id: string;
  name: string;
  category: string;
  logo_url: string | null;
  status: 'online' | 'offline';
  response_time: number;
  status_code: number;
  error: string | null;
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

const ChannelMonitor = () => {
  const { toast } = useToast();
  const isLovable = () => {
    const host = window.location.hostname;
    return host.includes('lovable.app') || host.includes('lovable.dev') || host === 'localhost';
  };

  const [pingResults, setPingResults] = useState<PingResult[]>([]);
  const [logs, setLogs] = useState<HealthLog[]>([]);
  const [pinging, setPinging] = useState(false);
  const [loadingLogs, setLoadingLogs] = useState(true);
  const [lastPing, setLastPing] = useState<Date | null>(null);

  const fetchLogs = useCallback(async () => {
    setLoadingLogs(true);
    try {
      if (isLovable()) {
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

  const runPing = useCallback(async () => {
    setPinging(true);
    try {
      let data: any;

      if (isLovable()) {
        const { data: fnData, error } = await supabase.functions.invoke('channel-ping', { body: {} });
        if (error) throw error;
        data = fnData;
      } else {
        data = await apiPost('/api/channels/ping', {});
      }

      if (data?.results) {
        setPingResults(data.results);
        setLastPing(new Date());
        const offline = data.results.filter((r: PingResult) => r.status === 'offline').length;
        if (offline > 0) {
          toast({ title: `${offline} canal(es) caído(s)`, variant: 'destructive' });
        } else {
          toast({ title: `Todos los canales online (${data.results.length})` });
        }
        fetchLogs();
      }
    } catch {
      toast({ title: 'Error de conexión', variant: 'destructive' });
    }
    setPinging(false);
  }, [toast, fetchLogs]);

  useEffect(() => {
    fetchLogs();
    const channel = supabase
      .channel('channel-health-monitor')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'channel_health_logs' }, () => {
        fetchLogs();
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [fetchLogs]);

  const clearLogs = async () => {
    try {
      if (isLovable()) {
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

  const online = pingResults.filter(r => r.status === 'online');
  const offline = pingResults.filter(r => r.status === 'offline');

  // Group error logs by channel
  const errorsByChannel = logs.reduce((acc, log) => {
    const name = (log.channels as any)?.name || 'Desconocido';
    if (!acc[name]) acc[name] = [];
    acc[name].push(log);
    return acc;
  }, {} as Record<string, HealthLog[]>);

  return (
    <div className="space-y-6">
      {/* Ping Control */}
      <div className="glass-strong rounded-2xl p-5 border border-border/30">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">
              <Activity className="w-5 h-5 text-primary" />
            </div>
            <div>
              <h3 className="font-semibold text-foreground">Estado de Canales</h3>
              <p className="text-xs text-muted-foreground">
                {lastPing ? `Último check: ${format(lastPing, 'HH:mm:ss')}` : 'Sin verificar aún'}
              </p>
            </div>
          </div>
          <Button onClick={runPing} disabled={pinging} className="gap-2">
            <RefreshCw className={`w-4 h-4 ${pinging ? 'animate-spin' : ''}`} />
            {pinging ? 'Verificando...' : 'Verificar canales'}
          </Button>
        </div>

        {/* Summary cards */}
        {pingResults.length > 0 && (
          <div className="grid grid-cols-3 gap-3 mb-4">
            <div className="rounded-xl bg-secondary/40 p-3 text-center">
              <p className="text-2xl font-bold text-foreground">{pingResults.length}</p>
              <p className="text-xs text-muted-foreground">Total</p>
            </div>
            <div className="rounded-xl bg-green-500/10 border border-green-500/20 p-3 text-center">
              <p className="text-2xl font-bold text-green-500">{online.length}</p>
              <p className="text-xs text-green-500/70">Online</p>
            </div>
            <div className="rounded-xl bg-destructive/10 border border-destructive/20 p-3 text-center">
              <p className="text-2xl font-bold text-destructive">{offline.length}</p>
              <p className="text-xs text-destructive/70">Caídos</p>
            </div>
          </div>
        )}

        {/* Channel status list */}
        {pingResults.length > 0 && (
          <ScrollArea className="max-h-[400px]">
            <div className="space-y-1.5">
              {/* Offline first, then online */}
              {[...offline, ...online].map((ch, i) => (
                <motion.div
                  key={ch.id}
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: i * 0.02 }}
                  className={`flex items-center gap-3 px-3 py-2.5 rounded-xl transition-colors ${
                    ch.status === 'offline'
                      ? 'bg-destructive/5 border border-destructive/15'
                      : 'bg-secondary/20 border border-transparent'
                  }`}
                >
                  {/* Status indicator */}
                  <div className={`w-2.5 h-2.5 rounded-full shrink-0 ${
                    ch.status === 'online' ? 'bg-green-500 shadow-[0_0_6px_rgba(34,197,94,0.5)]' : 'bg-destructive shadow-[0_0_6px_rgba(239,68,68,0.5)]'
                  }`} />

                  {/* Logo */}
                  <div className="w-8 h-8 rounded-lg overflow-hidden bg-secondary/40 shrink-0 flex items-center justify-center">
                    {ch.logo_url ? (
                      <img src={ch.logo_url} alt="" className="w-full h-full object-cover" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                    ) : (
                      <Wifi className="w-3.5 h-3.5 text-muted-foreground" />
                    )}
                  </div>

                  {/* Info */}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-foreground truncate">{ch.name}</p>
                    <p className="text-[11px] text-muted-foreground">{ch.category}</p>
                  </div>

                  {/* Response time / Error */}
                  {ch.status === 'online' ? (
                    <div className="flex items-center gap-1 text-xs text-green-500/80 shrink-0">
                      <Zap className="w-3 h-3" />
                      <span>{ch.response_time}ms</span>
                    </div>
                  ) : (
                    <div className="flex items-center gap-1 text-xs text-destructive/80 shrink-0">
                      <WifiOff className="w-3 h-3" />
                      <span className="truncate max-w-[120px]">{ch.error || 'Sin respuesta'}</span>
                    </div>
                  )}
                </motion.div>
              ))}
            </div>
          </ScrollArea>
        )}
      </div>

      {/* Error History */}
      <div className="glass-strong rounded-2xl p-5 border border-border/30">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-destructive/10 flex items-center justify-center">
              <AlertTriangle className="w-5 h-5 text-destructive" />
            </div>
            <div>
              <h3 className="font-semibold text-foreground">Historial de Errores</h3>
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
    </div>
  );
};

export default ChannelMonitor;
