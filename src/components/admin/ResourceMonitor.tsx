import { useState, useEffect, useRef } from 'react';
import { apiGet } from '@/lib/api';
import { Cpu, MemoryStick, HardDrive, Activity, Server, Clock } from 'lucide-react';
import { motion } from 'framer-motion';
import { Progress } from '@/components/ui/progress';

interface ResourceData {
  cpu_percent: number;
  cpu_cores: number;
  cpu_model: string;
  ram_total_gb: number;
  ram_used_gb: number;
  ram_free_gb: number;
  ram_percent: number;
  disk_total_gb: number;
  disk_used_gb: number;
  disk_percent: number;
  load_avg: number[];
  uptime_hours: number;
}

interface HistoryPoint {
  time: number;
  cpu: number;
  ram: number;
}

const MAX_HISTORY = 60;

const ResourceMonitor = () => {
  const [data, setData] = useState<ResourceData | null>(null);
  const [history, setHistory] = useState<HistoryPoint[]>([]);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval>>();

  const fetchResources = async () => {
    try {
      const result = await apiGet('/api/admin/resources');
      setData(result);
      setHistory(prev => {
        const next = [...prev, { time: Date.now(), cpu: result.cpu_percent, ram: result.ram_percent }];
        return next.slice(-MAX_HISTORY);
      });
    } catch {
      // Server might not support this yet
    }
  };

  useEffect(() => {
    fetchResources();
    intervalRef.current = setInterval(fetchResources, 2000);
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, []);

  // Draw graph
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || history.length < 2) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, w, h);

    // Grid lines
    ctx.strokeStyle = 'hsl(var(--border) / 0.15)';
    ctx.lineWidth = 0.5;
    for (let i = 0; i <= 4; i++) {
      const y = (h / 4) * i;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
    }

    const drawLine = (points: number[], color: string, alpha: number) => {
      ctx.beginPath();
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.globalAlpha = alpha;
      points.forEach((val, i) => {
        const x = (i / (MAX_HISTORY - 1)) * w;
        const y = h - (val / 100) * (h - 4) - 2;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.stroke();

      // Fill
      ctx.globalAlpha = alpha * 0.1;
      ctx.lineTo(w, h);
      ctx.lineTo(0, h);
      ctx.closePath();
      ctx.fillStyle = color;
      ctx.fill();
      ctx.globalAlpha = 1;
    };

    const pad = (arr: number[]) => {
      const padded = new Array(MAX_HISTORY - arr.length).fill(0);
      return [...padded, ...arr];
    };

    drawLine(pad(history.map(p => p.cpu)), '#f97316', 0.9); // orange for CPU
    drawLine(pad(history.map(p => p.ram)), '#a855f7', 0.9); // purple for RAM
  }, [history]);

  const getColor = (percent: number) => {
    if (percent >= 90) return 'text-destructive';
    if (percent >= 70) return 'text-yellow-400';
    return 'text-emerald-400';
  };

  const getProgressColor = (percent: number) => {
    if (percent >= 90) return '[&>div]:bg-destructive';
    if (percent >= 70) return '[&>div]:bg-yellow-400';
    return '[&>div]:bg-emerald-400';
  };

  const formatUptime = (hours: number) => {
    if (hours >= 24) {
      const days = Math.floor(hours / 24);
      const h = Math.floor(hours % 24);
      return `${days}d ${h}h`;
    }
    return `${hours.toFixed(1)}h`;
  };

  return (
    <div className="space-y-4">
      <h2 className="font-display font-semibold text-xl text-foreground flex items-center gap-2">
        <Server className="w-5 h-5 text-primary" />
        Monitor de Recursos
      </h2>

      {!data ? (
        <div className="glass rounded-xl p-8 text-center">
          <Activity className="w-10 h-10 text-muted-foreground mx-auto mb-3 animate-pulse" />
          <p className="text-sm text-muted-foreground">Conectando al monitor de recursos...</p>
          <p className="text-xs text-muted-foreground mt-1">Asegúrate de que el servidor tenga el endpoint <code className="bg-muted px-1.5 rounded text-primary">/api/admin/resources</code></p>
        </div>
      ) : (
        <>
          {/* CPU, RAM, Disk cards */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {/* CPU */}
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className="glass rounded-xl p-4"
            >
              <div className="flex items-center gap-2 mb-3">
                <div className="w-8 h-8 rounded-lg bg-orange-500/15 flex items-center justify-center">
                  <Cpu className="w-4 h-4 text-orange-400" />
                </div>
                <span className="text-xs text-muted-foreground uppercase tracking-wider">CPU</span>
              </div>
              <p className={`text-3xl font-bold ${getColor(data.cpu_percent)}`}>{data.cpu_percent}%</p>
              <Progress value={data.cpu_percent} className={`mt-2 h-1.5 ${getProgressColor(data.cpu_percent)}`} />
              <p className="text-[10px] text-muted-foreground mt-2">{data.cpu_cores} cores • {data.cpu_model.split(' ').slice(0, 3).join(' ')}</p>
              <p className="text-[10px] text-muted-foreground">Load: {data.load_avg.join(' / ')}</p>
            </motion.div>

            {/* RAM */}
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.05 }}
              className="glass rounded-xl p-4"
            >
              <div className="flex items-center gap-2 mb-3">
                <div className="w-8 h-8 rounded-lg bg-purple-500/15 flex items-center justify-center">
                  <MemoryStick className="w-4 h-4 text-purple-400" />
                </div>
                <span className="text-xs text-muted-foreground uppercase tracking-wider">RAM</span>
              </div>
              <p className={`text-3xl font-bold ${getColor(data.ram_percent)}`}>{data.ram_percent}%</p>
              <Progress value={data.ram_percent} className={`mt-2 h-1.5 ${getProgressColor(data.ram_percent)}`} />
              <p className="text-[10px] text-muted-foreground mt-2">{data.ram_used_gb} GB / {data.ram_total_gb} GB</p>
              <p className="text-[10px] text-muted-foreground">Libre: {data.ram_free_gb} GB</p>
            </motion.div>

            {/* Disk */}
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.1 }}
              className="glass rounded-xl p-4"
            >
              <div className="flex items-center gap-2 mb-3">
                <div className="w-8 h-8 rounded-lg bg-blue-500/15 flex items-center justify-center">
                  <HardDrive className="w-4 h-4 text-blue-400" />
                </div>
                <span className="text-xs text-muted-foreground uppercase tracking-wider">Disco</span>
              </div>
              <p className={`text-3xl font-bold ${getColor(data.disk_percent)}`}>{data.disk_percent}%</p>
              <Progress value={data.disk_percent} className={`mt-2 h-1.5 ${getProgressColor(data.disk_percent)}`} />
              <p className="text-[10px] text-muted-foreground mt-2">{data.disk_used_gb} GB / {data.disk_total_gb} GB</p>
            </motion.div>
          </div>

          {/* Uptime bar */}
          <div className="glass rounded-xl px-4 py-3 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Clock className="w-4 h-4 text-muted-foreground" />
              <span className="text-xs text-muted-foreground">Uptime</span>
            </div>
            <span className="text-sm font-semibold text-foreground">{formatUptime(data.uptime_hours)}</span>
          </div>

          {/* Real-time graph */}
          <div className="glass rounded-xl p-4">
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs text-muted-foreground">Últimos 2 minutos</span>
              <div className="flex items-center gap-3">
                <span className="flex items-center gap-1 text-[10px] text-orange-400">
                  <span className="w-2 h-2 rounded-full bg-orange-400" /> CPU
                </span>
                <span className="flex items-center gap-1 text-[10px] text-purple-400">
                  <span className="w-2 h-2 rounded-full bg-purple-400" /> RAM
                </span>
              </div>
            </div>
            <canvas
              ref={canvasRef}
              className="w-full h-28 rounded-lg"
              style={{ background: 'hsl(var(--muted) / 0.3)' }}
            />
            <div className="flex items-center justify-between mt-2 text-[10px] text-muted-foreground">
              <span>0-100%</span>
              <span className="flex items-center gap-1">
                <Activity className="w-3 h-3 animate-pulse text-primary" /> Tiempo real (2s)
              </span>
            </div>
          </div>
        </>
      )}
    </div>
  );
};

export default ResourceMonitor;
