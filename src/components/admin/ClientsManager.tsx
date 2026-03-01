import { useState, useEffect } from 'react';
import { apiGet, apiPost, apiPut, apiDelete } from '@/lib/api';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Plus, Trash2, Edit2, Save, X, Users, UserX, UserCheck, Monitor, Package } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { motion } from 'framer-motion';
import { format } from 'date-fns';

interface Plan {
  id: string;
  name: string;
  categories: string[];
}

interface Client {
  id: string;
  username: string;
  password: string;
  max_screens: number;
  expiry_date: string;
  is_active: boolean;
  notes: string | null;
  plan_id: string | null;
  created_at: string;
}

const ClientsManager = () => {
  const { toast } = useToast();
  const [clients, setClients] = useState<Client[]>([]);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState({ username: '', password: '', max_screens: 1, expiry_date: '', notes: '', plan_id: '' });

  const fetchClients = async () => {
    try {
      const data = await apiGet('/api/clients');
      setClients(data || []);
    } catch (err: any) {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    }
    setLoading(false);
  };

  const fetchPlans = async () => {
    const { data } = await (supabase.from('plans' as any).select('id, name, categories').eq('is_active', true).order('sort_order', { ascending: true }) as any);
    setPlans((data as any[]) || []);
  };

  useEffect(() => { fetchClients(); fetchPlans(); }, []);

  const handleSave = async () => {
    if (!form.username.trim() || !form.password.trim() || !form.expiry_date) {
      toast({ title: 'Error', description: 'Completa usuario, contraseña y fecha', variant: 'destructive' });
      return;
    }
    const payload: any = {
      username: form.username.trim(),
      password: form.password.trim(),
      max_screens: form.max_screens,
      expiry_date: form.expiry_date,
      notes: form.notes.trim() || null,
      plan_id: form.plan_id || null,
    };

    try {
      if (editingId) {
        await apiPut(`/api/clients/${editingId}`, payload);
        toast({ title: 'Cliente actualizado' });
      } else {
        await apiPost('/api/clients', { ...payload, is_active: true });
        toast({ title: 'Cliente creado' });
      }
      setForm({ username: '', password: '', max_screens: 1, expiry_date: '', notes: '', plan_id: '' });
      setShowForm(false);
      setEditingId(null);
      fetchClients();
    } catch (err: any) {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    }
  };

  const handleEdit = (c: Client) => {
    setForm({
      username: c.username,
      password: c.password,
      max_screens: c.max_screens,
      expiry_date: c.expiry_date.split('T')[0],
      notes: c.notes || '',
      plan_id: c.plan_id || '',
    });
    setEditingId(c.id);
    setShowForm(true);
  };

  const toggleActive = async (c: Client) => {
    try {
      await apiPut(`/api/clients/${c.id}`, { is_active: !c.is_active });
      fetchClients();
      toast({ title: c.is_active ? 'Cliente suspendido' : 'Cliente activado' });
    } catch (err: any) {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await apiDelete(`/api/clients/${id}`);
      toast({ title: 'Cliente eliminado' });
      fetchClients();
    } catch (err: any) {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    }
  };

  const isExpired = (date: string) => new Date(date) < new Date();

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="font-display font-semibold text-xl text-foreground">Clientes ({clients.length})</h2>
        <Button onClick={() => { setShowForm(true); setEditingId(null); setForm({ username: '', password: '', max_screens: 1, expiry_date: '', notes: '', plan_id: '' }); }} className="gradient-primary text-primary-foreground gap-2">
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
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">Plan</label>
            <select value={form.plan_id} onChange={e => setForm({ ...form, plan_id: e.target.value })} className="w-full h-10 rounded-md border border-border bg-secondary px-3 text-sm text-foreground">
              <option value="">Sin plan</option>
              {plans.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
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
                    <div className="flex items-center gap-3 text-xs text-muted-foreground flex-wrap">
                      <span className="flex items-center gap-1"><Monitor className="w-3 h-3" /> {c.max_screens} pantallas</span>
                      <span>Expira: {format(new Date(c.expiry_date), 'dd/MM/yyyy')}</span>
                      {c.plan_id && plans.find(p => p.id === c.plan_id) && (
                        <Badge variant="secondary" className="text-[10px] py-0 gap-1">
                          <Package className="w-2.5 h-2.5" /> {plans.find(p => p.id === c.plan_id)?.name}
                        </Badge>
                      )}
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
