import { useState, useEffect, useCallback } from 'react';
import { apiGet, apiPost, apiPut, apiDelete } from '@/lib/api';
import { copyToClipboard } from '@/lib/clipboard';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { motion } from 'framer-motion';
import { format, differenceInDays } from 'date-fns';
import {
  Plus, Trash2, Edit2, Save, X, Users, UserX, UserCheck, Monitor,
  Link2, Copy, RefreshCw, List, Tv, FileText, Radio, Calendar,
  AlertTriangle, Search, Filter, Eye, EyeOff
} from 'lucide-react';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';

interface XtreamClient {
  id: string;
  username: string;
  password: string;
  max_connections: number;
  exp_date: string; // unix timestamp or date string
  is_trial: boolean;
  is_banned: boolean;
  admin_enabled: boolean;
  created_at: string;
  active_cons: number;
  // computed
  expiry_date?: Date;
  days_left?: number;
}

const ShieldClientsManager = () => {
  const { toast } = useToast();
  const [clients, setClients] = useState<XtreamClient[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [expandedPlaylist, setExpandedPlaylist] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<'all' | 'active' | 'expired' | 'banned' | 'expiring'>('all');
  const [showPassword, setShowPassword] = useState<Record<string, boolean>>({});

  const [form, setForm] = useState({
    username: '', password: '', max_connections: 1,
    exp_date: '', notes: '', is_trial: false,
  });

  const processClients = (raw: any[]): XtreamClient[] => {
    return raw.map(c => {
      const expDate = c.exp_date
        ? (String(c.exp_date).length > 10 ? new Date(c.exp_date) : new Date(Number(c.exp_date) * 1000))
        : null;
      const daysLeft = expDate ? differenceInDays(expDate, new Date()) : 999;
      return {
        ...c,
        max_connections: c.max_connections || 1,
        is_trial: c.is_trial || false,
        is_banned: c.is_banned || false,
        admin_enabled: c.admin_enabled !== false,
        active_cons: c.active_cons || 0,
        expiry_date: expDate || undefined,
        days_left: daysLeft,
      };
    });
  };

  const fetchClients = useCallback(async () => {
    try {
      const data = await apiGet('/api/shield/clients');
      setClients(processClients(data || []));
    } catch (err: any) {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    }
    setLoading(false);
  }, [toast]);

  useEffect(() => { fetchClients(); }, [fetchClients]);

  const handleSave = async () => {
    if (!form.username.trim() || !form.password.trim() || !form.exp_date) {
      toast({ title: 'Error', description: 'Completa usuario, contraseña y fecha', variant: 'destructive' });
      return;
    }
    const payload = {
      username: form.username.trim(),
      password: form.password.trim(),
      max_connections: form.max_connections,
      exp_date: form.exp_date,
      is_trial: form.is_trial,
    };
    try {
      if (editingId) {
        await apiPut(`/api/shield/clients/${editingId}`, payload);
        toast({ title: 'Cliente actualizado' });
      } else {
        await apiPost('/api/shield/clients', payload);
        toast({ title: 'Cliente creado' });
      }
      resetForm();
      fetchClients();
    } catch (err: any) {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    }
  };

  const resetForm = () => {
    setForm({ username: '', password: '', max_connections: 1, exp_date: '', notes: '', is_trial: false });
    setShowForm(false);
    setEditingId(null);
  };

  const handleEdit = (c: XtreamClient) => {
    const expStr = c.expiry_date ? format(c.expiry_date, 'yyyy-MM-dd') : '';
    setForm({
      username: c.username,
      password: c.password,
      max_connections: c.max_connections,
      exp_date: expStr,
      notes: '',
      is_trial: c.is_trial,
    });
    setEditingId(c.id);
    setShowForm(true);
  };

  const toggleBan = async (c: XtreamClient) => {
    try {
      await apiPut(`/api/shield/clients/${c.id}`, { is_banned: !c.is_banned });
      toast({ title: c.is_banned ? 'Cliente desbaneado' : 'Cliente baneado' });
      fetchClients();
    } catch (err: any) {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await apiDelete(`/api/shield/clients/${id}`);
      toast({ title: 'Cliente eliminado' });
      fetchClients();
    } catch (err: any) {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    }
  };

  const getPlaylistUrl = (c: XtreamClient, type: string) => {
    const base = window.location.origin;
    switch (type) {
      case 'm3u_plus':
        return `${base}/get.php?username=${c.username}&password=${c.password}&type=m3u_plus&output=ts`;
      case 'ts':
        return `${base}/get.php?username=${c.username}&password=${c.password}&type=m3u_plus&output=ts`;
      case 'hls':
        return `${base}/get.php?username=${c.username}&password=${c.password}&type=m3u_plus&output=hls`;
      case 'simple':
        return `${base}/get.php?username=${c.username}&password=${c.password}&type=m3u`;
      case 'enigma':
        return `${base}/get.php?username=${c.username}&password=${c.password}&type=enigma2`;
      case 'ott':
        return `${base}/get.php?username=${c.username}&password=${c.password}&type=m3u_plus&output=mpegts`;
      default:
        return `${base}/get.php?username=${c.username}&password=${c.password}&type=m3u_plus`;
    }
  };

  const getXtreamLogin = (c: XtreamClient) => {
    const base = window.location.origin;
    return { url: base, username: c.username, password: c.password };
  };

  const copyPlaylist = async (c: XtreamClient, type: string, label: string) => {
    const url = getPlaylistUrl(c, type);
    await copyToClipboard(url);
    toast({ title: '📋 URL copiada', description: `${label} copiado al portapapeles` });
  };

  const copyXtreamLogin = async (c: XtreamClient) => {
    const { url, username, password } = getXtreamLogin(c);
    const text = `URL: ${url}\nUsuario: ${username}\nContraseña: ${password}`;
    await copyToClipboard(text);
    toast({ title: '📋 Datos Xtream copiados', description: 'URL, usuario y contraseña copiados' });
  };

  const isExpired = (c: XtreamClient) => (c.days_left ?? 999) < 0;
  const isExpiringSoon = (c: XtreamClient) => (c.days_left ?? 999) >= 0 && (c.days_left ?? 999) <= 7;

  const filtered = clients.filter(c => {
    if (search && !c.username.toLowerCase().includes(search.toLowerCase())) return false;
    switch (filter) {
      case 'active': return !isExpired(c) && !c.is_banned && c.admin_enabled;
      case 'expired': return isExpired(c);
      case 'banned': return c.is_banned;
      case 'expiring': return isExpiringSoon(c);
      default: return true;
    }
  });

  const stats = {
    total: clients.length,
    active: clients.filter(c => !isExpired(c) && !c.is_banned).length,
    expired: clients.filter(c => isExpired(c)).length,
    expiring: clients.filter(c => isExpiringSoon(c)).length,
    online: clients.reduce((sum, c) => sum + c.active_cons, 0),
  };

  const playlistFormats = [
    { type: 'm3u_plus', label: 'M3U Plus', desc: 'Compatible con la mayoría de apps', icon: List },
    { type: 'ts', label: 'MPEG-TS (.ts)', desc: 'Para FFmpeg y reproductores TS', icon: Radio },
    { type: 'hls', label: 'HLS (.m3u8)', desc: 'Streaming adaptativo HTTP', icon: Tv },
    { type: 'simple', label: 'M3U Simple', desc: 'Solo URLs sin metadatos', icon: FileText },
    { type: 'enigma', label: 'Enigma2', desc: 'Para receptores satelitales', icon: Tv },
    { type: 'ott', label: 'OTT / Smart TV', desc: 'Optimizado para televisores', icon: Monitor },
  ];

  return (
    <div className="space-y-4">
      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        <StatBadge label="Total" value={stats.total} color="primary" />
        <StatBadge label="Activos" value={stats.active} color="success" />
        <StatBadge label="Expirados" value={stats.expired} color="destructive" />
        <StatBadge label="Por vencer" value={stats.expiring} color="warning" />
        <StatBadge label="En línea" value={stats.online} color="accent" />
      </div>

      {/* Search + Filter + Add */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Buscar cliente..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="pl-9 bg-secondary border-border text-foreground h-9"
          />
        </div>
        <div className="flex gap-1">
          {(['all', 'active', 'expired', 'expiring', 'banned'] as const).map(f => (
            <Button key={f} variant={filter === f ? 'default' : 'outline'} size="sm"
              onClick={() => setFilter(f)}
              className={`text-xs h-9 ${filter === f ? 'gradient-primary text-primary-foreground' : ''}`}>
              {f === 'all' ? 'Todos' : f === 'active' ? 'Activos' : f === 'expired' ? 'Expirados' : f === 'expiring' ? 'Por vencer' : 'Baneados'}
            </Button>
          ))}
        </div>
        <Button onClick={() => { setShowForm(true); setEditingId(null); resetForm(); setShowForm(true); }}
          className="gradient-primary text-primary-foreground gap-2 h-9">
          <Plus className="w-4 h-4" /> Nuevo
        </Button>
      </div>

      {/* Form */}
      {showForm && (
        <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} className="glass rounded-xl p-5 space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Input placeholder="Usuario" value={form.username} onChange={e => setForm({ ...form, username: e.target.value })}
              className="bg-secondary border-border text-foreground" maxLength={50} />
            <Input placeholder="Contraseña" value={form.password} onChange={e => setForm({ ...form, password: e.target.value })}
              className="bg-secondary border-border text-foreground" maxLength={50} />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Máx. Conexiones</label>
              <Input type="number" min={1} max={50} value={form.max_connections}
                onChange={e => setForm({ ...form, max_connections: parseInt(e.target.value) || 1 })}
                className="bg-secondary border-border text-foreground" />
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Fecha de Expiración</label>
              <Input type="date" value={form.exp_date} onChange={e => setForm({ ...form, exp_date: e.target.value })}
                className="bg-secondary border-border text-foreground" />
            </div>
            <div className="flex items-end">
              <label className="flex items-center gap-2 cursor-pointer h-10">
                <input type="checkbox" checked={form.is_trial} onChange={e => setForm({ ...form, is_trial: e.target.checked })}
                  className="w-4 h-4 rounded border-border accent-primary" />
                <span className="text-sm text-foreground">Trial</span>
              </label>
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
      ) : filtered.length === 0 ? (
        <div className="glass rounded-xl p-12 text-center">
          <Users className="w-12 h-12 text-muted-foreground mx-auto mb-3" />
          <p className="text-muted-foreground">No hay clientes {filter !== 'all' ? 'con este filtro' : 'registrados'}</p>
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map((c, i) => (
            <motion.div key={c.id} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: i * 0.02 }}
              className={`glass rounded-xl p-4 ${c.is_banned || isExpired(c) ? 'opacity-50' : ''}`}>
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-3 flex-1 min-w-0">
                  <div className={`w-10 h-10 rounded-lg flex items-center justify-center shrink-0 ${
                    c.is_banned ? 'bg-destructive/20' : isExpired(c) ? 'bg-muted' : isExpiringSoon(c) ? 'bg-yellow-500/20' : 'bg-primary/20'
                  }`}>
                    {c.is_banned ? <UserX className="w-5 h-5 text-destructive" /> :
                      isExpired(c) ? <UserX className="w-5 h-5 text-muted-foreground" /> :
                        <UserCheck className="w-5 h-5 text-primary" />}
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="font-semibold text-foreground text-sm">{c.username}</p>
                      <button onClick={() => setShowPassword(p => ({ ...p, [c.id]: !p[c.id] }))}
                        className="text-muted-foreground hover:text-foreground">
                        {showPassword[c.id] ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
                      </button>
                      {showPassword[c.id] && <span className="text-xs text-muted-foreground font-mono">{c.password}</span>}
                    </div>
                    <div className="flex items-center gap-3 text-xs text-muted-foreground flex-wrap">
                      <span className="flex items-center gap-1">
                        <Monitor className="w-3 h-3" />
                        {c.active_cons}/{c.max_connections}
                      </span>
                      <span className="flex items-center gap-1">
                        <Calendar className="w-3 h-3" />
                        {c.expiry_date ? format(c.expiry_date, 'dd/MM/yyyy') : 'Sin fecha'}
                      </span>
                      {c.days_left !== undefined && c.days_left >= 0 && c.days_left <= 30 && (
                        <Badge variant={c.days_left <= 3 ? 'destructive' : 'secondary'}
                          className="text-[10px] py-0">
                          {c.days_left === 0 ? 'Expira hoy' : `${c.days_left}d restantes`}
                        </Badge>
                      )}
                      {isExpired(c) && <Badge variant="destructive" className="text-[10px] py-0">EXPIRADO</Badge>}
                      {c.is_banned && <Badge variant="destructive" className="text-[10px] py-0">BANEADO</Badge>}
                      {c.is_trial && <Badge variant="secondary" className="text-[10px] py-0">TRIAL</Badge>}
                      {c.active_cons > 0 && (
                        <Badge className="text-[10px] py-0 bg-emerald-500/15 text-emerald-400 border-emerald-400/30">
                          🟢 En línea
                        </Badge>
                      )}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <Button variant="ghost" size="icon"
                    onClick={() => setExpandedPlaylist(expandedPlaylist === c.id ? null : c.id)}
                    className={`text-muted-foreground hover:text-primary ${expandedPlaylist === c.id ? 'text-primary' : ''}`}
                    title="Links M3U">
                    <Link2 className="w-4 h-4" />
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => toggleBan(c)} className="text-xs text-muted-foreground">
                    {c.is_banned ? 'Desbanear' : 'Banear'}
                  </Button>
                  <Button variant="ghost" size="icon" onClick={() => handleEdit(c)} className="text-muted-foreground hover:text-primary">
                    <Edit2 className="w-4 h-4" />
                  </Button>
                  <Button variant="ghost" size="icon" onClick={() => handleDelete(c.id)} className="text-muted-foreground hover:text-destructive">
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </div>
              </div>

              {/* Playlist URLs */}
              {expandedPlaylist === c.id && (
                <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} className="mt-3 pt-3 border-t border-border/50 space-y-3">
                  {/* Xtream Login */}
                  <div className="bg-primary/5 rounded-lg p-3 border border-primary/10">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-xs font-semibold text-foreground">📺 Datos Xtream Codes (TiviMate, Smarters)</span>
                      <Button variant="outline" size="sm" onClick={() => copyXtreamLogin(c)} className="text-xs gap-1 h-7">
                        <Copy className="w-3 h-3" /> Copiar Todo
                      </Button>
                    </div>
                    <div className="grid grid-cols-3 gap-2 text-xs">
                      <div>
                        <span className="text-muted-foreground block">URL:</span>
                        <code className="text-primary font-mono">{window.location.origin}</code>
                      </div>
                      <div>
                        <span className="text-muted-foreground block">Usuario:</span>
                        <code className="text-foreground font-mono">{c.username}</code>
                      </div>
                      <div>
                        <span className="text-muted-foreground block">Contraseña:</span>
                        <code className="text-foreground font-mono">{c.password}</code>
                      </div>
                    </div>
                  </div>

                  {/* Playlist Formats */}
                  <div>
                    <label className="text-xs text-muted-foreground flex items-center gap-1 mb-2">
                      <Link2 className="w-3 h-3" /> Formatos de Playlist
                    </label>
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                      {playlistFormats.map(({ type, label, desc, icon: Icon }) => (
                        <div key={type} className="glass rounded-lg p-3 space-y-2">
                          <div className="flex items-center gap-2">
                            <Icon className="w-4 h-4 text-primary shrink-0" />
                            <span className="text-xs font-semibold text-foreground">{label}</span>
                          </div>
                          <p className="text-[10px] text-muted-foreground leading-tight">{desc}</p>
                          <Button variant="outline" size="sm" onClick={() => copyPlaylist(c, type, label)}
                            className="w-full text-xs gap-1 h-7 border-border">
                            <Copy className="w-3 h-3" /> Copiar
                          </Button>
                        </div>
                      ))}
                    </div>
                  </div>

                  <p className="text-[10px] text-muted-foreground">
                    💡 Todas las URLs pasan por el proxy de Cloudflare. La IP real nunca se expone al cliente.
                  </p>
                </motion.div>
              )}
            </motion.div>
          ))}
        </div>
      )}
    </div>
  );
};

const StatBadge = ({ label, value, color }: { label: string; value: number; color: string }) => {
  const colorMap: Record<string, string> = {
    primary: 'bg-primary/15 text-primary',
    success: 'bg-emerald-500/15 text-emerald-400',
    destructive: 'bg-destructive/15 text-destructive',
    warning: 'bg-yellow-500/15 text-yellow-400',
    accent: 'bg-accent/15 text-accent',
  };
  return (
    <div className="glass rounded-xl p-3 text-center">
      <p className={`text-2xl font-bold ${colorMap[color]?.split(' ')[1] || 'text-foreground'}`}>{value}</p>
      <p className="text-xs text-muted-foreground">{label}</p>
    </div>
  );
};

export default ShieldClientsManager;
