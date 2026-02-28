import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Plus, Trash2, Edit2, Save, X, Tv } from 'lucide-react';
import { motion } from 'framer-motion';

interface Channel {
  id: string;
  name: string;
  url: string;
  category: string;
  is_active: boolean;
  sort_order: number;
}

const ChannelsManager = () => {
  const { toast } = useToast();
  const [channels, setChannels] = useState<Channel[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState({ name: '', url: '', category: 'General', sort_order: 0 });

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

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="font-display font-semibold text-xl text-foreground">Canales ({channels.length})</h2>
        <Button onClick={() => { setShowForm(true); setEditingId(null); setForm({ name: '', url: '', category: 'General', sort_order: 0 }); }} className="gradient-primary text-primary-foreground gap-2">
          <Plus className="w-4 h-4" /> Agregar Canal
        </Button>
      </div>

      {showForm && (
        <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} className="glass rounded-xl p-5 space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Input placeholder="Nombre del canal" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} className="bg-secondary border-border text-foreground" maxLength={100} />
            <Input placeholder="Categoría" value={form.category} onChange={e => setForm({ ...form, category: e.target.value })} className="bg-secondary border-border text-foreground" maxLength={50} />
          </div>
          <Input placeholder="URL del stream (ej: http://ip:port/canal.ts)" value={form.url} onChange={e => setForm({ ...form, url: e.target.value })} className="bg-secondary border-border text-foreground" maxLength={500} />
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
          <p className="text-muted-foreground">No hay canales. Agrega tu primer canal.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {channels.map((ch, i) => (
            <motion.div key={ch.id} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: i * 0.03 }}
              className={`glass rounded-xl p-4 flex items-center justify-between ${!ch.is_active ? 'opacity-50' : ''}`}>
              <div className="flex items-center gap-3 flex-1 min-w-0">
                <div className="w-10 h-10 rounded-lg bg-secondary flex items-center justify-center shrink-0">
                  <Tv className="w-5 h-5 text-primary" />
                </div>
                <div className="min-w-0">
                  <p className="font-semibold text-foreground text-sm truncate">{ch.name}</p>
                  <p className="text-xs text-muted-foreground truncate">{ch.category} · {ch.url.substring(0, 40)}...</p>
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
