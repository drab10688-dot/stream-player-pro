import { useState, useEffect, useCallback } from 'react';
import { apiGet, apiPost } from '@/lib/api';
import { useToast } from '@/hooks/use-toast';
import { Settings, Server, Check, X, Loader2, RefreshCw, Shield, AlertTriangle } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { motion } from 'framer-motion';

interface XtreamStatus {
  host: string;
  port: string;
  connected: boolean;
  server_info: {
    user_info?: any;
    server_info?: any;
  } | null;
  error: string | null;
}

const XtreamConfig = () => {
  const { toast } = useToast();
  const [config, setConfig] = useState<XtreamStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);

  const [host, setHost] = useState('http://localhost');
  const [port, setPort] = useState('25461');
  const [testUser, setTestUser] = useState('');
  const [testPass, setTestPass] = useState('');

  const fetchConfig = useCallback(async () => {
    try {
      const data = await apiGet('/api/xtream/config');
      setConfig(data);
      if (data.host) setHost(data.host);
      if (data.port) setPort(data.port);
    } catch {
      // Server might not have this endpoint yet
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchConfig();
  }, [fetchConfig]);

  const handleSave = async () => {
    setSaving(true);
    try {
      await apiPost('/api/xtream/config', { host, port });
      toast({ title: 'Guardado', description: 'Configuración de Xtream UI actualizada' });
      await fetchConfig();
    } catch (err: any) {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    }
    setSaving(false);
  };

  const handleTest = async () => {
    setTesting(true);
    try {
      const data = await apiPost('/api/xtream/test', { host, port, username: testUser, password: testPass });
      if (data.success) {
        toast({ title: '✅ Conexión exitosa', description: `Xtream UI respondió correctamente` });
      } else {
        toast({ title: 'Error', description: data.error || 'No se pudo conectar', variant: 'destructive' });
      }
      await fetchConfig();
    } catch (err: any) {
      toast({ title: 'Error de conexión', description: err.message, variant: 'destructive' });
    }
    setTesting(false);
  };

  if (loading) {
    return (
      <div className="text-center py-12 text-muted-foreground">
        <div className="animate-spin w-8 h-8 border-2 border-primary border-t-transparent rounded-full mx-auto mb-3" />
        Cargando configuración...
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Connection Config */}
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="glass rounded-xl p-6">
        <div className="flex items-center gap-3 mb-6">
          <div className="w-12 h-12 rounded-xl bg-accent/15 flex items-center justify-center">
            <Settings className="w-6 h-6 text-accent" />
          </div>
          <div>
            <h2 className="text-lg font-bold text-foreground">Conexión Xtream UI</h2>
            <p className="text-xs text-muted-foreground">Configura la conexión al panel Xtream UI en tu servidor</p>
          </div>
          <div className="ml-auto">
            {config?.connected ? (
              <Badge className="bg-emerald-500/15 text-emerald-400 border-emerald-400/30 gap-1">
                <Check className="w-3 h-3" /> Conectado
              </Badge>
            ) : (
              <Badge variant="destructive" className="gap-1">
                <X className="w-3 h-3" /> Desconectado
              </Badge>
            )}
          </div>
        </div>

        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="text-xs font-medium text-foreground mb-1.5 block">Host de Xtream UI</label>
              <Input
                value={host}
                onChange={e => setHost(e.target.value)}
                placeholder="http://localhost"
                className="bg-secondary border-border text-foreground placeholder:text-muted-foreground"
              />
              <p className="text-[10px] text-muted-foreground mt-1">Usa localhost si está en el mismo servidor</p>
            </div>
            <div>
              <label className="text-xs font-medium text-foreground mb-1.5 block">Puerto</label>
              <Input
                value={port}
                onChange={e => setPort(e.target.value)}
                placeholder="25461"
                className="bg-secondary border-border text-foreground placeholder:text-muted-foreground"
              />
              <p className="text-[10px] text-muted-foreground mt-1">Puerto por defecto: 25461</p>
            </div>
          </div>

          <Button onClick={handleSave} disabled={saving} className="gradient-primary gap-2">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
            Guardar Configuración
          </Button>
        </div>
      </motion.div>

      {/* Test Connection */}
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }} className="glass rounded-xl p-6">
        <div className="flex items-center gap-3 mb-4">
          <Server className="w-5 h-5 text-primary" />
          <h3 className="text-sm font-semibold text-foreground">Probar Conexión</h3>
        </div>
        <p className="text-xs text-muted-foreground mb-4">
          Usa cualquier credencial válida de Xtream UI para verificar que la conexión funciona.
        </p>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
          <Input
            value={testUser}
            onChange={e => setTestUser(e.target.value)}
            placeholder="Usuario de prueba"
            className="bg-secondary border-border text-foreground placeholder:text-muted-foreground"
          />
          <Input
            type="password"
            value={testPass}
            onChange={e => setTestPass(e.target.value)}
            placeholder="Contraseña"
            className="bg-secondary border-border text-foreground placeholder:text-muted-foreground"
          />
        </div>

        <div className="flex gap-2">
          <Button onClick={handleTest} disabled={testing || !testUser || !testPass} variant="outline" className="gap-2">
            {testing ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
            Probar Conexión
          </Button>
        </div>

        {config?.error && (
          <div className="mt-4 bg-destructive/10 border border-destructive/20 rounded-lg p-3 flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 text-destructive mt-0.5 shrink-0" />
            <p className="text-xs text-destructive">{config.error}</p>
          </div>
        )}
      </motion.div>

      {/* Proxy Explanation */}
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }} className="glass rounded-xl p-6">
        <h3 className="text-sm font-semibold text-foreground mb-4 flex items-center gap-2">
          <Shield className="w-4 h-4 text-primary" /> ¿Qué hace el proxy?
        </h3>
        <div className="space-y-3 text-xs text-muted-foreground">
          <div className="flex items-start gap-2">
            <span className="bg-primary/15 text-primary w-5 h-5 rounded-full flex items-center justify-center shrink-0 text-[10px] font-bold">1</span>
            <p>Recibe peticiones de <code className="bg-muted px-1 rounded text-primary">player_api.php</code> a través de la URL de Cloudflare.</p>
          </div>
          <div className="flex items-start gap-2">
            <span className="bg-primary/15 text-primary w-5 h-5 rounded-full flex items-center justify-center shrink-0 text-[10px] font-bold">2</span>
            <p>Las reenvía internamente a Xtream UI en <code className="bg-muted px-1 rounded text-primary">{host}:{port}</code>.</p>
          </div>
          <div className="flex items-start gap-2">
            <span className="bg-primary/15 text-primary w-5 h-5 rounded-full flex items-center justify-center shrink-0 text-[10px] font-bold">3</span>
            <p>Reescribe todas las URLs de respuesta para que apunten al dominio de Cloudflare, nunca a la IP real.</p>
          </div>
          <div className="flex items-start gap-2">
            <span className="bg-primary/15 text-primary w-5 h-5 rounded-full flex items-center justify-center shrink-0 text-[10px] font-bold">4</span>
            <p>Compatible con <strong>TiviMate, IPTV Smarters, VLC</strong> y cualquier app Xtream Codes.</p>
          </div>
        </div>
      </motion.div>
    </div>
  );
};

export default XtreamConfig;
