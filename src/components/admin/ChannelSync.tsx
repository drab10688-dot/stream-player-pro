import { useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { apiPost } from '@/lib/api';
import { isLovablePreview } from '@/lib/utils';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { copyToClipboard } from '@/lib/clipboard';
import { Upload, Download, Link, Copy, Check, Loader2, ArrowRightLeft, Globe, FileText, Shield, Clock } from 'lucide-react';

const ChannelSync = () => {
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);

  const [exportToken, setExportToken] = useState('');
  const [exportCount, setExportCount] = useState(0);
  const [expiresHours, setExpiresHours] = useState('24');
  const [copied, setCopied] = useState(false);

  const [importToken, setImportToken] = useState('');
  const [importMode, setImportMode] = useState<'merge' | 'replace'>('merge');
  const [importResult, setImportResult] = useState<any>(null);

  const [remoteUrl, setRemoteUrl] = useState('');
  const [remoteAdminToken, setRemoteAdminToken] = useState('');
  const [pullMode, setPullMode] = useState<'merge' | 'replace'>('merge');

  const callSyncFunction = async (action: string, body?: any) => {
    const session = await supabase.auth.getSession();
    const token = session.data.session?.access_token;
    const resp = await fetch(
      `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/channel-sync?action=${action}`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
          'apikey': import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
        },
        body: body ? JSON.stringify(body) : undefined,
      }
    );
    const result = await resp.json();
    if (!resp.ok) throw new Error(result.error);
    return result;
  };

  const handleExport = async () => {
    setLoading(true);
    try {
      let result;
      if (isLovablePreview()) {
        result = await callSyncFunction('export', { expires_hours: parseInt(expiresHours) });
      } else {
        result = await apiPost('/api/channels/export', { expires_hours: parseInt(expiresHours) });
      }
      setExportToken(result.export_token);
      setExportCount(result.channels_count);
      toast({ title: '✅ Exportación lista', description: `${result.channels_count} canales exportados. Expira en ${expiresHours}h` });
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
    setImportResult(null);
    try {
      let result;
      if (isLovablePreview()) {
        result = await callSyncFunction('import', { export_token: importToken.trim(), mode: importMode });
      } else {
        result = await apiPost('/api/channels/import-sync', { export_token: importToken.trim(), mode: importMode });
      }
      setImportResult(result);
      toast({
        title: '✅ Importación completada',
        description: `${result.imported} importados, ${result.skipped} omitidos`,
      });
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
      let result;
      if (isLovablePreview()) {
        result = await callSyncFunction('pull', {
          remote_url: remoteUrl.trim(),
          remote_admin_token: remoteAdminToken.trim(),
          mode: pullMode,
        });
      } else {
        result = await apiPost('/api/channels/pull-remote', {
          remote_url: remoteUrl.trim(),
          remote_admin_token: remoteAdminToken.trim(),
          mode: pullMode,
        });
      }
      toast({
        title: '✅ Sincronización completada',
        description: `${result.imported} importados desde ${result.source}`,
      });
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
          <h2 className="text-xl font-bold text-foreground">Sincronización de Canales</h2>
          <p className="text-sm text-muted-foreground">Comparte canales entre paneles Omnisync con firma digital</p>
        </div>
      </div>

      <Tabs defaultValue="export" className="space-y-4">
        <TabsList className="grid grid-cols-3 w-full max-w-md">
          <TabsTrigger value="export" className="gap-2"><Upload className="w-4 h-4" /> Exportar</TabsTrigger>
          <TabsTrigger value="import" className="gap-2"><Download className="w-4 h-4" /> Importar</TabsTrigger>
          <TabsTrigger value="pull" className="gap-2"><Globe className="w-4 h-4" /> Conexión</TabsTrigger>
        </TabsList>

        <TabsContent value="export">
          <Card className="glass border-border/30">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-foreground"><FileText className="w-5 h-5" /> Exportar Canales</CardTitle>
              <CardDescription>Genera un token firmado con todos tus canales</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <label className="text-sm font-medium mb-1 block text-foreground flex items-center gap-1">
                  <Clock className="w-3 h-3" /> Expiración del token
                </label>
                <Select value={expiresHours} onValueChange={setExpiresHours}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="1">1 hora</SelectItem>
                    <SelectItem value="6">6 horas</SelectItem>
                    <SelectItem value="24">24 horas</SelectItem>
                    <SelectItem value="72">3 días</SelectItem>
                    <SelectItem value="168">7 días</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <Button onClick={handleExport} disabled={loading} className="gradient-primary text-primary-foreground">
                {loading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Upload className="w-4 h-4 mr-2" />}
                Generar Token Firmado
              </Button>

              {exportToken && (
                <div className="space-y-3">
                  <div className="flex items-center gap-2 flex-wrap">
                    <Badge variant="secondary">{exportCount} canales</Badge>
                    <Badge variant="outline" className="gap-1">
                      <Shield className="w-3 h-3" /> Firmado digitalmente
                    </Badge>
                    <Badge variant="outline" className="gap-1">
                      <Clock className="w-3 h-3" /> Expira en {expiresHours}h
                    </Badge>
                  </div>
                  <Textarea value={exportToken} readOnly className="font-mono text-xs h-32 bg-muted/30" />
                  <Button onClick={handleCopyToken} variant="outline" className="gap-2">
                    {copied ? <Check className="w-4 h-4 text-primary" /> : <Copy className="w-4 h-4" />}
                    {copied ? 'Copiado' : 'Copiar Token'}
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="import">
          <Card className="glass border-border/30">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-foreground"><Download className="w-5 h-5" /> Importar desde Token</CardTitle>
              <CardDescription>Pega un token firmado. Se verificará la firma y expiración automáticamente.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <Textarea
                placeholder="Pega aquí el token firmado del otro panel..."
                value={importToken}
                onChange={(e) => setImportToken(e.target.value)}
                className="font-mono text-xs h-32"
              />
              <div className="flex gap-2">
                <Button variant={importMode === 'merge' ? 'default' : 'outline'} size="sm" onClick={() => setImportMode('merge')}>
                  Fusionar (no duplicar)
                </Button>
                <Button variant={importMode === 'replace' ? 'destructive' : 'outline'} size="sm" onClick={() => setImportMode('replace')}>
                  Reemplazar todo
                </Button>
              </div>
              <Button onClick={handleImport} disabled={loading || !importToken.trim()} className="gradient-primary text-primary-foreground">
                {loading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Download className="w-4 h-4 mr-2" />}
                Verificar e Importar
              </Button>
              {importResult && (
                <div className="p-3 rounded-md bg-muted/30 text-sm space-y-1">
                  <p className="text-foreground">✅ <strong>{importResult.imported}</strong> canales importados</p>
                  <p className="text-foreground">⏭️ <strong>{importResult.skipped}</strong> omitidos</p>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="pull">
          <Card className="glass border-border/30">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-foreground"><Link className="w-5 h-5" /> Conexión Directa</CardTitle>
              <CardDescription>Conecta directamente a otro panel Omnisync y trae sus canales</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <label className="text-sm font-medium mb-1 block text-foreground">URL del Panel Remoto</label>
                <Input placeholder="http://IP_DEL_VPS o https://dominio.com" value={remoteUrl} onChange={(e) => setRemoteUrl(e.target.value)} />
              </div>
              <div>
                <label className="text-sm font-medium mb-1 block text-foreground">Token Admin del Panel Remoto</label>
                <Input type="password" placeholder="JWT del admin del otro panel" value={remoteAdminToken} onChange={(e) => setRemoteAdminToken(e.target.value)} />
              </div>
              <div className="flex gap-2">
                <Button variant={pullMode === 'merge' ? 'default' : 'outline'} size="sm" onClick={() => setPullMode('merge')}>Fusionar</Button>
                <Button variant={pullMode === 'replace' ? 'destructive' : 'outline'} size="sm" onClick={() => setPullMode('replace')}>Reemplazar todo</Button>
              </div>
              <Button onClick={handlePull} disabled={loading || !remoteUrl.trim()} className="gradient-primary text-primary-foreground">
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
