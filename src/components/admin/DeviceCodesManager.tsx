import { useEffect, useState } from 'react';
import { apiGet, apiPost, apiPut, apiDelete } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';
import { copyToClipboard } from '@/lib/clipboard';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Plus, Trash2, RefreshCw, Copy, Ban, RotateCcw, Edit2, KeyRound, CheckCircle2, Clock, XCircle } from 'lucide-react';

interface DeviceCode {
  id: string;
  code: string;
  label: string | null;
  client_id: string | null;
  client_username: string | null;
  sector_id: string;
  sector_name: string | null;
  device_id: string | null;
  status: 'pending' | 'active' | 'revoked';
  expires_at: string;
  activated_at: string | null;
  last_seen_at: string | null;
  notes: string | null;
  created_at: string;
}

interface Sector { id: string; name: string }
interface Client { id: string; username: string }

const DeviceCodesManager = () => {
  const { toast } = useToast();
  const [codes, setCodes] = useState<DeviceCode[]>([]);
  const [sectors, setSectors] = useState<Sector[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'all' | 'pending' | 'active' | 'revoked'>('all');

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<DeviceCode | null>(null);
  const [form, setForm] = useState({
    sector_id: '',
    client_id: '',
    label: '',
    expires_at: '',
    notes: '',
  });

  const loadAll = async () => {
    setLoading(true);
    try {
      const [c, s, cl] = await Promise.all([
        apiGet<DeviceCode[]>('/api/device-codes'),
        apiGet<Sector[]>('/api/vpn/sectors'),
        apiGet<Client[]>('/api/clients'),
      ]);
      setCodes(c);
      setSectors(s);
      setClients(cl);
    } catch (err: any) {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadAll(); }, []);

  const openCreate = () => {
    setEditing(null);
    const oneMonth = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    setForm({
      sector_id: sectors[0]?.id || '',
      client_id: '',
      label: '',
      expires_at: oneMonth.toISOString().slice(0, 10),
      notes: '',
    });
    setDialogOpen(true);
  };

  const openEdit = (c: DeviceCode) => {
    setEditing(c);
    setForm({
      sector_id: c.sector_id,
      client_id: c.client_id || '',
      label: c.label || '',
      expires_at: c.expires_at ? c.expires_at.slice(0, 10) : '',
      notes: c.notes || '',
    });
    setDialogOpen(true);
  };

  const handleSave = async () => {
    if (!form.sector_id) {
      toast({ title: 'Falta sector', description: 'Seleccioná un sector', variant: 'destructive' });
      return;
    }
    try {
      const payload = {
        sector_id: form.sector_id,
        client_id: form.client_id || null,
        label: form.label || null,
        expires_at: form.expires_at ? new Date(form.expires_at).toISOString() : undefined,
        notes: form.notes || null,
      };
      if (editing) {
        await apiPut(`/api/device-codes/${editing.id}`, payload);
        toast({ title: 'Código actualizado' });
      } else {
        await apiPost('/api/device-codes', payload);
        toast({ title: 'Código creado', description: 'Listo para activar en la APK' });
      }
      setDialogOpen(false);
      loadAll();
    } catch (err: any) {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    }
  };

  const handleStatus = async (c: DeviceCode, status: 'active' | 'revoked' | 'pending') => {
    try {
      await apiPut(`/api/device-codes/${c.id}`, { status });
      toast({ title: status === 'revoked' ? 'Código revocado' : 'Estado actualizado' });
      loadAll();
    } catch (err: any) {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    }
  };

  const handleResetDevice = async (c: DeviceCode) => {
    if (!confirm(`Liberar dispositivo del código ${c.code}? Podrá reactivarse en otro equipo.`)) return;
    try {
      await apiPost(`/api/device-codes/${c.id}/reset-device`, {});
      toast({ title: 'Dispositivo liberado' });
      loadAll();
    } catch (err: any) {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    }
  };

  const handleDelete = async (c: DeviceCode) => {
    if (!confirm(`Eliminar definitivamente el código ${c.code}?`)) return;
    try {
      await apiDelete(`/api/device-codes/${c.id}`);
      toast({ title: 'Código eliminado' });
      loadAll();
    } catch (err: any) {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    }
  };

  const handleCopy = async (text: string) => {
    await copyToClipboard(text);
    toast({ title: 'Copiado', description: text });
  };

  const statusBadge = (s: DeviceCode['status'], expired: boolean) => {
    if (expired) return <Badge variant="destructive" className="gap-1"><XCircle className="w-3 h-3" />Expirado</Badge>;
    if (s === 'active') return <Badge className="bg-primary hover:bg-primary/90 text-primary-foreground gap-1"><CheckCircle2 className="w-3 h-3" />Activo</Badge>;
    if (s === 'revoked') return <Badge variant="destructive" className="gap-1"><Ban className="w-3 h-3" />Revocado</Badge>;
    return <Badge variant="secondary" className="gap-1"><Clock className="w-3 h-3" />Pendiente</Badge>;
  };

  const filtered = codes.filter(c => filter === 'all' || c.status === filter);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-2xl font-bold flex items-center gap-2">
            <KeyRound className="w-6 h-6 text-primary" /> Códigos APK
          </h2>
          <p className="text-sm text-muted-foreground">
            Cada código activa 1 dispositivo (1 pantalla) en un sector específico.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Select value={filter} onValueChange={(v: any) => setFilter(v)}>
            <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos</SelectItem>
              <SelectItem value="pending">Pendientes</SelectItem>
              <SelectItem value="active">Activos</SelectItem>
              <SelectItem value="revoked">Revocados</SelectItem>
            </SelectContent>
          </Select>
          <Button variant="outline" size="icon" onClick={loadAll}><RefreshCw className="w-4 h-4" /></Button>
          <Button onClick={openCreate} className="gap-2"><Plus className="w-4 h-4" /> Nuevo código</Button>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <div className="animate-spin w-8 h-8 border-2 border-primary border-t-transparent rounded-full" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="glass rounded-xl p-12 text-center text-muted-foreground">
          No hay códigos. Creá uno con el botón de arriba.
        </div>
      ) : (
        <div className="grid gap-3">
          {filtered.map((c) => {
            const expired = new Date(c.expires_at) < new Date();
            return (
              <div key={c.id} className="glass rounded-xl p-4 flex items-center gap-4 flex-wrap">
                <div className="flex-1 min-w-[260px]">
                  <div className="flex items-center gap-2 mb-1">
                    <button
                      onClick={() => handleCopy(c.code)}
                      className="font-mono text-lg font-bold tracking-wider text-primary hover:underline flex items-center gap-2"
                    >
                      {c.code} <Copy className="w-3.5 h-3.5 opacity-60" />
                    </button>
                    {statusBadge(c.status, expired)}
                  </div>
                  <div className="text-sm text-muted-foreground space-x-3">
                    {c.label && <span>📺 {c.label}</span>}
                    {c.sector_name && <span>📡 {c.sector_name}</span>}
                    {c.client_username && <span>👤 {c.client_username}</span>}
                  </div>
                  <div className="text-xs text-muted-foreground mt-1 space-x-3">
                    <span>Vence: {new Date(c.expires_at).toLocaleDateString()}</span>
                    {c.device_id && <span>Device: <code className="text-[10px]">{c.device_id.slice(0, 16)}…</code></span>}
                    {c.activated_at && <span>Activado: {new Date(c.activated_at).toLocaleDateString()}</span>}
                  </div>
                </div>
                <div className="flex items-center gap-1 flex-wrap">
                  <Button variant="outline" size="sm" onClick={() => openEdit(c)} className="gap-1">
                    <Edit2 className="w-3.5 h-3.5" /> Editar
                  </Button>
                  {c.device_id && (
                    <Button variant="outline" size="sm" onClick={() => handleResetDevice(c)} className="gap-1">
                      <RotateCcw className="w-3.5 h-3.5" /> Reset device
                    </Button>
                  )}
                  {c.status !== 'revoked' ? (
                    <Button variant="outline" size="sm" onClick={() => handleStatus(c, 'revoked')} className="gap-1 text-destructive">
                      <Ban className="w-3.5 h-3.5" /> Revocar
                    </Button>
                  ) : (
                    <Button variant="outline" size="sm" onClick={() => handleStatus(c, 'pending')} className="gap-1">
                      <CheckCircle2 className="w-3.5 h-3.5" /> Reactivar
                    </Button>
                  )}
                  <Button variant="outline" size="icon" onClick={() => handleDelete(c)} className="text-destructive">
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{editing ? `Editar código ${editing.code}` : 'Nuevo código de activación'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>Sector (define los canales UDP) *</Label>
              <Select value={form.sector_id} onValueChange={(v) => setForm({ ...form, sector_id: v })}>
                <SelectTrigger><SelectValue placeholder="Seleccionar sector" /></SelectTrigger>
                <SelectContent>
                  {sectors.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Cliente (opcional, para agrupar pantallas)</Label>
              <Select value={form.client_id || 'none'} onValueChange={(v) => setForm({ ...form, client_id: v === 'none' ? '' : v })}>
                <SelectTrigger><SelectValue placeholder="Sin cliente" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Sin cliente</SelectItem>
                  {clients.map((c) => <SelectItem key={c.id} value={c.id}>{c.username}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Etiqueta (ej: "TV Living")</Label>
              <Input value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} placeholder="TV Living" />
            </div>
            <div>
              <Label>Vence el</Label>
              <Input type="date" value={form.expires_at} onChange={(e) => setForm({ ...form, expires_at: e.target.value })} />
            </div>
            <div>
              <Label>Notas</Label>
              <Input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancelar</Button>
            <Button onClick={handleSave}>{editing ? 'Guardar' : 'Crear código'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default DeviceCodesManager;
