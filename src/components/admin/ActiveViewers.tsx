import { useState, useEffect, useRef, useCallback } from 'react';
import { apiGet, apiPost } from '@/lib/api';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { Users, MapPin, Tv, RefreshCw, Activity, Globe, Monitor, Smartphone, XCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { motion } from 'framer-motion';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

interface Viewer {
  id: string;
  device_id: string;
  ip_address: string | null;
  country: string | null;
  city: string | null;
  connected_at: string;
  last_heartbeat: string;
  client_username: string;
  client_id: string;
  channel_name: string | null;
  channel_category: string | null;
  channel_logo: string | null;
  source?: 'panel' | 'apk';
}

interface ViewersData {
  total_viewers: number;
  viewers: Viewer[];
}

// Banderas emoji por país (simplificado)
const countryFlags: Record<string, string> = {
  'Argentina': '🇦🇷', 'Bolivia': '🇧🇴', 'Brasil': '🇧🇷', 'Chile': '🇨🇱',
  'Colombia': '🇨🇴', 'Costa Rica': '🇨🇷', 'Cuba': '🇨🇺', 'Ecuador': '🇪🇨',
  'El Salvador': '🇸🇻', 'Spain': '🇪🇸', 'Guatemala': '🇬🇹', 'Honduras': '🇭🇳',
  'Mexico': '🇲🇽', 'Nicaragua': '🇳🇮', 'Panama': '🇵🇦', 'Paraguay': '🇵🇾',
  'Peru': '🇵🇪', 'Dominican Republic': '🇩🇴', 'Uruguay': '🇺🇾', 'Venezuela': '🇻🇪',
  'United States': '🇺🇸', 'Canada': '🇨🇦', 'United Kingdom': '🇬🇧', 'France': '🇫🇷',
  'Germany': '🇩🇪', 'Italy': '🇮🇹', 'Portugal': '🇵🇹', 'Local': '🏠',
};

const getFlag = (country: string | null) => {
  if (!country) return '🌍';
  return countryFlags[country] || '🌍';
};

const formatTime = (dateStr: string) => {
  const d = new Date(dateStr);
  return d.toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' });
};

const ActiveViewers = () => {
  const { toast } = useToast();
  const [data, setData] = useState<ViewersData | null>(null);
  const [loading, setLoading] = useState(true);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const intervalRef = useRef<ReturnType<typeof setInterval>>();

  const kickApkUser = useCallback(async (username: string, device_id?: string) => {
    try {
      await apiPost('/api/admin/apk-connections/kick', { username, device_id });
      toast({ title: 'Conexión APK cerrada', description: username });
      fetchViewers();
    } catch (err: any) {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    }
  }, [toast]);

    try {
      const [result, apkConns] = await Promise.all([
        apiGet('/api/viewers/active'),
        apiGet('/api/admin/apk-connections').catch(() => []),
      ]);

      // Merge APK connections into viewers
      const apkViewers: Viewer[] = (apkConns || []).map((c: any, i: number) => ({
        id: `apk-${c.username}-${i}`,
        device_id: c.device_id || 'apk',
        ip_address: c.ip || null,
        country: c.country || null,
        city: c.city || null,
        connected_at: c.connectedAt,
        last_heartbeat: c.lastHeartbeat,
        client_username: c.username,
        client_id: `apk-${c.username}`,
        channel_name: c.channelId || null,
        channel_category: null,
        channel_logo: null,
        source: 'apk' as const,
      }));

      const panelViewers = (result?.viewers || []).map((v: Viewer) => ({ ...v, source: 'panel' as const }));
      const allViewers = [...panelViewers, ...apkViewers];

      setData({
        total_viewers: allViewers.length,
        viewers: allViewers,
      });
    } catch (err: any) {
      if (!autoRefresh) {
        toast({ title: 'Error', description: err.message, variant: 'destructive' });
      }
    }
    setLoading(false);
  }, [autoRefresh, toast]);

  useEffect(() => {
    fetchViewers();

    // Realtime: escuchar cambios en active_connections
    const channel = supabase
      .channel('active-viewers-realtime')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'active_connections' },
        () => {
          // Cualquier INSERT/UPDATE/DELETE → refrescar inmediatamente
          fetchViewers();
        }
      )
      .subscribe();

    // Polling de respaldo cada 5s
    if (autoRefresh) {
      intervalRef.current = setInterval(fetchViewers, 5000);
    }

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
      supabase.removeChannel(channel);
    };
  }, [autoRefresh, fetchViewers]);

  // Agrupar por país
  const countryStats = data?.viewers.reduce((acc, v) => {
    const country = v.country || 'Desconocido';
    acc[country] = (acc[country] || 0) + 1;
    return acc;
  }, {} as Record<string, number>) || {};

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h2 className="font-display font-semibold text-xl text-foreground flex items-center gap-2">
          <Users className="w-5 h-5 text-primary" />
          Espectadores Activos
        </h2>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setAutoRefresh(!autoRefresh)}
            className={`gap-1.5 text-xs ${autoRefresh ? 'border-primary text-primary' : 'border-border text-muted-foreground'}`}
          >
            <Activity className={`w-3.5 h-3.5 ${autoRefresh ? 'animate-pulse' : ''}`} />
            {autoRefresh ? 'Auto (10s)' : 'Manual'}
          </Button>
          <Button variant="outline" size="sm" onClick={fetchViewers} className="gap-1.5 text-xs border-border text-foreground">
            <RefreshCw className="w-3.5 h-3.5" /> Refrescar
          </Button>
        </div>
      </div>

      {/* Summary */}
      {data && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="glass rounded-xl p-4 text-center">
            <Users className="w-6 h-6 text-primary mx-auto mb-1" />
            <p className="text-2xl font-bold text-foreground">{data.total_viewers}</p>
            <p className="text-xs text-muted-foreground">Conectados</p>
          </motion.div>
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }} className="glass rounded-xl p-4 text-center">
            <Tv className="w-6 h-6 text-emerald-400 mx-auto mb-1" />
            <p className="text-2xl font-bold text-foreground">
              {data.viewers.filter(v => v.channel_name).length}
            </p>
            <p className="text-xs text-muted-foreground">Viendo Canal</p>
          </motion.div>
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }} className="glass rounded-xl p-4 text-center">
            <Globe className="w-6 h-6 text-blue-400 mx-auto mb-1" />
            <p className="text-2xl font-bold text-foreground">{Object.keys(countryStats).length}</p>
            <p className="text-xs text-muted-foreground">Países</p>
          </motion.div>
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 }} className="glass rounded-xl p-4 text-center">
            <Monitor className="w-6 h-6 text-purple-400 mx-auto mb-1" />
            <p className="text-2xl font-bold text-foreground">
              {new Set(data.viewers.map(v => v.client_username)).size}
            </p>
            <p className="text-xs text-muted-foreground">Clientes Únicos</p>
          </motion.div>
        </div>
      )}

      {/* Countries breakdown */}
      {Object.keys(countryStats).length > 0 && (
        <div className="glass rounded-xl p-4">
          <p className="text-sm font-semibold text-foreground mb-2 flex items-center gap-2">
            <MapPin className="w-4 h-4 text-primary" /> Por País
          </p>
          <div className="flex flex-wrap gap-2">
            {Object.entries(countryStats)
              .sort((a, b) => b[1] - a[1])
              .map(([country, count]) => (
                <Badge key={country} variant="secondary" className="text-xs gap-1 py-1 px-2">
                  {getFlag(country)} {country}: {count}
                </Badge>
              ))}
          </div>
        </div>
      )}

      {/* Viewers Table */}
      {loading ? (
        <div className="text-center py-12 text-muted-foreground">Cargando...</div>
      ) : !data || data.viewers.length === 0 ? (
        <div className="glass rounded-xl p-12 text-center">
          <Users className="w-12 h-12 text-muted-foreground mx-auto mb-3" />
          <p className="text-muted-foreground">No hay espectadores conectados en este momento.</p>
        </div>
      ) : (
        <div className="glass rounded-xl overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow className="border-border/30">
                <TableHead className="text-muted-foreground">Cliente</TableHead>
                <TableHead className="text-muted-foreground">Canal</TableHead>
                <TableHead className="text-muted-foreground">IP</TableHead>
                <TableHead className="text-muted-foreground">Ubicación</TableHead>
                <TableHead className="text-muted-foreground">Dispositivo</TableHead>
                <TableHead className="text-muted-foreground">Última act.</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.viewers.map((viewer, i) => (
                <motion.tr
                  key={viewer.id}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: i * 0.02 }}
                  className="border-border/20 hover:bg-muted/30"
                >
                  <TableCell className="font-semibold text-foreground text-sm">
                    <div className="flex items-center gap-2">
                      {viewer.client_username}
                      {viewer.source === 'apk' && (
                        <Badge variant="outline" className="text-[10px] px-1.5 py-0 border-primary/40 text-primary gap-0.5">
                          <Smartphone className="w-3 h-3" /> APK
                        </Badge>
                      )}
                    </div>
                  </TableCell>
                  <TableCell>
                    {viewer.channel_name ? (
                      <div className="flex items-center gap-2">
                        {viewer.channel_logo && (
                          <img src={viewer.channel_logo} alt="" className="w-5 h-5 rounded object-cover" />
                        )}
                        <div>
                          <p className="text-sm text-foreground">{viewer.channel_name}</p>
                          <p className="text-[10px] text-muted-foreground">{viewer.channel_category}</p>
                        </div>
                      </div>
                    ) : (
                      <span className="text-xs text-muted-foreground italic">Sin canal</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <code className="text-xs text-muted-foreground bg-secondary/50 px-1.5 py-0.5 rounded">
                      {viewer.ip_address || '—'}
                    </code>
                  </TableCell>
                  <TableCell>
                    <span className="text-sm">
                      {getFlag(viewer.country)}{' '}
                      <span className="text-foreground">{viewer.country || '—'}</span>
                      {viewer.city && <span className="text-muted-foreground text-xs ml-1">({viewer.city})</span>}
                    </span>
                  </TableCell>
                  <TableCell>
                    <span className="text-xs text-muted-foreground truncate max-w-[120px] block">
                      {viewer.device_id.substring(0, 12)}...
                    </span>
                  </TableCell>
                  <TableCell>
                    <span className="text-xs text-muted-foreground">{formatTime(viewer.last_heartbeat)}</span>
                  </TableCell>
                </motion.tr>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
};

export default ActiveViewers;
