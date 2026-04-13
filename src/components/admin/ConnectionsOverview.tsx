import { useState, useEffect, useRef } from 'react';
import { apiGet } from '@/lib/api';
import { Server, Users, Radio, RefreshCw, Activity, ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { motion } from 'framer-motion';

interface StreamInfo {
  channel_id: string;
  channel_name: string;
  type: string;
  clients: number;
  ready: boolean;
  uptime_seconds: number;
  uptime_seconds: number;
}

interface ConnectionsData {
  total_streams: number;
  total_clients_watching: number;
  origin_connections: number;
  streams: StreamInfo[];
}

const ConnectionsOverview = () => {
  const [data, setData] = useState<ConnectionsData | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const intervalRef = useRef<ReturnType<typeof setInterval>>();

  const fetchData = async () => {
    try {
      const result = await apiGet('/api/streams/active');
      setData(result);
    } catch {
      // silently fail
    }
  };

  useEffect(() => {
    fetchData();
    if (autoRefresh) {
      intervalRef.current = setInterval(fetchData, 5000);
    }
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [autoRefresh]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h2 className="font-display font-semibold text-xl text-foreground flex items-center gap-2">
          <Server className="w-5 h-5 text-primary" />
          Conexiones Origen → Clientes
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
          <Button variant="outline" size="sm" onClick={fetchData} className="gap-1.5 text-xs border-border text-foreground">
            <RefreshCw className="w-3.5 h-3.5" /> Refrescar
          </Button>
        </div>
      </div>

      {/* Summary flow */}
      {data && (
        <div className="flex items-center justify-center gap-3 flex-wrap">
          <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} className="glass rounded-xl p-5 text-center min-w-[140px]">
            <Server className="w-8 h-8 text-primary mx-auto mb-2" />
            <p className="text-3xl font-bold text-foreground">{data.origin_connections}</p>
            <p className="text-xs text-muted-foreground mt-1">Conexiones al Origen</p>
          </motion.div>

          <ArrowRight className="w-6 h-6 text-primary animate-pulse" />

          <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: 0.05 }} className="glass rounded-xl p-5 text-center min-w-[140px]">
            <Radio className="w-8 h-8 text-emerald-400 mx-auto mb-2" />
            <p className="text-3xl font-bold text-foreground">{data.total_streams}</p>
            <p className="text-xs text-muted-foreground mt-1">Canales en Restream</p>
          </motion.div>

          <ArrowRight className="w-6 h-6 text-emerald-400 animate-pulse" />

          <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: 0.1 }} className="glass rounded-xl p-5 text-center min-w-[140px]">
            <Users className="w-8 h-8 text-blue-400 mx-auto mb-2" />
            <p className="text-3xl font-bold text-foreground">{data.total_clients_watching}</p>
            <p className="text-xs text-muted-foreground mt-1">Clientes Viendo</p>
          </motion.div>
        </div>
      )}

      {/* Ratio card */}
      {data && data.origin_connections > 0 && (
        <div className="glass rounded-xl p-4 border border-primary/20">
          <p className="text-sm text-foreground font-semibold mb-1">
            Ratio de distribución: <span className="text-primary">1:{Math.max(1, Math.round(data.total_clients_watching / data.origin_connections))}</span>
          </p>
          <p className="text-xs text-muted-foreground">
            Cada conexión al origen sirve en promedio a {Math.max(1, Math.round(data.total_clients_watching / data.origin_connections))} clientes simultáneamente.
          </p>
        </div>
      )}

      {/* Per-channel breakdown */}
      {data && data.streams.length > 0 ? (
        <div className="space-y-2">
          <p className="text-sm font-semibold text-foreground">Desglose por Canal</p>
          {data.streams
            .sort((a, b) => b.clients - a.clients)
            .map((stream, i) => (
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
                  <p className="font-semibold text-foreground text-sm truncate">{stream.channel_name}</p>
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground uppercase font-mono shrink-0">{stream.type}</span>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <div className="flex items-center gap-1 text-xs text-muted-foreground">
                    <Server className="w-3.5 h-3.5 text-primary" />
                    <span>1</span>
                  </div>
                  <ArrowRight className="w-3 h-3 text-muted-foreground" />
                  <div className="flex items-center gap-1 text-xs">
                    <Users className="w-3.5 h-3.5 text-primary" />
                    <span className="font-bold text-foreground">{stream.clients}</span>
                  </div>
                </div>
              </div>
            </motion.div>
          ))}
        </div>
      ) : (
        <div className="glass rounded-xl p-12 text-center">
          <Radio className="w-12 h-12 text-muted-foreground mx-auto mb-3" />
          <p className="text-muted-foreground">No hay streams activos. Se activarán cuando un cliente reproduzca un canal.</p>
        </div>
      )}
    </div>
  );
};

export default ConnectionsOverview;
