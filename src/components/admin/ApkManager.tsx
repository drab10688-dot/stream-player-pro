import { useState, useEffect } from 'react';
import { Upload, Trash2, Download, Smartphone, Copy, Check, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';
import { apiGet, apiPost, apiDelete } from '@/lib/api';

interface ApkFile {
  name: string;
  size: number;
  uploaded_at: string;
  download_url: string;
}

const ApkManager = () => {
  const { toast } = useToast();
  const [apkFiles, setApkFiles] = useState<ApkFile[]>([]);
  const [uploading, setUploading] = useState(false);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState<string | null>(null);
  const [serverInfo, setServerInfo] = useState<{ ip: string; apk_port: number } | null>(null);

  const fetchApks = async () => {
    try {
      const data = await apiGet('/api/apk/list');
      setApkFiles(data.files || []);
      setServerInfo(data.server || null);
    } catch {
      setApkFiles([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchApks(); }, []);

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.name.endsWith('.apk')) {
      toast({ title: 'Error', description: 'Solo archivos .apk', variant: 'destructive' });
      return;
    }

    setUploading(true);
    try {
      const formData = new FormData();
      formData.append('apk', file);

      const token = localStorage.getItem('admin_token');
      const res = await fetch('/api/apk/upload', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: formData,
      });

      if (!res.ok) throw new Error('Upload failed');
      toast({ title: '✅ APK subida correctamente' });
      fetchApks();
    } catch {
      toast({ title: 'Error subiendo APK', variant: 'destructive' });
    } finally {
      setUploading(false);
      e.target.value = '';
    }
  };

  const handleDelete = async (name: string) => {
    if (!confirm(`¿Eliminar ${name}?`)) return;
    try {
      await apiDelete(`/api/apk/${encodeURIComponent(name)}`);
      toast({ title: '🗑️ APK eliminada' });
      fetchApks();
    } catch {
      toast({ title: 'Error eliminando', variant: 'destructive' });
    }
  };

  const copyUrl = (url: string) => {
    navigator.clipboard.writeText(url);
    setCopied(url);
    setTimeout(() => setCopied(null), 2000);
    toast({ title: '📋 URL copiada al portapapeles' });
  };

  const formatSize = (bytes: number) => {
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  return (
    <div className="space-y-6">
      {/* Connection Info */}
      {serverInfo && (
        <Card className="glass-strong border-primary/20">
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Smartphone className="w-5 h-5 text-primary" />
              Configuración para APK
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div className="p-3 rounded-lg bg-muted/50 space-y-1">
                <p className="text-xs text-muted-foreground">URL del servidor</p>
                <div className="flex items-center gap-2">
                  <code className="text-sm font-mono text-foreground flex-1">http://{serverInfo.ip}:{serverInfo.apk_port}</code>
                  <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => copyUrl(`http://${serverInfo.ip}:${serverInfo.apk_port}`)}>
                    {copied === `http://${serverInfo.ip}:${serverInfo.apk_port}` ? <Check className="w-3.5 h-3.5 text-green-500" /> : <Copy className="w-3.5 h-3.5" />}
                  </Button>
                </div>
              </div>
              <div className="p-3 rounded-lg bg-muted/50 space-y-1">
                <p className="text-xs text-muted-foreground">Puerto Xtream</p>
                <code className="text-sm font-mono text-foreground">{serverInfo.apk_port}</code>
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              Las APKs deben configurarse con esta IP y puerto para conectar automáticamente via API Xtream Codes.
            </p>
          </CardContent>
        </Card>
      )}

      {/* Upload */}
      <Card className="glass-strong">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base">Gestión de APK</CardTitle>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={fetchApks} disabled={loading}>
                <RefreshCw className={`w-4 h-4 mr-1 ${loading ? 'animate-spin' : ''}`} /> Actualizar
              </Button>
              <label>
                <Button variant="default" size="sm" asChild disabled={uploading}>
                  <span className="cursor-pointer">
                    <Upload className="w-4 h-4 mr-1" /> {uploading ? 'Subiendo...' : 'Subir APK'}
                  </span>
                </Button>
                <input type="file" accept=".apk" onChange={handleUpload} className="hidden" />
              </label>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex justify-center py-8">
              <div className="animate-spin w-6 h-6 border-2 border-primary border-t-transparent rounded-full" />
            </div>
          ) : apkFiles.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <Smartphone className="w-12 h-12 mx-auto mb-3 opacity-30" />
              <p>No hay APKs subidas</p>
              <p className="text-xs mt-1">Sube un archivo .apk para que los clientes puedan descargarlo</p>
            </div>
          ) : (
            <div className="space-y-3">
              {apkFiles.map((apk) => (
                <div key={apk.name} className="flex items-center justify-between p-3 rounded-lg bg-muted/30 border border-border/30">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
                      <Smartphone className="w-5 h-5 text-primary" />
                    </div>
                    <div>
                      <p className="font-medium text-sm">{apk.name}</p>
                      <div className="flex items-center gap-2 mt-0.5">
                        <Badge variant="secondary" className="text-xs">{formatSize(apk.size)}</Badge>
                        <span className="text-xs text-muted-foreground">
                          {new Date(apk.uploaded_at).toLocaleDateString()}
                        </span>
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => copyUrl(apk.download_url)} title="Copiar enlace">
                      {copied === apk.download_url ? <Check className="w-4 h-4 text-green-500" /> : <Copy className="w-4 h-4" />}
                    </Button>
                    <Button variant="ghost" size="icon" className="h-8 w-8" asChild title="Descargar">
                      <a href={apk.download_url} download>
                        <Download className="w-4 h-4" />
                      </a>
                    </Button>
                    <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive hover:text-destructive" onClick={() => handleDelete(apk.name)} title="Eliminar">
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default ApkManager;
