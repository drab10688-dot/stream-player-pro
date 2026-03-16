import { useState, useEffect, useRef } from 'react';
import { apiGet } from '@/lib/api';
import { ArrowDownToLine, ArrowUpFromLine, Activity, Wifi } from 'lucide-react';
import { motion } from 'framer-motion';

interface BandwidthData {
  rx_mbps: number;
  tx_mbps: number;
  rx_total_gb: number;
  tx_total_gb: number;
  interface: string;
}

interface HistoryPoint {
  time: number;
  rx: number;
  tx: number;
}

const MAX_HISTORY = 60; // 60 data points = 2 minutes at 2s interval

const BandwidthMonitor = () => {
  const [data, setData] = useState<BandwidthData | null>(null);
  const [history, setHistory] = useState<HistoryPoint[]>([]);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval>>();

  const fetchBandwidth = async () => {
    try {
      const result = await apiGet('/api/admin/bandwidth');
      setData(result);
      setHistory(prev => {
        const next = [...prev, { time: Date.now(), rx: result.rx_mbps, tx: result.tx_mbps }];
        return next.slice(-MAX_HISTORY);
      });
    } catch {
      // Silently fail - server might not support this yet
    }
  };

  useEffect(() => {
    fetchBandwidth();
    intervalRef.current = setInterval(fetchBandwidth, 2000);
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, []);

  // Draw mini graph
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

    const maxVal = Math.max(
      ...history.map(p => p.rx),
      ...history.map(p => p.tx),
      1
    );

    const drawLine = (points: number[], color: string, alpha: number) => {
      ctx.beginPath();
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.5;
      ctx.globalAlpha = alpha;
      points.forEach((val, i) => {
        const x = (i / (MAX_HISTORY - 1)) * w;
        const y = h - (val / maxVal) * (h - 4) - 2;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.stroke();

      // Fill area
      ctx.globalAlpha = alpha * 0.15;
      ctx.lineTo(w, h);
      ctx.lineTo(0, h);
      ctx.closePath();
      ctx.fillStyle = color;
      ctx.fill();
      ctx.globalAlpha = 1;
    };

    // Pad with zeros if not enough data
    const pad = (arr: number[]) => {
      const padded = new Array(MAX_HISTORY - arr.length).fill(0);
      return [...padded, ...arr];
    };

    drawLine(pad(history.map(p => p.rx)), '#22c55e', 0.9); // green for download
    drawLine(pad(history.map(p => p.tx)), '#3b82f6', 0.9); // blue for upload
  }, [history]);

  const formatMbps = (val: number) => {
    if (val >= 1000) return `${(val / 1000).toFixed(1)} Gbps`;
    if (val >= 100) return `${val.toFixed(0)} Mbps`;
    if (val >= 10) return `${val.toFixed(1)} Mbps`;
    return `${val.toFixed(2)} Mbps`;
  };

  return (
    <div className="space-y-4">
      <h2 className="font-display font-semibold text-xl text-foreground flex items-center gap-2">
        <Wifi className="w-5 h-5 text-primary" />
        Monitor de Ancho de Banda
      </h2>

      {!data ? (
        <div className="glass rounded-xl p-8 text-center">
          <Activity className="w-10 h-10 text-muted-foreground mx-auto mb-3 animate-pulse" />
          <p className="text-sm text-muted-foreground">Conectando al monitor de red...</p>
          <p className="text-xs text-muted-foreground mt-1">Asegúrate de que el servidor tenga el endpoint <code className="bg-muted px-1.5 rounded text-primary">/api/admin/bandwidth</code></p>
        </div>
      ) : (
        <>
          {/* Real-time cards */}
          <div className="grid grid-cols-2 gap-3">
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className="glass rounded-xl p-4"
            >
              <div className="flex items-center gap-2 mb-2">
                <div className="w-8 h-8 rounded-lg bg-emerald-500/15 flex items-center justify-center">
                  <ArrowDownToLine className="w-4 h-4 text-emerald-400" />
                </div>
                <span className="text-xs text-muted-foreground uppercase tracking-wider">Entrada (RX)</span>
              </div>
              <p className="text-2xl font-bold text-foreground">{formatMbps(data.rx_mbps)}</p>
              <p className="text-[10px] text-muted-foreground mt-1">Total: {data.rx_total_gb.toFixed(2)} GB</p>
            </motion.div>

            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.05 }}
              className="glass rounded-xl p-4"
            >
              <div className="flex items-center gap-2 mb-2">
                <div className="w-8 h-8 rounded-lg bg-blue-500/15 flex items-center justify-center">
                  <ArrowUpFromLine className="w-4 h-4 text-blue-400" />
                </div>
                <span className="text-xs text-muted-foreground uppercase tracking-wider">Salida (TX)</span>
              </div>
              <p className="text-2xl font-bold text-foreground">{formatMbps(data.tx_mbps)}</p>
              <p className="text-[10px] text-muted-foreground mt-1">Total: {data.tx_total_gb.toFixed(2)} GB</p>
            </motion.div>
          </div>

          {/* Mini graph */}
          <div className="glass rounded-xl p-4">
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs text-muted-foreground">Últimos 2 minutos</span>
              <div className="flex items-center gap-3">
                <span className="flex items-center gap-1 text-[10px] text-emerald-400">
                  <span className="w-2 h-2 rounded-full bg-emerald-400" /> RX
                </span>
                <span className="flex items-center gap-1 text-[10px] text-blue-400">
                  <span className="w-2 h-2 rounded-full bg-blue-400" /> TX
                </span>
              </div>
            </div>
            <canvas
              ref={canvasRef}
              className="w-full h-24 rounded-lg"
              style={{ background: 'hsl(var(--muted) / 0.3)' }}
            />
            <div className="flex items-center justify-between mt-2 text-[10px] text-muted-foreground">
              <span>Interfaz: {data.interface}</span>
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

export default BandwidthMonitor;
