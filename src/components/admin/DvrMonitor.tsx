import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Video, RefreshCw, Users, HardDrive, RotateCcw, Clock, Disc, Power, PowerOff } from 'lucide-react';
import { apiGet } from '@/lib/api';
import { toast } from 'sonner';

interface DvrStatus {
  channelId: string;
  channelName?: string;
  viewers: number;
  segments: number;
  recording: boolean;
  restarts: number;
  uptime: number;
  sizeMB: number;
  format: string;
  enabled?: boolean;
  active?: boolean;
}

const DvrMonitor = () => {
  const [dvrList, setDvrList] = useState<DvrStatus[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchData = async () => {
    setLoading(true);
    try {
      const statusData = await apiGet('/api/admin/dvr/status');
      setDvrList(Array.isArray(statusData) ? statusData : []);
    } catch (err: any) {
      toast.error('Error cargando estado DVR: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 10000);
    return () => clearInterval(interval);
  }, []);

  const formatUptime = (seconds: number) => {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    if (h > 0) return `${h}h ${m}m`;
    if (m > 0) return `${m}m ${s}s`;
    return `${s}s`;
  };

  const activeList = dvrList.filter(d => d.active);
  const inactiveList = dvrList.filter(d => !d.active);
  const totalViewers = activeList.reduce((a, d) => a + d.viewers, 0);
  const totalSize = activeList.reduce((a, d) => a + d.sizeMB, 0);
  const totalSegments = activeList.reduce((a, d) => a + d.segments, 0);

  return (
    <div className="space-y-6">
      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card className="glass-strong border-border/30">
          <CardContent className="p-4 flex items-center gap-3">
            <div className="p-2 rounded-lg bg-primary/10">
              <Disc className="w-5 h-5 text-primary" />
            </div>
            <div>
              <p className="text-2xl font-bold">{dvrList.length}</p>
              <p className="text-xs text-muted-foreground">DVR Habilitados</p>
            </div>
          </CardContent>
        </Card>
        <Card className="glass-strong border-border/30">
          <CardContent className="p-4 flex items-center gap-3">
            <div className="p-2 rounded-lg bg-red-500/10">
              <Power className="w-5 h-5 text-red-500" />
            </div>
            <div>
              <p className="text-2xl font-bold">{activeList.length}</p>
              <p className="text-xs text-muted-foreground">Grabando Ahora</p>
            </div>
          </CardContent>
        </Card>
        <Card className="glass-strong border-border/30">
          <CardContent className="p-4 flex items-center gap-3">
            <div className="p-2 rounded-lg bg-blue-500/10">
              <Users className="w-5 h-5 text-blue-500" />
            </div>
            <div>
              <p className="text-2xl font-bold">{totalViewers}</p>
              <p className="text-xs text-muted-foreground">Viewers DVR</p>
            </div>
          </CardContent>
        </Card>
        <Card className="glass-strong border-border/30">
          <CardContent className="p-4 flex items-center gap-3">
            <div className="p-2 rounded-lg bg-orange-500/10">
              <HardDrive className="w-5 h-5 text-orange-500" />
            </div>
            <div>
              <p className="text-2xl font-bold">{totalSize.toFixed(1)}</p>
              <p className="text-xs text-muted-foreground">MB en disco</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Active DVR channels */}
      <Card className="glass-strong border-border/30">
        <CardHeader className="flex flex-row items-center justify-between pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Disc className="w-5 h-5 text-red-500" />
            Canales DVR
          </CardTitle>
          <Button variant="outline" size="sm" onClick={fetchData} disabled={loading}>
            <RefreshCw className={`w-4 h-4 mr-1 ${loading ? 'animate-spin' : ''}`} />
            Actualizar
          </Button>
        </CardHeader>
        <CardContent>
          {loading && dvrList.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <RefreshCw className="w-8 h-8 mx-auto mb-2 animate-spin opacity-30" />
              <p>Cargando estado DVR...</p>
            </div>
          ) : dvrList.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <Video className="w-10 h-10 mx-auto mb-2 opacity-30" />
              <p>No hay canales con DVR habilitado</p>
              <p className="text-xs mt-1">Activa el DVR en la pestaña de Canales. FFmpeg se inicia automáticamente.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {/* Active (recording) channels first */}
              {activeList.map((dvr) => (
                <div
                  key={dvr.channelId}
                  className="flex flex-wrap items-center justify-between gap-3 p-3 rounded-lg bg-card/50 border border-red-500/20"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="relative">
                      <Disc className="w-5 h-5 text-red-500 animate-pulse" />
                    </div>
                    <div className="min-w-0">
                      <p className="font-medium text-sm truncate">
                        {dvr.channelName || dvr.channelId.slice(0, 8)}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {dvr.format.toUpperCase()} • {formatUptime(dvr.uptime)}
                      </p>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="secondary" className="gap-1 text-xs">
                      <Users className="w-3 h-3" /> {dvr.viewers}
                    </Badge>
                    <Badge variant="outline" className="gap-1 text-xs">
                      <Video className="w-3 h-3" /> {dvr.segments} seg
                    </Badge>
                    <Badge variant="outline" className="gap-1 text-xs">
                      <HardDrive className="w-3 h-3" /> {dvr.sizeMB.toFixed(1)} MB
                    </Badge>
                    {dvr.restarts > 0 && (
                      <Badge variant="destructive" className="gap-1 text-xs">
                        <RotateCcw className="w-3 h-3" /> {dvr.restarts}
                      </Badge>
                    )}
                    <Badge className="bg-red-500/20 text-red-400 border-red-500/30 gap-1 text-xs">
                      <Disc className="w-3 h-3 animate-pulse" /> REC
                    </Badge>
                  </div>
                </div>
              ))}

              {/* Enabled but inactive channels */}
              {inactiveList.map((dvr) => (
                <div
                  key={dvr.channelId}
                  className="flex flex-wrap items-center justify-between gap-3 p-3 rounded-lg bg-card/30 border border-border/10 opacity-70"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="relative">
                      <PowerOff className="w-5 h-5 text-muted-foreground" />
                    </div>
                    <div className="min-w-0">
                      <p className="font-medium text-sm truncate">
                        {dvr.channelName || dvr.channelId.slice(0, 8)}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        FFmpeg iniciándose... espera unos segundos
                      </p>
                    </div>
                  </div>
                  <Badge variant="outline" className="gap-1 text-xs text-muted-foreground">
                    <Clock className="w-3 h-3" /> Standby
                  </Badge>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default DvrMonitor;
