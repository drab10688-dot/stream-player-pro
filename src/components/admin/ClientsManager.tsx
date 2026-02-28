import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Plus, Trash2, Edit2, Save, X, Users, UserX, UserCheck, Monitor } from 'lucide-react';
import { motion } from 'framer-motion';
import { format } from 'date-fns';

interface Client {
  id: string;
  username: string;
  password: string;
  max_screens: number;
  expiry_date: string;
  is_active: boolean;
  notes: string | null;
  created_at: string;
}

const ClientsManager = () => {
  const { toast } = useToast();
  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState({ username: '', password: '', max_screens: 1, expiry_date: '', notes: '' });

  const fetchClients = async () => {
    const { data } = await supabase.from('clients').select('*').order('created_at', { ascending: false });
    setClients(data || []);
    setLoading(false);
  };

  useEffect(() => { fetchClients(); }, []);

  const handleSave = async () => {
    if (!form.username.trim() || !form.password.trim() || !form.expiry_date) {
      toast({ title: 'Error', description: 'Completa usuario, contraseña y fecha', variant: 'destructive' });
      return;
    }
    const payload = {
      username: form.username.trim(),
      password: form.password.trim(),
      max_screens: form.max_screens,
      expiry_date: form.expiry_date,
      notes: form.notes.trim() || null,
    };

    if (editingId) {
      const { error } = await supabase.from('clients').update(payload).eq('id', editingId);
      if (error) { toast({ title: 'Error', description: error.message, variant: 'destructive' }); return; }
      toast({ title: 'Cliente actualizado' });
    } else {
      const { error } = await supabase.from('clients').insert({ ...payload, is_active: true });
      if (error) { toast({ title: 'Error', description: error.message, variant: 'destructive' }); return; }
      toast({ title: 'Cliente creado' });
    }
    setForm({ username: '', password: '', max_screens: 1, expiry_date: '', notes: '' });
    setShowForm(false);
    setEditingId(null);
    fetchClients();
  };

  const handleEdit = (c: Client) => {
    setForm({
      username: c.username,
      password: c.password,
      max_screens: c.max_screens,
      expiry_date: c.expiry_date.split('T')[0],
      notes: c.notes || '',
    });
    setEditingId(c.id);
    setShowForm(true);
  };

  const toggleActive = async (c: Client) => {
    await supabase.from('clients').update({ is_active: !c.is_active }).eq('id', c.id);
    fetchClients();
    toast({ title: c.is_active ? 'Cliente suspendido' : 'Cliente activado' });
  };

  const handleDelete = async (id: string) => {
    await supabase.from('clients').delete().eq('id', id);
    toast({ title: 'Cliente eliminado' });
    fetchClients();
  };

  const isExpired = (date: string) => new Date(date) < new Date();

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="font-display font-semibold text-xl text-foreground">Clientes ({clients.length})</h2>
        <Button onClick={() => { setShowForm(true); setEditingId(null); setForm({ username: '', password: '', max_screens: 1, expiry_date: '', notes: '' }); }} className="gradient-primary text-primary-foreground gap-2">
          <Plus className="w-4 h-4" /> Nuevo Cliente
        </Button>
      </div>

      {showForm && (
        <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} className="glass rounded-xl p-5 space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Input placeholder="Usuario" value={form.username} onChange={e => setForm({ ...form, username: e.target.value })} className="bg-secondary border-border text-foreground" maxLength={50} />
            <Input placeholder="Contraseña" value={form.password} onChange={e => setForm({ ...form, password: e.target.value })} className="bg-secondary border-border text-foreground" maxLength={50} />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Máx. Pantallas</label>
              <Input type="number" min={1} max={10} value={form.max_screens} onChange={e => setForm({ ...form, max_screens: parseInt(e.target.value) || 1 })} className="bg-secondary border-border text-foreground" />
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Fecha de Expiración</label>
              <Input type="date" value={form.expiry_date} onChange={e => setForm({ ...form, expiry_date: e.target.value })} className="bg-secondary border-border text-foreground" />
            </div>
          </div>
          <Input placeholder="Notas (opcional)" value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} className="bg-secondary border-border text-foreground" maxLength={200} />
          <div className="flex gap-2 justify-end">
            <Button variant="ghost" onClick={() => { setShowForm(false); setEditingId(null); }} className="text-muted-foreground"><X className="w-4 h-4 mr-1" /> Cancelar</Button>
            <Button onClick={handleSave} className="gradient-primary text-primary-foreground"><Save className="w-4 h-4 mr-1" /> {editingId ? 'Actualizar' : 'Crear'}</Button>
          </div>
        </motion.div>
      )}

      {loading ? (
        <div className="text-center py-12 text-muted-foreground">Cargando...</div>
      ) : clients.length === 0 ? (
        <div className="glass rounded-xl p-12 text-center">
          <Users className="w-12 h-12 text-muted-foreground mx-auto mb-3" />
          <p className="text-muted-foreground">No hay clientes registrados</p>
        </div>
      ) : (
        <div className="space-y-2">
          {clients.map((c, i) => (
            <motion.div key={c.id} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: i * 0.03 }}
              className={`glass rounded-xl p-4 ${!c.is_active || isExpired(c.expiry_date) ? 'opacity-50' : ''}`}>
              <div className="flex items-center justify-between gap-4">
                <div className="flex items-center gap-3 flex-1 min-w-0">
                  <div className={`w-10 h-10 rounded-lg flex items-center justify-center shrink-0 ${c.is_active && !isExpired(c.expiry_date) ? 'bg-primary/20' : 'bg-destructive/20'}`}>
                    {c.is_active && !isExpired(c.expiry_date) ? <UserCheck className="w-5 h-5 text-primary" /> : <UserX className="w-5 h-5 text-destructive" />}
                  </div>
                  <div className="min-w-0">
                    <p className="font-semibold text-foreground text-sm">{c.username}</p>
                    <div className="flex items-center gap-3 text-xs text-muted-foreground">
                      <span className="flex items-center gap-1"><Monitor className="w-3 h-3" /> {c.max_screens} pantallas</span>
                      <span>Expira: {format(new Date(c.expiry_date), 'dd/MM/yyyy')}</span>
                      {isExpired(c.expiry_date) && <span className="text-destructive font-semibold">EXPIRADO</span>}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <Button variant="ghost" size="sm" onClick={() => toggleActive(c)} className="text-xs text-muted-foreground">
                    {c.is_active ? 'Suspender' : 'Activar'}
                  </Button>
                  <Button variant="ghost" size="icon" onClick={() => handleEdit(c)} className="text-muted-foreground hover:text-primary">
                    <Edit2 className="w-4 h-4" />
                  </Button>
                  <Button variant="ghost" size="icon" onClick={() => handleDelete(c.id)} className="text-muted-foreground hover:text-destructive">
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

export default ClientsManager;
