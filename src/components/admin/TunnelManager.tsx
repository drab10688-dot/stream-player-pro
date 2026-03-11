import { useState, useEffect, useCallback } from 'react';
import { apiGet, apiPost } from '@/lib/api';
import { copyToClipboard } from '@/lib/clipboard';
import { useToast } from '@/hooks/use-toast';
import { Globe, Shield, ShieldCheck, Play, Square, Download, RefreshCw, Copy, ExternalLink, Loader2, Monitor, Split, Server } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { motion } from 'framer-motion';

interface XtreamTunnelStatus {
  status: 'stopped' | 'running';
  url: string | null;
  error: string | null;
  port: string;
}

interface TunnelStatus {
  installed: boolean;
  status: 'stopped' | 'starting' | 'running' | 'error';
  url: string | null;
  error: string | null;
  https: boolean;
  mode: 'full' | 'hybrid';
  server_ip: string | null;
  stream_base_url: string | null;
  xtream_tunnel?: XtreamTunnelStatus;
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

  const handleXtreamStart = async () => {
    setActionLoading('xtream-start');
    try {
      const data = await apiPost('/api/tunnel/xtream/start', {});
      toast({ title: 'Éxito', description: data.message });
      if (!data.url) {
        let attempts = 0;
        const poll = setInterval(async () => {
          attempts++;
          await fetchStatus();
          if (tunnel?.xtream_tunnel?.url || attempts > 10) clearInterval(poll);
        }, 3000);
      }
      await fetchStatus();
    } catch (err: any) {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    }
    setActionLoading(null);
  };

  const handleXtreamStop = async () => {
    setActionLoading('xtream-stop');
    try {
      const data = await apiPost('/api/tunnel/xtream/stop', {});
      toast({ title: 'Éxito', description: data.message });
      await fetchStatus();
    } catch (err: any) {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    }
    setActionLoading(null);
  };

  const copyUrl = async () => {
    if (tunnel?.url) {
      await copyToClipboard(tunnel.url);
      toast({ title: 'Copiado', description: 'URL copiada al portapapeles' });
    }
  };

  const copyXtreamUrl = async () => {
    if (tunnel?.xtream_tunnel?.url) {
      await copyToClipboard(tunnel.xtream_tunnel.url);
      toast({ title: 'Copiado', description: 'URL de Xtream UI copiada al portapapeles' });
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
  const xtreamStatus = tunnel?.xtream_tunnel?.status || 'stopped';
  const xtreamConfig = statusConfig[xtreamStatus];

  return (
    <div className="space-y-6">
      {/* Shield Tunnel Card */}
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="glass rounded-xl p-6">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-12 h-12 rounded-xl bg-primary/15 flex items-center justify-center">
            <Globe className="w-6 h-6 text-primary" />
          </div>
          <div>
            <h2 className="text-lg font-bold text-foreground">Túnel Shield</h2>
            <p className="text-xs text-muted-foreground">Panel Shield + Proxy de streams con HTTPS</p>
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
            {/* Mode selector */}
            <div className="bg-muted/30 rounded-lg p-4 border border-border/30">
              <p className="text-xs font-medium text-foreground mb-3">Modo del túnel</p>
              <div className="grid grid-cols-2 gap-2">
                <button
                  onClick={async () => {
                    try {
                      await apiPost('/api/tunnel/mode', { mode: 'full' });
                      await fetchStatus();
                      toast({ title: 'Modo cambiado', description: 'Todo el tráfico pasa por Cloudflare' });
                    } catch (err: any) { toast({ title: 'Error', description: err.message, variant: 'destructive' }); }
                  }}
                  className={`p-3 rounded-lg border text-left transition-all ${tunnel.mode === 'full' ? 'border-primary bg-primary/10' : 'border-border/30 hover:border-border'}`}
                >
                  <div className="flex items-center gap-2 mb-1">
                    <Shield className="w-4 h-4 text-primary" />
                    <span className="text-xs font-semibold text-foreground">Completo</span>
                  </div>
                  <p className="text-[10px] text-muted-foreground">Todo por Cloudflare. Máxima privacidad.</p>
                </button>
                <button
                  onClick={async () => {
                    try {
                      await apiPost('/api/tunnel/mode', { mode: 'hybrid' });
                      await fetchStatus();
                      toast({ title: 'Modo cambiado', description: 'Admin por túnel, streams por IP directa' });
                    } catch (err: any) { toast({ title: 'Error', description: err.message, variant: 'destructive' }); }
                  }}
                  className={`p-3 rounded-lg border text-left transition-all ${tunnel.mode === 'hybrid' ? 'border-primary bg-primary/10' : 'border-border/30 hover:border-border'}`}
                >
                  <div className="flex items-center gap-2 mb-1">
                    <Split className="w-4 h-4 text-primary" />
                    <span className="text-xs font-semibold text-foreground">Híbrido</span>
                  </div>
                  <p className="text-[10px] text-muted-foreground">Admin por túnel, streams por IP. Cumple ToS.</p>
                </button>
              </div>
            </div>

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

            {/* Hybrid mode info */}
            {tunnel.mode === 'hybrid' && tunnel.server_ip && status === 'running' && (
              <div className="bg-primary/5 rounded-lg p-3 border border-primary/10">
                <div className="flex items-start gap-2">
                  <Monitor className="w-4 h-4 text-primary mt-0.5 shrink-0" />
                  <div className="text-xs text-muted-foreground">
                    <span className="text-foreground font-medium">Modo híbrido activo</span>
                    <p className="mt-1">🔒 Admin/Login → <code className="bg-muted px-1 rounded text-primary">{tunnel.url}</code></p>
                    <p className="mt-0.5">📺 Streams → <code className="bg-muted px-1 rounded text-primary">http://{tunnel.server_ip}</code></p>
                  </div>
                </div>
              </div>
            )}

            {/* Error display */}
            {tunnel.error && (
              <div className="bg-destructive/10 border border-destructive/20 rounded-lg p-3">
                <p className="text-xs text-destructive">{tunnel.error}</p>
              </div>
            )}
          </div>
        )}
      </motion.div>

      {/* Shield URL Card */}
      {tunnel?.url && (
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="glass rounded-xl p-6">
          <div className="flex items-center gap-2 mb-4">
            <ShieldCheck className="w-5 h-5 text-emerald-400" />
            <h3 className="text-sm font-semibold text-foreground">URL Shield Activa</h3>
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

      {/* Xtream UI Tunnel Card */}
      {tunnel?.installed && (
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }} className="glass rounded-xl p-6">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-12 h-12 rounded-xl bg-yellow-500/15 flex items-center justify-center">
              <Server className="w-6 h-6 text-yellow-400" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-foreground">Túnel Xtream UI</h2>
              <p className="text-xs text-muted-foreground">Acceso seguro al panel de administración de Xtream UI (puerto {tunnel.xtream_tunnel?.port || '25500'})</p>
            </div>
            <div className="ml-auto">
              <Badge variant={xtreamConfig.variant}>{xtreamConfig.label}</Badge>
            </div>
          </div>

          <div className="flex items-center gap-3 mb-4">
            {xtreamStatus === 'stopped' ? (
              <Button onClick={handleXtreamStart} disabled={!!actionLoading} className="bg-yellow-500 hover:bg-yellow-600 text-yellow-950 gap-2">
                {actionLoading === 'xtream-start' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
                Iniciar Túnel Xtream UI
              </Button>
            ) : (
              <Button onClick={handleXtreamStop} disabled={!!actionLoading} variant="destructive" className="gap-2">
                {actionLoading === 'xtream-stop' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Square className="w-4 h-4" />}
                Detener
              </Button>
            )}
          </div>

          {/* Xtream URL */}
          {tunnel.xtream_tunnel?.url && (
            <div className="bg-muted/30 rounded-lg p-4 border border-border/30 flex items-center gap-3">
              <code className="text-yellow-400 text-sm flex-1 break-all font-mono">{tunnel.xtream_tunnel.url}</code>
              <Button variant="ghost" size="icon" onClick={copyXtreamUrl} className="shrink-0 text-muted-foreground hover:text-yellow-400">
                <Copy className="w-4 h-4" />
              </Button>
              <Button variant="ghost" size="icon" asChild className="shrink-0 text-muted-foreground hover:text-yellow-400">
                <a href={tunnel.xtream_tunnel.url} target="_blank" rel="noopener noreferrer">
                  <ExternalLink className="w-4 h-4" />
                </a>
              </Button>
            </div>
          )}

          {tunnel.xtream_tunnel?.error && (
            <div className="mt-3 bg-destructive/10 border border-destructive/20 rounded-lg p-3">
              <p className="text-xs text-destructive">{tunnel.xtream_tunnel.error}</p>
            </div>
          )}

          <div className="mt-4 bg-yellow-500/5 rounded-lg p-3 border border-yellow-500/10">
            <p className="text-xs text-muted-foreground">
              <span className="text-foreground font-medium">⚠️ Solo para administración.</span> Este túnel expone el panel de Xtream UI. No compartas esta URL con clientes.
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