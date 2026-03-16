import { useState, useEffect, useCallback } from 'react';
import { apiGet, apiPost } from '@/lib/api';
import { useToast } from '@/hooks/use-toast';
import { Smartphone, Upload, Trash2, Download, Copy, RefreshCw, Loader2, Shield } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { motion } from 'framer-motion';

interface ApkFile {
  name: string;
  size: number;
  modified: string;
  download_url: string;
}

const ApkManager = () => {
  const { toast } = useToast();
  const [apks, setApks] = useState<ApkFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);

  const fetchApks = useCallback(async () => {
    try {
      const data = await apiGet('/api/apk');
      setApks(data.files || []);
    } catch (err: any) {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    }
    setLoading(false);
  }, []);

  useEffect(() => { fetchApks(); }, [fetchApks]);

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.name.endsWith('.apk')) {
      toast({ title: 'Error', description: 'Solo se permiten archivos .apk', variant: 'destructive' });
      return;
    }
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append('apk', file);
      const token = localStorage.getItem('admin_token');
      const serverUrl = localStorage.getItem('server_url') || '';
      const res = await fetch(`${serverUrl}/api/apk/upload`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` },
        body: formData,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Error al subir APK');
      toast({ title: '✅ APK subida', description: data.message });
      await fetchApks();
    } catch (err: any) {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    }
    setUploading(false);
    e.target.value = '';
  };

  const handleDelete = async (name: string) => {
    if (!confirm(`¿Eliminar ${name}?`)) return;
    try {
      await apiPost('/api/apk/delete', { name });
      toast({ title: 'Eliminada', description: `${name} eliminada` });
      await fetchApks();
    } catch (err: any) {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    }
  };

  const copyLink = async (apk: ApkFile) => {
    const { copyToClipboard } = await import('@/lib/clipboard');
    const url = `${window.location.origin}${apk.download_url}`;
    const ok = await copyToClipboard(url);
    if (ok) toast({ title: 'Copiado', description: 'Enlace de descarga copiado' });
  };

  const formatSize = (bytes: number) => {
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  if (loading) {
    return (
      <div className="text-center py-12 text-muted-foreground">
        <div className="animate-spin w-8 h-8 border-2 border-primary border-t-transparent rounded-full mx-auto mb-3" />
        Cargando APKs...
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="glass rounded-xl p-6">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-xl bg-primary/15 flex items-center justify-center">
              <Smartphone className="w-6 h-6 text-primary" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-foreground">Gestión de APK</h2>
              <p className="text-xs text-muted-foreground">Sube y comparte tu aplicación con los clientes</p>
            </div>
          </div>
          <div className="flex gap-2">
            <Button variant="ghost" size="icon" onClick={fetchApks} className="text-muted-foreground">
              <RefreshCw className="w-4 h-4" />
            </Button>
            <label>
              <input type="file" accept=".apk" className="hidden" onChange={handleUpload} disabled={uploading} />
              <Button asChild className="gradient-primary gap-2 cursor-pointer" disabled={uploading}>
                <span>
                  {uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
                  {uploading ? 'Subiendo...' : 'Subir APK'}
                </span>
              </Button>
            </label>
          </div>
        </div>

        <div className="bg-primary/5 rounded-lg p-3 border border-primary/10 mb-4">
          <div className="flex items-start gap-2">
            <Shield className="w-4 h-4 text-primary mt-0.5 shrink-0" />
            <p className="text-xs text-muted-foreground">
              <span className="text-foreground font-medium">Túnel Cloudflare:</span> Si tienes el túnel activo, los enlaces de descarga funcionarán a través de HTTPS con IP oculta automáticamente.
            </p>
          </div>
        </div>

        {apks.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            <Smartphone className="w-12 h-12 mx-auto mb-3 opacity-30" />
            <p className="text-sm">No hay APKs subidas</p>
            <p className="text-xs mt-1">Sube tu primera APK para compartirla con tus clientes</p>
          </div>
        ) : (
          <div className="space-y-3">
            {apks.map((apk) => (
              <motion.div
                key={apk.name}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="bg-muted/30 rounded-lg p-4 border border-border/30 flex items-center gap-4"
              >
                <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                  <Smartphone className="w-5 h-5 text-primary" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-foreground truncate">{apk.name}</p>
                  <div className="flex items-center gap-3 mt-0.5">
                    <Badge variant="outline" className="text-[10px]">{formatSize(apk.size)}</Badge>
                    <span className="text-[10px] text-muted-foreground">{new Date(apk.modified).toLocaleDateString()}</span>
                  </div>
                </div>
                <div className="flex gap-1 shrink-0">
                  <Button variant="ghost" size="icon" onClick={() => copyLink(apk)} title="Copiar enlace">
                    <Copy className="w-4 h-4 text-muted-foreground" />
                  </Button>
                  <Button variant="ghost" size="icon" asChild title="Descargar">
                    <a href={apk.download_url} download>
                      <Download className="w-4 h-4 text-muted-foreground" />
                    </a>
                  </Button>
                  <Button variant="ghost" size="icon" onClick={() => handleDelete(apk.name)} title="Eliminar">
                    <Trash2 className="w-4 h-4 text-destructive" />
                  </Button>
                </div>
              </motion.div>
            ))}
          </div>
        )}
      </motion.div>
    </div>
  );
};

export default ApkManager;
