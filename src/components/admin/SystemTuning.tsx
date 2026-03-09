import { useState, useEffect, useRef } from 'react';
import { apiGet } from '@/lib/api';
import { useToast } from '@/hooks/use-toast';
import { Cpu, HardDrive, MemoryStick, Network, Shield, CheckCircle2, XCircle, AlertTriangle, RefreshCw, Copy, ChevronDown, ChevronRight, Server, Gauge, ArrowDownToLine, ArrowUpFromLine } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { motion, AnimatePresence } from 'framer-motion';

interface SysctlParam {
  value: string;
  recommended: string | null;
  optimal: boolean | null;
  description: string;
}

interface NetworkBytes {
  interface: string;
  rx_bytes: number;
  tx_bytes: number;
}

interface SystemInfo {
  sysctl: Record<string, SysctlParam>;
  categories: Record<string, string[]>;
  hardware: {
    cpu_model: string;
    cpu_cores: number;
    cpu_speed_mhz: number;
    ram_total_gb: string;
    ram_free_gb: string;
    ram_used_gb: string;
    ram_used_percent: string;
    uptime_hours: string;
    load_avg: string[];
    kernel: string;
  };
  disk: { total_gb: string; used_gb: string; avail_gb: string; percent: string };
  hls_cache_disk: { total_gb: string; used_gb: string; avail_gb: string; percent: string } | null;
  network: NetworkBytes | null;
  files: { open: string; max: string; ulimit: string };
  status: {
    config_applied: boolean;
    bbr_loaded: boolean;
    optimized_count: number;
    total_params: number;
    score_percent: number;
  };
}

const categoryIcons: Record<string, any> = {
  'TCP Congestion': Network,
  'Buffers de Red': Network,
  'Conexiones': Network,
  'TCP Keepalive': Network,
  'TCP Avanzado': Network,
  'Sistema de Archivos': HardDrive,
  'Memoria Virtual': MemoryStick,
};

const SystemTuning = () => {
  const [data, setData] = useState<SystemInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [expandedCats, setExpandedCats] = useState<Record<string, boolean>>({});
  const { toast } = useToast();

  const fetchData = async () => {
    setLoading(true);
    try {
      const res = await apiGet('/api/admin/system-info');
      setData(res);
    } catch {
      toast({ title: 'Error', description: 'No se pudo obtener info del sistema. Verifica que el servidor esté actualizado.', variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchData(); }, []);

  const toggleCat = (cat: string) => setExpandedCats(prev => ({ ...prev, [cat]: !prev[cat] }));

  const copyFixCommand = () => {
    const cmd = `sudo curl -sL https://raw.githubusercontent.com/tu-repo/main/server/install.sh | grep -A100 'sysctl.d/99-streambox' | head -80 > /etc/sysctl.d/99-streambox.conf && sudo sysctl -p /etc/sysctl.d/99-streambox.conf`;
    navigator.clipboard.writeText(cmd);
    toast({ title: 'Copiado', description: 'Comando copiado al portapapeles' });
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="animate-spin w-8 h-8 border-2 border-primary border-t-transparent rounded-full" />
      </div>
    );
  }

  if (!data) {
    return (
      <div className="text-center py-20 text-muted-foreground">
        <Server className="w-12 h-12 mx-auto mb-4 opacity-50" />
        <p>No se pudo conectar al servidor</p>
        <p className="text-sm mt-1">Este módulo requiere la API local del VPS</p>
        <Button onClick={fetchData} className="mt-4" variant="outline" size="sm">
          <RefreshCw className="w-4 h-4 mr-2" /> Reintentar
        </Button>
      </div>
    );
  }

  const scoreColor = data.status.score_percent >= 80 ? 'text-green-400' : data.status.score_percent >= 50 ? 'text-yellow-400' : 'text-red-400';
  const ramPercent = parseInt(data.hardware.ram_used_percent);
  const diskPercent = parseInt(data.disk.percent);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-foreground flex items-center gap-2">
            <Shield className="w-5 h-5 text-primary" /> Optimización del Sistema
          </h2>
          <p className="text-sm text-muted-foreground mt-1">Parámetros del kernel y recursos del servidor</p>
        </div>
        <Button onClick={fetchData} variant="outline" size="sm">
          <RefreshCw className="w-4 h-4 mr-2" /> Actualizar
        </Button>
      </div>

      {/* Score + Hardware Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Score */}
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="glass-strong rounded-xl p-4 border border-border/30">
          <div className="flex items-center gap-3 mb-3">
            <Gauge className="w-5 h-5 text-primary" />
            <span className="text-sm font-medium text-muted-foreground">Puntuación</span>
          </div>
          <div className={`text-3xl font-bold ${scoreColor}`}>{data.status.score_percent}%</div>
          <p className="text-xs text-muted-foreground mt-1">
            {data.status.optimized_count}/{data.status.total_params} parámetros óptimos
          </p>
          <div className="mt-2 flex gap-2">
            {data.status.config_applied && <Badge variant="outline" className="text-green-400 border-green-400/30 text-[10px]">Config aplicada</Badge>}
            {data.status.bbr_loaded && <Badge variant="outline" className="text-green-400 border-green-400/30 text-[10px]">BBR activo</Badge>}
          </div>
        </motion.div>

        {/* CPU */}
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }} className="glass-strong rounded-xl p-4 border border-border/30">
          <div className="flex items-center gap-3 mb-3">
            <Cpu className="w-5 h-5 text-primary" />
            <span className="text-sm font-medium text-muted-foreground">CPU</span>
          </div>
          <div className="text-lg font-bold text-foreground truncate" title={data.hardware.cpu_model}>
            {data.hardware.cpu_cores} Cores
          </div>
          <p className="text-xs text-muted-foreground mt-1 truncate" title={data.hardware.cpu_model}>
            {data.hardware.cpu_model}
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            Load: {data.hardware.load_avg.join(' / ')}
          </p>
        </motion.div>

        {/* RAM */}
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }} className="glass-strong rounded-xl p-4 border border-border/30">
          <div className="flex items-center gap-3 mb-3">
            <MemoryStick className="w-5 h-5 text-primary" />
            <span className="text-sm font-medium text-muted-foreground">RAM</span>
          </div>
          <div className="text-lg font-bold text-foreground">{data.hardware.ram_used_gb} / {data.hardware.ram_total_gb} GB</div>
          <Progress value={ramPercent} className="mt-2 h-2" />
          <p className="text-xs text-muted-foreground mt-1">{data.hardware.ram_free_gb} GB libres ({ramPercent}% uso)</p>
        </motion.div>

        {/* Disco */}
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 }} className="glass-strong rounded-xl p-4 border border-border/30">
          <div className="flex items-center gap-3 mb-3">
            <HardDrive className="w-5 h-5 text-primary" />
            <span className="text-sm font-medium text-muted-foreground">Disco</span>
          </div>
          <div className="text-lg font-bold text-foreground">{data.disk.used_gb} / {data.disk.total_gb} GB</div>
          <Progress value={diskPercent} className="mt-2 h-2" />
          <p className="text-xs text-muted-foreground mt-1">{data.disk.avail_gb} GB libres ({data.disk.percent} uso)</p>
        </motion.div>
      </div>

      {/* Extra info row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="glass rounded-lg p-3 border border-border/20 text-center">
          <p className="text-xs text-muted-foreground">Kernel</p>
          <p className="text-sm font-mono text-foreground truncate">{data.hardware.kernel}</p>
        </div>
        <div className="glass rounded-lg p-3 border border-border/20 text-center">
          <p className="text-xs text-muted-foreground">Uptime</p>
          <p className="text-sm font-mono text-foreground">{data.hardware.uptime_hours}h</p>
        </div>
        <div className="glass rounded-lg p-3 border border-border/20 text-center">
          <p className="text-xs text-muted-foreground">Archivos abiertos</p>
          <p className="text-sm font-mono text-foreground">{data.files.open} / {data.files.max}</p>
        </div>
        <div className="glass rounded-lg p-3 border border-border/20 text-center">
          <p className="text-xs text-muted-foreground">ulimit -n</p>
          <p className="text-sm font-mono text-foreground">{data.files.ulimit}</p>
        </div>
      </div>

      {/* HLS Cache Disk */}
      {data.hls_cache_disk && (
        <div className="glass-strong rounded-xl p-4 border border-border/30">
          <div className="flex items-center gap-3 mb-2">
            <HardDrive className="w-4 h-4 text-primary" />
            <span className="text-sm font-medium text-foreground">Caché HLS (SSD)</span>
          </div>
          <div className="flex items-center gap-4">
            <span className="text-sm text-muted-foreground">{data.hls_cache_disk.used_gb} / {data.hls_cache_disk.total_gb} GB ({data.hls_cache_disk.percent})</span>
            <Progress value={parseInt(data.hls_cache_disk.percent)} className="flex-1 h-2" />
          </div>
        </div>
      )}

      {/* Warning if score < 80 */}
      {data.status.score_percent < 80 && (
        <div className="glass-strong rounded-xl p-4 border border-yellow-500/30 bg-yellow-500/5">
          <div className="flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-yellow-400 mt-0.5 shrink-0" />
            <div className="flex-1">
              <p className="text-sm font-medium text-yellow-400">Servidor no optimizado para streaming</p>
              <p className="text-xs text-muted-foreground mt-1">
                Ejecuta el instalador nuevamente o aplica la configuración sysctl manualmente para obtener el máximo rendimiento.
              </p>
              <div className="mt-3 p-2 rounded bg-background/50 font-mono text-xs text-muted-foreground overflow-x-auto">
                sudo sysctl -p /etc/sysctl.d/99-streambox.conf
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Sysctl Categories */}
      <div className="space-y-3">
        <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
          <Network className="w-4 h-4 text-primary" /> Parámetros del Kernel (sysctl)
        </h3>

        {Object.entries(data.categories).map(([catName, keys]) => {
          const expanded = expandedCats[catName] ?? false;
          const catParams = keys.map(k => data.sysctl[k]).filter(Boolean);
          const optimalCount = catParams.filter(p => p.optimal === true).length;
          const allOptimal = optimalCount === catParams.length;
          const Icon = categoryIcons[catName] || Network;

          return (
            <motion.div key={catName} className="glass-strong rounded-xl border border-border/30 overflow-hidden">
              <button
                onClick={() => toggleCat(catName)}
                className="w-full flex items-center justify-between p-4 hover:bg-accent/5 transition-colors"
              >
                <div className="flex items-center gap-3">
                  <Icon className="w-4 h-4 text-primary" />
                  <span className="font-medium text-foreground text-sm">{catName}</span>
                  <Badge variant="outline" className={`text-[10px] ${allOptimal ? 'text-green-400 border-green-400/30' : 'text-yellow-400 border-yellow-400/30'}`}>
                    {optimalCount}/{catParams.length}
                  </Badge>
                </div>
                <div className="flex items-center gap-2">
                  {allOptimal ? (
                    <CheckCircle2 className="w-4 h-4 text-green-400" />
                  ) : (
                    <AlertTriangle className="w-4 h-4 text-yellow-400" />
                  )}
                  {expanded ? <ChevronDown className="w-4 h-4 text-muted-foreground" /> : <ChevronRight className="w-4 h-4 text-muted-foreground" />}
                </div>
              </button>

              <AnimatePresence>
                {expanded && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.2 }}
                    className="overflow-hidden"
                  >
                    <div className="border-t border-border/20 divide-y divide-border/10">
                      {keys.map(key => {
                        const param = data.sysctl[key];
                        if (!param) return null;
                        return (
                          <div key={key} className="px-4 py-3 flex items-center gap-3 text-sm">
                            <div className="shrink-0">
                              {param.optimal === true ? (
                                <CheckCircle2 className="w-4 h-4 text-green-400" />
                              ) : param.optimal === false ? (
                                <XCircle className="w-4 h-4 text-red-400" />
                              ) : (
                                <AlertTriangle className="w-4 h-4 text-muted-foreground" />
                              )}
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="font-mono text-xs text-foreground truncate">{key}</p>
                              <p className="text-xs text-muted-foreground">{param.description}</p>
                            </div>
                            <div className="text-right shrink-0">
                              <p className={`font-mono text-xs ${param.optimal === true ? 'text-green-400' : param.optimal === false ? 'text-red-400' : 'text-muted-foreground'}`}>
                                {param.value}
                              </p>
                              {param.optimal === false && param.recommended && (
                                <p className="text-[10px] text-muted-foreground">
                                  rec: {param.recommended}
                                </p>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.div>
          );
        })}
      </div>
    </div>
  );
};

export default SystemTuning;
