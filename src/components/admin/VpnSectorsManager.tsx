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
import { Plus, Download, RefreshCw, Trash2, Edit, Network, Radio, Activity, Server, Key, Copy, CheckCircle2, XCircle, Cpu, Play, Square, AlertCircle, Wifi, Home } from 'lucide-react';

// ============================================================
// Tipos
// ============================================================
type DeliveryMode = 'multicast_direct' | 'udpxy_rbldf' | 'udpxy_central' | 'lan_direct';

interface Sector {
  id: string;
  name: string;
  description: string | null;
  vpn_username: string;
  vpn_password: string;
  assigned_ip: string;
  mikrotik_public_ip: string | null;
  ipsec_psk: string | null;
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
interface SectorPreviewChannel {
  multicast_group_id: string;
  multicast_ip: string;
  port: number;
  channel_name: string | null;
}

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
  const [multicastEnabled, setMulticastEnabled] = useState(true);
  const [loadingSetting, setLoadingSetting] = useState(false);

  useEffect(() => {
    apiGet<{ multicast_enabled: boolean }>('/api/vpn/settings')
      .then(r => setMulticastEnabled(r.multicast_enabled))
      .catch(() => { /* silencioso si backend viejo */ });
  }, []);

  const toggleMulticast = async (next: boolean) => {
    setLoadingSetting(true);
    try {
      await apiPut('/api/vpn/settings', { multicast_enabled: next });
      setMulticastEnabled(next);
      toast({
        title: next ? '✅ Multicast activado' : '⏸️ Multicast desactivado',
        description: next
          ? 'Los clientes en sectores VPN recibirán URLs udp://@... o http://udpxy/...'
          : 'Todos los clientes volverán a usar HLS via /api/restream (modo seguro).',
      });
    } catch (e: any) {
      toast({ title: 'Error', description: e.message, variant: 'destructive' });
    } finally {
      setLoadingSetting(false);
    }
  };

  return (
    <div className="space-y-6">
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="glass rounded-xl p-6">
        <div className="flex items-center justify-between gap-3 mb-2 flex-wrap">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-xl bg-primary/15 flex items-center justify-center">
              <Network className="w-6 h-6 text-primary" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-foreground">VPN Sectores · Multicast</h2>
              <p className="text-xs text-muted-foreground">L2TP/IPsec + multicast UDP validado hacia MikroTik remotos</p>
            </div>
          </div>
          <div className="flex items-center gap-3 px-4 py-2 rounded-lg glass-strong border border-border/30">
            <div className="text-right">
              <div className="text-xs font-semibold text-foreground">Entrega Multicast/UDP</div>
              <div className="text-[10px] text-muted-foreground">
                {multicastEnabled ? 'Activo · sectores reciben udp://...' : 'Desactivado · todo va por HLS'}
              </div>
            </div>
            <Switch
              checked={multicastEnabled}
              onCheckedChange={toggleMulticast}
              disabled={loadingSetting}
            />
          </div>
        </div>
      </motion.div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="glass-strong border border-border/30 p-1 flex-wrap h-auto">
          <TabsTrigger value="sectors" className="gap-2"><Server className="w-4 h-4" /> Sectores VPN</TabsTrigger>
          <TabsTrigger value="lan" className="gap-2"><Home className="w-4 h-4" /> LAN Local</TabsTrigger>
          <TabsTrigger value="multicast" className="gap-2"><Radio className="w-4 h-4" /> Canales Multicast</TabsTrigger>
          <TabsTrigger value="encoders" className="gap-2"><Cpu className="w-4 h-4" /> Encoders FFmpeg</TabsTrigger>
          <TabsTrigger value="monitor" className="gap-2"><Activity className="w-4 h-4" /> Monitor</TabsTrigger>
        </TabsList>

        <TabsContent value="sectors" className="mt-4"><SectorsSection mode="vpn" /></TabsContent>
        <TabsContent value="lan" className="mt-4"><SectorsSection mode="lan" /></TabsContent>
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
// ============================================================
// LanNetworkConfig: selector de interfaz/IP para multicast LAN local
// ============================================================
interface NetIfaceAddr { address: string; netmask: string; mac: string }
interface NetIface { name: string; addresses: NetIfaceAddr[] }

const LanNetworkConfig = () => {
  const { toast } = useToast();
  const [ifaces, setIfaces] = useState<NetIface[]>([]);
  const [iface, setIface] = useState<string>('');
  const [localIp, setLocalIp] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [ifResp, cfgResp] = await Promise.all([
        apiGet<{ interfaces: NetIface[] }>('/api/vpn/network-interfaces'),
        apiGet<{ iface: string; local_ip: string }>('/api/vpn/lan-config'),
      ]);
      setIfaces(ifResp.interfaces || []);
      setIface(cfgResp.iface || '');
      setLocalIp(cfgResp.local_ip || '');
    } catch (e: any) {
      toast({ title: 'Error', description: e.message, variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => { load(); }, [load]);

  const onSelectIface = (name: string) => {
    setIface(name);
    const found = ifaces.find(i => i.name === name);
    if (found && found.addresses.length > 0) {
      setLocalIp(found.addresses[0].address);
    }
  };

  const save = async () => {
    if (!iface || !localIp) {
      toast({ title: 'Faltan datos', description: 'Selecciona interfaz e IP.', variant: 'destructive' });
      return;
    }
    setSaving(true);
    try {
      await apiPut('/api/vpn/lan-config', { iface, local_ip: localIp });
      toast({
        title: 'Configuración guardada',
        description: 'Reinicia los encoders activos para aplicar la nueva interfaz.',
      });
    } catch (e: any) {
      toast({ title: 'Error', description: e.message, variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  const selectedIface = ifaces.find(i => i.name === iface);

  return (
    <div className="rounded-lg border border-border bg-card p-4 space-y-3">
      <div className="flex items-center gap-2">
        <Network className="w-4 h-4 text-primary" />
        <h3 className="text-sm font-semibold">Interfaz de red para multicast LAN</h3>
        <Button variant="ghost" size="icon" onClick={load} disabled={loading}>
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        Elige por qué interfaz del VPS debe salir el tráfico UDP multicast (FFmpeg <code>localaddr</code> + ruta 224.0.0.0/4).
        Solo aplica a sectores LAN local. Por defecto usa el túnel L2TP (<code>ppp0 / 172.16.50.1</code>).
      </p>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div>
          <Label className="text-xs">Interfaz</Label>
          <Select value={iface} onValueChange={onSelectIface}>
            <SelectTrigger><SelectValue placeholder="Selecciona interfaz" /></SelectTrigger>
            <SelectContent>
              {ifaces.map(i => (
                <SelectItem key={i.name} value={i.name}>
                  {i.name} ({i.addresses[0]?.address || 'sin IPv4'})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div>
          <Label className="text-xs">IP local (localaddr)</Label>
          {selectedIface && selectedIface.addresses.length > 1 ? (
            <Select value={localIp} onValueChange={setLocalIp}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {selectedIface.addresses.map(a => (
                  <SelectItem key={a.address} value={a.address}>{a.address}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <Input value={localIp} onChange={e => setLocalIp(e.target.value)} placeholder="192.168.1.50" />
          )}
        </div>

        <div className="flex items-end">
          <Button onClick={save} disabled={saving} className="gradient-primary w-full">
            {saving ? 'Guardando...' : 'Guardar configuración'}
          </Button>
        </div>
      </div>

      {ifaces.length === 0 && !loading && (
        <p className="text-xs text-destructive">
          No se detectaron interfaces. Verifica el backend del VPS.
        </p>
      )}
    </div>
  );
};


interface SectorsSectionProps { mode?: 'vpn' | 'lan' }
const SectorsSection = ({ mode = 'vpn' }: SectorsSectionProps) => {
  const isLanTab = mode === 'lan';
  const { toast } = useToast();
  const [sectors, setSectors] = useState<Sector[]>([]);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [centralPsk, setCentralPsk] = useState<string>('');
  const [loadWarning, setLoadWarning] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Sector | null>(null);
  const [useIpsec, setUseIpsec] = useState(true);
  const [lanPreviewSectorId, setLanPreviewSectorId] = useState<string | null>(null);
  const [lanPreviewUrls, setLanPreviewUrls] = useState<Record<string, SectorPreviewChannel[]>>({});
  const [loadingPreviewId, setLoadingPreviewId] = useState<string | null>(null);
  const [form, setForm] = useState({
    name: '', description: '', vpn_username: '', vpn_password: '',
    assigned_ip: '', mikrotik_public_ip: '', ipsec_psk: '', plan_id: '',
    delivery_mode: (isLanTab ? 'lan_direct' : 'multicast_direct') as DeliveryMode,
    udpxy_url: '',
  });

  const load = useCallback(async () => {
    const [sectorsResult, plansResult, statusResult] = await Promise.allSettled([
      apiGet<Sector[]>('/api/vpn/sectors'),
      apiGet<Plan[]>('/api/plans'),
      apiGet<VpnStatus>('/api/vpn/status'),
    ]);

    if (statusResult.status === 'fulfilled' && statusResult.value?.psk) {
      setCentralPsk(statusResult.value.psk);
    }

    let warning: string | null = null;

    if (sectorsResult.status === 'fulfilled') {
      setSectors(sectorsResult.value);
    } else {
      setSectors([]);
      warning = 'No se pudieron cargar los sectores desde el backend local.';
    }

    if (plansResult.status === 'fulfilled') {
      setPlans(plansResult.value);
    } else {
      setPlans([]);
      warning = warning
        ? `${warning} Los planes no están disponibles y se seguirá sin filtros por plan.`
        : 'Los planes no están disponibles y se seguirá sin filtros por plan.';
    }

    if (warning && !getAdminToken()) {
      warning += ' Cierra sesión y vuelve a entrar con las credenciales del panel del VPS para regenerar el token local.';
    }

    setLoadWarning(warning);

    if (sectorsResult.status === 'rejected' && plansResult.status === 'rejected') {
      toast({
        title: 'Error',
        description: !getAdminToken()
          ? 'Falta el token local del VPS o ya no es válido. Vuelve a iniciar sesión en el panel.'
          : 'No se pudo cargar el módulo VPN desde el backend local.',
        variant: 'destructive',
      });
    }
  }, [toast]);

  useEffect(() => { load(); }, [load]);

  // Filtra los sectores según la pestaña activa (VPN vs LAN local)
  const visibleSectors = sectors.filter(s =>
    isLanTab ? s.delivery_mode === 'lan_direct' : s.delivery_mode !== 'lan_direct'
  );

  const openCreate = () => {
    setEditing(null);
    const used = new Set(sectors.map(s => s.assigned_ip));
    let suggested = '';
    for (let i = 10; i <= 250; i++) {
      const ip = `172.16.50.${i}`;
      if (!used.has(ip)) { suggested = ip; break; }
    }
    setUseIpsec(!isLanTab);
    setForm({
      name: '',
      description: '',
      vpn_username: '',
      vpn_password: '',
      assigned_ip: isLanTab ? '' : suggested,
      mikrotik_public_ip: '',
      ipsec_psk: isLanTab ? '' : centralPsk,
      plan_id: '',
      delivery_mode: isLanTab ? 'lan_direct' : 'multicast_direct',
      udpxy_url: '',
    });
    setOpen(true);
  };

  const openEdit = (s: Sector) => {
    setEditing(s);
    setUseIpsec(!!s.ipsec_psk);
    setForm({
      name: s.name, description: s.description || '',
      vpn_username: s.vpn_username, vpn_password: s.vpn_password,
      assigned_ip: s.assigned_ip,
      mikrotik_public_ip: s.mikrotik_public_ip || '',
      ipsec_psk: s.ipsec_psk || centralPsk,
      plan_id: s.plan_id || '',
      delivery_mode: s.delivery_mode || 'multicast_direct',
      udpxy_url: s.udpxy_url || '',
    });
    setOpen(true);
  };

  const save = async () => {
    try {
      const payload = {
        ...form,
        ipsec_psk: useIpsec ? (form.ipsec_psk || centralPsk || '') : '',
        plan_id: form.plan_id || null,
        gre_local_ip: null,
        gre_remote_ip: null,
      };
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

  const copyToClipboard = async (value: string, message = 'Copiado al portapapeles') => {
    try {
      await navigator.clipboard.writeText(value);
      toast({ title: message });
    } catch {
      toast({ title: 'Error', description: 'No se pudo copiar el texto', variant: 'destructive' });
    }
  };

  const toggleLanPreview = async (sectorId: string) => {
    if (lanPreviewSectorId === sectorId) {
      setLanPreviewSectorId(null);
      return;
    }

    setLanPreviewSectorId(sectorId);
    if (lanPreviewUrls[sectorId]) return;

    setLoadingPreviewId(sectorId);
    try {
      const rows = await apiGet<SectorPreviewChannel[]>(`/api/vpn/sectors/${sectorId}/channels`);
      setLanPreviewUrls(prev => ({
        ...prev,
        [sectorId]: rows.filter(row => !!row.multicast_ip),
      }));
    } catch (e: any) {
      toast({
        title: 'Error',
        description: e.message || 'No se pudieron cargar las URLs UDP de prueba.',
        variant: 'destructive',
      });
      setLanPreviewSectorId(null);
    } finally {
      setLoadingPreviewId(null);
    }
  };

  return (
    <div className="space-y-4">
      {isLanTab && <LanNetworkConfig />}
      <div className="flex justify-between items-center">
        <p className="text-sm text-muted-foreground">{visibleSectors.length} sector(es) {isLanTab ? "LAN local" : "VPN"} configurados</p>
        <div className="flex gap-2">
          <Button variant="ghost" size="icon" onClick={load}><RefreshCw className="w-4 h-4" /></Button>
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button onClick={openCreate} className="gradient-primary gap-2">
                <Plus className="w-4 h-4" /> {isLanTab ? 'Nuevo sector LAN' : 'Nuevo Sector VPN'}
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-2xl">
              <DialogHeader>
                <DialogTitle>{editing ? 'Editar Sector' : (isLanTab ? 'Nuevo sector LAN local' : 'Nuevo Sector VPN')}</DialogTitle>
              </DialogHeader>
              <div className="grid grid-cols-2 gap-4">
                <div className="col-span-2">
                  <Label>Nombre del sector</Label>
                  <Input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="Sector Norte" />
                </div>
                {form.delivery_mode !== 'lan_direct' && (<>
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
                </>)}
                <div>
                  <Label>Plan asociado</Label>
                  <Select value={form.plan_id || undefined} onValueChange={v => setForm({ ...form, plan_id: v })}>
                    <SelectTrigger><SelectValue placeholder="Sin plan" /></SelectTrigger>
                    <SelectContent>
                      {plans.map(p => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="col-span-2">
                  <Label>Modo de entrega de video</Label>
                  <Select value={form.delivery_mode} onValueChange={v => setForm({ ...form, delivery_mode: v as DeliveryMode })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="multicast_direct">📡 Multicast directo al TV Box (vía VPN · ahorra aire WISP)</SelectItem>
                      <SelectItem value="udpxy_rbldf">🏠 udpxy en RB LDF del cliente (HTTP local)</SelectItem>
                      <SelectItem value="udpxy_central">🗼 udpxy en MikroTik central (HTTP por aire)</SelectItem>
                      <SelectItem value="lan_direct">🏡 LAN local (sin VPN · APK en la misma red del MikroTik)</SelectItem>
                    </SelectContent>
                  </Select>
                  <p className="text-[11px] text-muted-foreground mt-1">
                    {form.delivery_mode === 'multicast_direct' && 'APK reproducirá udp://@239.x.x.x:1234. Requiere router cliente en bridge + IGMP en RB LDF.'}
                    {form.delivery_mode === 'udpxy_rbldf' && 'APK pedirá http://{udpxy_url}/udp/239.x.x.x:1234 al RB LDF. Requiere container en RB LDF.'}
                    {form.delivery_mode === 'udpxy_central' && 'APK pedirá HTTP al MikroTik central. Saturará aire WISP con N streams por cliente.'}
                    {form.delivery_mode === 'lan_direct' && 'Sin VPN. La APK consume udp://@239.x.x.x:1234 directamente desde el gateway MikroTik en LAN. Requiere IGMP snooping en el bridge.'}
                  </p>
                </div>
                {form.delivery_mode === 'lan_direct' && (
                  <div className="col-span-2 rounded-lg border border-primary/30 bg-primary/5 p-3 space-y-2">
                    <p className="text-xs text-foreground font-semibold">🏡 Sector LAN local</p>
                    <p className="text-[11px] text-muted-foreground leading-relaxed">
                      Este sector NO usa VPN. La APK o VLC deben estar dentro del rango IP local del sector para recibir los UDP. Luego asigna los canales desde <strong>Canales Multicast</strong>.
                    </p>
                    <div>
                      <Label>Rango IP local / CIDR</Label>
                      <Input
                        value={form.assigned_ip}
                        onChange={e => setForm({ ...form, assigned_ip: e.target.value })}
                        placeholder="192.168.1.0/24"
                      />
                      <p className="text-[11px] text-muted-foreground mt-1">
                        Usa un rango CIDR para que el backend detecte qué clientes pertenecen a este sector LAN.
                      </p>
                    </div>
                  </div>
                )}
                {form.delivery_mode !== 'multicast_direct' && form.delivery_mode !== 'lan_direct' && (
                  <div className="col-span-2">
                    <Label>URL base udpxy</Label>
                    <Input
                      value={form.udpxy_url}
                      onChange={e => setForm({ ...form, udpxy_url: e.target.value })}
                      placeholder={form.delivery_mode === 'udpxy_rbldf' ? 'http://192.168.1.1:4022' : 'http://10.99.99.2:4022'}
                    />
                  </div>
                )}
                {form.delivery_mode !== 'lan_direct' && (<>
                <div className="col-span-2">
                  <Label>IP pública del MikroTik (opcional)</Label>
                  <Input
                    value={form.mikrotik_public_ip}
                    onChange={e => setForm({ ...form, mikrotik_public_ip: e.target.value })}
                    placeholder="190.0.0.123 — útil para ATAR la PSK al peer en el VPS"
                  />
                  <p className="text-[11px] text-muted-foreground mt-1">
                    Si lo dejas vacío, el VPS aceptará IPSec desde cualquier IP usando la PSK central.
                  </p>
                </div>

                <div className="col-span-2 rounded-lg border border-border/40 p-3 space-y-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <Label className="text-sm font-semibold">🔐 IPSec (cifrado L2TP)</Label>
                      <p className="text-[11px] text-muted-foreground mt-0.5">
                        Recomendado. El MikroTik debe activar <code>use-ipsec=yes</code> con esta PSK.
                      </p>
                    </div>
                    <Switch checked={useIpsec} onCheckedChange={setUseIpsec} />
                  </div>
                  {useIpsec && (
                    <div>
                      <Label className="text-xs">Pre-Shared Key (PSK)</Label>
                      <div className="flex gap-2">
                        <Input
                          value={form.ipsec_psk}
                          onChange={e => setForm({ ...form, ipsec_psk: e.target.value })}
                          placeholder={centralPsk || 'Cargando PSK central...'}
                          className="font-mono text-xs"
                        />
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => setForm({ ...form, ipsec_psk: centralPsk })}
                          disabled={!centralPsk}
                          title="Usar PSK central del VPS"
                        >
                          <Key className="w-3 h-3" />
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            navigator.clipboard.writeText(form.ipsec_psk);
                            toast({ title: 'PSK copiada' });
                          }}
                          disabled={!form.ipsec_psk}
                        >
                          <Copy className="w-3 h-3" />
                        </Button>
                      </div>
                      <p className="text-[11px] text-muted-foreground mt-1">
                        Por defecto se usa la PSK central del VPS. Cambia solo si necesitas una PSK específica para este sector.
                      </p>
                    </div>
                  )}
                </div>
                </>)}

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
        {loadWarning && (
          <div className="glass rounded-lg border border-border/40 p-3 text-xs text-muted-foreground">
            {loadWarning}
          </div>
        )}
        {visibleSectors.map(s => {
          const previewRows = lanPreviewUrls[s.id] || [];
          const previewOpen = lanPreviewSectorId === s.id;

          return (
            <motion.div key={s.id} initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="glass rounded-lg p-4 space-y-3">
              <div className="flex items-start gap-4">
                <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                  <Server className="w-5 h-5 text-primary" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1 flex-wrap">
                    <span className="font-semibold text-foreground truncate">{s.name}</span>
                    <Badge variant={s.is_active ? 'default' : 'secondary'} className="text-[10px]">
                      {s.is_active ? 'Activo' : 'Inactivo'}
                    </Badge>
                    {s.tunnel_status === 'connected' && (
                      <Badge variant="outline" className="text-emerald-400 border-emerald-400/30 text-[10px]">Conectado</Badge>
                    )}
                    {s.plan_name && <Badge variant="outline" className="text-[10px]">{s.plan_name}</Badge>}
                    <Badge variant="outline" className="text-[10px] border-primary/30 text-primary">
                      {s.delivery_mode === 'multicast_direct' && '📡 Multicast directo'}
                      {s.delivery_mode === 'udpxy_rbldf' && '🏠 udpxy RB LDF'}
                      {s.delivery_mode === 'udpxy_central' && '🗼 udpxy central'}
                      {s.delivery_mode === 'lan_direct' && '🏡 LAN local (sin VPN)'}
                    </Badge>
                    {s.ipsec_psk ? (
                      <Badge variant="outline" className="text-[10px] border-emerald-400/30 text-emerald-400">🔐 IPSec</Badge>
                    ) : (
                      <Badge variant="outline" className="text-[10px] border-amber-400/30 text-amber-400">🔓 Sin IPSec</Badge>
                    )}
                  </div>
                  <div className="text-xs text-muted-foreground flex flex-wrap gap-x-4 gap-y-1">
                    <span>👤 {s.vpn_username}</span>
                    <span>🌐 {s.assigned_ip}</span>
                    <span>📺 {s.channels_count} canales</span>
                  </div>
                </div>
                <div className="flex items-center gap-1 shrink-0 flex-wrap justify-end">
                  <Switch checked={s.is_active} onCheckedChange={() => toggle(s)} />
                  {isLanTab && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="gap-2"
                      onClick={() => toggleLanPreview(s.id)}
                      disabled={!s.is_active || loadingPreviewId === s.id}
                      title={s.is_active ? 'Ver URLs UDP para probar en VLC' : 'Activa el sector LAN para ver las URLs UDP'}
                    >
                      <Wifi className="w-4 h-4" />
                      {loadingPreviewId === s.id ? 'Cargando...' : previewOpen ? 'Ocultar UDP' : 'Ver UDP'}
                    </Button>
                  )}
                  {!isLanTab && (
                    <Button variant="ghost" size="icon" onClick={() => downloadConfig(s)} title="Descargar config MikroTik (.rsc)">
                      <Download className="w-4 h-4" />
                    </Button>
                  )}
                  <Button variant="ghost" size="icon" onClick={() => openEdit(s)}><Edit className="w-4 h-4" /></Button>
                  <Button variant="ghost" size="icon" onClick={() => remove(s.id)} className="text-destructive">
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </div>
              </div>

              {isLanTab && previewOpen && s.is_active && (
                <div className="rounded-lg border border-border/40 bg-background/60 p-3 space-y-3">
                  <div className="flex items-center justify-between gap-3 flex-wrap">
                    <div>
                      <p className="text-sm font-semibold text-foreground">Prueba UDP en VLC</p>
                      <p className="text-[11px] text-muted-foreground">
                        Estas son las URLs multicast del sector LAN. Si VLC no abre ninguna, ya puedes descartar que el problema sea solo del panel.
                      </p>
                    </div>
                    {previewRows.length > 0 && (
                      <Button
                        variant="outline"
                        size="sm"
                        className="gap-2"
                        onClick={() => copyToClipboard(previewRows.map(row => `udp://@${row.multicast_ip}:${row.port}`).join('\n'), 'Lista UDP copiada')}
                      >
                        <Copy className="w-4 h-4" /> Copiar lista
                      </Button>
                    )}
                  </div>

                  {previewRows.length > 0 ? (
                    <div className="space-y-2">
                      {previewRows.map((row) => {
                        const udpUrl = `udp://@${row.multicast_ip}:${row.port}`;
                        return (
                          <div key={`${s.id}-${row.multicast_group_id}`} className="flex items-center gap-2 rounded-lg border border-border/30 px-3 py-2 flex-wrap">
                            <div className="min-w-0 flex-1">
                              <div className="text-xs font-medium text-foreground truncate">{row.channel_name || 'Canal sin nombre'}</div>
                              <code className="text-[11px] text-primary break-all">{udpUrl}</code>
                            </div>
                            <Button variant="outline" size="sm" className="gap-2" onClick={() => copyToClipboard(udpUrl, 'URL UDP copiada')}>
                              <Copy className="w-4 h-4" /> Copiar
                            </Button>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="rounded-lg border border-dashed border-border/40 px-3 py-4 text-xs text-muted-foreground">
                      Este sector no tiene canales multicast asignados todavía. Ve a <strong>Canales Multicast</strong> y asígnale canales al sector para ver sus URLs UDP aquí.
                    </div>
                  )}
                </div>
              )}
            </motion.div>
          );
        })}
        {visibleSectors.length === 0 && (
          <div className="text-center py-12 text-muted-foreground text-sm">
            {isLanTab
              ? "No hay sectores LAN locales. Crea uno para distribuir canales UDP en tu red local sin VPN."
              : "No hay sectores VPN configurados. Crea uno para distribuir canales por VPN."}
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
  const [loadWarning, setLoadWarning] = useState<string | null>(null);
  const [selectedSector, setSelectedSector] = useState<string>('');
  const [sectorChannels, setSectorChannels] = useState<Set<string>>(new Set());

  const loadChannels = useCallback(async (): Promise<{ data: Channel[]; source: 'admin' | 'public' }> => {
    try {
      const data = await apiGet<Channel[]>('/api/channels');
      return { data, source: 'admin' };
    } catch {
      const data = await apiGet<Channel[]>('/api/channels/public');
      return { data, source: 'public' };
    }
  }, []);

  const load = useCallback(async () => {
    const [groupsResult, channelsResult, sectorsResult, plansResult] = await Promise.allSettled([
      apiGet<MulticastGroup[]>('/api/vpn/multicast'),
      loadChannels(),
      apiGet<Sector[]>('/api/vpn/sectors'),
      apiGet<Plan[]>('/api/plans'),
    ]);

    let warning: string | null = null;

    if (groupsResult.status === 'fulfilled') setGroups(groupsResult.value);
    else {
      setGroups([]);
      warning = 'No se pudo cargar el pool multicast.';
    }

    if (channelsResult.status === 'fulfilled') {
      setChannels(channelsResult.value.data);
      if (channelsResult.value.source === 'public') {
        warning = warning
          ? `${warning} Los canales se cargaron en modo público; si faltan canales inactivos vuelve a iniciar sesión.`
          : 'Los canales se cargaron en modo público; si faltan canales inactivos vuelve a iniciar sesión.';
      }
    } else {
      setChannels([]);
      warning = warning
        ? `${warning} No fue posible obtener la lista de canales.`
        : 'No fue posible obtener la lista de canales.';
    }

    if (sectorsResult.status === 'fulfilled') setSectors(sectorsResult.value);
    else {
      setSectors([]);
      warning = warning
        ? `${warning} Tampoco se pudieron cargar los sectores.`
        : 'No se pudieron cargar los sectores.';
    }

    if (plansResult.status === 'fulfilled') setPlans(plansResult.value);
    else {
      setPlans([]);
      warning = warning
        ? `${warning} Los planes no están disponibles y no se aplicarán filtros por plan.`
        : 'Los planes no están disponibles y no se aplicarán filtros por plan.';
    }

    if (warning && !getAdminToken()) {
      warning += ' Cierra sesión y vuelve a entrar con las credenciales del panel del VPS.';
    }

    setLoadWarning(warning);

    if (groupsResult.status === 'rejected' && sectorsResult.status === 'rejected') {
      toast({
        title: 'Error',
        description: !getAdminToken()
          ? 'El backend local no aceptó el token actual. Vuelve a iniciar sesión.'
          : 'No se pudo cargar la configuración multicast desde el backend local.',
        variant: 'destructive',
      });
    }
  }, [loadChannels, toast]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!selectedSector) { setSectorChannels(new Set()); return; }
    apiGet(`/api/vpn/sectors/${selectedSector}/channels`)
      .then(rows => {
        setSectorChannels(new Set(rows.map((r: any) => r.multicast_group_id)));
      })
      .catch(() => {
        setSectorChannels(new Set());
        setLoadWarning(prev => prev || 'No se pudo cargar el mapeo actual del sector seleccionado.');
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
      {loadWarning && (
        <div className="lg:col-span-2 glass rounded-lg border border-border/40 p-3 text-xs text-muted-foreground">
          {loadWarning}
        </div>
      )}
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
      toast({ title: 'Sistema resincronizado', description: 'Configuración VPN y rutas multicast actualizadas' });
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
  mode: 'always_on' | 'on_demand';
  idle_timeout_seconds: number;
  last_viewer_at: string | null;
  current_viewers: number;
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

  const setMode = async (channelId: string, mode: 'always_on' | 'on_demand', idleSec?: number) => {
    setLoading(true);
    try {
      await apiPut(`/api/vpn/encoders/${channelId}/config`, {
        mode,
        ...(idleSec !== undefined ? { idle_timeout_seconds: idleSec } : {}),
      });
      toast({ title: 'Configuración guardada', description: mode === 'on_demand' ? 'Bajo demanda activado' : 'Siempre activo' });
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
  const onDemandCount = encoders.filter(e => e.mode === 'on_demand').length;

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
          <div className="flex items-center gap-4 flex-wrap">
            <div className="flex items-center gap-2">
              <Cpu className="w-5 h-5 text-primary" />
              <span className="font-semibold text-foreground">Encoders FFmpeg</span>
            </div>
            <Badge variant="outline" className="gap-1">
              <CheckCircle2 className="w-3 h-3 text-primary" /> {running} activos
            </Badge>
            {idle > 0 && (
              <Badge variant="outline" className="gap-1 text-muted-foreground">
                {idle} idle
              </Badge>
            )}
            {onDemandCount > 0 && (
              <Badge variant="outline" className="gap-1 text-primary">
                {onDemandCount} bajo demanda
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
          Los encoders convierten HTTP/HLS/TS unicast → UDP multicast en tiempo real.
          <strong> Siempre activo</strong> = corre mientras haya sectores asignados (latencia 0 al cambiar canal).
          <strong> Bajo demanda</strong> = arranca solo cuando un cliente está mirando, se apaga tras X minutos sin viewers (ahorra CPU).
          Modo <strong>copy</strong> = sin transcoding (CPU mínima). Modo <strong>transcode</strong> = recodifica a H.264+AAC (~15-25% CPU/canal).
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
                    <span className={e.current_viewers > 0 ? 'text-primary font-medium' : ''}>
                      👁 {e.current_viewers || 0} viewers
                    </span>
                    {e.idle_seconds !== null && e.idle_seconds > 0 && (
                      <span className="text-yellow-600 dark:text-yellow-500">idle {e.idle_seconds}s</span>
                    )}
                    {e.last_error && (
                      <span className="text-destructive truncate max-w-[300px]" title={e.last_error}>{e.last_error}</span>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {/* Toggle on-demand */}
                  <div className="flex items-center gap-1.5 px-2 py-1 rounded border border-border/40">
                    <Switch
                      checked={e.mode === 'on_demand'}
                      onCheckedChange={(v) => setMode(e.channel_id, v ? 'on_demand' : 'always_on')}
                      disabled={loading}
                    />
                    <span className="text-[10px] text-muted-foreground whitespace-nowrap">
                      {e.mode === 'on_demand' ? 'Bajo demanda' : 'Siempre activo'}
                    </span>
                  </div>
                  {/* Selector de timeout solo si on_demand */}
                  {e.mode === 'on_demand' && (
                    <Select
                      value={String(e.idle_timeout_seconds || 300)}
                      onValueChange={(v) => setMode(e.channel_id, 'on_demand', parseInt(v, 10))}
                    >
                      <SelectTrigger className="h-8 w-[110px] text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="60">1 min</SelectItem>
                        <SelectItem value="180">3 min</SelectItem>
                        <SelectItem value="300">5 min</SelectItem>
                        <SelectItem value="600">10 min</SelectItem>
                        <SelectItem value="1800">30 min</SelectItem>
                      </SelectContent>
                    </Select>
                  )}
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
