import { useState, useEffect, useCallback } from 'react';
import { apiGet } from '@/lib/api';
import { copyToClipboard } from '@/lib/clipboard';
import { useToast } from '@/hooks/use-toast';
import { Activity, Users, Clock, Globe, Tv, Copy, Check, RefreshCw, ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { motion } from 'framer-motion';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';

interface ProxyConnection {
  id: string;
  client_ip: string;
  username: string;
  connected_at: string;
  last_activity: string;
  target: string;
  country: string | null;
}

interface ProxyData {
  active_connections: number;
  total_requests: number;
  uptime_seconds: number;
  connections: ProxyConnection[];
  xtream_endpoints: {
    player_api: string;
    live: string;
    get_m3u: string;
    xmltv: string;
  };
}

const formatUptime = (s: number) => {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
};

const ProxyStatus = () => {
  const { toast } = useToast();
  const [data, setData] = useState<ProxyData | null>(null);
  const [loading, setLoading] = useState(true);
  const [copiedEndpoint, setCopiedEndpoint] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    try {
      const result = await apiGet('/api/proxy/status');
      setData(result);
    } catch {
      // Server may not have this endpoint yet - show empty state
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchData();
    const iv = setInterval(fetchData, 5000);
    return () => clearInterval(iv);
  }, [fetchData]);

  const copyEndpoint = async (key: string, url: string) => {
    await copyToClipboard(url);
    setCopiedEndpoint(key);
    toast({ title: 'Copiado' });
    setTimeout(() => setCopiedEndpoint(null), 2000);
  };

  if (loading) {
    return (
      <div className="text-center py-12 text-muted-foreground">
        <div className="animate-spin w-8 h-8 border-2 border-primary border-t-transparent rounded-full mx-auto mb-3" />
        Cargando estado del proxy...
      </div>
    );
  }

  const baseUrl = typeof window !== 'undefined' ? window.location.origin : '';

  const endpoints = [
    { key: 'player_api', label: 'Player API', path: '/player_api.php', desc: 'Login y listas de canales' },
    { key: 'live', label: 'Live Streams', path: '/live/{user}/{pass}/{stream_id}.ts', desc: 'Streams en vivo' },
    { key: 'get_m3u', label: 'Playlist M3U', path: '/get.php?username={user}&password={pass}&type=m3u_plus', desc: 'Lista M3U completa' },
    { key: 'xmltv', label: 'EPG/XMLTV', path: '/xmltv.php?username={user}&password={pass}', desc: 'Guía de programación' },
  ];

  return (
    <div className="space-y-6">
      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard icon={Users} label="Conexiones" value={data?.active_connections ?? 0} color="primary" />
        <StatCard icon={Activity} label="Peticiones Totales" value={data?.total_requests ?? 0} color="accent" />
        <StatCard icon={Clock} label="Uptime" value={formatUptime(data?.uptime_seconds ?? 0)} color="success" />
        <StatCard icon={Globe} label="Endpoints" value={endpoints.length} color="primary" />
      </div>

      {/* Xtream Endpoints */}
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="glass rounded-xl p-6">
        <h3 className="text-sm font-semibold text-foreground mb-4 flex items-center gap-2">
          <Tv className="w-4 h-4 text-primary" /> Endpoints Xtream Codes (Proxy)
        </h3>
        <p className="text-xs text-muted-foreground mb-4">
          Usa estos endpoints en TiviMate, Smarters o cualquier app compatible. La IP real está oculta.
        </p>

        <div className="space-y-2">
          {endpoints.map(ep => (
            <div key={ep.key} className="bg-muted/30 rounded-lg p-3 border border-border/30 flex items-center gap-3">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-0.5">
                  <span className="text-xs font-semibold text-foreground">{ep.label}</span>
                  <ArrowRight className="w-3 h-3 text-muted-foreground" />
                  <span className="text-[10px] text-muted-foreground">{ep.desc}</span>
                </div>
                <code className="text-primary text-[11px] font-mono break-all">{baseUrl}{ep.path}</code>
              </div>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => copyEndpoint(ep.key, `${baseUrl}${ep.path}`)}
                className="shrink-0 text-muted-foreground hover:text-primary"
              >
                {copiedEndpoint === ep.key ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
              </Button>
            </div>
          ))}
        </div>

        <div className="mt-4 bg-primary/5 rounded-lg p-3 border border-primary/10 text-xs text-muted-foreground">
          <span className="text-foreground font-medium">💡 Tip:</span> Si usas el túnel Cloudflare, reemplaza <code className="bg-muted px-1 rounded text-primary">{baseUrl}</code> por tu URL de Cloudflare.
        </div>
      </motion.div>

      {/* Active Connections */}
      {data && data.connections && data.connections.length > 0 && (
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="glass rounded-xl overflow-hidden">
          <div className="p-4 border-b border-border/30 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
              <Users className="w-4 h-4 text-primary" /> Conexiones Activas
            </h3>
            <Button variant="ghost" size="sm" onClick={fetchData} className="text-xs text-muted-foreground gap-1">
              <RefreshCw className="w-3.5 h-3.5" /> Refrescar
            </Button>
          </div>
          <Table>
            <TableHeader>
              <TableRow className="border-border/30">
                <TableHead className="text-muted-foreground">Usuario</TableHead>
                <TableHead className="text-muted-foreground">IP</TableHead>
                <TableHead className="text-muted-foreground">Destino</TableHead>
                <TableHead className="text-muted-foreground">Actividad</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.connections.map(conn => (
                <TableRow key={conn.id} className="border-border/20">
                  <TableCell className="text-sm font-medium text-foreground">{conn.username}</TableCell>
                  <TableCell>
                    <code className="text-xs text-muted-foreground bg-secondary/50 px-1.5 py-0.5 rounded">{conn.client_ip}</code>
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">{conn.target}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {new Date(conn.last_activity).toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' })}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </motion.div>
      )}

      {(!data || !data.connections || data.connections.length === 0) && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="glass rounded-xl p-12 text-center">
          <Activity className="w-12 h-12 text-muted-foreground mx-auto mb-3" />
          <p className="text-muted-foreground text-sm">No hay conexiones activas en este momento.</p>
          <p className="text-xs text-muted-foreground/60 mt-1">Las conexiones aparecerán cuando los clientes usen los endpoints proxy.</p>
        </motion.div>
      )}
    </div>
  );
};

const StatCard = ({ icon: Icon, label, value, color }: { icon: any; label: string; value: number | string; color: string }) => {
  const colorMap: Record<string, string> = {
    primary: 'bg-primary/15 text-primary',
    accent: 'bg-accent/15 text-accent',
    success: 'bg-emerald-500/15 text-emerald-400',
  };
  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="glass rounded-xl p-4 text-center">
      <Icon className={`w-6 h-6 mx-auto mb-1 ${colorMap[color]?.split(' ')[1]}`} />
      <p className="text-2xl font-bold text-foreground">{value}</p>
      <p className="text-xs text-muted-foreground">{label}</p>
    </motion.div>
  );
};

export default ProxyStatus;
