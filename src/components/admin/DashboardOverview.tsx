import { useState, useEffect, useCallback } from 'react';
import { apiGet } from '@/lib/api';
import { copyToClipboard } from '@/lib/clipboard';
import { useToast } from '@/hooks/use-toast';
import { Globe, Shield, ShieldCheck, ShieldOff, Activity, Server, Wifi, Copy, Check, ExternalLink, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { motion } from 'framer-motion';

interface SystemStatus {
  tunnel: {
    installed: boolean;
    status: string;
    url: string | null;
    mode: string;
  };
  xtream: {
    connected: boolean;
    host: string;
    port: string;
  };
  proxy: {
    active_connections: number;
    uptime_seconds: number;
  };
  server_ip: string | null;
}

const DashboardOverview = () => {
  const { toast } = useToast();
  const [status, setStatus] = useState<SystemStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [copiedUrl, setCopiedUrl] = useState(false);

  const fetchStatus = useCallback(async () => {
    try {
      const data = await apiGet('/api/status');
      setStatus(data);
    } catch {
      // Fallback: try individual endpoints
      try {
        const tunnel = await apiGet('/api/tunnel/status');
        setStatus({
          tunnel: { installed: tunnel.installed, status: tunnel.status, url: tunnel.url, mode: tunnel.mode },
          xtream: { connected: false, host: 'localhost', port: '25461' },
          proxy: { active_connections: 0, uptime_seconds: 0 },
          server_ip: tunnel.server_ip,
        });
      } catch {
        // Server offline
      }
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchStatus();
    const iv = setInterval(fetchStatus, 10000);
    return () => clearInterval(iv);
  }, [fetchStatus]);

  const copyUrl = async (url: string) => {
    await copyToClipboard(url);
    setCopiedUrl(true);
    toast({ title: 'Copiado' });
    setTimeout(() => setCopiedUrl(false), 2000);
  };

  if (loading) {
    return (
      <div className="text-center py-12 text-muted-foreground">
        <div className="animate-spin w-8 h-8 border-2 border-primary border-t-transparent rounded-full mx-auto mb-3" />
        Conectando con el servidor...
      </div>
    );
  }

  const tunnelRunning = status?.tunnel?.status === 'running';
  const tunnelUrl = status?.tunnel?.url;

  return (
    <div className="space-y-6">
      {/* Status Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatusCard
          icon={tunnelRunning ? ShieldCheck : ShieldOff}
          label="Túnel Cloudflare"
          value={tunnelRunning ? 'Activo' : status?.tunnel?.installed ? 'Detenido' : 'No instalado'}
          color={tunnelRunning ? 'success' : 'muted'}
        />
        <StatusCard
          icon={Server}
          label="Xtream UI"
          value={status?.xtream?.connected ? 'Conectado' : 'Desconectado'}
          color={status?.xtream?.connected ? 'success' : 'destructive'}
          sub={status?.xtream?.host ? `${status.xtream.host}:${status.xtream.port}` : undefined}
        />
        <StatusCard
          icon={Wifi}
          label="Conexiones Activas"
          value={String(status?.proxy?.active_connections ?? 0)}
          color="primary"
        />
        <StatusCard
          icon={Activity}
          label="Modo"
          value={status?.tunnel?.mode === 'full' ? 'Completo' : 'Híbrido'}
          color="accent"
          sub={status?.tunnel?.mode === 'full' ? 'Todo por CF' : 'API por CF, streams directo'}
        />
      </div>

      {/* Active URL */}
      {tunnelUrl && (
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="glass rounded-xl p-6">
          <div className="flex items-center gap-2 mb-4">
            <Globe className="w-5 h-5 text-emerald-400" />
            <h3 className="text-sm font-semibold text-foreground">URL Pública Activa</h3>
            <Badge variant="outline" className="text-emerald-400 border-emerald-400/30 text-[10px] ml-auto">HTTPS</Badge>
          </div>
          <div className="bg-muted/30 rounded-lg p-4 border border-border/30 flex items-center gap-3">
            <code className="text-primary text-sm flex-1 break-all font-mono">{tunnelUrl}</code>
            <Button variant="ghost" size="icon" onClick={() => copyUrl(tunnelUrl)} className="shrink-0 text-muted-foreground hover:text-primary">
              {copiedUrl ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
            </Button>
            <Button variant="ghost" size="icon" asChild className="shrink-0 text-muted-foreground hover:text-primary">
              <a href={tunnelUrl} target="_blank" rel="noopener noreferrer"><ExternalLink className="w-4 h-4" /></a>
            </Button>
          </div>

          {status?.tunnel?.mode === 'hybrid' && status.server_ip && (
            <div className="mt-3 bg-primary/5 rounded-lg p-3 border border-primary/10 text-xs text-muted-foreground">
              <span className="text-foreground font-medium">Modo Híbrido:</span>
              <p className="mt-1">🔒 Panel/API → <code className="bg-muted px-1 rounded text-primary">{tunnelUrl}</code></p>
              <p className="mt-0.5">📺 Streams → <code className="bg-muted px-1 rounded text-primary">http://{status.server_ip}</code></p>
            </div>
          )}
        </motion.div>
      )}

      {/* How it works */}
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }} className="glass rounded-xl p-6">
        <h3 className="text-sm font-semibold text-foreground mb-4 flex items-center gap-2">
          <Shield className="w-4 h-4 text-primary" /> ¿Cómo funciona Omnisync Shield?
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <StepCard step={1} title="Conecta con Xtream UI" desc="El proxy se conecta a tu panel Xtream UI existente en el mismo servidor o red local." />
          <StepCard step={2} title="Túnel Cloudflare" desc="Crea un túnel seguro HTTPS que oculta la IP real de tu servidor completamente." />
          <StepCard step={3} title="URL Anónima" desc="Tus clientes usan la URL de Cloudflare. Nadie puede rastrear tu servidor." />
        </div>
      </motion.div>

      {/* Refresh */}
      <div className="flex justify-center">
        <Button variant="outline" size="sm" onClick={fetchStatus} className="gap-2 text-xs text-muted-foreground">
          <RefreshCw className="w-3.5 h-3.5" /> Actualizar Estado
        </Button>
      </div>
    </div>
  );
};

const StatusCard = ({ icon: Icon, label, value, color, sub }: { icon: any; label: string; value: string; color: string; sub?: string }) => {
  const colorMap: Record<string, string> = {
    primary: 'bg-primary/15 text-primary',
    success: 'bg-emerald-500/15 text-emerald-400',
    destructive: 'bg-destructive/15 text-destructive',
    accent: 'bg-accent/15 text-accent',
    muted: 'bg-muted text-muted-foreground',
  };
  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="glass rounded-xl p-4 flex items-center gap-4">
      <div className={`w-12 h-12 rounded-xl flex items-center justify-center shrink-0 ${colorMap[color]}`}>
        <Icon className="w-6 h-6" />
      </div>
      <div className="min-w-0">
        <p className="text-lg font-bold text-foreground truncate">{value}</p>
        <p className="text-xs text-muted-foreground">{label}</p>
        {sub && <p className="text-[10px] text-muted-foreground/70 truncate">{sub}</p>}
      </div>
    </motion.div>
  );
};

const StepCard = ({ step, title, desc }: { step: number; title: string; desc: string }) => (
  <div className="bg-muted/30 rounded-lg p-4 border border-border/30">
    <div className="flex items-center gap-2 mb-2">
      <span className="bg-primary/15 text-primary w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold">{step}</span>
      <span className="text-sm font-semibold text-foreground">{title}</span>
    </div>
    <p className="text-xs text-muted-foreground">{desc}</p>
  </div>
);

export default DashboardOverview;
