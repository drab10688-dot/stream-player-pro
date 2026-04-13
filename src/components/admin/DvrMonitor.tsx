import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Video, RefreshCw, Users, HardDrive, RotateCcw, Clock, Disc, Power, PowerOff, AlertTriangle, ChevronDown, ChevronUp, Search, CheckCircle, XCircle, Zap, Timer } from 'lucide-react';
import { apiGet, apiPut } from '@/lib/api';
import { toast } from 'sonner';
import { Switch } from '@/components/ui/switch';
import { motion, AnimatePresence } from 'framer-motion';

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
  keepAlive?: boolean;
  
  ready?: boolean;
  lastError?: string | null;
  lastErrorAt?: string | null;
  errorCount?: number;
}

interface DvrDiagnostics {
  engine: string;
  dvrDir: string;
  activeCount: number;
  channelsWithErrors: number;
  errors: Array<{
    channelId: string;
    errorCount: number;
    lastError: string;
    lastErrorAt: string;
    lastErrorType: string;
  }>;
}

interface ChannelDiagnostic {
  channelId: string;
  engine: string;
  channelDir: string;
  channelDirExists: boolean;
  
  hasPlaylist: boolean;
  segments: number;
  allFiles: string[];
  isActive: boolean;
  isRecording: boolean;
  restartCount: number;
  preWarmed: boolean;
  sourceUrl: string | null;
  errors: Array<{ timestamp: string; message: string; type: string }>;
}

const DvrMonitor = () => {
  const [dvrList, setDvrList] = useState<DvrStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [diagnostics, setDiagnostics] = useState<DvrDiagnostics | null>(null);
  const [channelDiag, setChannelDiag] = useState<ChannelDiagnostic | null>(null);
  const [expandedChannel, setExpandedChannel] = useState<string | null>(null);
  const [showDiagnostics, setShowDiagnostics] = useState(false);

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

  const fetchDiagnostics = async () => {
    try {
      const data = await apiGet('/api/admin/dvr/diagnostics');
      setDiagnostics(data);
    } catch (err: any) {
      toast.error('Error cargando diagnóstico: ' + err.message);
    }
  };

  const fetchChannelDiag = async (channelId: string) => {
    try {
      const data = await apiGet(`/api/admin/dvr/diagnostics?channelId=${channelId}`);
      setChannelDiag(data);
      setExpandedChannel(channelId);
    } catch (err: any) {
      toast.error('Error: ' + err.message);
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
  const channelsWithErrors = dvrList.filter(d => (d.errorCount || 0) > 0).length;

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
            <div className={`p-2 rounded-lg ${channelsWithErrors > 0 ? 'bg-destructive/10' : 'bg-orange-500/10'}`}>
              {channelsWithErrors > 0 
                ? <AlertTriangle className="w-5 h-5 text-destructive" />
                : <HardDrive className="w-5 h-5 text-orange-500" />
              }
            </div>
            <div>
              <p className="text-2xl font-bold">{channelsWithErrors > 0 ? channelsWithErrors : totalSize.toFixed(1)}</p>
              <p className="text-xs text-muted-foreground">
                {channelsWithErrors > 0 ? 'Con Errores' : 'MB en disco'}
              </p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Diagnostics button */}
      <div className="flex justify-end">
        <Button 
          variant="outline" 
          size="sm" 
          onClick={() => { setShowDiagnostics(!showDiagnostics); if (!diagnostics) fetchDiagnostics(); }}
          className="gap-1"
        >
          <Search className="w-4 h-4" />
          {showDiagnostics ? 'Ocultar Diagnóstico' : 'Auditar DVR'}
        </Button>
      </div>

      {/* Global diagnostics panel */}
      <AnimatePresence>
        {showDiagnostics && diagnostics && (
          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}>
            <Card className="border-accent/30 bg-accent/5">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Search className="w-4 h-4" />
                  Diagnóstico General DVR
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
                  <div className="flex items-center gap-2">
                    <CheckCircle className="w-4 h-4 text-green-500" />
                    <span className="text-muted-foreground">Motor:</span>
                    <code className="text-xs bg-secondary px-1 rounded truncate">{diagnostics.engine || 'Node.js nativo'}</code>
                  </div>
                  <div>
                    <span className="text-muted-foreground">DVR Dir:</span>
                    <code className="text-xs bg-secondary px-1 rounded ml-1">{diagnostics.dvrDir}</code>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Activos:</span> {diagnostics.activeCount}
                  </div>
                  <div>
                    <span className="text-muted-foreground">Con errores:</span> 
                    <span className={diagnostics.channelsWithErrors > 0 ? ' text-destructive font-bold' : ''}>
                      {' '}{diagnostics.channelsWithErrors}
                    </span>
                  </div>
                </div>

                {diagnostics.errors.length > 0 && (
                  <div className="space-y-2 mt-3">
                    <p className="text-xs font-medium text-destructive">Últimos errores por canal:</p>
                    {diagnostics.errors.map((err) => (
                      <div key={err.channelId} className="p-2 rounded bg-destructive/5 border border-destructive/20 text-xs">
                        <div className="flex items-center justify-between">
                          <code className="font-mono">{err.channelId.slice(0, 8)}...</code>
                          <Badge variant="destructive" className="text-[10px]">{err.errorCount} errores</Badge>
                        </div>
                        <p className="mt-1 text-muted-foreground truncate">{err.lastError}</p>
                        <p className="text-muted-foreground/60">{new Date(err.lastErrorAt).toLocaleString()}</p>
                      </div>
                    ))}
                  </div>
                )}

                <Button variant="outline" size="sm" onClick={fetchDiagnostics} className="mt-2">
                  <RefreshCw className="w-3 h-3 mr-1" /> Refrescar diagnóstico
                </Button>
              </CardContent>
            </Card>
          </motion.div>
        )}
      </AnimatePresence>

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
              <p className="text-xs mt-1">Activa el DVR en la pestaña de Canales. El segmentador Node.js se inicia automáticamente.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {/* Active (recording) channels first */}
              {activeList.map((dvr) => (
                <div key={dvr.channelId}>
                  <div
                    className={`flex flex-wrap items-center justify-between gap-3 p-3 rounded-lg bg-card/50 border cursor-pointer transition-colors hover:bg-card/70 ${
                      (dvr.errorCount || 0) > 0 ? 'border-destructive/30' : 'border-red-500/20'
                    }`}
                    onClick={() => {
                      if (expandedChannel === dvr.channelId) {
                        setExpandedChannel(null);
                        setChannelDiag(null);
                      } else {
                        fetchChannelDiag(dvr.channelId);
                      }
                    }}
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="relative">
                        {(dvr.errorCount || 0) > 0 
                          ? <AlertTriangle className="w-5 h-5 text-destructive" />
                          : <Disc className="w-5 h-5 text-red-500 animate-pulse" />
                        }
                      </div>
                      <div className="min-w-0">
                        <p className="font-medium text-sm truncate">
                          {dvr.channelName || dvr.channelId.slice(0, 8)}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {dvr.format.toUpperCase()} • {formatUptime(dvr.uptime)}
                          {dvr.lastError && (
                            <span className="text-destructive ml-2">⚠ {dvr.lastError.substring(0, 60)}...</span>
                          )}
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
                      {dvr.ready ? (
                        <Badge className="bg-green-500/20 text-green-400 border-green-500/30 gap-1 text-xs">
                          <CheckCircle className="w-3 h-3" /> LISTO
                        </Badge>
                      ) : (
                        <Badge className="bg-red-500/20 text-red-400 border-red-500/30 gap-1 text-xs">
                          <Disc className="w-3 h-3 animate-pulse" /> REC
                        </Badge>
                      )}
                      {expandedChannel === dvr.channelId 
                        ? <ChevronUp className="w-4 h-4 text-muted-foreground" />
                        : <ChevronDown className="w-4 h-4 text-muted-foreground" />
                      }
                    </div>
                  </div>

                  {/* Expanded diagnostic detail */}
                  <AnimatePresence>
                    {expandedChannel === dvr.channelId && channelDiag && (
                      <motion.div
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: 'auto' }}
                        exit={{ opacity: 0, height: 0 }}
                        className="overflow-hidden"
                      >
                        <div className="ml-8 mt-2 p-3 rounded-lg bg-secondary/50 border border-border/30 text-xs space-y-2">
                          <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                            <div>
                              <span className="text-muted-foreground">Motor:</span>{' '}
                              <code className="bg-background px-1 rounded">{channelDiag.engine || 'Node.js nativo'}</code>
                              <CheckCircle className="w-3 h-3 text-green-500 inline ml-1" />
                            </div>
                            <div>
                              <span className="text-muted-foreground">Segmentos .ts:</span>{' '}
                              <span className="text-green-500">{channelDiag.segments}</span>
                            </div>
                            <div>
                              <span className="text-muted-foreground">Playlist:</span>{' '}
                              {channelDiag.hasPlaylist 
                                ? <span className="text-green-500">✓ existe</span>
                                : <span className="text-destructive">✗ falta</span>
                              }
                            </div>
                            <div>
                              <span className="text-muted-foreground">Segmentos:</span> {channelDiag.segments}
                            </div>
                            <div>
                              <span className="text-muted-foreground">Reinicios:</span> {channelDiag.restartCount}
                            </div>
                            <div>
                              <span className="text-muted-foreground">Pre-warm:</span>{' '}
                              {channelDiag.preWarmed ? 'Sí' : 'No'}
                            </div>
                          </div>
                          
                          {channelDiag.sourceUrl && (
                            <div>
                              <span className="text-muted-foreground">URL origen:</span>{' '}
                              <code className="bg-background px-1 rounded break-all">{channelDiag.sourceUrl}</code>
                            </div>
                          )}

                          {channelDiag.errors.length > 0 && (
                            <div className="mt-2">
                              <p className="font-medium text-destructive mb-1">
                                Historial de errores ({channelDiag.errors.length}):
                              </p>
                              <div className="max-h-40 overflow-y-auto space-y-1">
                                {channelDiag.errors.slice().reverse().map((err, i) => (
                                  <div key={i} className="p-1.5 rounded bg-destructive/5 border border-destructive/10">
                                    <div className="flex items-center justify-between">
                                      <Badge variant="outline" className="text-[10px]">{err.type}</Badge>
                                      <span className="text-muted-foreground/60">
                                        {new Date(err.timestamp).toLocaleTimeString()}
                                      </span>
                                    </div>
                                    <p className="mt-0.5 text-muted-foreground break-all">{err.message}</p>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}

                          {channelDiag.errors.length === 0 && (
                            <p className="text-green-500 flex items-center gap-1">
                              <CheckCircle className="w-3 h-3" /> Sin errores registrados
                            </p>
                          )}
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              ))}

              {/* Enabled but inactive channels */}
              {inactiveList.map((dvr) => (
                <div key={dvr.channelId}>
                  <div
                    className={`flex flex-wrap items-center justify-between gap-3 p-3 rounded-lg bg-card/30 border cursor-pointer transition-colors hover:bg-card/50 ${
                      (dvr.errorCount || 0) > 0 ? 'border-destructive/20' : 'border-border/10'
                    } opacity-70`}
                    onClick={() => {
                      if (expandedChannel === dvr.channelId) {
                        setExpandedChannel(null);
                        setChannelDiag(null);
                      } else {
                        fetchChannelDiag(dvr.channelId);
                      }
                    }}
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="relative">
                        {(dvr.errorCount || 0) > 0 
                          ? <AlertTriangle className="w-5 h-5 text-destructive" />
                          : <PowerOff className="w-5 h-5 text-muted-foreground" />
                        }
                      </div>
                      <div className="min-w-0">
                        <p className="font-medium text-sm truncate">
                          {dvr.channelName || dvr.channelId.slice(0, 8)}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {dvr.lastError 
                            ? <span className="text-destructive">⚠ {dvr.lastError.substring(0, 80)}</span>
                            : 'Esperando pre-calentamiento...'
                          }
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {(dvr.errorCount || 0) > 0 && (
                        <Badge variant="destructive" className="text-[10px]">{dvr.errorCount} errores</Badge>
                      )}
                      <Badge variant="outline" className="gap-1 text-xs text-muted-foreground">
                        <Clock className="w-3 h-3" /> Standby
                      </Badge>
                      {expandedChannel === dvr.channelId 
                        ? <ChevronUp className="w-4 h-4 text-muted-foreground" />
                        : <ChevronDown className="w-4 h-4 text-muted-foreground" />
                      }
                    </div>
                  </div>

                  {/* Expanded diagnostic for inactive too */}
                  <AnimatePresence>
                    {expandedChannel === dvr.channelId && channelDiag && (
                      <motion.div
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: 'auto' }}
                        exit={{ opacity: 0, height: 0 }}
                        className="overflow-hidden"
                      >
                        <div className="ml-8 mt-2 p-3 rounded-lg bg-secondary/50 border border-border/30 text-xs space-y-2">
                          <div className="grid grid-cols-2 gap-2">
                            <div>
                              <span className="text-muted-foreground">Motor:</span>{' '}
                              <code className="bg-background px-1 rounded">{channelDiag.engine || 'Node.js nativo'}</code>
                              <CheckCircle className="w-3 h-3 text-green-500 inline ml-1" />
                            </div>
                            <div>
                              <span className="text-muted-foreground">Reinicios:</span> {channelDiag.restartCount}
                            </div>
                          </div>
                          {channelDiag.errors.length > 0 && (
                            <div>
                              <p className="font-medium text-destructive mb-1">Errores ({channelDiag.errors.length}):</p>
                              <div className="max-h-40 overflow-y-auto space-y-1">
                                {channelDiag.errors.slice().reverse().map((err, i) => (
                                  <div key={i} className="p-1.5 rounded bg-destructive/5 border border-destructive/10">
                                    <div className="flex items-center justify-between">
                                      <Badge variant="outline" className="text-[10px]">{err.type}</Badge>
                                      <span className="text-muted-foreground/60">{new Date(err.timestamp).toLocaleTimeString()}</span>
                                    </div>
                                    <p className="mt-0.5 text-muted-foreground break-all">{err.message}</p>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}
                          {channelDiag.errors.length === 0 && (
                            <p className="text-green-500 flex items-center gap-1">
                              <CheckCircle className="w-3 h-3" /> Sin errores
                            </p>
                          )}
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
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