import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Video, RefreshCw, Users, HardDrive, RotateCcw, Clock, Disc } from 'lucide-react';
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
}

const DvrMonitor = () => {
  const [dvrList, setDvrList] = useState<DvrStatus[]>([]);
  const [channels, setChannels] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);

  const fetchData = async () => {
    setLoading(true);
    try {
      const [statusData, channelsData] = await Promise.all([
        apiGet('/api/admin/dvr/status'),
        apiGet('/api/channels'),
      ]);
      const channelMap: Record<string, string> = {};
      (Array.isArray(channelsData) ? channelsData : channelsData.channels || []).forEach((ch: any) => {
        channelMap[ch.id] = ch.name;
      });
      setChannels(channelMap);
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

  const totalViewers = dvrList.reduce((a, d) => a + d.viewers, 0);
  const totalSize = dvrList.reduce((a, d) => a + d.sizeMB, 0);
  const totalSegments = dvrList.reduce((a, d) => a + d.segments, 0);

  return (
    <div className="space-y-6">
      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card className="glass-strong border-border/30">
          <CardContent className="p-4 flex items-center gap-3">
            <div className="p-2 rounded-lg bg-red-500/10">
              <Disc className="w-5 h-5 text-red-500" />
            </div>
            <div>
              <p className="text-2xl font-bold">{dvrList.length}</p>
              <p className="text-xs text-muted-foreground">Grabando</p>
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
            <div className="p-2 rounded-lg bg-green-500/10">
              <Video className="w-5 h-5 text-green-500" />
            </div>
            <div>
              <p className="text-2xl font-bold">{totalSegments}</p>
              <p className="text-xs text-muted-foreground">Segmentos</p>
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

      {/* DVR list */}
      <Card className="glass-strong border-border/30">
        <CardHeader className="flex flex-row items-center justify-between pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Disc className="w-5 h-5 text-red-500" />
            Canales con DVR Activo
          </CardTitle>
          <Button variant="outline" size="sm" onClick={fetchData} disabled={loading}>
            <RefreshCw className={`w-4 h-4 mr-1 ${loading ? 'animate-spin' : ''}`} />
            Actualizar
          </Button>
        </CardHeader>
        <CardContent>
          {dvrList.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <Video className="w-10 h-10 mx-auto mb-2 opacity-30" />
              <p>No hay canales con DVR activo</p>
              <p className="text-xs mt-1">El DVR se activa automáticamente cuando un cliente abre un canal con DVR habilitado</p>
            </div>
          ) : (
            <div className="space-y-3">
              {dvrList.map((dvr) => (
                <div
                  key={dvr.channelId}
                  className="flex flex-wrap items-center justify-between gap-3 p-3 rounded-lg bg-card/50 border border-border/20"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="relative">
                      <Disc className="w-5 h-5 text-red-500 animate-pulse" />
                    </div>
                    <div className="min-w-0">
                      <p className="font-medium text-sm truncate">
                        {channels[dvr.channelId] || dvr.channelId.slice(0, 8)}
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
                    <Badge variant="outline" className="gap-1 text-xs">
                      <Clock className="w-3 h-3" /> {formatUptime(dvr.uptime)}
                    </Badge>
                    {dvr.restarts > 0 && (
                      <Badge variant="destructive" className="gap-1 text-xs">
                        <RotateCcw className="w-3 h-3" /> {dvr.restarts}
                      </Badge>
                    )}
                    {dvr.recording && (
                      <Badge className="bg-red-500/20 text-red-400 border-red-500/30 gap-1 text-xs">
                        <Disc className="w-3 h-3 animate-pulse" /> REC
                      </Badge>
                    )}
                  </div>
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
