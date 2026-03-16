import { useState, useEffect } from 'react';
import { apiGet, apiPost, apiPut, apiDelete } from '@/lib/api';
import { supabase } from '@/integrations/supabase/client';
import { isLovablePreview } from '@/lib/utils';
import { copyToClipboard } from '@/lib/clipboard';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Plus, Trash2, Edit2, Save, X, Users, UserX, UserCheck, Monitor, Package, Link2, Copy, RefreshCw, Film, Check } from 'lucide-react';
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
  playlist_token: string | null;
  created_at: string;
}

const ClientsManager = () => {
  const { toast } = useToast();
  const [clients, setClients] = useState<Client[]>([]);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [expandedPlaylist, setExpandedPlaylist] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [form, setForm] = useState({ username: '', password: '', max_screens: 1, expiry_date: '', notes: '', plan_id: '', vod_enabled: false });

  const fetchClients = async () => {
    try {
      if (isLovablePreview()) {
        const { data, error } = await supabase.from('clients').select('*').order('created_at', { ascending: false });
        if (error) throw error;
        setClients((data as any[]) || []);
      } else {
        const data = await apiGet('/api/clients');
        setClients(data || []);
      }
    } catch (err: any) {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    }
    setLoading(false);
  };

  const fetchPlans = async () => {
    try {
      if (isLovablePreview()) {
        const { data } = await (supabase.from('plans' as any).select('id, name, categories').eq('is_active', true).order('sort_order', { ascending: true }) as any);
        setPlans((data as any[]) || []);
      } else {
        const data = await apiGet('/api/plans');
        setPlans((data || []).filter((p: any) => p.is_active));
      }
    } catch (err) {
      console.error('Error fetching plans:', err);
    }
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
      vod_enabled: form.vod_enabled,
    };

    try {
      if (isLovablePreview()) {
        if (editingId) {
          const { error } = await supabase.from('clients').update(payload).eq('id', editingId);
          if (error) throw error;
          toast({ title: 'Cliente actualizado' });
        } else {
          const { error } = await supabase.from('clients').insert({ ...payload, is_active: true });
          if (error) throw error;
          toast({ title: 'Cliente creado' });
        }
      } else {
        if (editingId) {
          await apiPut(`/api/clients/${editingId}`, payload);
          toast({ title: 'Cliente actualizado' });
        } else {
          await apiPost('/api/clients', { ...payload, is_active: true });
          toast({ title: 'Cliente creado' });
        }
      }
      setForm({ username: '', password: '', max_screens: 1, expiry_date: '', notes: '', plan_id: '', vod_enabled: false });
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
      vod_enabled: (c as any).vod_enabled || false,
    });
    setEditingId(c.id);
    setShowForm(true);
  };

  const toggleActive = async (c: Client) => {
    try {
      if (isLovablePreview()) {
        const { error } = await supabase.from('clients').update({ is_active: !c.is_active }).eq('id', c.id);
        if (error) throw error;
      } else {
        await apiPut(`/api/clients/${c.id}`, { is_active: !c.is_active });
      }
      fetchClients();
      toast({ title: c.is_active ? 'Cliente suspendido' : 'Cliente activado' });
    } catch (err: any) {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    }
  };

  const handleDelete = async (id: string) => {
    try {
      if (isLovablePreview()) {
        const { error } = await supabase.from('clients').delete().eq('id', id);
        if (error) throw error;
      } else {
        await apiDelete(`/api/clients/${id}`);
      }
      toast({ title: 'Cliente eliminado' });
      fetchClients();
    } catch (err: any) {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    }
  };

  const isExpired = (date: string) => new Date(date) < new Date();

  const regenerateToken = async (clientId: string) => {
    try {
      if (isLovablePreview()) {
        const newToken = Array.from(crypto.getRandomValues(new Uint8Array(16)))
          .map(b => b.toString(16).padStart(2, '0')).join('');
        const { error } = await supabase.from('clients').update({ playlist_token: newToken } as any).eq('id', clientId);
        if (error) throw error;
      } else {
        await apiPost(`/api/clients/${clientId}/regenerate-token`, {});
      }
      toast({ title: '🔑 Token regenerado', description: 'El link anterior ya no funcionará' });
      fetchClients();
    } catch (err: any) {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    }
  };

  const getBaseUrl = () => window.location.origin;

  const getPlaylistFormats = (token: string | null, username: string, password: string) => {
    if (!token) return [];
    const base = getBaseUrl();
    return [
      {
        label: 'M3U Playlist',
        description: 'Compatible con OTT Player, Smart IPTV, SS IPTV, TiviMate',
        url: `${base}/api/playlist/${token}`,
        format: 'm3u',
      },
      {
        label: 'M3U8 (HLS)',
        description: 'Para reproductores que prefieren .m3u8',
        url: `${base}/api/playlist/${token}.m3u8`,
        format: 'm3u8',
      },
      {
        label: 'Xtream Codes API',
        description: 'Para apps que usan login Xtream (XCIPTV, TiviMate, etc.)',
        url: `${base}/player_api.php?username=${encodeURIComponent(username)}&password=${encodeURIComponent(password)}`,
        format: 'xtream',
      },
      {
        label: 'TS Direct Stream',
        description: 'URL base para streams .ts individuales',
        url: `${base}/live/${encodeURIComponent(username)}/${encodeURIComponent(password)}/`,
        format: 'ts',
      },
      {
        label: 'EPG (Guía de Programación)',
        description: 'URL de la guía electrónica de programación',
        url: `${base}/xmltv.php?username=${encodeURIComponent(username)}&password=${encodeURIComponent(password)}`,
        format: 'epg',
      },
    ];
  };

  const handleCopy = async (text: string, id: string) => {
    const success = await copyToClipboard(text);
    if (success) {
      setCopiedId(id);
      toast({ title: '📋 Copiado', description: 'URL copiada al portapapeles' });
      setTimeout(() => setCopiedId(null), 2000);
    } else {
      toast({ title: 'Error', description: 'No se pudo copiar. Selecciona y copia manualmente.', variant: 'destructive' });
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="font-display font-semibold text-xl text-foreground">Clientes ({clients.length})</h2>
        <Button onClick={() => { setShowForm(true); setEditingId(null); setForm({ username: '', password: '', max_screens: 1, expiry_date: '', notes: '', plan_id: '', vod_enabled: false }); }} className="gradient-primary text-primary-foreground gap-2">
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
          <div className="flex items-center gap-4">
            <Input placeholder="Notas (opcional)" value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} className="bg-secondary border-border text-foreground flex-1" maxLength={200} />
            <label className="flex items-center gap-2 cursor-pointer shrink-0">
              <input type="checkbox" checked={form.vod_enabled} onChange={e => setForm({ ...form, vod_enabled: e.target.checked })} className="w-4 h-4 rounded border-border accent-primary" />
              <span className="text-sm text-foreground flex items-center gap-1"><Film className="w-3.5 h-3.5" /> VOD</span>
            </label>
          </div>
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
                      {(c as any).vod_enabled && (
                        <Badge variant="secondary" className="text-[10px] py-0 gap-1 bg-primary/10 text-primary">
                          <Film className="w-2.5 h-2.5" /> VOD
                        </Badge>
                      )}
                      {isExpired(c.expiry_date) && <span className="text-destructive font-semibold">EXPIRADO</span>}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <Button variant="ghost" size="icon" onClick={() => setExpandedPlaylist(expandedPlaylist === c.id ? null : c.id)} className={`text-muted-foreground hover:text-primary ${expandedPlaylist === c.id ? 'text-primary' : ''}`} title="Links de Playlist">
                    <Link2 className="w-4 h-4" />
                  </Button>
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

              {/* Expanded Playlist URLs */}
              {expandedPlaylist === c.id && (
                <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} className="mt-3 pt-3 border-t border-border/50">
                  <div className="flex items-center justify-between mb-3">
                    <label className="text-xs font-semibold text-foreground flex items-center gap-1">
                      <Link2 className="w-3.5 h-3.5 text-primary" /> Links de Playlist y Conexión
                    </label>
                    {c.playlist_token ? (
                      <Button variant="outline" size="sm" onClick={() => regenerateToken(c.id)} className="text-xs gap-1 border-border text-muted-foreground hover:text-destructive" title="Regenerar token (invalida links anteriores)">
                        <RefreshCw className="w-3 h-3" /> Regenerar Token
                      </Button>
                    ) : (
                      <Button variant="outline" size="sm" onClick={() => regenerateToken(c.id)} className="text-xs gap-1">
                        <RefreshCw className="w-3 h-3" /> Generar Token
                      </Button>
                    )}
                  </div>

                  {c.playlist_token ? (
                    <div className="space-y-2">
                      {getPlaylistFormats(c.playlist_token, c.username, c.password).map((fmt) => {
                        const copyKey = `${c.id}-${fmt.format}`;
                        const isCopied = copiedId === copyKey;
                        return (
                          <div key={fmt.format} className="bg-secondary/50 rounded-lg p-3 border border-border/30">
                            <div className="flex items-start justify-between gap-2 mb-1.5">
                              <div>
                                <span className="text-xs font-semibold text-foreground">{fmt.label}</span>
                                <p className="text-[10px] text-muted-foreground">{fmt.description}</p>
                              </div>
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => handleCopy(fmt.url, copyKey)}
                                className={`shrink-0 text-xs gap-1 h-7 px-2 transition-colors ${isCopied ? 'border-emerald-500/50 text-emerald-400' : 'border-border text-muted-foreground'}`}
                              >
                                {isCopied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                                {isCopied ? 'Copiado' : 'Copiar'}
                              </Button>
                            </div>
                            <Input
                              readOnly
                              value={fmt.url}
                              className="bg-muted/50 border-border/50 text-foreground text-[11px] font-mono h-8"
                              onClick={(e) => (e.target as HTMLInputElement).select()}
                            />
                          </div>
                        );
                      })}

                      {/* Xtream login info */}
                      <div className="bg-primary/5 rounded-lg p-3 border border-primary/10 mt-2">
                        <p className="text-xs font-semibold text-foreground mb-2">📱 Datos para apps Xtream Codes</p>
                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                          {[
                            { label: 'Server URL', value: getBaseUrl(), id: `${c.id}-server` },
                            { label: 'Usuario', value: c.username, id: `${c.id}-user` },
                            { label: 'Contraseña', value: c.password, id: `${c.id}-pass` },
                          ].map((field) => (
                            <div key={field.id} className="flex items-center gap-1">
                              <div className="flex-1 min-w-0">
                                <p className="text-[10px] text-muted-foreground">{field.label}</p>
                                <p className="text-xs font-mono text-foreground truncate">{field.value}</p>
                              </div>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="shrink-0 w-6 h-6 text-muted-foreground hover:text-primary"
                                onClick={() => handleCopy(field.value, field.id)}
                              >
                                {copiedId === field.id ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                              </Button>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="bg-muted/30 rounded-lg p-4 text-center">
                      <p className="text-xs text-muted-foreground">Sin token generado. Genera uno para obtener los links de playlist.</p>
                    </div>
                  )}

                  <p className="text-[10px] text-muted-foreground mt-2">
                    💡 En red LAN usa la IP local. Con Cloudflare Tunnel usa el dominio del túnel como Server URL.
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

export default ClientsManager;
