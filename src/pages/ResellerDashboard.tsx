import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Plus, Trash2, Edit2, Save, X, Users, LogOut, Store, UserCheck, UserX, Copy, Monitor, Film, Check } from 'lucide-react';
import { copyToClipboard } from '@/lib/clipboard';
import { motion } from 'framer-motion';
import { format } from 'date-fns';
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
  plan_name: string | null;
  playlist_token: string | null;
  vod_enabled: boolean;
  created_at: string;
}

interface Plan {
  id: string;
  name: string;
  categories: string[];
}

interface ResellerInfo {
  id: string;
  name: string;
  username: string;
  max_clients: number;
  email: string | null;
  phone: string | null;
}

const resellerApi = async (path: string, options: RequestInit = {}) => {
  const token = localStorage.getItem('reseller_token');
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string> || {}),
  };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const API_BASE = import.meta.env.VITE_LOCAL_API_URL || '';
  const base = (typeof window !== 'undefined' && window.location.protocol === 'https:' && API_BASE.startsWith('http://')) ? '' : API_BASE;

  const response = await fetch(`${base}${path}`, { ...options, headers });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || `Error ${response.status}`);
  return data;
};

const ResellerDashboard = () => {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [info, setInfo] = useState<ResellerInfo | null>(null);
  const [clients, setClients] = useState<Client[]>([]);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [form, setForm] = useState({
    username: '', password: '', max_screens: 1, expiry_date: '', notes: '', plan_id: '', vod_enabled: false,
  });

  const fetchAll = useCallback(async () => {
    try {
      const [me, cls, pls] = await Promise.all([
        resellerApi('/api/reseller/me'),
        resellerApi('/api/reseller/clients'),
        resellerApi('/api/reseller/plans'),
      ]);
      setInfo(me);
      setClients(cls || []);
      setPlans(pls || []);
    } catch (err: any) {
      if (err.message.includes('401') || err.message.includes('Token')) {
        localStorage.removeItem('reseller_token');
        localStorage.removeItem('reseller_info');
        navigate('/reseller');
        return;
      }
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    }
    setLoading(false);
  }, [navigate, toast]);

  useEffect(() => {
    const token = localStorage.getItem('reseller_token');
    if (!token) { navigate('/reseller'); return; }
    fetchAll();
  }, [fetchAll, navigate]);

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
        await resellerApi(`/api/reseller/clients/${editingId}`, { method: 'PUT', body: JSON.stringify(payload) });
        toast({ title: 'Cliente actualizado' });
      } else {
        await resellerApi('/api/reseller/clients', { method: 'POST', body: JSON.stringify(payload) });
        toast({ title: 'Cliente creado' });
      }
      resetForm();
      fetchAll();
    } catch (err: any) {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    }
  };

  const resetForm = () => {
    setForm({ username: '', password: '', max_screens: 1, expiry_date: '', notes: '', plan_id: '', vod_enabled: false });
    setShowForm(false);
    setEditingId(null);
  };

  const handleEdit = (c: Client) => {
    setForm({
      username: c.username, password: c.password, max_screens: c.max_screens,
      expiry_date: c.expiry_date.split('T')[0], notes: c.notes || '',
      plan_id: c.plan_id || '', vod_enabled: c.vod_enabled,
    });
    setEditingId(c.id);
    setShowForm(true);
  };

  const toggleActive = async (c: Client) => {
    try {
      await resellerApi(`/api/reseller/clients/${c.id}`, { method: 'PUT', body: JSON.stringify({ is_active: !c.is_active }) });
      fetchAll();
      toast({ title: c.is_active ? 'Cliente suspendido' : 'Cliente activado' });
    } catch (err: any) {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await resellerApi(`/api/reseller/clients/${id}`, { method: 'DELETE' });
      toast({ title: 'Cliente eliminado' });
      fetchAll();
    } catch (err: any) {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    }
  };

  const handleCopy = async (text: string, id: string) => {
    await copyToClipboard(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const handleLogout = () => {
    localStorage.removeItem('reseller_token');
    localStorage.removeItem('reseller_info');
    navigate('/reseller');
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="animate-spin w-8 h-8 border-2 border-primary border-t-transparent rounded-full" />
      </div>
    );
  }

  const isExpired = (d: string) => new Date(d) < new Date();

  return (
    <div className="min-h-screen bg-background bg-grid">
      <header className="sticky top-0 z-50 glass-strong border-b border-primary/5">
        <div className="container flex items-center justify-between h-16 px-4">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-full overflow-hidden">
              <img src={omnisyncLogo} alt="Omnisync" className="w-full h-full object-cover" />
            </div>
            <div>
              <h1 className="font-bold text-lg text-gradient tracking-tight">Reseller</h1>
              <p className="text-[10px] text-muted-foreground -mt-0.5 tracking-wider uppercase">{info?.name}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="text-xs gap-1">
              <Users className="w-3 h-3" /> {clients.length}/{info?.max_clients}
            </Badge>
            <Button variant="ghost" size="icon" onClick={handleLogout} className="text-muted-foreground hover:text-destructive">
              <LogOut className="w-5 h-5" />
            </Button>
          </div>
        </div>
      </header>

      <main className="container px-4 py-6 space-y-4">
        {/* Stats */}
        <div className="grid grid-cols-3 gap-3">
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="glass rounded-xl p-4 text-center">
            <Users className="w-6 h-6 text-primary mx-auto mb-1" />
            <p className="text-2xl font-bold text-foreground">{clients.length}</p>
            <p className="text-xs text-muted-foreground">Total Clientes</p>
          </motion.div>
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }} className="glass rounded-xl p-4 text-center">
            <UserCheck className="w-6 h-6 text-emerald-400 mx-auto mb-1" />
            <p className="text-2xl font-bold text-foreground">{clients.filter(c => c.is_active && !isExpired(c.expiry_date)).length}</p>
            <p className="text-xs text-muted-foreground">Activos</p>
          </motion.div>
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }} className="glass rounded-xl p-4 text-center">
            <UserX className="w-6 h-6 text-destructive mx-auto mb-1" />
            <p className="text-2xl font-bold text-foreground">{clients.filter(c => !c.is_active || isExpired(c.expiry_date)).length}</p>
            <p className="text-xs text-muted-foreground">Inactivos</p>
          </motion.div>
        </div>

        {/* Actions */}
        <div className="flex items-center justify-between">
          <h2 className="font-semibold text-lg text-foreground">Mis Clientes</h2>
          <Button onClick={() => { resetForm(); setShowForm(true); }} className="gradient-primary text-primary-foreground gap-2"
            disabled={clients.length >= (info?.max_clients || 0)}>
            <Plus className="w-4 h-4" /> Nuevo Cliente
          </Button>
        </div>

        {/* Form */}
        {showForm && (
          <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} className="glass rounded-xl p-5 space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Usuario</label>
                <Input placeholder="nombre_usuario" value={form.username} onChange={e => setForm({ ...form, username: e.target.value })}
                  className="bg-secondary border-border text-foreground" maxLength={50} />
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Contraseña</label>
                <Input placeholder="contraseña_segura" value={form.password} onChange={e => setForm({ ...form, password: e.target.value })}
                  className="bg-secondary border-border text-foreground" maxLength={50} />
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Pantallas</label>
                <Input type="number" min={1} max={5} value={form.max_screens} onChange={e => setForm({ ...form, max_screens: parseInt(e.target.value) || 1 })}
                  className="bg-secondary border-border text-foreground" />
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Fecha de expiración</label>
                <Input type="date" value={form.expiry_date} onChange={e => setForm({ ...form, expiry_date: e.target.value })}
                  className="bg-secondary border-border text-foreground" />
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Plan</label>
                <select value={form.plan_id} onChange={e => setForm({ ...form, plan_id: e.target.value })}
                  className="w-full h-10 rounded-md bg-secondary border border-border text-foreground px-3 text-sm">
                  <option value="">Sin plan (todos los canales)</option>
                  {plans.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </div>
            </div>
            <div className="flex items-center gap-4">
              <label className="flex items-center gap-2 text-sm text-foreground cursor-pointer">
                <input type="checkbox" checked={form.vod_enabled} onChange={e => setForm({ ...form, vod_enabled: e.target.checked })}
                  className="rounded" />
                <Film className="w-4 h-4 text-muted-foreground" /> VOD habilitado
              </label>
            </div>
            <Input placeholder="Notas (opcional)" value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })}
              className="bg-secondary border-border text-foreground" maxLength={200} />
            <div className="flex gap-2 justify-end">
              <Button variant="ghost" onClick={resetForm} className="text-muted-foreground"><X className="w-4 h-4 mr-1" /> Cancelar</Button>
              <Button onClick={handleSave} className="gradient-primary text-primary-foreground"><Save className="w-4 h-4 mr-1" /> {editingId ? 'Actualizar' : 'Crear'}</Button>
            </div>
          </motion.div>
        )}

        {/* Client list */}
        {clients.length === 0 ? (
          <div className="glass rounded-xl p-12 text-center">
            <Users className="w-12 h-12 text-muted-foreground mx-auto mb-3" />
            <p className="text-muted-foreground">No tienes clientes aún. ¡Crea el primero!</p>
          </div>
        ) : (
          <div className="space-y-2">
            {clients.map((c, i) => {
              const expired = isExpired(c.expiry_date);
              return (
                <motion.div key={c.id} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: i * 0.03 }}
                  className={`glass rounded-xl p-4 ${!c.is_active || expired ? 'opacity-60' : ''}`}>
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-3 flex-1 min-w-0 cursor-pointer" onClick={() => setExpandedId(expandedId === c.id ? null : c.id)}>
                      <div className={`w-10 h-10 rounded-lg flex items-center justify-center shrink-0 ${c.is_active && !expired ? 'bg-emerald-500/20' : 'bg-destructive/20'}`}>
                        {c.is_active && !expired ? <UserCheck className="w-5 h-5 text-emerald-400" /> : <UserX className="w-5 h-5 text-destructive" />}
                      </div>
                      <div className="min-w-0">
                        <p className="font-semibold text-foreground text-sm">{c.username}</p>
                        <div className="flex items-center gap-2 text-xs text-muted-foreground flex-wrap">
                          <Badge variant={c.is_active && !expired ? 'default' : 'destructive'} className="text-[10px] px-1.5 py-0">
                            {expired ? 'Expirado' : c.is_active ? 'Activo' : 'Suspendido'}
                          </Badge>
                          <span className="flex items-center gap-1"><Monitor className="w-3 h-3" /> {c.max_screens}</span>
                          <span>Exp: {format(new Date(c.expiry_date), 'dd/MM/yyyy')}</span>
                          {c.plan_name && <Badge variant="outline" className="text-[10px]">{c.plan_name}</Badge>}
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

                  {expandedId === c.id && (
                    <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }}
                      className="mt-3 pt-3 border-t border-border/30 space-y-2">
                      <div className="flex items-center gap-2">
                        <code className="text-xs bg-secondary px-2 py-1 rounded text-foreground flex-1">
                          Usuario: {c.username} | Contraseña: {c.password}
                        </code>
                        <Button variant="ghost" size="icon" className="h-7 w-7"
                          onClick={() => handleCopy(`Usuario: ${c.username}\nContraseña: ${c.password}`, `creds-${c.id}`)}>
                          {copiedId === `creds-${c.id}` ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5 text-muted-foreground" />}
                        </Button>
                      </div>
                      {c.playlist_token && (
                        <div className="flex items-center gap-2">
                          <code className="text-xs bg-secondary px-2 py-1 rounded text-foreground flex-1 truncate">
                            M3U: {window.location.origin}/api/playlist/{c.playlist_token}
                          </code>
                          <Button variant="ghost" size="icon" className="h-7 w-7"
                            onClick={() => handleCopy(`${window.location.origin}/api/playlist/${c.playlist_token}`, `m3u-${c.id}`)}>
                            {copiedId === `m3u-${c.id}` ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5 text-muted-foreground" />}
                          </Button>
                        </div>
                      )}
                    </motion.div>
                  )}
                </motion.div>
              );
            })}
          </div>
        )}
      </main>
    </div>
  );
};

export default ResellerDashboard;