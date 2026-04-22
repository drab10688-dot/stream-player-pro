import { useState, useEffect, useCallback } from 'react';
import { motion } from 'framer-motion';
import { apiGet, apiPost, apiPut, apiDelete, getAdminToken } from '@/lib/api';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Plus, Download, RefreshCw, Trash2, Edit, Network, Radio, Activity, Server, Key, Copy, CheckCircle2, XCircle, Cpu, Play, Square, AlertCircle } from 'lucide-react';

// ============================================================
// Tipos
// ============================================================
type DeliveryMode = 'multicast_direct' | 'udpxy_rbldf' | 'udpxy_central';

interface Sector {
  id: string;
  name: string;
  description: string | null;
  vpn_username: string;
  vpn_password: string;
  assigned_ip: string;
  gre_local_ip: string | null;
  gre_remote_ip: string | null;
  gre_tunnel_name: string | null;
  mikrotik_public_ip: string | null;
  plan_id: string | null;
  plan_name: string | null;
  is_active: boolean;
  channels_count: number;
  tunnel_status: string | null;
  bytes_in: number;
  bytes_out: number;
  notes: string | null;
  delivery_mode: DeliveryMode;
  udpxy_url: string | null;
}

interface MulticastGroup {
  id: string;
  multicast_ip: string;
  port: number;
  channel_id: string | null;
  channel_name: string | null;
  is_assigned: boolean;
  sectors_count: number;
}

interface Channel { id: string; name: string; category: string; }
interface Plan { id: string; name: string; categories?: string[]; }

interface VpnStatus {
  ipsec_running: boolean;
  xl2tpd_running: boolean;
  smcroute_running: boolean;
  public_ip: string;
  psk: string;
  tunnels: Array<{ interface: string; ip: string }>;
  mock?: boolean;
}

// ============================================================
// Componente principal
// ============================================================
const VpnSectorsManager = () => {
  const { toast } = useToast();
  const [tab, setTab] = useState('sectors');

  return (
    <div className="space-y-6">
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="glass rounded-xl p-6">
        <div className="flex items-center gap-3 mb-2">
          <div className="w-12 h-12 rounded-xl bg-primary/15 flex items-center justify-center">
            <Network className="w-6 h-6 text-primary" />
          </div>
          <div>
            <h2 className="text-lg font-bold text-foreground">VPN Sectores · Multicast</h2>
            <p className="text-xs text-muted-foreground">L2TP/IPsec + GRE para distribución multicast a MikroTik remotos</p>
          </div>
        </div>
      </motion.div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="glass-strong border border-border/30 p-1">
          <TabsTrigger value="sectors" className="gap-2"><Server className="w-4 h-4" /> Sectores</TabsTrigger>
          <TabsTrigger value="multicast" className="gap-2"><Radio className="w-4 h-4" /> Canales Multicast</TabsTrigger>
          <TabsTrigger value="encoders" className="gap-2"><Cpu className="w-4 h-4" /> Encoders FFmpeg</TabsTrigger>
          <TabsTrigger value="monitor" className="gap-2"><Activity className="w-4 h-4" /> Monitor</TabsTrigger>
        </TabsList>

        <TabsContent value="sectors" className="mt-4"><SectorsSection /></TabsContent>
        <TabsContent value="multicast" className="mt-4"><MulticastSection /></TabsContent>
        <TabsContent value="encoders" className="mt-4"><EncodersSection /></TabsContent>
        <TabsContent value="monitor" className="mt-4"><MonitorSection /></TabsContent>
      </Tabs>
    </div>
  );
};

// ============================================================
// SECCIÓN 1: SECTORES (CRUD + descarga config MikroTik)
// ============================================================
const SectorsSection = () => {
  const { toast } = useToast();
  const [sectors, setSectors] = useState<Sector[]>([]);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Sector | null>(null);
  const [form, setForm] = useState({
    name: '', description: '', vpn_username: '', vpn_password: '',
    assigned_ip: '', gre_local_ip: '172.16.50.1', gre_remote_ip: '',
    mikrotik_public_ip: '', plan_id: '',
  });

  const load = useCallback(async () => {
    try {
      const [s, p] = await Promise.all([apiGet('/api/vpn/sectors'), apiGet('/api/plans')]);
      setSectors(s);
      setPlans(p);
    } catch (e: any) {
      toast({ title: 'Error', description: e.message, variant: 'destructive' });
    }
  }, [toast]);

  useEffect(() => { load(); }, [load]);

  const openCreate = () => {
    setEditing(null);
    // Sugerir IP libre del pool 172.16.50.10-250
    const used = new Set(sectors.map(s => s.assigned_ip));
    let suggested = '';
    for (let i = 10; i <= 250; i++) {
      const ip = `172.16.50.${i}`;
      if (!used.has(ip)) { suggested = ip; break; }
    }
    setForm({
      name: '', description: '', vpn_username: '', vpn_password: '',
      assigned_ip: suggested, gre_local_ip: '172.16.50.1',
      gre_remote_ip: '', mikrotik_public_ip: '', plan_id: '',
    });
    setOpen(true);
  };

  const openEdit = (s: Sector) => {
    setEditing(s);
    setForm({
      name: s.name, description: s.description || '',
      vpn_username: s.vpn_username, vpn_password: s.vpn_password,
      assigned_ip: s.assigned_ip,
      gre_local_ip: s.gre_local_ip || '172.16.50.1',
      gre_remote_ip: s.gre_remote_ip || '',
      mikrotik_public_ip: s.mikrotik_public_ip || '',
      plan_id: s.plan_id || '',
    });
    setOpen(true);
  };

  const save = async () => {
    try {
      const payload = { ...form, plan_id: form.plan_id || null };
      if (editing) {
        await apiPut(`/api/vpn/sectors/${editing.id}`, payload);
        toast({ title: 'Sector actualizado' });
      } else {
        await apiPost('/api/vpn/sectors', payload);
        toast({ title: 'Sector creado' });
      }
      setOpen(false);
      load();
    } catch (e: any) {
      toast({ title: 'Error', description: e.message, variant: 'destructive' });
    }
  };

  const remove = async (id: string) => {
    if (!confirm('¿Eliminar sector? Se desconectará el túnel.')) return;
    try {
      await apiDelete(`/api/vpn/sectors/${id}`);
      toast({ title: 'Sector eliminado' });
      load();
    } catch (e: any) {
      toast({ title: 'Error', description: e.message, variant: 'destructive' });
    }
  };

  const toggle = async (s: Sector) => {
    try {
      await apiPut(`/api/vpn/sectors/${s.id}`, { is_active: !s.is_active });
      load();
    } catch (e: any) {
      toast({ title: 'Error', description: e.message, variant: 'destructive' });
    }
  };

  const downloadConfig = async (s: Sector) => {
    try {
      const token = getAdminToken();
      const res = await fetch(`/api/vpn/sectors/${s.id}/mikrotik-config`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error('Error al descargar');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `omnisync-${s.name.replace(/[^a-z0-9]/gi, '-')}.rsc`;
      a.click();
      URL.revokeObjectURL(url);
      toast({ title: 'Configuración MikroTik descargada' });
    } catch (e: any) {
      toast({ title: 'Error', description: e.message, variant: 'destructive' });
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <p className="text-sm text-muted-foreground">{sectors.length} sectores configurados</p>
        <div className="flex gap-2">
          <Button variant="ghost" size="icon" onClick={load}><RefreshCw className="w-4 h-4" /></Button>
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button onClick={openCreate} className="gradient-primary gap-2">
                <Plus className="w-4 h-4" /> Nuevo Sector
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-2xl">
              <DialogHeader>
                <DialogTitle>{editing ? 'Editar Sector' : 'Nuevo Sector'}</DialogTitle>
              </DialogHeader>
              <div className="grid grid-cols-2 gap-4">
                <div className="col-span-2">
                  <Label>Nombre del sector</Label>
                  <Input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="Sector Norte" />
                </div>
                <div>
                  <Label>Usuario L2TP</Label>
                  <Input value={form.vpn_username} onChange={e => setForm({ ...form, vpn_username: e.target.value })} placeholder="sector_norte" />
                </div>
                <div>
                  <Label>Contraseña L2TP</Label>
                  <Input value={form.vpn_password} onChange={e => setForm({ ...form, vpn_password: e.target.value })} type="text" />
                </div>
                <div>
                  <Label>IP asignada en VPN</Label>
                  <Input value={form.assigned_ip} onChange={e => setForm({ ...form, assigned_ip: e.target.value })} placeholder="172.16.50.10" />
                </div>
                <div>
                  <Label>IP pública MikroTik (opcional)</Label>
                  <Input value={form.mikrotik_public_ip} onChange={e => setForm({ ...form, mikrotik_public_ip: e.target.value })} />
                </div>
                <div>
                  <Label>GRE local IP</Label>
                  <Input value={form.gre_local_ip} onChange={e => setForm({ ...form, gre_local_ip: e.target.value })} />
                </div>
                <div>
                  <Label>GRE remote IP (point-to-point)</Label>
                  <Input value={form.gre_remote_ip} onChange={e => setForm({ ...form, gre_remote_ip: e.target.value })} placeholder="10.99.99.2" />
                </div>
                <div className="col-span-2">
                  <Label>Plan asociado</Label>
                  <Select value={form.plan_id} onValueChange={v => setForm({ ...form, plan_id: v })}>
                    <SelectTrigger><SelectValue placeholder="Sin plan" /></SelectTrigger>
                    <SelectContent>
                      {plans.map(p => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="col-span-2">
                  <Label>Descripción</Label>
                  <Input value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} />
                </div>
              </div>
              <Button onClick={save} className="gradient-primary">{editing ? 'Guardar' : 'Crear'}</Button>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      <div className="space-y-2">
        {sectors.map(s => (
          <motion.div key={s.id} initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="glass rounded-lg p-4 flex items-center gap-4">
            <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
              <Server className="w-5 h-5 text-primary" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1">
                <span className="font-semibold text-foreground truncate">{s.name}</span>
                <Badge variant={s.is_active ? 'default' : 'secondary'} className="text-[10px]">
                  {s.is_active ? 'Activo' : 'Inactivo'}
                </Badge>
                {s.tunnel_status === 'connected' && (
                  <Badge variant="outline" className="text-emerald-400 border-emerald-400/30 text-[10px]">Conectado</Badge>
                )}
                {s.plan_name && <Badge variant="outline" className="text-[10px]">{s.plan_name}</Badge>}
              </div>
              <div className="text-xs text-muted-foreground flex flex-wrap gap-x-4 gap-y-1">
                <span>👤 {s.vpn_username}</span>
                <span>🌐 {s.assigned_ip}</span>
                <span>📺 {s.channels_count} canales</span>
                {s.gre_tunnel_name && <span>🔗 {s.gre_tunnel_name}</span>}
              </div>
            </div>
            <div className="flex items-center gap-1 shrink-0">
              <Switch checked={s.is_active} onCheckedChange={() => toggle(s)} />
              <Button variant="ghost" size="icon" onClick={() => downloadConfig(s)} title="Descargar config MikroTik (.rsc)">
                <Download className="w-4 h-4" />
              </Button>
              <Button variant="ghost" size="icon" onClick={() => openEdit(s)}><Edit className="w-4 h-4" /></Button>
              <Button variant="ghost" size="icon" onClick={() => remove(s.id)} className="text-destructive">
                <Trash2 className="w-4 h-4" />
              </Button>
            </div>
          </motion.div>
        ))}
        {sectors.length === 0 && (
          <div className="text-center py-12 text-muted-foreground text-sm">
            No hay sectores configurados. Crea uno para distribuir canales por VPN.
          </div>
        )}
      </div>
    </div>
  );
};

// ============================================================
// SECCIÓN 2: MULTICAST (asignar canal → grupo + sector → canales)
// ============================================================
const MulticastSection = () => {
  const { toast } = useToast();
  const [groups, setGroups] = useState<MulticastGroup[]>([]);
  const [channels, setChannels] = useState<Channel[]>([]);
  const [sectors, setSectors] = useState<Sector[]>([]);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [selectedSector, setSelectedSector] = useState<string>('');
  const [sectorChannels, setSectorChannels] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    try {
      const [g, c, s, p] = await Promise.all([
        apiGet('/api/vpn/multicast'),
        apiGet('/api/channels'),
        apiGet('/api/vpn/sectors'),
        apiGet('/api/plans'),
      ]);
      setGroups(g);
      setChannels(c);
      setSectors(s);
      setPlans(p);
    } catch (e: any) {
      toast({ title: 'Error', description: e.message, variant: 'destructive' });
    }
  }, [toast]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!selectedSector) { setSectorChannels(new Set()); return; }
    apiGet(`/api/vpn/sectors/${selectedSector}/channels`).then(rows => {
      setSectorChannels(new Set(rows.map((r: any) => r.multicast_group_id)));
    });
  }, [selectedSector]);

  const assignChannel = async (groupId: string, channelId: string | null) => {
    try {
      await apiPost('/api/vpn/multicast/assign', { multicast_group_id: groupId, channel_id: channelId });
      load();
    } catch (e: any) {
      toast({ title: 'Error', description: e.message, variant: 'destructive' });
    }
  };

  const toggleSectorChannel = (groupId: string) => {
    const next = new Set(sectorChannels);
    if (next.has(groupId)) next.delete(groupId);
    else next.add(groupId);
    setSectorChannels(next);
  };

  const saveSectorChannels = async () => {
    if (!selectedSector) return;
    try {
      await apiPost(`/api/vpn/sectors/${selectedSector}/channels`, {
        multicast_group_ids: Array.from(sectorChannels),
      });
      toast({ title: 'Asignación guardada', description: 'Rutas multicast actualizadas en el sistema' });
      load();
    } catch (e: any) {
      toast({ title: 'Error', description: e.message, variant: 'destructive' });
    }
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      {/* Panel 1: Pool multicast → asignar canales */}
      <div className="glass rounded-xl p-4">
        <h3 className="font-semibold text-foreground mb-3 flex items-center gap-2">
          <Radio className="w-4 h-4 text-primary" /> Pool Multicast (239.10.0.X)
        </h3>
        <div className="space-y-1 max-h-[500px] overflow-y-auto">
          {groups.map(g => (
            <div key={g.id} className="flex items-center gap-2 p-2 rounded hover:bg-muted/30">
              <code className="text-xs text-primary font-mono w-32 shrink-0">{g.multicast_ip}:{g.port}</code>
              <Select value={g.channel_id || 'none'} onValueChange={v => assignChannel(g.id, v === 'none' ? null : v)}>
                <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Sin asignar" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">— Sin asignar —</SelectItem>
                  {channels.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                </SelectContent>
              </Select>
              {g.sectors_count > 0 && (
                <Badge variant="outline" className="text-[10px] shrink-0">{g.sectors_count} sec</Badge>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Panel 2: Sector → seleccionar canales que recibe */}
      <div className="glass rounded-xl p-4">
        <h3 className="font-semibold text-foreground mb-3 flex items-center gap-2">
          <Server className="w-4 h-4 text-primary" /> Canales por Sector
        </h3>
        <Select value={selectedSector} onValueChange={setSelectedSector}>
          <SelectTrigger><SelectValue placeholder="Selecciona un sector" /></SelectTrigger>
          <SelectContent>
            {sectors.map(s => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
          </SelectContent>
        </Select>

        {selectedSector && (() => {
          const sector = sectors.find(s => s.id === selectedSector);
          const plan = plans.find(p => p.id === sector?.plan_id);
          const allowedCats = plan?.categories || [];
          const planLimited = !!sector?.plan_id;
          const channelById = new Map(channels.map(c => [c.id, c]));
          const assignedGroups = groups.filter(g => g.is_assigned);
          const isAllowedGroup = (g: MulticastGroup) => {
            if (!planLimited) return true;
            if (!g.channel_id) return false;
            const cat = channelById.get(g.channel_id)?.category;
            return !!cat && allowedCats.includes(cat);
          };
          const allowedGroups = assignedGroups.filter(isAllowedGroup);
          const blockedCount = assignedGroups.length - allowedGroups.length;

          const cleanSelection = () => {
            const cleaned = new Set<string>();
            sectorChannels.forEach(id => {
              const g = assignedGroups.find(x => x.id === id);
              if (g && isAllowedGroup(g)) cleaned.add(id);
            });
            setSectorChannels(cleaned);
          };

          return (
            <>
              <div className="mt-3 glass rounded-lg p-3 space-y-1">
                {planLimited ? (
                  <>
                    <div className="flex items-center gap-2 text-xs flex-wrap">
                      <Badge variant="outline" className="text-primary border-primary/30">{plan?.name || 'Plan'}</Badge>
                      <span className="text-muted-foreground">
                        {sectorChannels.size} / {allowedGroups.length} permitidos seleccionados
                      </span>
                    </div>
                    <div className="text-[11px] text-muted-foreground flex flex-wrap items-center gap-1">
                      <span>Categorías:</span>
                      {allowedCats.length
                        ? allowedCats.map(c => <Badge key={c} variant="secondary" className="text-[10px]">{c}</Badge>)
                        : <span className="text-destructive">Ninguna (asigna categorías al plan)</span>}
                    </div>
                    {blockedCount > 0 && (
                      <p className="text-[11px] text-yellow-400">
                        {blockedCount} canal(es) ocultos por restricción del plan.{' '}
                        <button onClick={cleanSelection} className="underline hover:text-primary">
                          Limpiar selección no permitida
                        </button>
                      </p>
                    )}
                  </>
                ) : (
                  <p className="text-[11px] text-yellow-400">
                    Sector sin plan asignado: puede recibir cualquier canal. Asigna un plan al sector para limitar.
                  </p>
                )}
              </div>

              <div className="space-y-1 max-h-[380px] overflow-y-auto mt-3">
                {allowedGroups.map(g => (
                  <label key={g.id} className="flex items-center gap-2 p-2 rounded hover:bg-muted/30 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={sectorChannels.has(g.id)}
                      onChange={() => toggleSectorChannel(g.id)}
                      className="w-4 h-4 accent-primary"
                    />
                    <code className="text-xs text-primary font-mono w-28 shrink-0">{g.multicast_ip}</code>
                    <span className="text-xs text-foreground flex-1 truncate">{g.channel_name || 'Sin canal'}</span>
                    {g.channel_id && (
                      <Badge variant="outline" className="text-[10px] shrink-0">
                        {channelById.get(g.channel_id)?.category || '—'}
                      </Badge>
                    )}
                  </label>
                ))}
                {allowedGroups.length === 0 && (
                  <p className="text-xs text-muted-foreground text-center py-8">
                    {planLimited
                      ? 'No hay canales asignados a grupos multicast dentro de las categorías de este plan.'
                      : 'Asigna canales a grupos multicast en el panel izquierdo primero.'}
                  </p>
                )}
              </div>
              <Button
                onClick={saveSectorChannels}
                className="gradient-primary w-full mt-3"
                disabled={planLimited && allowedCats.length === 0}
              >
                Guardar y aplicar al sistema
              </Button>
            </>
          );
        })()}
      </div>
    </div>
  );
};

// ============================================================
// SECCIÓN 3: MONITOR (estado IPsec + xl2tpd + smcroute + túneles)
// ============================================================
const MonitorSection = () => {
  const { toast } = useToast();
  const [status, setStatus] = useState<VpnStatus | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const data = await apiGet('/api/vpn/status');
      setStatus(data);
    } catch (e: any) {
      toast({ title: 'Error', description: e.message, variant: 'destructive' });
    }
    setLoading(false);
  }, [toast]);

  useEffect(() => {
    load();
    const i = setInterval(load, 5000);
    return () => clearInterval(i);
  }, [load]);

  const resync = async () => {
    try {
      await apiPost('/api/vpn/resync', {});
      toast({ title: 'Sistema resincronizado', description: 'chap-secrets, GRE y smcroute actualizados' });
      load();
    } catch (e: any) {
      toast({ title: 'Error', description: e.message, variant: 'destructive' });
    }
  };

  const copyPSK = async () => {
    if (!status?.psk) return;
    const { copyToClipboard } = await import('@/lib/clipboard');
    if (await copyToClipboard(status.psk)) toast({ title: 'PSK copiado' });
  };

  if (loading) return <div className="text-center py-12 text-muted-foreground">Cargando...</div>;
  if (!status) return null;

  const StatusBadge = ({ ok, label }: { ok: boolean; label: string }) => (
    <div className="glass rounded-lg p-3 flex items-center gap-2">
      {ok ? <CheckCircle2 className="w-4 h-4 text-emerald-400" /> : <XCircle className="w-4 h-4 text-destructive" />}
      <span className="text-xs text-foreground">{label}</span>
    </div>
  );

  return (
    <div className="space-y-4">
      {status.mock && (
        <div className="glass rounded-lg p-3 border border-yellow-400/20 bg-yellow-400/5">
          <p className="text-xs text-yellow-400">
            ⚠️ Modo simulación: este sistema no es Linux o el script <code>install-vpn.sh</code> no se ha ejecutado todavía.
          </p>
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <StatusBadge ok={status.ipsec_running} label="IPsec (strongSwan)" />
        <StatusBadge ok={status.xl2tpd_running} label="L2TP (xl2tpd)" />
        <StatusBadge ok={status.smcroute_running} label="Multicast (smcroute)" />
      </div>

      <div className="glass rounded-xl p-4 space-y-3">
        <h3 className="font-semibold text-foreground flex items-center gap-2">
          <Key className="w-4 h-4 text-primary" /> Configuración del servidor
        </h3>
        <div className="space-y-2 text-xs">
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground w-32">IP pública:</span>
            <code className="text-primary">{status.public_ip}</code>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground w-32">PSK IPsec:</span>
            <code className="text-primary flex-1 truncate">{status.psk}</code>
            <Button variant="ghost" size="icon" onClick={copyPSK}><Copy className="w-4 h-4" /></Button>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground w-32">Red VPN:</span>
            <code className="text-primary">172.16.50.0/24</code>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground w-32">Multicast:</span>
            <code className="text-primary">239.10.0.0/24</code>
          </div>
        </div>
      </div>

      <div className="glass rounded-xl p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-semibold text-foreground flex items-center gap-2">
            <Activity className="w-4 h-4 text-primary" /> Túneles activos ({status.tunnels.length})
          </h3>
          <Button variant="outline" size="sm" onClick={resync} className="gap-2">
            <RefreshCw className="w-4 h-4" /> Resincronizar
          </Button>
        </div>
        {status.tunnels.length === 0 ? (
          <p className="text-xs text-muted-foreground text-center py-4">No hay túneles L2TP conectados</p>
        ) : (
          <div className="space-y-1">
            {status.tunnels.map((t, i) => (
              <div key={i} className="flex items-center gap-3 p-2 rounded bg-muted/20 text-xs">
                <span className="w-2 h-2 rounded-full bg-emerald-400" />
                <code className="text-primary">{t.interface}</code>
                <span className="text-muted-foreground">→</span>
                <code className="text-foreground">{t.ip}</code>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

// ============================================================
// SECCIÓN 4: ENCODERS FFMPEG (HTTP→UDP multicast on-demand)
// ============================================================
interface EncoderRow {
  id: string;
  channel_id: string;
  channel_name: string;
  category: string;
  multicast_ip: string | null;
  port: number | null;
  pid: number | null;
  status: string;
  codec_mode: string;
  source_codec_video: string | null;
  source_codec_audio: string | null;
  cpu_percent: number;
  bitrate_kbps: number;
  started_at: string | null;
  last_heartbeat: string | null;
  last_error: string | null;
  sectors_using: number;
  runtime_alive: boolean;
  idle_seconds: number | null;
}

const EncodersSection = () => {
  const { toast } = useToast();
  const [encoders, setEncoders] = useState<EncoderRow[]>([]);
  const [ffmpegInstalled, setFfmpegInstalled] = useState(true);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await apiGet<{ ffmpeg_installed: boolean; encoders: EncoderRow[] }>('/api/vpn/encoders');
      setFfmpegInstalled(r.ffmpeg_installed);
      setEncoders(r.encoders || []);
    } catch (e: any) {
      toast({ title: 'Error', description: e.message, variant: 'destructive' });
    }
  }, [toast]);

  useEffect(() => {
    load();
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, [load]);

  const startOne = async (channelId: string) => {
    setLoading(true);
    try {
      await apiPost(`/api/vpn/encoders/${channelId}/start`, {});
      toast({ title: 'Encoder iniciado' });
      await load();
    } catch (e: any) {
      toast({ title: 'Error', description: e.message, variant: 'destructive' });
    } finally { setLoading(false); }
  };

  const stopOne = async (channelId: string) => {
    setLoading(true);
    try {
      await apiPost(`/api/vpn/encoders/${channelId}/stop`, {});
      toast({ title: 'Encoder detenido' });
      await load();
    } catch (e: any) {
      toast({ title: 'Error', description: e.message, variant: 'destructive' });
    } finally { setLoading(false); }
  };

  const syncAll = async () => {
    setLoading(true);
    try {
      const r = await apiPost<{ started: number; total_active: number }>('/api/vpn/encoders/sync', {});
      toast({ title: `Sync OK`, description: `Iniciados: ${r.started} · Activos: ${r.total_active}` });
      await load();
    } catch (e: any) {
      toast({ title: 'Error', description: e.message, variant: 'destructive' });
    } finally { setLoading(false); }
  };

  const running = encoders.filter(e => e.runtime_alive).length;
  const idle = encoders.filter(e => e.runtime_alive && e.idle_seconds !== null).length;

  return (
    <div className="space-y-4">
      {!ffmpegInstalled && (
        <div className="glass rounded-xl p-4 border border-destructive/40 bg-destructive/5 flex gap-3">
          <AlertCircle className="w-5 h-5 text-destructive shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-semibold text-destructive">FFmpeg no instalado</p>
            <p className="text-xs text-muted-foreground mt-1">
              Ejecuta <code className="bg-muted px-1.5 py-0.5 rounded">sudo bash server/install-vpn.sh</code> en el VPS para instalar FFmpeg y habilitar el encoder multicast.
            </p>
          </div>
        </div>
      )}

      {/* Header + stats */}
      <div className="glass rounded-xl p-4">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <Cpu className="w-5 h-5 text-primary" />
              <span className="font-semibold text-foreground">Encoders FFmpeg</span>
            </div>
            <Badge variant="outline" className="gap-1">
              <CheckCircle2 className="w-3 h-3 text-primary" /> {running} activos
            </Badge>
            {idle > 0 && (
              <Badge variant="outline" className="gap-1 text-muted-foreground">
                {idle} idle (auto-stop pronto)
              </Badge>
            )}
            <Badge variant="outline">{encoders.length} total</Badge>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={load}>
              <RefreshCw className="w-4 h-4 mr-1" /> Refrescar
            </Button>
            <Button size="sm" onClick={syncAll} disabled={loading}>
              <RefreshCw className="w-4 h-4 mr-1" /> Sincronizar con sectores
            </Button>
          </div>
        </div>
        <p className="text-xs text-muted-foreground mt-3">
          Los encoders convierten HTTP/HLS/TS unicast → UDP multicast en tiempo real. Se inician automáticamente cuando un sector recibe un canal y se detienen 60s después de quedar sin uso.
          Modo <strong>copy</strong> = sin transcoding (CPU mínima, requiere H.264+AAC). Modo <strong>transcode</strong> = recodifica a H.264+AAC (~15-25% CPU/canal).
        </p>
      </div>

      {/* Lista de encoders */}
      <div className="glass rounded-xl p-4">
        {encoders.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground">
            <Cpu className="w-12 h-12 mx-auto mb-3 opacity-30" />
            <p className="text-sm">No hay encoders activos.</p>
            <p className="text-xs mt-1">Asigna canales multicast a sectores en la pestaña "Canales Multicast" para que se inicien automáticamente.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {encoders.map(e => (
              <div key={e.id} className="flex items-center gap-3 p-3 rounded-lg border border-border/40 hover:bg-muted/30 transition">
                <div className={`w-2 h-2 rounded-full shrink-0 ${
                  e.runtime_alive && !e.idle_seconds ? 'bg-primary animate-pulse' :
                  e.runtime_alive && e.idle_seconds ? 'bg-yellow-500' :
                  e.status === 'error' ? 'bg-destructive' : 'bg-muted-foreground/30'
                }`} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium text-sm truncate text-foreground">{e.channel_name}</span>
                    <Badge variant="outline" className="text-[10px] py-0 px-1.5">{e.category}</Badge>
                    {e.multicast_ip && (
                      <code className="text-[10px] bg-muted px-1.5 py-0.5 rounded text-muted-foreground">
                        udp://{e.multicast_ip}:{e.port}
                      </code>
                    )}
                  </div>
                  <div className="flex items-center gap-3 mt-1 text-[11px] text-muted-foreground flex-wrap">
                    <span className={e.codec_mode === 'copy' ? 'text-primary' : 'text-yellow-600 dark:text-yellow-500'}>
                      {e.codec_mode === 'copy' ? '⚡ copy' : '🔄 transcode'}
                    </span>
                    {e.source_codec_video && <span>v: {e.source_codec_video}</span>}
                    {e.source_codec_audio && <span>a: {e.source_codec_audio}</span>}
                    {e.pid && <span>PID: {e.pid}</span>}
                    <span>Sectores: {e.sectors_using}</span>
                    {e.idle_seconds !== null && e.idle_seconds > 0 && (
                      <span className="text-yellow-600 dark:text-yellow-500">idle {e.idle_seconds}s</span>
                    )}
                    {e.last_error && (
                      <span className="text-destructive truncate max-w-[300px]" title={e.last_error}>{e.last_error}</span>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  {e.runtime_alive ? (
                    <Button size="sm" variant="outline" onClick={() => stopOne(e.channel_id)} disabled={loading}>
                      <Square className="w-3.5 h-3.5 mr-1" /> Stop
                    </Button>
                  ) : (
                    <Button size="sm" variant="outline" onClick={() => startOne(e.channel_id)} disabled={loading || !ffmpegInstalled}>
                      <Play className="w-3.5 h-3.5 mr-1" /> Start
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default VpnSectorsManager;
