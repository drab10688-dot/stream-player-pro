import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Download, Upload, Database, Server, Clock, Trash2, Loader2, HardDrive, RefreshCw } from 'lucide-react';
import { motion } from 'framer-motion';
import { format } from 'date-fns';

interface BackupRecord {
  id: string;
  name: string;
  type: string;
  file_size: number | null;
  status: string;
  includes_db: boolean;
  includes_config: boolean;
  notes: string | null;
  created_at: string;
}

const BackupManager = () => {
  const { toast } = useToast();
  const [backups, setBackups] = useState<BackupRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [restoring, setRestoring] = useState(false);

  const fetchBackups = async () => {
    const { data, error } = await (supabase
      .from('system_backups' as any)
      .select('*')
      .order('created_at', { ascending: false }) as any);
    if (error) {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    } else {
      setBackups((data as any[]) || []);
    }
    setLoading(false);
  };

  useEffect(() => { fetchBackups(); }, []);

  const createBackup = async (type: 'full' | 'database' | 'config') => {
    setCreating(true);
    try {
      // Export all tables data
      const tables = ['channels', 'clients', 'plans', 'ads', 'resellers', 'active_connections'];
      const backupData: Record<string, any[]> = {};

      for (const table of tables) {
        const { data } = await supabase.from(table as any).select('*');
        backupData[table] = (data as any[]) || [];
      }

      const backupContent = JSON.stringify({
        version: '1.0',
        created_at: new Date().toISOString(),
        type,
        tables: backupData,
      }, null, 2);

      const blob = new Blob([backupContent], { type: 'application/json' });
      const fileName = `backup-${type}-${format(new Date(), 'yyyy-MM-dd-HHmmss')}.json`;

      // Upload to storage
      const { error: uploadError } = await supabase.storage
        .from('backups')
        .upload(fileName, blob);

      if (uploadError) throw uploadError;

      // Register backup
      const { error: insertError } = await (supabase.from('system_backups' as any).insert({
        name: fileName,
        type,
        file_size: blob.size,
        status: 'completed',
        includes_db: type === 'full' || type === 'database',
        includes_config: type === 'full' || type === 'config',
      } as any) as any);

      if (insertError) throw insertError;

      toast({ title: '✅ Backup creado', description: fileName });
      fetchBackups();
    } catch (err: any) {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    }
    setCreating(false);
  };

  const downloadBackup = async (backup: BackupRecord) => {
    try {
      const { data, error } = await supabase.storage
        .from('backups')
        .download(backup.name);
      if (error) throw error;

      const url = URL.createObjectURL(data);
      const a = document.createElement('a');
      a.href = url;
      a.download = backup.name;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err: any) {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    }
  };

  const restoreBackup = async (backup: BackupRecord) => {
    if (!confirm(`⚠️ ¿Restaurar "${backup.name}"?\n\nEsto reemplazará TODOS los datos actuales. Esta acción no se puede deshacer.`)) return;

    setRestoring(true);
    try {
      const { data: fileData, error } = await supabase.storage
        .from('backups')
        .download(backup.name);
      if (error) throw error;

      const text = await fileData.text();
      const backupContent = JSON.parse(text);

      if (!backupContent.tables) throw new Error('Formato de backup inválido');

      // Restore tables in order (respect foreign keys)
      const restoreOrder = ['plans', 'resellers', 'channels', 'ads', 'clients'];

      for (const table of restoreOrder) {
        if (backupContent.tables[table]) {
          await (supabase.from(table as any).delete() as any).neq('id', '00000000-0000-0000-0000-000000000000');
          if (backupContent.tables[table].length > 0) {
            const { error: insertErr } = await (supabase.from(table as any).insert(backupContent.tables[table] as any) as any);
            if (insertErr) console.warn(`Error restaurando ${table}:`, insertErr.message);
          }
        }
      }

      toast({ title: '✅ Backup restaurado', description: 'Datos restaurados correctamente' });
    } catch (err: any) {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    }
    setRestoring(false);
  };

  const handleFileRestore = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!confirm(`⚠️ ¿Restaurar desde "${file.name}"?\n\nEsto reemplazará TODOS los datos actuales.`)) return;

    setRestoring(true);
    try {
      const text = await file.text();
      const backupContent = JSON.parse(text);

      if (!backupContent.tables) throw new Error('Formato de backup inválido');

      const restoreOrder = ['plans', 'resellers', 'channels', 'ads', 'clients'];

      for (const table of restoreOrder) {
        if (backupContent.tables[table]) {
          await (supabase.from(table as any).delete() as any).neq('id', '00000000-0000-0000-0000-000000000000');
          if (backupContent.tables[table].length > 0) {
            const { error: insertErr } = await (supabase.from(table as any).insert(backupContent.tables[table] as any) as any);
            if (insertErr) console.warn(`Error restaurando ${table}:`, insertErr.message);
          }
        }
      }

      toast({ title: '✅ Backup restaurado', description: 'Datos restaurados desde archivo' });
    } catch (err: any) {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    }
    setRestoring(false);
    e.target.value = '';
  };

  const deleteBackup = async (backup: BackupRecord) => {
    if (!confirm(`¿Eliminar backup "${backup.name}"?`)) return;
    try {
      await supabase.storage.from('backups').remove([backup.name]);
      await supabase.from('system_backups').delete().eq('id', backup.id);
      toast({ title: 'Backup eliminado' });
      fetchBackups();
    } catch (err: any) {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    }
  };

  const formatSize = (bytes: number | null) => {
    if (!bytes) return '—';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1048576).toFixed(1)} MB`;
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h2 className="font-display font-semibold text-xl text-foreground">Backups ({backups.length})</h2>
        <div className="flex gap-2">
          <label className="cursor-pointer">
            <input type="file" accept=".json" className="hidden" onChange={handleFileRestore} disabled={restoring} />
            <Button variant="outline" className="gap-2 border-border text-foreground pointer-events-none" disabled={restoring} asChild>
              <span><Upload className="w-4 h-4" /> Restaurar Archivo</span>
            </Button>
          </label>
        </div>
      </div>

      {/* Create backup actions */}
      <div className="glass rounded-xl p-5">
        <h3 className="font-semibold text-foreground mb-3">Crear Backup</h3>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <Button onClick={() => createBackup('full')} disabled={creating} className="gradient-primary text-primary-foreground gap-2 h-auto py-3 flex-col">
            {creating ? <Loader2 className="w-5 h-5 animate-spin" /> : <HardDrive className="w-5 h-5" />}
            <span className="text-xs">Backup Completo</span>
          </Button>
          <Button onClick={() => createBackup('database')} disabled={creating} variant="outline" className="gap-2 h-auto py-3 flex-col border-border text-foreground">
            <Database className="w-5 h-5" />
            <span className="text-xs">Solo Base de Datos</span>
          </Button>
          <Button onClick={() => createBackup('config')} disabled={creating} variant="outline" className="gap-2 h-auto py-3 flex-col border-border text-foreground">
            <Server className="w-5 h-5" />
            <span className="text-xs">Solo Configuración</span>
          </Button>
        </div>
      </div>

      {/* Backup list */}
      {loading ? (
        <div className="text-center py-12 text-muted-foreground">Cargando...</div>
      ) : backups.length === 0 ? (
        <div className="glass rounded-xl p-12 text-center">
          <HardDrive className="w-12 h-12 text-muted-foreground mx-auto mb-3" />
          <p className="text-muted-foreground">No hay backups. Crea uno para proteger tus datos.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {backups.map((b, i) => (
            <motion.div key={b.id} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: i * 0.03 }}
              className="glass rounded-xl p-4">
              <div className="flex items-center justify-between gap-4">
                <div className="flex items-center gap-3 flex-1 min-w-0">
                  <div className="w-10 h-10 rounded-lg bg-primary/20 flex items-center justify-center shrink-0">
                    <HardDrive className="w-5 h-5 text-primary" />
                  </div>
                  <div className="min-w-0">
                    <p className="font-semibold text-foreground text-sm truncate">{b.name}</p>
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <span className="flex items-center gap-1"><Clock className="w-3 h-3" /> {format(new Date(b.created_at), 'dd/MM/yyyy HH:mm')}</span>
                      <span>{formatSize(b.file_size)}</span>
                      <Badge variant={b.status === 'completed' ? 'default' : 'secondary'} className="text-[10px] py-0">
                        {b.type}
                      </Badge>
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <Button variant="ghost" size="icon" onClick={() => downloadBackup(b)} className="text-muted-foreground hover:text-primary" title="Descargar">
                    <Download className="w-4 h-4" />
                  </Button>
                  <Button variant="ghost" size="icon" onClick={() => restoreBackup(b)} disabled={restoring} className="text-muted-foreground hover:text-accent" title="Restaurar">
                    <RefreshCw className="w-4 h-4" />
                  </Button>
                  <Button variant="ghost" size="icon" onClick={() => deleteBackup(b)} className="text-muted-foreground hover:text-destructive" title="Eliminar">
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </div>
              </div>
            </motion.div>
          ))}
        </div>
      )}
    </div>
  );
};

export default BackupManager;
