import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Plus, Trash2, Edit2, Save, X, Users, UserCheck, UserX, Store, Phone, Mail, Hash, Percent } from 'lucide-react';
import { motion } from 'framer-motion';
import { format } from 'date-fns';

interface Reseller {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  username: string;
  password: string;
  max_clients: number;
  is_active: boolean;
  commission_percent: number;
  notes: string | null;
  created_at: string;
  client_count?: number;
}

const ResellersManager = () => {
  const { toast } = useToast();
  const [resellers, setResellers] = useState<Reseller[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState({
    name: '', email: '', phone: '', username: '', password: '',
    max_clients: 10, commission_percent: 0, notes: '',
  });

  const fetchResellers = async () => {
    const { data } = await supabase.from('resellers').select('*').order('created_at', { ascending: false });
    if (data) {
      // Get client counts per reseller
      const { data: clients } = await supabase.from('clients').select('reseller_id');
      const counts: Record<string, number> = {};
      clients?.forEach(c => {
        if (c.reseller_id) counts[c.reseller_id] = (counts[c.reseller_id] || 0) + 1;
      });
      setResellers(data.map(r => ({ ...r, client_count: counts[r.id] || 0 })));
    }
    setLoading(false);
  };

  useEffect(() => { fetchResellers(); }, []);

  const handleSave = async () => {
    if (!form.name.trim() || !form.username.trim() || !form.password.trim()) {
      toast({ title: 'Error', description: 'Nombre, usuario y contraseña son requeridos', variant: 'destructive' });
      return;
    }
    const payload = {
      name: form.name.trim(),
      email: form.email.trim() || null,
      phone: form.phone.trim() || null,
      username: form.username.trim(),
      password: form.password.trim(),
      max_clients: form.max_clients,
      commission_percent: form.commission_percent,
      notes: form.notes.trim() || null,
    };

    if (editingId) {
      const { error } = await supabase.from('resellers').update(payload).eq('id', editingId);
      if (error) { toast({ title: 'Error', description: error.message, variant: 'destructive' }); return; }
      toast({ title: 'Reseller actualizado' });
    } else {
      const { error } = await supabase.from('resellers').insert({ ...payload, is_active: true });
      if (error) { toast({ title: 'Error', description: error.message, variant: 'destructive' }); return; }
      toast({ title: 'Reseller creado' });
    }
    resetForm();
    fetchResellers();
  };

  const resetForm = () => {
    setForm({ name: '', email: '', phone: '', username: '', password: '', max_clients: 10, commission_percent: 0, notes: '' });
    setShowForm(false);
    setEditingId(null);
  };

  const handleEdit = (r: Reseller) => {
    setForm({
      name: r.name, email: r.email || '', phone: r.phone || '',
      username: r.username, password: r.password,
      max_clients: r.max_clients, commission_percent: r.commission_percent || 0,
      notes: r.notes || '',
    });
    setEditingId(r.id);
    setShowForm(true);
  };

  const toggleActive = async (r: Reseller) => {
    await supabase.from('resellers').update({ is_active: !r.is_active }).eq('id', r.id);
    fetchResellers();
    toast({ title: r.is_active ? 'Reseller suspendido' : 'Reseller activado' });
  };

  const handleDelete = async (id: string) => {
    // Unlink clients first
    await supabase.from('clients').update({ reseller_id: null }).eq('reseller_id', id);
    await supabase.from('resellers').delete().eq('id', id);
    toast({ title: 'Reseller eliminado' });
    fetchResellers();
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="font-semibold text-xl text-foreground">Resellers ({resellers.length})</h2>
        <Button onClick={() => { setShowForm(true); setEditingId(null); resetForm(); setShowForm(true); }} className="gradient-primary text-primary-foreground gap-2">
          <Plus className="w-4 h-4" /> Nuevo Reseller
        </Button>
      </div>

      {showForm && (
        <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} className="glass rounded-xl p-5 space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Nombre / Empresa</label>
              <Input placeholder="Nombre del reseller" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} className="bg-secondary border-border text-foreground" maxLength={100} />
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Email</label>
              <Input placeholder="email@ejemplo.com" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} className="bg-secondary border-border text-foreground" maxLength={100} />
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Teléfono</label>
              <Input placeholder="+1 234 567 890" value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })} className="bg-secondary border-border text-foreground" maxLength={30} />
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Usuario de acceso</label>
              <Input placeholder="usuario_reseller" value={form.username} onChange={e => setForm({ ...form, username: e.target.value })} className="bg-secondary border-border text-foreground" maxLength={50} />
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Contraseña</label>
              <Input placeholder="Contraseña" value={form.password} onChange={e => setForm({ ...form, password: e.target.value })} className="bg-secondary border-border text-foreground" maxLength={50} />
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Máx. Clientes</label>
              <Input type="number" min={1} value={form.max_clients} onChange={e => setForm({ ...form, max_clients: parseInt(e.target.value) || 10 })} className="bg-secondary border-border text-foreground" />
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Comisión %</label>
              <Input type="number" min={0} max={100} step={0.5} value={form.commission_percent} onChange={e => setForm({ ...form, commission_percent: parseFloat(e.target.value) || 0 })} className="bg-secondary border-border text-foreground" />
            </div>
          </div>
          <Input placeholder="Notas (opcional)" value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} className="bg-secondary border-border text-foreground" maxLength={200} />
          <div className="flex gap-2 justify-end">
            <Button variant="ghost" onClick={resetForm} className="text-muted-foreground"><X className="w-4 h-4 mr-1" /> Cancelar</Button>
            <Button onClick={handleSave} className="gradient-primary text-primary-foreground"><Save className="w-4 h-4 mr-1" /> {editingId ? 'Actualizar' : 'Crear'}</Button>
          </div>
        </motion.div>
      )}

      {loading ? (
        <div className="text-center py-12 text-muted-foreground">Cargando...</div>
      ) : resellers.length === 0 ? (
        <div className="glass rounded-xl p-12 text-center">
          <Store className="w-12 h-12 text-muted-foreground mx-auto mb-3" />
          <p className="text-muted-foreground">No hay resellers registrados</p>
          <p className="text-muted-foreground text-xs mt-1">Los resellers pueden gestionar sus propios clientes</p>
        </div>
      ) : (
        <div className="space-y-2">
          {resellers.map((r, i) => (
            <motion.div key={r.id} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: i * 0.03 }}
              className={`glass rounded-xl p-4 ${!r.is_active ? 'opacity-50' : ''}`}>
              <div className="flex items-center justify-between gap-4">
                <div className="flex items-center gap-3 flex-1 min-w-0">
                  <div className={`w-10 h-10 rounded-lg flex items-center justify-center shrink-0 ${r.is_active ? 'bg-accent/20' : 'bg-destructive/20'}`}>
                    <Store className={`w-5 h-5 ${r.is_active ? 'text-accent' : 'text-destructive'}`} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold text-foreground text-sm">{r.name}</p>
                    <div className="flex items-center gap-3 text-xs text-muted-foreground flex-wrap">
                      <span className="flex items-center gap-1">
                        <Users className="w-3 h-3" /> {r.client_count || 0}/{r.max_clients} clientes
                      </span>
                      {r.commission_percent > 0 && (
                        <span className="flex items-center gap-1">
                          <Percent className="w-3 h-3" /> {r.commission_percent}%
                        </span>
                      )}
                      {r.email && (
                        <span className="flex items-center gap-1 hidden sm:flex">
                          <Mail className="w-3 h-3" /> {r.email}
                        </span>
                      )}
                      {r.phone && (
                        <span className="flex items-center gap-1 hidden sm:flex">
                          <Phone className="w-3 h-3" /> {r.phone}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <Button variant="ghost" size="sm" onClick={() => toggleActive(r)} className="text-xs text-muted-foreground">
                    {r.is_active ? 'Suspender' : 'Activar'}
                  </Button>
                  <Button variant="ghost" size="icon" onClick={() => handleEdit(r)} className="text-muted-foreground hover:text-primary">
                    <Edit2 className="w-4 h-4" />
                  </Button>
                  <Button variant="ghost" size="icon" onClick={() => handleDelete(r.id)} className="text-muted-foreground hover:text-destructive">
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

export default ResellersManager;
