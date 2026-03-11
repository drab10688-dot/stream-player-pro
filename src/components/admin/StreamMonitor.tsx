import { useState, useEffect, useRef } from 'react';
import { apiGet, apiPost } from '@/lib/api';
import { useToast } from '@/hooks/use-toast';
import { Radio, Wifi, Server, Users, RefreshCw, Activity, ArrowDown, Play, Square, Eye, EyeOff, RotateCcw, AlertTriangle, Cpu, HardDrive, Disc } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import { motion, AnimatePresence } from 'framer-motion';

interface ActiveStream {
  channel_id: string;
  channel_name: string;
  type: string;
  stream_mode: string;
  clients: number;
  ready: boolean;
  keep_alive: boolean;
  uptime_seconds: number;
  source_url: string;
  bandwidth_bps: number;
  bandwidth_in_bps: number;
  cpu_percent: number;
  mem_mb: number;
  retry_count: number;
  max_retries: number;
}

interface SystemStats {
  cpu_percent: number;
  cpu_cores: number;
  load_avg: number[];
  mem_total_mb: number;
  mem_used_mb: number;
  mem_percent: number;
}

interface FailureAlert {
  channel_id: string;
  channel_name: string;
  retry_count: number;
  type: string;
}

interface StreamsData {
  total_streams: number;
  total_clients_watching: number;
  origin_connections: number;
  streams: ActiveStream[];
  system?: SystemStats;
  alerts?: FailureAlert[];
}

interface AllChannel {
  id: string;
  name: string;
  url: string;
  category: string;
  is_active: boolean;
  keep_alive: boolean;
  is_streaming: boolean;
  stream_type: string | null;
  stream_ready: boolean;
  stream_clients: number;
  bandwidth_in_bps: number;
  bandwidth_bps: number;
  uptime_seconds: number;
}

const formatUptime = (seconds: number) => {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return `${h}h ${m}m`;
};

const formatBandwidth = (bytesPerSec: number) => {
  const mbps = (bytesPerSec * 8) / (1024 * 1024);
  if (mbps >= 1) return `${mbps.toFixed(1)} Mbps`;
  const kbps = (bytesPerSec * 8) / 1024;
  if (kbps >= 1) return `${kbps.toFixed(0)} Kbps`;
  return '0 Kbps';
};

const getBandwidthColor = (bytesPerSec: number) => {
  const mbps = (bytesPerSec * 8) / (1024 * 1024);
  if (mbps >= 10) return 'text-red-400';
  if (mbps >= 5) return 'text-orange-400';
  if (mbps >= 1) return 'text-yellow-300';
  return 'text-emerald-400';
};

const getModeIcon = (mode: string) => {
  switch (mode) {
    case 'buffer': return <Disc className="w-3 h-3" />;
    case 'transcode': return <Cpu className="w-3 h-3" />;
    default: return <Radio className="w-3 h-3" />;
  }
};

const getModeLabel = (mode: string) => {
  switch (mode) {
    case 'buffer': return 'Buffer';
    case 'transcode': return 'Transcode';
    default: return 'Directo';
  }
};

const getModeColor = (mode: string) => {
  switch (mode) {
    case 'buffer': return 'border-amber-500/30 text-amber-400';
    case 'transcode': return 'border-cyan-500/30 text-cyan-400';
    default: return 'border-primary/30 text-primary';
  }
};

const StreamMonitor = () => {
  const { toast } = useToast();
  const [data, setData] = useState<StreamsData | null>(null);
  const [allChannels, setAllChannels] = useState<AllChannel[]>([]);
  const [loading, setLoading] = useState(true);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [showAll, setShowAll] = useState(false);
  const [startingChannels, setStartingChannels] = useState<Set<string>>(new Set());
  const [stoppingChannels, setStoppingChannels] = useState<Set<string>>(new Set());
  const [restartingChannels, setRestartingChannels] = useState<Set<string>>(new Set());
  const intervalRef = useRef<ReturnType<typeof setInterval>>();

  const fetchStreams = async () => {
    try {
      const result = await apiGet('/api/streams/active');
      setData(result);
      if (showAll) {
        const allResult = await apiGet('/api/streams/all-channels');
        setAllChannels(allResult.channels || []);
      }
    } catch (err: any) {
      if (!autoRefresh) {
        toast({ title: 'Error', description: err.message, variant: 'destructive' });
      }
    }
    setLoading(false);
  };

  const handleStart = async (channelId: string) => {
    setStartingChannels(prev => new Set(prev).add(channelId));
    try {
      const result = await apiPost(`/api/streams/start/${channelId}`, {});
      toast({ title: '▶️ Stream Iniciado', description: result.message });
      await fetchStreams();
    } catch (err: any) {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    }
    setStartingChannels(prev => { const s = new Set(prev); s.delete(channelId); return s; });
  };

  const handleStop = async (channelId: string) => {
    setStoppingChannels(prev => new Set(prev).add(channelId));
    try {
      const result = await apiPost(`/api/streams/stop/${channelId}`, {});
      toast({ title: '⏹️ Stream Detenido', description: result.message });
      await fetchStreams();
    } catch (err: any) {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    }
    setStoppingChannels(prev => { const s = new Set(prev); s.delete(channelId); return s; });
  };

  const handleRestart = async (channelId: string) => {
    setRestartingChannels(prev => new Set(prev).add(channelId));
    try {
      const result = await apiPost(`/api/streams/restart/${channelId}`, {});
      toast({ title: '🔄 Proceso Reiniciado', description: result.message });
      await fetchStreams();
    } catch (err: any) {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    }
    setRestartingChannels(prev => { const s = new Set(prev); s.delete(channelId); return s; });
  };

  useEffect(() => {
    fetchStreams();
    if (autoRefresh) {
      intervalRef.current = setInterval(fetchStreams, 5000);
    }
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [autoRefresh, showAll]);

  const sys = data?.system;
  const alerts = data?.alerts || [];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h2 className="font-display font-semibold text-xl text-foreground flex items-center gap-2">
          <Radio className="w-5 h-5 text-primary" />
          Streams Activos
        </h2>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowAll(!showAll)}
            className={`gap-1.5 text-xs ${showAll ? 'border-primary text-primary' : 'border-border text-muted-foreground'}`}
          >
            {showAll ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
            {showAll ? 'Todos' : 'Solo Activos'}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setAutoRefresh(!autoRefresh)}
            className={`gap-1.5 text-xs ${autoRefresh ? 'border-primary text-primary' : 'border-border text-muted-foreground'}`}
          >
            <Activity className={`w-3.5 h-3.5 ${autoRefresh ? 'animate-pulse' : ''}`} />
            {autoRefresh ? 'Auto (5s)' : 'Manual'}
          </Button>
          <Button variant="outline" size="sm" onClick={fetchStreams} className="gap-1.5 text-xs border-border text-foreground">
            <RefreshCw className="w-3.5 h-3.5" /> Refrescar
          </Button>
        </div>
      </div>

      {/* ── Failure Alerts ── */}
      <AnimatePresence>
        {alerts.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="rounded-xl border border-destructive/50 bg-destructive/10 p-4 space-y-2"
          >
            <div className="flex items-center gap-2 text-destructive">
              <AlertTriangle className="w-5 h-5" />
              <h3 className="font-semibold text-sm">Alertas de Fallos ({alerts.length})</h3>
            </div>
            {alerts.map(a => (
              <div key={a.channel_id} className="flex items-center justify-between gap-3 text-sm">
                <span className="text-destructive font-medium">{a.channel_name}</span>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground">{a.retry_count} reintentos fallidos</span>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleRestart(a.channel_id)}
                    disabled={restartingChannels.has(a.channel_id)}
                    className="gap-1 text-xs border-destructive/30 text-destructive hover:bg-destructive/10 h-7 px-2"
                  >
                    <RotateCcw className="w-3 h-3" />
                    {restartingChannels.has(a.channel_id) ? '...' : 'Reiniciar'}
                  </Button>
                </div>
              </div>
            ))}
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Global System Load ── */}
      {sys && (
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="glass rounded-xl p-4 space-y-3">
          <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
            <Server className="w-4 h-4 text-primary" /> Carga Global del VPS
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <div className="flex justify-between text-xs">
                <span className="text-muted-foreground flex items-center gap-1"><Cpu className="w-3 h-3" /> CPU ({sys.cpu_cores} núcleos)</span>
                <span className={`font-bold ${sys.cpu_percent > 80 ? 'text-red-400' : sys.cpu_percent > 50 ? 'text-amber-400' : 'text-emerald-400'}`}>
                  {sys.cpu_percent}%
                </span>
              </div>
              <Progress value={sys.cpu_percent} className="h-2.5" />
              <p className="text-[10px] text-muted-foreground">Load: {sys.load_avg.map(l => l.toFixed(2)).join(' / ')}</p>
            </div>
            <div className="space-y-1.5">
              <div className="flex justify-between text-xs">
                <span className="text-muted-foreground flex items-center gap-1"><HardDrive className="w-3 h-3" /> RAM</span>
                <span className={`font-bold ${sys.mem_percent > 85 ? 'text-red-400' : sys.mem_percent > 60 ? 'text-amber-400' : 'text-emerald-400'}`}>
                  {sys.mem_used_mb} / {sys.mem_total_mb} MB ({sys.mem_percent}%)
                </span>
              </div>
              <Progress value={sys.mem_percent} className="h-2.5" />
            </div>
          </div>
        </motion.div>
      )}

      {/* Summary Cards */}
      {data && (
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="glass rounded-xl p-4 text-center">
            <Server className="w-6 h-6 text-primary mx-auto mb-1" />
            <p className="text-2xl font-bold text-foreground">{data.origin_connections}</p>
            <p className="text-xs text-muted-foreground">Conexiones al Origen</p>
          </motion.div>
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }} className="glass rounded-xl p-4 text-center">
            <Radio className="w-6 h-6 text-emerald-400 mx-auto mb-1" />
            <p className="text-2xl font-bold text-foreground">{data.total_streams}</p>
            <p className="text-xs text-muted-foreground">Canales en Restream</p>
          </motion.div>
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }} className="glass rounded-xl p-4 text-center">
            <Users className="w-6 h-6 text-blue-400 mx-auto mb-1" />
            <p className="text-2xl font-bold text-foreground">{data.total_clients_watching}</p>
            <p className="text-xs text-muted-foreground">Clientes Viendo</p>
          </motion.div>
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 }} className="glass rounded-xl p-4 text-center">
            <ArrowDown className="w-6 h-6 text-orange-400 mx-auto mb-1" />
            <p className="text-2xl font-bold text-foreground">
              {formatBandwidth(data.streams.reduce((sum, s) => sum + (s.bandwidth_in_bps || 0), 0))}
            </p>
            <p className="text-xs text-muted-foreground">Entrada (Origen)</p>
          </motion.div>
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }} className="glass rounded-xl p-4 text-center">
            <ArrowDown className="w-6 h-6 text-cyan-400 mx-auto mb-1 rotate-180" />
            <p className="text-2xl font-bold text-foreground">
              {formatBandwidth(data.streams.reduce((sum, s) => sum + (s.bandwidth_bps || 0), 0))}
            </p>
            <p className="text-xs text-muted-foreground">Salida (Clientes)</p>
          </motion.div>
        </div>
      )}

      {/* Important Note */}
      <div className="glass rounded-xl p-4 border border-primary/20">
        <div className="flex items-start gap-3">
          <div className="w-8 h-8 rounded-lg bg-primary/15 flex items-center justify-center shrink-0 mt-0.5">
            <Wifi className="w-4 h-4 text-primary" />
          </div>
          <div>
            <p className="text-sm font-semibold text-foreground">1 conexión al origen = 1 canal</p>
            <p className="text-xs text-muted-foreground mt-1">
              Sin importar cuántos clientes vean el mismo canal, solo se mantiene <strong className="text-foreground">una única conexión</strong> al servidor de origen. 
              FFmpeg comparte los segmentos HLS entre todos los espectadores.
            </p>
          </div>
        </div>
      </div>

      {/* Stream/Channel List */}
      {loading ? (
        <div className="text-center py-12 text-muted-foreground">Cargando...</div>
      ) : showAll ? (
        /* ALL CHANNELS VIEW */
        <div className="space-y-2">
          {allChannels.length === 0 ? (
            <div className="glass rounded-xl p-12 text-center">
              <Radio className="w-12 h-12 text-muted-foreground mx-auto mb-3" />
              <p className="text-muted-foreground">No hay canales configurados.</p>
            </div>
          ) : (
            allChannels.map((ch, i) => (
              <motion.div
                key={ch.id}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: i * 0.02 }}
                className={`glass rounded-xl p-3 ${!ch.is_active ? 'opacity-50' : ''}`}
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-3 min-w-0 flex-1">
                    <div className={`w-3 h-3 rounded-full shrink-0 ${
                      ch.is_streaming && ch.stream_ready ? 'bg-emerald-400 animate-pulse' : 
                      ch.is_streaming ? 'bg-yellow-400 animate-pulse' : 
                      'bg-muted-foreground/30'
                    }`} />
                    <div className="min-w-0">
                      <p className="font-semibold text-foreground text-sm truncate">{ch.name}</p>
                      <p className="text-[10px] text-muted-foreground">{ch.category}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    {ch.is_streaming && (
                      <>
                        <span className={`inline-block px-2 py-0.5 rounded text-[10px] font-mono ${
                          ch.stream_type === 'ffmpeg' 
                            ? 'bg-purple-500/20 text-purple-300' 
                            : 'bg-blue-500/20 text-blue-300'
                        }`}>
                          {ch.stream_type === 'ffmpeg' ? 'TS→HLS' : 'HLS Proxy'}
                        </span>
                        <div className="text-center min-w-[55px]">
                          <p className={`text-xs font-bold font-mono ${getBandwidthColor(ch.bandwidth_in_bps)}`}>
                            ↓ {formatBandwidth(ch.bandwidth_in_bps)}
                          </p>
                        </div>
                        <div className="text-center min-w-[55px]">
                          <p className={`text-xs font-bold font-mono ${getBandwidthColor(ch.bandwidth_bps)}`}>
                            ↑ {formatBandwidth(ch.bandwidth_bps)}
                          </p>
                        </div>
                        <div className="text-center min-w-[30px]">
                          <p className="text-sm font-bold text-foreground">{ch.stream_clients}</p>
                          <p className="text-[10px] text-muted-foreground">usr</p>
                        </div>
                        <p className="text-xs text-muted-foreground font-mono min-w-[40px] text-center">{formatUptime(ch.uptime_seconds)}</p>
                      </>
                    )}
                    {ch.is_active && (
                      ch.is_streaming ? (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleStop(ch.id)}
                          disabled={stoppingChannels.has(ch.id)}
                          className="gap-1 text-xs border-red-500/30 text-red-400 hover:bg-red-500/10 h-7 px-2"
                        >
                          <Square className="w-3 h-3" />
                          {stoppingChannels.has(ch.id) ? '...' : 'Stop'}
                        </Button>
                      ) : (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleStart(ch.id)}
                          disabled={startingChannels.has(ch.id)}
                          className="gap-1 text-xs border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/10 h-7 px-2"
                        >
                          <Play className="w-3 h-3" />
                          {startingChannels.has(ch.id) ? '...' : 'Start'}
                        </Button>
                      )
                    )}
                  </div>
                </div>
              </motion.div>
            ))
          )}
        </div>
      ) : (
        /* ACTIVE STREAMS ONLY VIEW */
        !data || data.streams.length === 0 ? (
          <div className="glass rounded-xl p-12 text-center">
            <Radio className="w-12 h-12 text-muted-foreground mx-auto mb-3" />
            <p className="text-muted-foreground">No hay streams activos. Se activarán cuando un cliente reproduzca un canal.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {data.streams.map((stream, i) => (
              <motion.div
                key={stream.channel_id}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: i * 0.03 }}
                className={`glass rounded-xl p-4 ${stream.retry_count >= 3 ? 'ring-1 ring-destructive/50' : ''}`}
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-3 min-w-0 flex-1">
                    <div className={`w-3 h-3 rounded-full shrink-0 ${stream.ready ? 'bg-emerald-400 animate-pulse' : 'bg-yellow-400'}`} />
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="font-semibold text-foreground text-sm truncate">{stream.channel_name}</p>
                        <Badge variant="outline" className={`text-[10px] py-0 px-1.5 gap-0.5 ${getModeColor(stream.stream_mode)}`}>
                          {getModeIcon(stream.stream_mode)}
                          {getModeLabel(stream.stream_mode)}
                        </Badge>
                      </div>
                      <p className="text-xs text-muted-foreground truncate">{stream.source_url}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 shrink-0 flex-wrap justify-end">
                    <div className="text-center">
                      <span className={`inline-block px-2 py-0.5 rounded text-[10px] font-mono ${
                        stream.type?.includes('ffmpeg')
                          ? 'bg-purple-500/20 text-purple-300' 
                          : 'bg-blue-500/20 text-blue-300'
                      }`}>
                        {stream.type?.includes('ffmpeg') ? (stream.type === 'ffmpeg-buffer' ? 'Buffer' : 'FFmpeg') : 'HLS Proxy'}
                      </span>
                      {stream.keep_alive && (
                        <span className="inline-block px-1.5 py-0.5 rounded text-[10px] font-mono bg-green-500/20 text-green-300 ml-1">KA</span>
                      )}
                    </div>
                    {/* Per-process CPU/RAM */}
                    {(stream.cpu_percent > 0 || stream.mem_mb > 0) && (
                      <div className="text-center min-w-[70px]">
                        <p className={`text-[10px] font-mono ${stream.cpu_percent > 80 ? 'text-red-400' : stream.cpu_percent > 40 ? 'text-amber-400' : 'text-emerald-400'}`}>
                          CPU {stream.cpu_percent.toFixed(1)}%
                        </p>
                        <p className="text-[10px] font-mono text-muted-foreground">{stream.mem_mb} MB</p>
                      </div>
                    )}
                    <div className="text-center min-w-[60px]">
                      <p className={`text-xs font-bold font-mono ${getBandwidthColor(stream.bandwidth_in_bps || 0)}`}>
                        ↓ {formatBandwidth(stream.bandwidth_in_bps || 0)}
                      </p>
                      <p className="text-[10px] text-muted-foreground">entrada</p>
                    </div>
                    <div className="text-center min-w-[60px]">
                      <p className={`text-xs font-bold font-mono ${getBandwidthColor(stream.bandwidth_bps || 0)}`}>
                        ↑ {formatBandwidth(stream.bandwidth_bps || 0)}
                      </p>
                      <p className="text-[10px] text-muted-foreground">salida</p>
                    </div>
                    <div className="text-center">
                      <p className="text-sm font-bold text-foreground">{stream.clients}</p>
                      <p className="text-[10px] text-muted-foreground">clientes</p>
                    </div>
                    <div className="text-center">
                      <p className="text-xs text-muted-foreground font-mono">{formatUptime(stream.uptime_seconds)}</p>
                    </div>
                    <div className="flex gap-1">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleRestart(stream.channel_id)}
                        disabled={restartingChannels.has(stream.channel_id)}
                        className="gap-1 text-xs border-amber-500/30 text-amber-400 hover:bg-amber-500/10 h-7 px-2"
                        title="Reiniciar proceso"
                      >
                        <RotateCcw className={`w-3 h-3 ${restartingChannels.has(stream.channel_id) ? 'animate-spin' : ''}`} />
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleStop(stream.channel_id)}
                        disabled={stoppingChannels.has(stream.channel_id)}
                        className="gap-1 text-xs border-red-500/30 text-red-400 hover:bg-red-500/10 h-7 px-2"
                      >
                        <Square className="w-3 h-3" />
                        {stoppingChannels.has(stream.channel_id) ? '...' : 'Stop'}
                      </Button>
                    </div>
                  </div>
                </div>
                {/* Retry warning */}
                {stream.retry_count >= 3 && (
                  <div className="mt-2 flex items-center gap-2 text-xs text-destructive">
                    <AlertTriangle className="w-3.5 h-3.5" />
                    <span>{stream.retry_count} reintentos fallidos — considere reiniciar manualmente</span>
                  </div>
                )}
              </motion.div>
            ))}
          </div>
        )
      )}
    </div>
  );
};

export default StreamMonitor;
