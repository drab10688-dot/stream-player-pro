import { useState, useEffect, useCallback } from 'react';
import { apiGet } from '@/lib/api';
import { useToast } from '@/hooks/use-toast';
import { ScrollText, Users, Tv, Clock, RefreshCw, Calendar } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { motion } from 'framer-motion';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';

interface ActivityLog {
  id: string;
  client_username: string;
  channel_name: string | null;
  action: string;
  ip_address: string | null;
  country: string | null;
  city: string | null;
  device_id: string | null;
  started_at: string;
  ended_at: string | null;
  duration_seconds: number | null;
  source: string;
}

interface Stats {
  unique_clients: string;
  total_views: string;
  unique_channels: string;
  total_watch_seconds: string;
}

const formatDuration = (seconds: number | null) => {
  if (!seconds) return '—';
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return `${h}h ${m}m`;
};

const formatDate = (dateStr: string) => {
  const d = new Date(dateStr);
  return d.toLocaleString('es', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
};

const ActivityLogs = () => {
  const { toast } = useToast();
  const [logs, setLogs] = useState<ActivityLog[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [days, setDays] = useState(7);

  const fetchLogs = useCallback(async () => {
    try {
      const data = await apiGet(`/api/admin/activity-logs?days=${days}&limit=200`);
      setLogs(data.logs || []);
      setStats(data.stats || null);
    } catch (err: any) {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    }
    setLoading(false);
  }, [days, toast]);

  useEffect(() => { fetchLogs(); }, [fetchLogs]);

  const totalHours = stats ? Math.round(parseInt(stats.total_watch_seconds) / 3600) : 0;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h2 className="font-display font-semibold text-xl text-foreground flex items-center gap-2">
          <ScrollText className="w-5 h-5 text-primary" />
          Logs de Actividad
        </h2>
        <div className="flex items-center gap-2">
          {[1, 7, 30].map(d => (
            <Button key={d} variant={days === d ? 'default' : 'outline'} size="sm" onClick={() => setDays(d)}
              className={`text-xs ${days === d ? 'gradient-primary text-primary-foreground' : 'border-border text-foreground'}`}>
              {d === 1 ? '24h' : `${d}d`}
            </Button>
          ))}
          <Button variant="outline" size="sm" onClick={fetchLogs} className="gap-1.5 text-xs border-border text-foreground">
            <RefreshCw className="w-3.5 h-3.5" /> Refrescar
          </Button>
        </div>
      </div>

      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="glass rounded-xl p-4 text-center">
            <Users className="w-6 h-6 text-primary mx-auto mb-1" />
            <p className="text-2xl font-bold text-foreground">{stats.unique_clients}</p>
            <p className="text-xs text-muted-foreground">Clientes Únicos</p>
          </motion.div>
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }} className="glass rounded-xl p-4 text-center">
            <Tv className="w-6 h-6 text-emerald-400 mx-auto mb-1" />
            <p className="text-2xl font-bold text-foreground">{stats.total_views}</p>
            <p className="text-xs text-muted-foreground">Reproducciones</p>
          </motion.div>
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }} className="glass rounded-xl p-4 text-center">
            <Tv className="w-6 h-6 text-blue-400 mx-auto mb-1" />
            <p className="text-2xl font-bold text-foreground">{stats.unique_channels}</p>
            <p className="text-xs text-muted-foreground">Canales Vistos</p>
          </motion.div>
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 }} className="glass rounded-xl p-4 text-center">
            <Clock className="w-6 h-6 text-purple-400 mx-auto mb-1" />
            <p className="text-2xl font-bold text-foreground">{totalHours}h</p>
            <p className="text-xs text-muted-foreground">Tiempo Total</p>
          </motion.div>
        </div>
      )}

      {loading ? (
        <div className="text-center py-12 text-muted-foreground">Cargando...</div>
      ) : logs.length === 0 ? (
        <div className="glass rounded-xl p-12 text-center">
          <ScrollText className="w-12 h-12 text-muted-foreground mx-auto mb-3" />
          <p className="text-muted-foreground">No hay registros de actividad en este periodo.</p>
        </div>
      ) : (
        <div className="glass rounded-xl overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow className="border-border/30">
                <TableHead className="text-muted-foreground">Cliente</TableHead>
                <TableHead className="text-muted-foreground">Canal</TableHead>
                <TableHead className="text-muted-foreground">Ubicación</TableHead>
                <TableHead className="text-muted-foreground">Inicio</TableHead>
                <TableHead className="text-muted-foreground">Duración</TableHead>
                <TableHead className="text-muted-foreground">Fuente</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {logs.map((log, i) => (
                <motion.tr key={log.id} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: i * 0.01 }}
                  className="border-border/20 hover:bg-muted/30">
                  <TableCell className="font-semibold text-foreground text-sm">{log.client_username}</TableCell>
                  <TableCell className="text-sm text-foreground">{log.channel_name || '—'}</TableCell>
                  <TableCell>
                    <span className="text-sm text-muted-foreground">
                      {log.country || '—'}{log.city ? ` (${log.city})` : ''}
                    </span>
                  </TableCell>
                  <TableCell>
                    <span className="text-xs text-muted-foreground">{formatDate(log.started_at)}</span>
                  </TableCell>
                  <TableCell>
                    <span className="text-xs text-muted-foreground">{formatDuration(log.duration_seconds)}</span>
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline" className="text-[10px]">
                      {log.source === 'apk' ? '📱 APK' : '🖥️ Panel'}
                    </Badge>
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

export default ActivityLogs;