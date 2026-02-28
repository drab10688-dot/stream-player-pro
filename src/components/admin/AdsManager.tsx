import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Plus, Trash2, Send, Bell, Megaphone, X } from 'lucide-react';
import { motion } from 'framer-motion';

interface Ad {
  id: string;
  title: string;
  message: string;
  image_url: string | null;
  is_active: boolean;
  created_at: string;
}

const AdsManager = () => {
  const { toast } = useToast();
  const [ads, setAds] = useState<Ad[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ title: '', message: '', image_url: '' });

  const fetchAds = async () => {
    const { data } = await supabase.from('ads').select('*').order('created_at', { ascending: false });
    setAds(data || []);
    setLoading(false);
  };

  useEffect(() => { fetchAds(); }, []);

  const handleAdd = async () => {
    if (!form.title.trim() || !form.message.trim()) {
      toast({ title: 'Error', description: 'Completa título y mensaje', variant: 'destructive' });
      return;
    }
    await supabase.from('ads').insert({
      title: form.title.trim(),
      message: form.message.trim(),
      image_url: form.image_url.trim() || null,
    });
    setForm({ title: '', message: '', image_url: '' });
    setShowForm(false);
    toast({ title: 'Publicidad creada', description: 'Se mostrará a los clientes' });
    fetchAds();
  };

  const toggleAd = async (ad: Ad) => {
    await supabase.from('ads').update({ is_active: !ad.is_active }).eq('id', ad.id);
    fetchAds();
  };

  const deleteAd = async (id: string) => {
    await supabase.from('ads').delete().eq('id', id);
    toast({ title: 'Publicidad eliminada' });
    fetchAds();
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="font-display font-semibold text-xl text-foreground">Publicidad ({ads.length})</h2>
        <Button onClick={() => setShowForm(true)} className="gradient-primary text-primary-foreground gap-2">
          <Plus className="w-4 h-4" /> Nueva
        </Button>
      </div>

      {showForm && (
        <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} className="glass rounded-xl p-5 space-y-3">
          <div className="flex items-center gap-2 mb-1">
            <Bell className="w-5 h-5 text-primary" />
            <h3 className="font-display font-semibold text-foreground">Crear Aviso</h3>
          </div>
          <Input placeholder="Título" value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} className="bg-secondary border-border text-foreground" maxLength={100} />
          <Textarea placeholder="Mensaje..." value={form.message} onChange={e => setForm({ ...form, message: e.target.value })} className="bg-secondary border-border text-foreground min-h-[80px]" maxLength={500} />
          <Input placeholder="URL de imagen (opcional)" value={form.image_url} onChange={e => setForm({ ...form, image_url: e.target.value })} className="bg-secondary border-border text-foreground" maxLength={500} />
          <div className="flex gap-2 justify-end">
            <Button variant="ghost" onClick={() => setShowForm(false)} className="text-muted-foreground"><X className="w-4 h-4 mr-1" /> Cancelar</Button>
            <Button onClick={handleAdd} className="gradient-primary text-primary-foreground gap-2"><Send className="w-4 h-4" /> Enviar</Button>
          </div>
        </motion.div>
      )}

      {loading ? (
        <div className="text-center py-12 text-muted-foreground">Cargando...</div>
      ) : ads.length === 0 ? (
        <div className="glass rounded-xl p-12 text-center">
          <Megaphone className="w-12 h-12 text-muted-foreground mx-auto mb-3" />
          <p className="text-muted-foreground">No hay avisos publicados</p>
        </div>
      ) : (
        <div className="space-y-2">
          {ads.map((ad, i) => (
            <motion.div key={ad.id} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: i * 0.03 }}
              className={`glass rounded-xl p-4 ${!ad.is_active ? 'opacity-50' : ''}`}>
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <h3 className="font-semibold text-foreground text-sm">{ad.title}</h3>
                    <span className={`text-xs px-2 py-0.5 rounded-full ${ad.is_active ? 'bg-primary/20 text-primary' : 'bg-muted text-muted-foreground'}`}>
                      {ad.is_active ? 'Activo' : 'Inactivo'}
                    </span>
                  </div>
                  <p className="text-sm text-muted-foreground">{ad.message}</p>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <Button variant="ghost" size="sm" onClick={() => toggleAd(ad)} className="text-xs text-muted-foreground">
                    {ad.is_active ? 'Desactivar' : 'Activar'}
                  </Button>
                  <Button variant="ghost" size="icon" onClick={() => deleteAd(ad.id)} className="text-muted-foreground hover:text-destructive">
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

export default AdsManager;
