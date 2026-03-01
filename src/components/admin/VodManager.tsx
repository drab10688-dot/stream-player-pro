import { useState, useEffect, useRef } from 'react';
import { apiGet, apiDelete } from '@/lib/api';
import { supabase } from '@/integrations/supabase/client';
import { isLovablePreview } from '@/lib/utils';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Plus, Trash2, Edit2, Save, X, Film, Upload, Eye, EyeOff } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { motion } from 'framer-motion';
import { getAdminToken } from '@/lib/api';

interface VodItem {
  id: string;
  title: string;
  description: string | null;
  category: string;
  poster_url: string | null;
  video_filename: string;
  duration_minutes: number | null;
  is_active: boolean;
  sort_order: number;
  created_at: string;
}

const VodManager = () => {
  const { toast } = useToast();
  const [items, setItems] = useState<VodItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [form, setForm] = useState({ title: '', description: '', category: 'Películas', duration_minutes: '', sort_order: '0' });
  const videoFileRef = useRef<HTMLInputElement>(null);
  const posterFileRef = useRef<HTMLInputElement>(null);

  const fetchItems = async () => {
    try {
      if (isLovablePreview()) {
        const { data, error } = await supabase.from('vod_items' as any).select('*').order('sort_order', { ascending: true });
        if (error) throw error;
        setItems((data as any[]) || []);
      } else {
        const data = await apiGet('/api/vod');
        setItems(data || []);
      }
    } catch (err: any) {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    }
    setLoading(false);
  };

  useEffect(() => { fetchItems(); }, []);

  const handleSave = async () => {
    if (!form.title.trim()) {
      toast({ title: 'Error', description: 'Se requiere un título', variant: 'destructive' });
      return;
    }

    const videoFile = videoFileRef.current?.files?.[0];
    const posterFile = posterFileRef.current?.files?.[0];

    if (!editingId && !videoFile) {
      toast({ title: 'Error', description: 'Se requiere un archivo de video', variant: 'destructive' });
      return;
    }

    setUploading(true);
    setUploadProgress(0);

    try {
      if (isLovablePreview()) {
        // Supabase mode - just save metadata (no file upload in preview)
        const payload: any = {
          title: form.title.trim(),
          description: form.description.trim() || null,
          category: form.category || 'Películas',
          duration_minutes: parseInt(form.duration_minutes) || null,
          sort_order: parseInt(form.sort_order) || 0,
          video_filename: videoFile?.name || 'preview-video.mp4',
        };
        if (editingId) {
          await supabase.from('vod_items' as any).update(payload).eq('id', editingId);
          toast({ title: 'VOD actualizado' });
        } else {
          await supabase.from('vod_items' as any).insert({ ...payload, is_active: true });
          toast({ title: 'VOD creado' });
        }
      } else {
        const formData = new FormData();
        formData.append('title', form.title.trim());
        formData.append('description', form.description.trim());
        formData.append('category', form.category || 'Películas');
        formData.append('duration_minutes', form.duration_minutes);
        formData.append('sort_order', form.sort_order);
        if (videoFile) formData.append('video', videoFile);
        if (posterFile) formData.append('poster', posterFile);

        const token = getAdminToken();
        const url = editingId ? `/api/vod/${editingId}` : '/api/vod';
        const method = editingId ? 'PUT' : 'POST';

        const xhr = new XMLHttpRequest();
        xhr.open(method, url);
        if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`);

        xhr.upload.onprogress = (e) => {
          if (e.lengthComputable) setUploadProgress(Math.round((e.loaded / e.total) * 100));
        };

        await new Promise<void>((resolve, reject) => {
          xhr.onload = () => {
            if (xhr.status >= 200 && xhr.status < 300) {
              toast({ title: editingId ? 'VOD actualizado' : 'VOD subido exitosamente 🎬' });
              resolve();
            } else {
              try {
                const err = JSON.parse(xhr.responseText);
                reject(new Error(err.error || 'Error del servidor'));
              } catch {
                reject(new Error('Error del servidor'));
              }
            }
          };
          xhr.onerror = () => reject(new Error('Error de red'));
          xhr.send(formData);
        });
      }

      setForm({ title: '', description: '', category: 'Películas', duration_minutes: '', sort_order: '0' });
      setShowForm(false);
      setEditingId(null);
      if (videoFileRef.current) videoFileRef.current.value = '';
      if (posterFileRef.current) posterFileRef.current.value = '';
      fetchItems();
    } catch (err: any) {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    }
    setUploading(false);
    setUploadProgress(0);
  };

  const handleEdit = (item: VodItem) => {
    setForm({
      title: item.title,
      description: item.description || '',
      category: item.category,
      duration_minutes: item.duration_minutes?.toString() || '',
      sort_order: item.sort_order?.toString() || '0',
    });
    setEditingId(item.id);
    setShowForm(true);
  };

  const toggleActive = async (item: VodItem) => {
    try {
      if (isLovablePreview()) {
        await supabase.from('vod_items' as any).update({ is_active: !item.is_active }).eq('id', item.id);
      } else {
        const formData = new FormData();
        formData.append('is_active', (!item.is_active).toString());
        const token = getAdminToken();
        await fetch(`/api/vod/${item.id}`, {
          method: 'PUT',
          headers: token ? { 'Authorization': `Bearer ${token}` } : {},
          body: formData,
        });
      }
      fetchItems();
      toast({ title: item.is_active ? 'VOD desactivado' : 'VOD activado' });
    } catch (err: any) {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    }
  };

  const handleDelete = async (id: string) => {
    try {
      if (isLovablePreview()) {
        await supabase.from('vod_items' as any).delete().eq('id', id);
      } else {
        await apiDelete(`/api/vod/${id}`);
      }
      toast({ title: 'VOD eliminado' });
      fetchItems();
    } catch (err: any) {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="font-display font-semibold text-xl text-foreground">Películas / VOD ({items.length})</h2>
        <Button onClick={() => { setShowForm(true); setEditingId(null); setForm({ title: '', description: '', category: 'Películas', duration_minutes: '', sort_order: '0' }); }} className="gradient-primary text-primary-foreground gap-2">
          <Plus className="w-4 h-4" /> Subir Video
        </Button>
      </div>

      {showForm && (
        <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} className="glass rounded-xl p-5 space-y-3">
          <Input placeholder="Título" value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} className="bg-secondary border-border text-foreground" maxLength={100} />
          <Input placeholder="Descripción (opcional)" value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} className="bg-secondary border-border text-foreground" maxLength={500} />
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <Input placeholder="Categoría" value={form.category} onChange={e => setForm({ ...form, category: e.target.value })} className="bg-secondary border-border text-foreground" />
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Duración (min)</label>
              <Input type="number" placeholder="120" value={form.duration_minutes} onChange={e => setForm({ ...form, duration_minutes: e.target.value })} className="bg-secondary border-border text-foreground" />
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Orden</label>
              <Input type="number" value={form.sort_order} onChange={e => setForm({ ...form, sort_order: e.target.value })} className="bg-secondary border-border text-foreground" />
            </div>
          </div>

          {!editingId && (
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Archivo de Video *</label>
              <input ref={videoFileRef} type="file" accept="video/*" className="w-full text-sm text-foreground file:mr-4 file:py-2 file:px-4 file:rounded-md file:border-0 file:text-sm file:font-semibold file:bg-primary/10 file:text-primary hover:file:bg-primary/20" />
            </div>
          )}

          <div>
            <label className="text-xs text-muted-foreground mb-1 block">Poster / Carátula (opcional)</label>
            <input ref={posterFileRef} type="file" accept="image/*" className="w-full text-sm text-foreground file:mr-4 file:py-2 file:px-4 file:rounded-md file:border-0 file:text-sm file:font-semibold file:bg-primary/10 file:text-primary hover:file:bg-primary/20" />
          </div>

          {uploading && (
            <div className="space-y-1">
              <div className="w-full bg-secondary rounded-full h-2">
                <div className="bg-primary h-2 rounded-full transition-all" style={{ width: `${uploadProgress}%` }} />
              </div>
              <p className="text-xs text-muted-foreground text-center">{uploadProgress}% subido...</p>
            </div>
          )}

          <div className="flex gap-2 justify-end">
            <Button variant="ghost" onClick={() => { setShowForm(false); setEditingId(null); }} className="text-muted-foreground"><X className="w-4 h-4 mr-1" /> Cancelar</Button>
            <Button onClick={handleSave} disabled={uploading} className="gradient-primary text-primary-foreground">
              <Upload className="w-4 h-4 mr-1" /> {editingId ? 'Actualizar' : 'Subir'}
            </Button>
          </div>
        </motion.div>
      )}

      {loading ? (
        <div className="text-center py-12 text-muted-foreground">Cargando...</div>
      ) : items.length === 0 ? (
        <div className="glass rounded-xl p-12 text-center">
          <Film className="w-12 h-12 text-muted-foreground mx-auto mb-3" />
          <p className="text-muted-foreground">No hay videos/películas subidos</p>
        </div>
      ) : (
        <div className="space-y-2">
          {items.map((item, i) => (
            <motion.div key={item.id} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: i * 0.03 }}
              className={`glass rounded-xl p-4 ${!item.is_active ? 'opacity-50' : ''}`}>
              <div className="flex items-center justify-between gap-4">
                <div className="flex items-center gap-3 flex-1 min-w-0">
                  <div className="w-16 h-10 rounded-lg bg-secondary/60 overflow-hidden shrink-0">
                    {item.poster_url ? (
                      <img src={item.poster_url} alt={item.title} className="w-full h-full object-cover" />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center">
                        <Film className="w-5 h-5 text-muted-foreground" />
                      </div>
                    )}
                  </div>
                  <div className="min-w-0">
                    <p className="font-semibold text-foreground text-sm truncate">{item.title}</p>
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <Badge variant="secondary" className="text-[10px] py-0">{item.category}</Badge>
                      {item.duration_minutes && <span>{item.duration_minutes} min</span>}
                      {!item.is_active && <span className="text-destructive font-semibold">INACTIVO</span>}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <Button variant="ghost" size="icon" onClick={() => toggleActive(item)} className="text-muted-foreground hover:text-primary" title={item.is_active ? 'Desactivar' : 'Activar'}>
                    {item.is_active ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}
                  </Button>
                  <Button variant="ghost" size="icon" onClick={() => handleEdit(item)} className="text-muted-foreground hover:text-primary">
                    <Edit2 className="w-4 h-4" />
                  </Button>
                  <Button variant="ghost" size="icon" onClick={() => handleDelete(item.id)} className="text-muted-foreground hover:text-destructive">
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

export default VodManager;
