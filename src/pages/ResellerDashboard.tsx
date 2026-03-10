import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useResellerAuth, resellerApiGet, resellerApiPost, resellerApiPut, resellerApiDelete } from '@/contexts/ResellerAuthContext';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Store, LogOut, Plus, Edit2, Save, X, Trash2, Users, Calendar, Monitor, Loader2, Film } from 'lucide-react';
import { motion } from 'framer-motion';
import omnisyncLogo from '@/assets/omnisync-logo.png';

interface Client {
  id: string;
  username: string;
  password: string;
  max_screens: number;
  expiry_date: string;
  is_active: boolean;
  notes: string | null;
  plan_id: string | null;
  vod_enabled: boolean;
  created_at: string;
}

interface Plan {
  id: string;
  name: string;
}

const ResellerDashboard = () => {
  const { reseller, loading: authLoading, isReseller, logout } = useResellerAuth();
  const navigate = useNavigate();
  const { toast } = useToast();
  
  const [clients, setClients] = useState<Client[]>([]);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState({
    username: '', password: '', max_screens: 1,
    expiry_date: '', notes: '', plan_id: '', vod_enabled: false,
  });

  useEffect(() => {
    if (!authLoading && !isReseller) navigate('/reseller');
  }, [authLoading, isReseller, navigate]);

  const fetchData = async () => {
    try {
      const [clientsData, plansData] = await Promise.all([
        resellerApiGet('/api/reseller/clients'),
        resellerApiGet('/api/reseller/plans'),
      ]);
      setClients(clientsData || []);
      setPlans(plansData || []);
    } catch (err: any) {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    }
    setLoading(false);
  };

  useEffect(() => { if (isReseller) fetchData(); }, [isReseller]);

  const resetForm = () => {
    setForm({ username: '', password: '', max_screens: 1, expiry_date: '', notes: '', plan_id: '', vod_enabled: false });
    setShowForm(false);
    setEditingId(null);
  };

  const handleSave = async () => {
    if (!form.username.trim() || !form.password.trim() || !form.expiry_date) {
      toast({ title: 'Error', description: 'Usuario, contraseña y fecha de expiración son requeridos', variant: 'destructive' });
      return;
    }
    try {
      const payload = {
        username: form.username.trim(),
        password: form.password.trim(),
        max_screens: form.max_screens,
        expiry_date: form.expiry_date,
        notes: form.notes.trim() || null,
        plan_id: form.plan_id || null,
        vod_enabled: form.vod_enabled,
      };
      if (editingId) {
        await resellerApiPut(`/api/reseller/clients/${editingId}`, payload);
        toast({ title: 'Cliente actualizado' });
      } else {
        await resellerApiPost('/api/reseller/clients', payload);
        toast({ title: 'Cliente creado' });
      }
      resetForm();
      fetchData();
    } catch (err: any) {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    }
  };

  const handleEdit = (c: Client) => {
    setForm({
      username: c.username,
      password: c.password,
      max_screens: c.max_screens,
      expiry_date: c.expiry_date?.split('T')[0] || '',
      notes: c.notes || '',
      plan_id: c.plan_id || '',
      vod_enabled: c.vod_enabled,
    });
    setEditingId(c.id);
    setShowForm(true);
  };

  const toggleActive = async (c: Client) => {
    try {
      await resellerApiPut(`/api/reseller/clients/${c.id}`, { is_active: !c.is_active });
      fetchData();
      toast({ title: c.is_active ? 'Cliente suspendido' : 'Cliente activado' });
    } catch (err: any) {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await resellerApiDelete(`/api/reseller/clients/${id}`);
      toast({ title: 'Cliente eliminado' });
      fetchData();
    } catch (err: any) {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    }
  };

  const handleLogout = () => { logout(); navigate('/reseller'); };

  if (authLoading) return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <Loader2 className="w-8 h-8 animate-spin text-primary" />
    </div>
  );
  if (!isReseller) return null;

  const activeClients = clients.filter(c => c.is_active).length;
  const expiredClients = clients.filter(c => new Date(c.expiry_date) < new Date()).length;

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <div className="glass border-b border-border/50 px-4 py-3">
        <div className="max-w-5xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <img src={omnisyncLogo} alt="Logo" className="h-8" />
            <div>
              <h1 className="text-lg font-display font-bold text-foreground">Panel Reseller</h1>
              <p className="text-xs text-muted-foreground">{reseller?.name} • {clients.length}/{reseller?.max_clients} clientes</p>
            </div>
          </div>
          <Button variant="ghost" size="sm" onClick={handleLogout} className="text-muted-foreground gap-1.5">
            <LogOut className="w-4 h-4" /> Salir
          </Button>
        </div>
      </div>

      <div className="max-w-5xl mx-auto p-4 space-y-4">
        {/* Stats */}
        <div className="grid grid-cols-3 gap-3">
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="glass rounded-xl p-4 text-center">
            <Users className="w-6 h-6 text-primary mx-auto mb-1" />
            <p className="text-2xl font-bold text-foreground">{clients.length}</p>
            <p className="text-xs text-muted-foreground">Total Clientes</p>
          </motion.div>
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }} className="glass rounded-xl p-4 text-center">
            <div className="w-6 h-6 rounded-full bg-emerald-500/20 mx-auto mb-1 flex items-center justify-center">
              <div className="w-3 h-3 rounded-full bg-emerald-400" />
            </div>
            <p className="text-2xl font-bold text-foreground">{activeClients}</p>
            <p className="text-xs text-muted-foreground">Activos</p>
          </motion.div>
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }} className="glass rounded-xl p-4 text-center">
            <Calendar className="w-6 h-6 text-destructive mx-auto mb-1" />
            <p className="text-2xl font-bold text-foreground">{expiredClients}</p>
            <p className="text-xs text-muted-foreground">Expirados</p>
          </motion.div>
        </div>

        {/* Actions */}
        <div className="flex items-center justify-between">
          <h2 className="font-semibold text-lg text-foreground">Mis Clientes</h2>
          <Button
            onClick={() => { resetForm(); setShowForm(true); }}
            disabled={clients.length >= (reseller?.max_clients || 0)}
            className="gradient-primary text-primary-foreground gap-2"
          >
            <Plus className="w-4 h-4" /> Nuevo Cliente
          </Button>
        </div>

        {clients.length >= (reseller?.max_clients || 0) && (
          <div className="glass rounded-xl p-3 border border-destructive/30 text-center">
            <p className="text-xs text-destructive">Has alcanzado el límite de clientes ({reseller?.max_clients}). Contacta al administrador para ampliarlo.</p>
          </div>
        )}

        {/* Form */}
        {showForm && (
          <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} className="glass rounded-xl p-5 space-y-3">
            <h3 className="font-semibold text-foreground">{editingId ? 'Editar Cliente' : 'Nuevo Cliente'}</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Usuario</label>
                <Input placeholder="usuario_cliente" value={form.username} onChange={e => setForm({ ...form, username: e.target.value })}
                  className="bg-secondary border-border text-foreground" maxLength={50} />
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Contraseña</label>
                <Input placeholder="Contraseña" value={form.password} onChange={e => setForm({ ...form, password: e.target.value })}
                  className="bg-secondary border-border text-foreground" maxLength={50} />
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Pantallas</label>
                <Input type="number" min={1} max={5} value={form.max_screens}
                  onChange={e => setForm({ ...form, max_screens: parseInt(e.target.value) || 1 })}
                  className="bg-secondary border-border text-foreground" />
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Expiración</label>
                <Input type="date" value={form.expiry_date} onChange={e => setForm({ ...form, expiry_date: e.target.value })}
                  className="bg-secondary border-border text-foreground" />
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Plan</label>
                <Select value={form.plan_id} onValueChange={(v) => setForm({ ...form, plan_id: v })}>
                  <SelectTrigger className="bg-secondary border-border text-foreground">
                    <SelectValue placeholder="Sin plan" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Sin plan (todos los canales)</SelectItem>
                    {plans.map(p => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="flex items-center justify-between">
              <Input placeholder="Notas (opcional)" value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })}
                className="bg-secondary border-border text-foreground flex-1 mr-3" maxLength={200} />
              <div className="flex items-center gap-2 shrink-0">
                <Film className="w-4 h-4 text-muted-foreground" />
                <span className="text-xs text-muted-foreground">VOD</span>
                <Switch checked={form.vod_enabled} onCheckedChange={(v) => setForm({ ...form, vod_enabled: v })} />
              </div>
            </div>
            <div className="flex gap-2 justify-end">
              <Button variant="ghost" onClick={resetForm} className="text-muted-foreground"><X className="w-4 h-4 mr-1" /> Cancelar</Button>
              <Button onClick={handleSave} className="gradient-primary text-primary-foreground"><Save className="w-4 h-4 mr-1" /> {editingId ? 'Actualizar' : 'Crear'}</Button>
            </div>
          </motion.div>
        )}

        {/* Client List */}
        {loading ? (
          <div className="text-center py-12 text-muted-foreground">Cargando...</div>
        ) : clients.length === 0 ? (
          <div className="glass rounded-xl p-12 text-center">
            <Users className="w-12 h-12 text-muted-foreground mx-auto mb-3" />
            <p className="text-muted-foreground">No tienes clientes registrados</p>
            <p className="text-xs text-muted-foreground mt-1">Crea tu primer cliente con el botón de arriba</p>
          </div>
        ) : (
          <div className="space-y-2">
            {clients.map((c, i) => {
              const isExpired = new Date(c.expiry_date) < new Date();
              const planName = plans.find(p => p.id === c.plan_id)?.name;
              return (
                <motion.div key={c.id} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: i * 0.03 }}
                  className={`glass rounded-xl p-4 ${!c.is_active || isExpired ? 'opacity-60' : ''}`}>
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-3 min-w-0 flex-1">
                      <button onClick={() => toggleActive(c)}
                        className={`w-3 h-3 rounded-full shrink-0 cursor-pointer transition-colors ${c.is_active && !isExpired ? 'bg-emerald-400' : 'bg-destructive'}`} />
                      <div className="min-w-0">
                        <p className="font-semibold text-foreground text-sm">{c.username}</p>
                        <div className="flex items-center gap-3 text-xs text-muted-foreground flex-wrap">
                          <span className="flex items-center gap-1">
                            <Monitor className="w-3 h-3" /> {c.max_screens} pantalla{c.max_screens > 1 ? 's' : ''}
                          </span>
                          <span className={`flex items-center gap-1 ${isExpired ? 'text-destructive' : ''}`}>
                            <Calendar className="w-3 h-3" /> {new Date(c.expiry_date).toLocaleDateString()}
                            {isExpired && ' (expirado)'}
                          </span>
                          {planName && <span className="px-1.5 py-0.5 rounded bg-primary/10 text-primary text-[10px]">{planName}</span>}
                          {c.vod_enabled && <span className="px-1.5 py-0.5 rounded bg-accent/10 text-accent text-[10px]">VOD</span>}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <Button variant="ghost" size="icon" onClick={() => handleEdit(c)} className="text-muted-foreground hover:text-primary">
                        <Edit2 className="w-4 h-4" />
                      </Button>
                      <Button variant="ghost" size="icon" onClick={() => handleDelete(c.id)} className="text-muted-foreground hover:text-destructive">
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                  </div>
                </motion.div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};

export default ResellerDashboard;
