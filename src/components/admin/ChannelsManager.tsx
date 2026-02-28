import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Plus, Trash2, Edit2, Save, X, Tv, Upload, Link, FileText, Loader2 } from 'lucide-react';
import { motion } from 'framer-motion';

interface Channel {
  id: string;
  name: string;
  url: string;
  category: string;
  is_active: boolean;
  sort_order: number;
  logo_url: string | null;
}

const ChannelsManager = () => {
  const { toast } = useToast();
  const [channels, setChannels] = useState<Channel[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [showM3UImport, setShowM3UImport] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState({ name: '', url: '', category: 'General', sort_order: 0 });
  const [m3uContent, setM3uContent] = useState('');
  const [m3uUrl, setM3uUrl] = useState('');
  const [importing, setImporting] = useState(false);

  const fetchChannels = async () => {
    const { data } = await supabase.from('channels').select('*').order('sort_order');
    setChannels(data || []);
    setLoading(false);
  };

  useEffect(() => { fetchChannels(); }, []);

  const handleSave = async () => {
    if (!form.name.trim() || !form.url.trim()) {
      toast({ title: 'Error', description: 'Nombre y URL son requeridos', variant: 'destructive' });
      return;
    }
    if (editingId) {
      await supabase.from('channels').update(form).eq('id', editingId);
      toast({ title: 'Canal actualizado' });
    } else {
      await supabase.from('channels').insert(form);
      toast({ title: 'Canal creado' });
    }
    setForm({ name: '', url: '', category: 'General', sort_order: 0 });
    setShowForm(false);
    setEditingId(null);
    fetchChannels();
  };

  const handleEdit = (ch: Channel) => {
    setForm({ name: ch.name, url: ch.url, category: ch.category, sort_order: ch.sort_order });
    setEditingId(ch.id);
    setShowForm(true);
  };

  const handleDelete = async (id: string) => {
    await supabase.from('channels').delete().eq('id', id);
    toast({ title: 'Canal eliminado' });
    fetchChannels();
  };

  const toggleActive = async (ch: Channel) => {
    await supabase.from('channels').update({ is_active: !ch.is_active }).eq('id', ch.id);
    fetchChannels();
  };

  const handleM3UImport = async () => {
    if (!m3uContent.trim() && !m3uUrl.trim()) {
      toast({ title: 'Error', description: 'Pega el contenido M3U o ingresa una URL', variant: 'destructive' });
      return;
    }

    setImporting(true);
    try {
      const result = await supabase.functions.invoke('import-m3u', {
        body: {
          m3u_content: m3uContent.trim() || undefined,
          m3u_url: m3uUrl.trim() || undefined,
        }
      });

      if (result.error) {
        toast({ title: 'Error', description: 'Error al importar la lista', variant: 'destructive' });
      } else {
        const data = result.data;
        toast({
          title: '¡Importación completada!',
          description: `${data.imported} de ${data.total} canales importados`,
        });
        setM3uContent('');
        setM3uUrl('');
        setShowM3UImport(false);
        fetchChannels();
      }
    } catch {
      toast({ title: 'Error', description: 'Error de conexión al importar', variant: 'destructive' });
    }
    setImporting(false);
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      setM3uContent(ev.target?.result as string || '');
    };
    reader.readAsText(file);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h2 className="font-display font-semibold text-xl text-foreground">Canales ({channels.length})</h2>
        <div className="flex gap-2">
          <Button onClick={() => { setShowM3UImport(!showM3UImport); setShowForm(false); }} variant="outline" className="gap-2 border-border text-foreground">
            <Upload className="w-4 h-4" /> Importar M3U
          </Button>
          <Button onClick={() => { setShowForm(true); setShowM3UImport(false); setEditingId(null); setForm({ name: '', url: '', category: 'General', sort_order: 0 }); }} className="gradient-primary text-primary-foreground gap-2">
            <Plus className="w-4 h-4" /> Agregar Canal
          </Button>
        </div>
      </div>

      {/* M3U Import Form */}
      {showM3UImport && (
        <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} className="glass rounded-xl p-5 space-y-4">
          <div className="flex items-center gap-2 mb-2">
            <FileText className="w-5 h-5 text-primary" />
            <h3 className="font-semibold text-foreground">Importar Lista M3U / M3U8</h3>
          </div>
          <p className="text-sm text-muted-foreground">
            Importa canales desde una lista M3U. Soporta listas de IPTV, películas, series y cualquier fuente de video.
          </p>

          {/* URL input */}
          <div className="space-y-2">
            <label className="text-sm font-medium text-foreground flex items-center gap-1">
              <Link className="w-3.5 h-3.5" /> URL de la lista M3U
            </label>
            <Input
              placeholder="https://ejemplo.com/lista.m3u"
              value={m3uUrl}
              onChange={e => setM3uUrl(e.target.value)}
              className="bg-secondary border-border text-foreground"
              maxLength={1000}
            />
          </div>

          <div className="flex items-center gap-3">
            <div className="h-px flex-1 bg-border" />
            <span className="text-xs text-muted-foreground">o pega el contenido</span>
            <div className="h-px flex-1 bg-border" />
          </div>

          {/* Content textarea */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-sm font-medium text-foreground">Contenido M3U</label>
              <label className="cursor-pointer text-xs text-primary hover:underline">
                <input type="file" accept=".m3u,.m3u8,.txt" className="hidden" onChange={handleFileUpload} />
                📁 Cargar archivo
              </label>
            </div>
            <Textarea
              placeholder={`#EXTM3U\n#EXTINF:-1 group-title="Deportes" tvg-logo="https://logo.png",ESPN\nhttp://ip:port/espn.ts\n#EXTINF:-1 group-title="Películas",HBO\nhttp://ip:port/hbo.m3u8`}
              value={m3uContent}
              onChange={e => setM3uContent(e.target.value)}
              className="bg-secondary border-border text-foreground font-mono text-xs min-h-[150px]"
              rows={8}
            />
          </div>

          <div className="flex gap-2 justify-end">
            <Button variant="ghost" onClick={() => setShowM3UImport(false)} className="text-muted-foreground">
              <X className="w-4 h-4 mr-1" /> Cancelar
            </Button>
            <Button onClick={handleM3UImport} disabled={importing} className="gradient-primary text-primary-foreground">
              {importing ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Upload className="w-4 h-4 mr-1" />}
              {importing ? 'Importando...' : 'Importar Canales'}
            </Button>
          </div>
        </motion.div>
      )}

      {/* Add/Edit Form */}
      {showForm && (
        <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} className="glass rounded-xl p-5 space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Input placeholder="Nombre del canal" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} className="bg-secondary border-border text-foreground" maxLength={100} />
            <Input placeholder="Categoría" value={form.category} onChange={e => setForm({ ...form, category: e.target.value })} className="bg-secondary border-border text-foreground" maxLength={50} />
          </div>
          <Input placeholder="URL del stream (HLS, TS, MP4, M3U8, cualquier URL)" value={form.url} onChange={e => setForm({ ...form, url: e.target.value })} className="bg-secondary border-border text-foreground" maxLength={500} />
          <Input type="number" placeholder="Orden" value={form.sort_order} onChange={e => setForm({ ...form, sort_order: parseInt(e.target.value) || 0 })} className="bg-secondary border-border text-foreground w-32" />
          <div className="flex gap-2 justify-end">
            <Button variant="ghost" onClick={() => { setShowForm(false); setEditingId(null); }} className="text-muted-foreground"><X className="w-4 h-4 mr-1" /> Cancelar</Button>
            <Button onClick={handleSave} className="gradient-primary text-primary-foreground"><Save className="w-4 h-4 mr-1" /> {editingId ? 'Actualizar' : 'Guardar'}</Button>
          </div>
        </motion.div>
      )}

      {loading ? (
        <div className="text-center py-12 text-muted-foreground">Cargando...</div>
      ) : channels.length === 0 ? (
        <div className="glass rounded-xl p-12 text-center">
          <Tv className="w-12 h-12 text-muted-foreground mx-auto mb-3" />
          <p className="text-muted-foreground">No hay canales. Agrega uno o importa una lista M3U.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {channels.map((ch, i) => (
            <motion.div key={ch.id} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: i * 0.03 }}
              className={`glass rounded-xl p-4 flex items-center justify-between ${!ch.is_active ? 'opacity-50' : ''}`}>
              <div className="flex items-center gap-3 flex-1 min-w-0">
                <div className="w-10 h-10 rounded-lg bg-secondary flex items-center justify-center shrink-0 overflow-hidden">
                  {ch.logo_url ? (
                    <img src={ch.logo_url} alt={ch.name} className="w-full h-full object-cover" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                  ) : (
                    <Tv className="w-5 h-5 text-primary" />
                  )}
                </div>
                <div className="min-w-0">
                  <p className="font-semibold text-foreground text-sm truncate">{ch.name}</p>
                  <p className="text-xs text-muted-foreground truncate">{ch.category} · {ch.url.substring(0, 50)}{ch.url.length > 50 ? '...' : ''}</p>
                </div>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <Button variant="ghost" size="sm" onClick={() => toggleActive(ch)} className="text-xs text-muted-foreground">
                  {ch.is_active ? 'Desactivar' : 'Activar'}
                </Button>
                <Button variant="ghost" size="icon" onClick={() => handleEdit(ch)} className="text-muted-foreground hover:text-primary">
                  <Edit2 className="w-4 h-4" />
                </Button>
                <Button variant="ghost" size="icon" onClick={() => handleDelete(ch.id)} className="text-muted-foreground hover:text-destructive">
                  <Trash2 className="w-4 h-4" />
                </Button>
              </div>
            </motion.div>
          ))}
        </div>
      )}
    </div>
  );
};

export default ChannelsManager;
