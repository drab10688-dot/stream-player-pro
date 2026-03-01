import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { apiPost, apiGet, apiDelete } from '@/lib/api';
import { AlertTriangle, Wifi, WifiOff, RefreshCw, Trash2, Activity, Clock, Zap, Power, PowerOff, Timer, ShieldCheck, ShieldAlert, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Switch } from '@/components/ui/switch';
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
  was_auto_disabled?: boolean;
  consecutive_failures?: number;
}

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
  const [autoActions, setAutoActions] = useState<AutoActions | null>(null);
  const [autoPing, setAutoPing] = useState(false);
  const [autoPingInterval, setAutoPingInterval] = useState<ReturnType<typeof setInterval> | null>(null);

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
        const { data: fnData, error } = await supabase.functions.invoke('channel-ping', { body: { auto_manage: true } });
        if (error) throw error;
        data = fnData;
      } else {
        data = await apiPost('/api/channels/ping', { auto_manage: true });
      }

      if (data?.results) {
        setPingResults(data.results);
        setLastPing(new Date());
        setAutoActions(data.auto_actions || null);

        const offline = data.results.filter((r: PingResult) => r.status === 'offline').length;
        const actions = data.auto_actions;
        
        let description = '';
        if (actions?.disabled?.length > 0) {
          description += `Desactivados: ${actions.disabled.join(', ')}. `;
        }
        if (actions?.reactivated?.length > 0) {
          description += `Reactivados: ${actions.reactivated.join(', ')}`;
        }

        if (offline > 0) {
          toast({ title: `${offline} canal(es) caído(s)`, description: description || undefined, variant: 'destructive' });
        } else {
          toast({ title: `Todos los canales online (${data.results.length})`, description: description || undefined });
        }
        fetchLogs();
      }
    } catch {
      toast({ title: 'Error de conexión', variant: 'destructive' });
    }
    setPinging(false);
  }, [toast, fetchLogs]);

  // Auto-ping toggle
  const toggleAutoPing = useCallback((enabled: boolean) => {
    setAutoPing(enabled);
    if (enabled) {
      // Run immediately then every 5 minutes
      runPing();
      const interval = setInterval(runPing, 5 * 60 * 1000);
      setAutoPingInterval(interval);
      toast({ title: 'Auto-verificación activada', description: 'Los canales se verificarán cada 5 minutos' });
    } else {
      if (autoPingInterval) {
        clearInterval(autoPingInterval);
        setAutoPingInterval(null);
      }
      toast({ title: 'Auto-verificación desactivada' });
    }
  }, [runPing, autoPingInterval, toast]);

  useEffect(() => {
    fetchLogs();
    const channel = supabase
      .channel('channel-health-monitor')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'channel_health_logs' }, () => {
        fetchLogs();
      })
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
      if (autoPingInterval) clearInterval(autoPingInterval);
    };
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
          <div className="flex items-center gap-3">
            {/* Auto-ping toggle */}
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-secondary/30 border border-border/20">
              <Timer className="w-4 h-4 text-muted-foreground" />
              <span className="text-xs text-muted-foreground">Auto (5min)</span>
              <Switch checked={autoPing} onCheckedChange={toggleAutoPing} />
            </div>
            <Button onClick={runPing} disabled={pinging} className="gap-2">
              <RefreshCw className={`w-4 h-4 ${pinging ? 'animate-spin' : ''}`} />
              {pinging ? 'Verificando...' : 'Verificar'}
            </Button>
          </div>
        </div>

        {/* Auto-actions summary */}
        <AnimatePresence>
          {autoActions && (autoActions.disabled.length > 0 || autoActions.reactivated.length > 0) && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              className="mb-4 space-y-2"
            >
              {autoActions.disabled.length > 0 && (
                <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-destructive/10 border border-destructive/20 text-sm">
                  <PowerOff className="w-4 h-4 text-destructive shrink-0" />
                  <span className="text-destructive">
                    <strong>Auto-desactivados ({autoActions.disabled.length}):</strong> {autoActions.disabled.join(', ')}
                  </span>
                </div>
              )}
              {autoActions.reactivated.length > 0 && (
                <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-green-500/10 border border-green-500/20 text-sm">
                  <RotateCcw className="w-4 h-4 text-green-500 shrink-0" />
                  <span className="text-green-500">
                    <strong>Reactivados ({autoActions.reactivated.length}):</strong> {autoActions.reactivated.join(', ')}
                  </span>
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>

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

        {/* Info about auto-management */}
        <div className="flex items-start gap-2 px-3 py-2 rounded-xl bg-primary/5 border border-primary/10 mb-4">
          <ShieldCheck className="w-4 h-4 text-primary shrink-0 mt-0.5" />
          <p className="text-xs text-muted-foreground">
            <strong className="text-foreground">Auto-gestión:</strong> Los canales que fallen <strong>3 veces consecutivas</strong> se desactivan automáticamente del login. 
            Cuando vuelven a responder, se reactivan solos.
          </p>
        </div>

        {/* Channel status list */}
        {pingResults.length > 0 && (
          <ScrollArea className="max-h-[400px]">
            <div className="space-y-1.5">
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
                  <div className={`w-2.5 h-2.5 rounded-full shrink-0 ${
                    ch.status === 'online' ? 'bg-green-500 shadow-[0_0_6px_rgba(34,197,94,0.5)]' : 'bg-destructive shadow-[0_0_6px_rgba(239,68,68,0.5)]'
                  }`} />

                  <div className="w-8 h-8 rounded-lg overflow-hidden bg-secondary/40 shrink-0 flex items-center justify-center">
                    {ch.logo_url ? (
                      <img src={ch.logo_url} alt="" className="w-full h-full object-cover" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                    ) : (
                      <Wifi className="w-3.5 h-3.5 text-muted-foreground" />
                    )}
                  </div>

                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-foreground truncate">{ch.name}</p>
                    <p className="text-[11px] text-muted-foreground">{ch.category}</p>
                  </div>

                  {/* Failure counter for offline */}
                  {ch.status === 'offline' && (ch.consecutive_failures || 0) > 0 && (
                    <div className="flex items-center gap-1 text-xs text-amber-500 shrink-0">
                      <ShieldAlert className="w-3 h-3" />
                      <span>{(ch.consecutive_failures || 0) + 1}/3</span>
                    </div>
                  )}

                  {ch.was_auto_disabled && ch.status === 'online' && (
                    <span className="text-[10px] bg-green-500/20 text-green-500 px-1.5 py-0.5 rounded-full shrink-0">
                      Recuperado
                    </span>
                  )}

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

      {/* VPN MikroTik Guide */}
      <div className="glass-strong rounded-2xl p-5 border border-border/30">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">
            <ShieldCheck className="w-5 h-5 text-primary" />
          </div>
          <div>
            <h3 className="font-semibold text-foreground">VPN MikroTik → VPS</h3>
            <span className="text-xs text-muted-foreground">Guía de configuración para enrutar canales por VPN</span>
          </div>
        </div>
        <div className="rounded-xl bg-secondary/20 p-4 space-y-3 text-sm text-muted-foreground">
          <p><strong className="text-foreground">1. Configurar WireGuard en MikroTik:</strong></p>
          <pre className="bg-background/50 rounded-lg p-3 text-xs overflow-x-auto font-mono">{`/interface wireguard add name=wg-vps listen-port=13231
/interface wireguard peers add interface=wg-vps \\
  public-key="CLAVE_PUBLICA_VPS" \\
  endpoint-address=IP_VPS:51820 \\
  allowed-address=10.10.10.0/24
/ip address add address=10.10.10.2/24 interface=wg-vps`}</pre>

          <p><strong className="text-foreground">2. En el VPS (Ubuntu):</strong></p>
          <pre className="bg-background/50 rounded-lg p-3 text-xs overflow-x-auto font-mono">{`sudo apt install wireguard
wg genkey | tee /etc/wireguard/private.key | wg pubkey > /etc/wireguard/public.key

# /etc/wireguard/wg0.conf
[Interface]
Address = 10.10.10.1/24
ListenPort = 51820
PrivateKey = CLAVE_PRIVADA_VPS

[Peer]
PublicKey = CLAVE_PUBLICA_MIKROTIK
AllowedIPs = 10.10.10.2/32

sudo systemctl enable wg-quick@wg0
sudo systemctl start wg-quick@wg0`}</pre>

          <p><strong className="text-foreground">3. Enrutar canales por la VPN:</strong></p>
          <p>Usa las IPs internas de la VPN (10.10.10.x) como URLs de los canales en la plataforma. El tráfico pasará automáticamente por el túnel WireGuard.</p>

          <p><strong className="text-foreground">4. DNS en MikroTik (opcional):</strong></p>
          <pre className="bg-background/50 rounded-lg p-3 text-xs overflow-x-auto font-mono">{`/ip dns static add name=stream.local address=10.10.10.1`}</pre>
        </div>
      </div>
    </div>
  );
};

export default ChannelMonitor;
