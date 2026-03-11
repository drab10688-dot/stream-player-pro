import { useState, useEffect, useCallback } from 'react';
import { apiGet, apiPost } from '@/lib/api';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { motion } from 'framer-motion';
import { Users, Monitor, Globe, Tv, RefreshCw, Zap, MapPin, Clock, Ban } from 'lucide-react';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';

interface ActiveConnection {
  id: string;
  username: string;
  ip: string;
  country: string | null;
  city: string | null;
  isp: string | null;
  stream_name: string | null;
  stream_type: string | null;
  connected_since: string;
  user_agent: string | null;
}

interface ViewerStats {
  total_connections: number;
  unique_users: number;
  unique_ips: number;
  connections: ActiveConnection[];
  users_summary: {
    username: string;
    connections: number;
    max_connections: number;
    ips: string[];
  }[];
}

const getFlag = (country: string | null): string => {
  if (!country) return '🌐';
  const flags: Record<string, string> = {
    'US': '🇺🇸', 'MX': '🇲🇽', 'ES': '🇪🇸', 'CO': '🇨🇴', 'AR': '🇦🇷', 'CL': '🇨🇱',
    'PE': '🇵🇪', 'VE': '🇻🇪', 'EC': '🇪🇨', 'BR': '🇧🇷', 'CR': '🇨🇷', 'PA': '🇵🇦',
    'DO': '🇩🇴', 'GT': '🇬🇹', 'HN': '🇭🇳', 'SV': '🇸🇻', 'NI': '🇳🇮', 'BO': '🇧🇴',
    'PY': '🇵🇾', 'UY': '🇺🇾', 'CU': '🇨🇺', 'CA': '🇨🇦', 'GB': '🇬🇧', 'DE': '🇩🇪',
    'FR': '🇫🇷', 'IT': '🇮🇹', 'PT': '🇵🇹', 'NL': '🇳🇱',
  };
  return flags[country.toUpperCase()] || '🌐';
};

const ShieldViewers = () => {
  const { toast } = useToast();
  const [data, setData] = useState<ViewerStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [autoRefresh, setAutoRefresh] = useState(true);

  const fetchViewers = useCallback(async () => {
    try {
      const result = await apiGet('/api/shield/viewers');
      setData(result);
    } catch (err: any) {
      // May not be available yet
      console.error('Viewers fetch error:', err);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchViewers();
    if (autoRefresh) {
      const iv = setInterval(fetchViewers, 5000);
      return () => clearInterval(iv);
    }
  }, [fetchViewers, autoRefresh]);

  const kickConnection = async (connId: string) => {
    try {
      await apiPost(`/api/shield/viewers/kick`, { connection_id: connId });
      toast({ title: 'Conexión cerrada' });
      fetchViewers();
    } catch (err: any) {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    }
  };

  const kickUser = async (username: string) => {
    try {
      await apiPost(`/api/shield/viewers/kick-user`, { username });
      toast({ title: `${username} desconectado` });
      fetchViewers();
    } catch (err: any) {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    }
  };

  if (loading) {
    return (
      <div className="text-center py-12 text-muted-foreground">
        <div className="animate-spin w-8 h-8 border-2 border-primary border-t-transparent rounded-full mx-auto mb-3" />
        Cargando conexiones activas...
      </div>
    );
  }

  const connections = data?.connections || [];
  const usersSummary = data?.users_summary || [];

  // Country stats
  const countryStats = connections.reduce<Record<string, number>>((acc, c) => {
    const k = c.country || 'Desconocido';
    acc[k] = (acc[k] || 0) + 1;
    return acc;
  }, {});

  return (
    <div className="space-y-6">
      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatCard icon={Users} label="Conexiones" value={data?.total_connections ?? 0} color="primary" />
        <StatCard icon={Monitor} label="Usuarios Únicos" value={data?.unique_users ?? 0} color="accent" />
        <StatCard icon={Globe} label="IPs Únicas" value={data?.unique_ips ?? 0} color="success" />
        <StatCard icon={Tv} label="Streams" value={connections.filter(c => c.stream_name).length} color="primary" />
      </div>

      {/* Controls */}
      <div className="flex items-center gap-2">
        <Button variant={autoRefresh ? 'default' : 'outline'} size="sm"
          onClick={() => setAutoRefresh(!autoRefresh)}
          className={`text-xs gap-1 ${autoRefresh ? 'gradient-primary text-primary-foreground' : ''}`}>
          <Zap className="w-3.5 h-3.5" /> {autoRefresh ? 'Auto-refresh ON' : 'Auto-refresh OFF'}
        </Button>
        <Button variant="outline" size="sm" onClick={fetchViewers} className="text-xs gap-1">
          <RefreshCw className="w-3.5 h-3.5" /> Refrescar
        </Button>
      </div>

      {/* Users Summary */}
      {usersSummary.length > 0 && (
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="glass rounded-xl p-4">
          <h3 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
            <Users className="w-4 h-4 text-primary" /> Resumen por Usuario
          </h3>
          <div className="space-y-2">
            {usersSummary.map(u => (
              <div key={u.username} className="flex items-center justify-between bg-muted/30 rounded-lg p-3 border border-border/30">
                <div className="flex items-center gap-3">
                  <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${
                    u.connections >= u.max_connections ? 'bg-destructive/20' : 'bg-primary/20'
                  }`}>
                    <Monitor className={`w-4 h-4 ${u.connections >= u.max_connections ? 'text-destructive' : 'text-primary'}`} />
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-foreground">{u.username}</p>
                    <p className="text-xs text-muted-foreground">
                      {u.connections}/{u.max_connections} pantallas · {u.ips.length} IP{u.ips.length !== 1 ? 's' : ''}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {u.connections >= u.max_connections && (
                    <Badge variant="destructive" className="text-[10px]">LÍMITE</Badge>
                  )}
                  <Button variant="ghost" size="sm" onClick={() => kickUser(u.username)}
                    className="text-xs text-muted-foreground hover:text-destructive gap-1">
                    <Ban className="w-3 h-3" /> Desconectar
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </motion.div>
      )}

      {/* Country Breakdown */}
      {Object.keys(countryStats).length > 0 && (
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="glass rounded-xl p-4">
          <h3 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
            <MapPin className="w-4 h-4 text-primary" /> Por País
          </h3>
          <div className="flex flex-wrap gap-2">
            {Object.entries(countryStats).sort((a, b) => b[1] - a[1]).map(([country, count]) => (
              <Badge key={country} variant="secondary" className="text-xs gap-1 py-1 px-2">
                {getFlag(country)} {country} <span className="font-bold">{count}</span>
              </Badge>
            ))}
          </div>
        </motion.div>
      )}

      {/* Connections Table */}
      {connections.length > 0 ? (
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="glass rounded-xl overflow-hidden">
          <div className="p-4 border-b border-border/30">
            <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
              <Zap className="w-4 h-4 text-primary" /> Conexiones en Tiempo Real
            </h3>
          </div>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="border-border/30">
                  <TableHead className="text-muted-foreground">Usuario</TableHead>
                  <TableHead className="text-muted-foreground">IP</TableHead>
                  <TableHead className="text-muted-foreground">País</TableHead>
                  <TableHead className="text-muted-foreground">Stream</TableHead>
                  <TableHead className="text-muted-foreground">Tiempo</TableHead>
                  <TableHead className="text-muted-foreground w-20">Acción</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {connections.map(conn => (
                  <TableRow key={conn.id} className="border-border/20">
                    <TableCell className="text-sm font-medium text-foreground">{conn.username}</TableCell>
                    <TableCell>
                      <code className="text-xs text-muted-foreground bg-secondary/50 px-1.5 py-0.5 rounded">{conn.ip}</code>
                    </TableCell>
                    <TableCell>
                      <span className="text-xs">
                        {getFlag(conn.country)} {conn.city ? `${conn.city}` : conn.country || '—'}
                      </span>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground max-w-[200px] truncate">
                      {conn.stream_name || '—'}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground flex items-center gap-1">
                      <Clock className="w-3 h-3" />
                      {conn.connected_since ? new Date(conn.connected_since).toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' }) : '—'}
                    </TableCell>
                    <TableCell>
                      <Button variant="ghost" size="icon" onClick={() => kickConnection(conn.id)}
                        className="text-muted-foreground hover:text-destructive w-8 h-8">
                        <Ban className="w-3.5 h-3.5" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </motion.div>
      ) : (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="glass rounded-xl p-12 text-center">
          <Users className="w-12 h-12 text-muted-foreground mx-auto mb-3" />
          <p className="text-muted-foreground text-sm">No hay conexiones activas</p>
          <p className="text-xs text-muted-foreground/60 mt-1">
            Las conexiones aparecerán cuando los clientes se conecten a través del proxy.
          </p>
        </motion.div>
      )}
    </div>
  );
};

const StatCard = ({ icon: Icon, label, value, color }: { icon: any; label: string; value: number; color: string }) => {
  const colorMap: Record<string, string> = {
    primary: 'text-primary',
    accent: 'text-accent',
    success: 'text-emerald-400',
  };
  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="glass rounded-xl p-4 text-center">
      <Icon className={`w-6 h-6 mx-auto mb-1 ${colorMap[color]}`} />
      <p className="text-2xl font-bold text-foreground">{value}</p>
      <p className="text-xs text-muted-foreground">{label}</p>
    </motion.div>
  );
};

export default ShieldViewers;
