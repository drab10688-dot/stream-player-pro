import { useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { apiGet, apiPost } from '@/lib/api';
import { isLovablePreview } from '@/lib/utils';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { copyToClipboard } from '@/lib/clipboard';
import { Upload, Download, Link, Copy, Check, Loader2, ArrowRightLeft, Globe, FileText } from 'lucide-react';

const ChannelSync = () => {
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);

  // Export
  const [exportToken, setExportToken] = useState('');
  const [exportCount, setExportCount] = useState(0);
  const [copied, setCopied] = useState(false);

  // Import via token
  const [importToken, setImportToken] = useState('');
  const [importMode, setImportMode] = useState<'merge' | 'replace'>('merge');

  // Pull from remote
  const [remoteUrl, setRemoteUrl] = useState('');
  const [remoteAdminToken, setRemoteAdminToken] = useState('');
  const [pullMode, setPullMode] = useState<'merge' | 'replace'>('merge');

  const handleExport = async () => {
    setLoading(true);
    try {
      if (isLovablePreview()) {
        const { data, error } = await supabase.functions.invoke('channel-sync', {
          body: {},
          headers: {},
        });
        // Use query param approach
        const session = await supabase.auth.getSession();
        const token = session.data.session?.access_token;
        const resp = await fetch(
          `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/channel-sync?action=export`,
          {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${token}`,
              'Content-Type': 'application/json',
              'apikey': import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
            },
          }
        );
        const result = await resp.json();
        if (!resp.ok) throw new Error(result.error);
        setExportToken(result.export_token);
        setExportCount(result.channels_count);
      } else {
        const result = await apiGet('/api/channels/export');
        setExportToken(result.export_token);
        setExportCount(result.channels_count);
      }
      toast({ title: '✅ Exportación lista', description: 'Copia el token y pégalo en el otro panel' });
    } catch (err: any) {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    }
    setLoading(false);
  };

  const handleCopyToken = async () => {
    const ok = await copyToClipboard(exportToken);
    if (ok) {
      setCopied(true);
      toast({ title: '📋 Token copiado' });
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleImport = async () => {
    if (!importToken.trim()) {
      toast({ title: 'Error', description: 'Pega el token de exportación', variant: 'destructive' });
      return;
    }
    setLoading(true);
    try {
      if (isLovablePreview()) {
        const session = await supabase.auth.getSession();
        const token = session.data.session?.access_token;
        const resp = await fetch(
          `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/channel-sync?action=import`,
          {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${token}`,
              'Content-Type': 'application/json',
              'apikey': import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
            },
            body: JSON.stringify({ export_token: importToken.trim(), mode: importMode }),
          }
        );
        const result = await resp.json();
        if (!resp.ok) throw new Error(result.error);
        toast({
          title: '✅ Importación completada',
          description: `${result.imported} importados, ${result.skipped} omitidos de ${result.total} totales`,
        });
      } else {
        const result = await apiPost('/api/channels/import-sync', {
          export_token: importToken.trim(),
          mode: importMode,
        });
        toast({
          title: '✅ Importación completada',
          description: `${result.imported} importados, ${result.skipped} omitidos de ${result.total} totales`,
        });
      }
      setImportToken('');
    } catch (err: any) {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    }
    setLoading(false);
  };

  const handlePull = async () => {
    if (!remoteUrl.trim()) {
      toast({ title: 'Error', description: 'Ingresa la URL del panel remoto', variant: 'destructive' });
      return;
    }
    setLoading(true);
    try {
      if (isLovablePreview()) {
        const session = await supabase.auth.getSession();
        const token = session.data.session?.access_token;
        const resp = await fetch(
          `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/channel-sync?action=pull`,
          {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${token}`,
              'Content-Type': 'application/json',
              'apikey': import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
            },
            body: JSON.stringify({
              remote_url: remoteUrl.trim(),
              remote_admin_token: remoteAdminToken.trim(),
              mode: pullMode,
            }),
          }
        );
        const result = await resp.json();
        if (!resp.ok) throw new Error(result.error);
        toast({
          title: '✅ Sincronización completada',
          description: `${result.imported} importados desde ${result.source}`,
        });
      } else {
        const result = await apiPost('/api/channels/pull-remote', {
          remote_url: remoteUrl.trim(),
          remote_admin_token: remoteAdminToken.trim(),
          mode: pullMode,
        });
        toast({
          title: '✅ Sincronización completada',
          description: `${result.imported} importados, ${result.skipped} omitidos`,
        });
      }
    } catch (err: any) {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    }
    setLoading(false);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <ArrowRightLeft className="w-6 h-6 text-primary" />
        <div>
          <h2 className="text-xl font-bold">Sincronización de Canales</h2>
          <p className="text-sm text-muted-foreground">Comparte canales entre paneles Omnisync</p>
        </div>
      </div>

      <Tabs defaultValue="export" className="space-y-4">
        <TabsList className="grid grid-cols-3 w-full max-w-md">
          <TabsTrigger value="export" className="gap-2"><Upload className="w-4 h-4" /> Exportar</TabsTrigger>
          <TabsTrigger value="import" className="gap-2"><Download className="w-4 h-4" /> Importar</TabsTrigger>
          <TabsTrigger value="pull" className="gap-2"><Globe className="w-4 h-4" /> Conexión</TabsTrigger>
        </TabsList>

        {/* EXPORT */}
        <TabsContent value="export">
          <Card className="glass border-border/30">
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><FileText className="w-5 h-5" /> Exportar Canales</CardTitle>
              <CardDescription>Genera un token con todos tus canales para importar en otro panel Omnisync</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <Button onClick={handleExport} disabled={loading} className="gradient-primary">
                {loading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Upload className="w-4 h-4 mr-2" />}
                Generar Token de Exportación
              </Button>

              {exportToken && (
                <div className="space-y-3">
                  <div className="flex items-center gap-2">
                    <Badge variant="secondary">{exportCount} canales</Badge>
                  </div>
                  <Textarea
                    value={exportToken}
                    readOnly
                    className="font-mono text-xs h-32 bg-muted/30"
                  />
                  <Button onClick={handleCopyToken} variant="outline" className="gap-2">
                    {copied ? <Check className="w-4 h-4 text-green-500" /> : <Copy className="w-4 h-4" />}
                    {copied ? 'Copiado' : 'Copiar Token'}
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* IMPORT */}
        <TabsContent value="import">
          <Card className="glass border-border/30">
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><Download className="w-5 h-5" /> Importar desde Token</CardTitle>
              <CardDescription>Pega un token generado en otro panel Omnisync para importar sus canales</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <Textarea
                placeholder="Pega aquí el token de exportación del otro panel..."
                value={importToken}
                onChange={(e) => setImportToken(e.target.value)}
                className="font-mono text-xs h-32"
              />

              <div className="flex gap-2">
                <Button
                  variant={importMode === 'merge' ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setImportMode('merge')}
                >
                  Fusionar (no duplicar)
                </Button>
                <Button
                  variant={importMode === 'replace' ? 'destructive' : 'outline'}
                  size="sm"
                  onClick={() => setImportMode('replace')}
                >
                  Reemplazar todo
                </Button>
              </div>

              <Button onClick={handleImport} disabled={loading || !importToken.trim()} className="gradient-primary">
                {loading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Download className="w-4 h-4 mr-2" />}
                Importar Canales
              </Button>
            </CardContent>
          </Card>
        </TabsContent>

        {/* PULL FROM REMOTE */}
        <TabsContent value="pull">
          <Card className="glass border-border/30">
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><Link className="w-5 h-5" /> Conexión Directa</CardTitle>
              <CardDescription>Conecta directamente a otro panel Omnisync (VPS) y trae sus canales</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <label className="text-sm font-medium mb-1 block">URL del Panel Remoto</label>
                <Input
                  placeholder="http://IP_DEL_VPS o https://dominio.com"
                  value={remoteUrl}
                  onChange={(e) => setRemoteUrl(e.target.value)}
                />
              </div>

              <div>
                <label className="text-sm font-medium mb-1 block">Token Admin del Panel Remoto</label>
                <Input
                  type="password"
                  placeholder="JWT del admin del otro panel"
                  value={remoteAdminToken}
                  onChange={(e) => setRemoteAdminToken(e.target.value)}
                />
                <p className="text-xs text-muted-foreground mt-1">
                  Obtén este token iniciando sesión como admin en el otro panel (se guarda en localStorage como admin_token)
                </p>
              </div>

              <div className="flex gap-2">
                <Button
                  variant={pullMode === 'merge' ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setPullMode('merge')}
                >
                  Fusionar
                </Button>
                <Button
                  variant={pullMode === 'replace' ? 'destructive' : 'outline'}
                  size="sm"
                  onClick={() => setPullMode('replace')}
                >
                  Reemplazar todo
                </Button>
              </div>

              <Button onClick={handlePull} disabled={loading || !remoteUrl.trim()} className="gradient-primary">
                {loading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Globe className="w-4 h-4 mr-2" />}
                Traer Canales del Panel Remoto
              </Button>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
};

export default ChannelSync;
