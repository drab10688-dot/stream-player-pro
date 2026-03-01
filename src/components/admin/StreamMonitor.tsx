import { useState, useEffect, useRef } from 'react';
import { apiGet } from '@/lib/api';
import { useToast } from '@/hooks/use-toast';
import { Radio, Wifi, Server, Users, RefreshCw, Activity } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { motion } from 'framer-motion';

interface ActiveStream {
  channel_id: string;
  channel_name: string;
  type: 'ffmpeg' | 'hls-proxy';
  clients: number;
  ready: boolean;
  uptime_seconds: number;
  source_url: string;
}

interface StreamsData {
  total_streams: number;
  total_clients_watching: number;
  origin_connections: number;
  streams: ActiveStream[];
}

const formatUptime = (seconds: number) => {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return `${h}h ${m}m`;
};

const StreamMonitor = () => {
  const { toast } = useToast();
  const [data, setData] = useState<StreamsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const intervalRef = useRef<ReturnType<typeof setInterval>>();

  const fetchStreams = async () => {
    try {
      const result = await apiGet('/api/streams/active');
      setData(result);
    } catch (err: any) {
      // Silently fail for auto-refresh, only show on manual
      if (!autoRefresh) {
        toast({ title: 'Error', description: err.message, variant: 'destructive' });
      }
    }
    setLoading(false);
  };

  useEffect(() => {
    fetchStreams();
    if (autoRefresh) {
      intervalRef.current = setInterval(fetchStreams, 5000);
    }
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [autoRefresh]);

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

      {/* Summary Cards */}
      {data && (
        <div className="grid grid-cols-3 gap-3">
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

      {/* Stream List */}
      {loading ? (
        <div className="text-center py-12 text-muted-foreground">Cargando...</div>
      ) : !data || data.streams.length === 0 ? (
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
              className="glass rounded-xl p-4"
            >
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-3 min-w-0 flex-1">
                  <div className={`w-3 h-3 rounded-full shrink-0 ${stream.ready ? 'bg-emerald-400 animate-pulse' : 'bg-yellow-400'}`} />
                  <div className="min-w-0">
                    <p className="font-semibold text-foreground text-sm truncate">{stream.channel_name}</p>
                    <p className="text-xs text-muted-foreground truncate">{stream.source_url}</p>
                  </div>
                </div>
                <div className="flex items-center gap-4 shrink-0">
                  <div className="text-center">
                    <span className={`inline-block px-2 py-0.5 rounded text-[10px] font-mono ${
                      stream.type === 'ffmpeg' 
                        ? 'bg-purple-500/20 text-purple-300' 
                        : 'bg-blue-500/20 text-blue-300'
                    }`}>
                      {stream.type === 'ffmpeg' ? 'TS→HLS' : 'HLS Proxy'}
                    </span>
                  </div>
                  <div className="text-center">
                    <p className="text-sm font-bold text-foreground">{stream.clients}</p>
                    <p className="text-[10px] text-muted-foreground">clientes</p>
                  </div>
                  <div className="text-center">
                    <p className="text-xs text-muted-foreground font-mono">{formatUptime(stream.uptime_seconds)}</p>
                  </div>
                </div>
              </div>
            </motion.div>
          ))}
        </div>
      )}
    </div>
  );
};

export default StreamMonitor;
