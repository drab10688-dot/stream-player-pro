import { useState, useEffect, useCallback } from 'react';
import { apiGet, apiPost } from '@/lib/api';
import { useToast } from '@/hooks/use-toast';
import { Globe, Shield, ShieldCheck, Play, Square, Download, RefreshCw, Copy, ExternalLink, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { motion } from 'framer-motion';

interface TunnelStatus {
  installed: boolean;
  status: 'stopped' | 'starting' | 'running' | 'error';
  url: string | null;
  error: string | null;
  https: boolean;
}

const TunnelManager = () => {
  const { toast } = useToast();
  const [tunnel, setTunnel] = useState<TunnelStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  const fetchStatus = useCallback(async () => {
    try {
      const data = await apiGet('/api/tunnel/status');
      setTunnel(data);
    } catch (err: any) {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchStatus();
    const interval = setInterval(fetchStatus, 5000);
    return () => clearInterval(interval);
  }, [fetchStatus]);

  const handleInstall = async () => {
    setActionLoading('install');
    try {
      const data = await apiPost('/api/tunnel/install', {});
      toast({ title: 'Éxito', description: data.message });
      await fetchStatus();
    } catch (err: any) {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    }
    setActionLoading(null);
  };

  const handleStart = async () => {
    setActionLoading('start');
    try {
      const data = await apiPost('/api/tunnel/start', { port: 80 });
      toast({ title: 'Éxito', description: data.message });
      // Poll for URL if not available yet
      if (!data.url) {
        let attempts = 0;
        const poll = setInterval(async () => {
          attempts++;
          await fetchStatus();
          if (tunnel?.url || attempts > 10) clearInterval(poll);
        }, 3000);
      }
      await fetchStatus();
    } catch (err: any) {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    }
    setActionLoading(null);
  };

  const handleStop = async () => {
    setActionLoading('stop');
    try {
      const data = await apiPost('/api/tunnel/stop', {});
      toast({ title: 'Éxito', description: data.message });
      await fetchStatus();
    } catch (err: any) {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    }
    setActionLoading(null);
  };

  const copyUrl = () => {
    if (tunnel?.url) {
      navigator.clipboard.writeText(tunnel.url);
      toast({ title: 'Copiado', description: 'URL copiada al portapapeles' });
    }
  };

  if (loading) {
    return (
      <div className="text-center py-12 text-muted-foreground">
        <div className="animate-spin w-8 h-8 border-2 border-primary border-t-transparent rounded-full mx-auto mb-3" />
        Cargando estado del túnel...
      </div>
    );
  }

  const statusConfig: Record<string, { label: string; color: string; variant: 'default' | 'secondary' | 'destructive' | 'outline' }> = {
    stopped: { label: 'Detenido', color: 'bg-muted text-muted-foreground', variant: 'secondary' },
    starting: { label: 'Iniciando...', color: 'bg-yellow-500/15 text-yellow-400', variant: 'outline' },
    running: { label: 'Activo', color: 'bg-emerald-500/15 text-emerald-400', variant: 'default' },
    error: { label: 'Error', color: 'bg-destructive/15 text-destructive', variant: 'destructive' },
  };

  const status = tunnel?.status || 'stopped';
  const config = statusConfig[status];

  return (
    <div className="space-y-6">
      {/* Header Card */}
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="glass rounded-xl p-6">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-12 h-12 rounded-xl bg-primary/15 flex items-center justify-center">
            <Globe className="w-6 h-6 text-primary" />
          </div>
          <div>
            <h2 className="text-lg font-bold text-foreground">Cloudflare Tunnel</h2>
            <p className="text-xs text-muted-foreground">Oculta la IP de tu VPS con HTTPS gratuito</p>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <Badge variant={config.variant}>{config.label}</Badge>
            <Button variant="ghost" size="icon" onClick={fetchStatus} className="text-muted-foreground">
              <RefreshCw className="w-4 h-4" />
            </Button>
          </div>
        </div>

        {/* Not installed */}
        {!tunnel?.installed && (
          <div className="bg-muted/30 rounded-lg p-4 border border-border/30">
            <div className="flex items-start gap-3">
              <Download className="w-5 h-5 text-primary mt-0.5 shrink-0" />
              <div className="flex-1">
                <p className="text-sm font-medium text-foreground mb-1">Cloudflared no está instalado</p>
                <p className="text-xs text-muted-foreground mb-3">
                  Necesitas instalar <code className="bg-muted px-1.5 py-0.5 rounded text-primary text-[11px]">cloudflared</code> para crear túneles seguros.
                </p>
                <Button onClick={handleInstall} disabled={actionLoading === 'install'} size="sm" className="gradient-primary">
                  {actionLoading === 'install' ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Instalando...</> : <><Download className="w-4 h-4 mr-2" /> Instalar cloudflared</>}
                </Button>
              </div>
            </div>
          </div>
        )}

        {/* Installed - Controls */}
        {tunnel?.installed && (
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              {status === 'stopped' || status === 'error' ? (
                <Button onClick={handleStart} disabled={!!actionLoading} className="gradient-primary gap-2">
                  {actionLoading === 'start' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
                  Iniciar Túnel
                </Button>
              ) : (
                <Button onClick={handleStop} disabled={!!actionLoading} variant="destructive" className="gap-2">
                  {actionLoading === 'stop' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Square className="w-4 h-4" />}
                  Detener Túnel
                </Button>
              )}
            </div>

            {/* Error display */}
            {tunnel.error && (
              <div className="bg-destructive/10 border border-destructive/20 rounded-lg p-3">
                <p className="text-xs text-destructive">{tunnel.error}</p>
              </div>
            )}
          </div>
        )}
      </motion.div>

      {/* URL Card - when running */}
      {tunnel?.url && (
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="glass rounded-xl p-6">
          <div className="flex items-center gap-2 mb-4">
            <ShieldCheck className="w-5 h-5 text-emerald-400" />
            <h3 className="text-sm font-semibold text-foreground">URL Segura Activa</h3>
            {tunnel.https && <Badge variant="outline" className="text-emerald-400 border-emerald-400/30 text-[10px]">HTTPS</Badge>}
          </div>

          <div className="bg-muted/30 rounded-lg p-4 border border-border/30 flex items-center gap-3">
            <code className="text-primary text-sm flex-1 break-all font-mono">{tunnel.url}</code>
            <Button variant="ghost" size="icon" onClick={copyUrl} className="shrink-0 text-muted-foreground hover:text-primary">
              <Copy className="w-4 h-4" />
            </Button>
            <Button variant="ghost" size="icon" asChild className="shrink-0 text-muted-foreground hover:text-primary">
              <a href={tunnel.url} target="_blank" rel="noopener noreferrer">
                <ExternalLink className="w-4 h-4" />
              </a>
            </Button>
          </div>

          <div className="mt-4 space-y-2">
            <div className="flex items-start gap-2">
              <Shield className="w-4 h-4 text-primary mt-0.5 shrink-0" />
              <p className="text-xs text-muted-foreground">
                <span className="text-foreground font-medium">IP oculta:</span> Los clientes solo ven la IP de Cloudflare, no la de tu VPS.
              </p>
            </div>
            <div className="flex items-start gap-2">
              <ShieldCheck className="w-4 h-4 text-emerald-400 mt-0.5 shrink-0" />
              <p className="text-xs text-muted-foreground">
                <span className="text-foreground font-medium">HTTPS automático:</span> Certificado SSL incluido sin configuración adicional.
              </p>
            </div>
          </div>

          <div className="mt-4 bg-primary/5 rounded-lg p-3 border border-primary/10">
            <p className="text-xs text-muted-foreground">
              <span className="text-foreground font-medium">💡 Comparte esta URL</span> con tus clientes en lugar de tu IP. Cada vez que reinicies el túnel se genera una URL nueva.
            </p>
          </div>
        </motion.div>
      )}

      {/* Info Card */}
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="glass rounded-xl p-5">
        <h3 className="text-sm font-semibold text-foreground mb-3">¿Cómo funciona?</h3>
        <div className="space-y-3 text-xs text-muted-foreground">
          <div className="flex items-start gap-2">
            <span className="bg-primary/15 text-primary w-5 h-5 rounded-full flex items-center justify-center shrink-0 text-[10px] font-bold">1</span>
            <p>Cloudflare crea un túnel seguro desde tu VPS hasta su red global.</p>
          </div>
          <div className="flex items-start gap-2">
            <span className="bg-primary/15 text-primary w-5 h-5 rounded-full flex items-center justify-center shrink-0 text-[10px] font-bold">2</span>
            <p>Los clientes se conectan a la URL de Cloudflare (con HTTPS gratuito).</p>
          </div>
          <div className="flex items-start gap-2">
            <span className="bg-primary/15 text-primary w-5 h-5 rounded-full flex items-center justify-center shrink-0 text-[10px] font-bold">3</span>
            <p>Cloudflare reenvía el tráfico a tu VPS sin exponer la IP real.</p>
          </div>
          <div className="flex items-start gap-2">
            <span className="bg-primary/15 text-primary w-5 h-5 rounded-full flex items-center justify-center shrink-0 text-[10px] font-bold">4</span>
            <p>Con dominio propio (~$3/año) puedes tener una URL fija permanente.</p>
          </div>
        </div>
      </motion.div>
    </div>
  );
};

export default TunnelManager;