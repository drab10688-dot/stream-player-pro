import { useState, useEffect } from 'react';
import { apiGet } from '@/lib/api';
import { supabase } from '@/integrations/supabase/client';
import { isLovablePreview } from '@/lib/utils';
import { useToast } from '@/hooks/use-toast';
import { Users, UserCheck, UserX, Clock, Tv, Store, Megaphone, Wifi, AlertTriangle, Link, Copy, Check } from 'lucide-react';
import { motion } from 'framer-motion';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts';
import { format } from 'date-fns';

interface Stats {
  clients: { total: number; active: number; expired: number; suspended: number; expiring_soon: number };
  resellers: { total: number; active: number };
  channels: { total: number; active: number };
  ads_active: number;
  connections_now: number;
  recent_clients: { id: string; username: string; is_active: boolean; expiry_date: string; created_at: string }[];
  clients_by_month: { month: string; count: number }[];
  categories: { category: string; count: number }[];
}


const COLORS = [
  'hsl(175, 85%, 50%)',
  'hsl(265, 70%, 60%)',
  'hsl(200, 90%, 55%)',
  'hsl(340, 75%, 55%)',
  'hsl(45, 90%, 55%)',
  'hsl(120, 60%, 50%)',
];

const StatCard = ({ icon: Icon, label, value, sub, color = 'primary' }: { icon: any; label: string; value: number | string; sub?: string; color?: string }) => {
  const colorMap: Record<string, string> = {
    primary: 'bg-primary/15 text-primary',
    destructive: 'bg-destructive/15 text-destructive',
    accent: 'bg-accent/15 text-accent',
    warning: 'bg-yellow-500/15 text-yellow-400',
    success: 'bg-emerald-500/15 text-emerald-400',
  };
  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="glass rounded-xl p-4 flex items-center gap-4">
      <div className={`w-12 h-12 rounded-xl flex items-center justify-center shrink-0 ${colorMap[color]}`}>
        <Icon className="w-6 h-6" />
      </div>
      <div>
        <p className="text-2xl font-bold text-foreground">{value}</p>
        <p className="text-xs text-muted-foreground">{label}</p>
        {sub && <p className="text-[10px] text-muted-foreground/70">{sub}</p>}
      </div>
    </motion.div>
  );
};

const AdminStats = () => {
  const { toast } = useToast();
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchStats = async () => {
      try {
        if (isLovablePreview()) {
          // Build stats from Supabase directly
          const [clientsRes, channelsRes, resellersRes, adsRes, connectionsRes] = await Promise.all([
            supabase.from('clients').select('id, username, is_active, expiry_date, created_at'),
            supabase.from('channels').select('id, is_active, category'),
            supabase.from('resellers').select('id, is_active'),
            supabase.from('ads').select('id, is_active'),
            supabase.from('active_connections').select('id'),
          ]);

          const clients = clientsRes.data || [];
          const channels = channelsRes.data || [];
          const resellers = resellersRes.data || [];
          const ads = adsRes.data || [];
          const connections = connectionsRes.data || [];

          const now = new Date();
          const sevenDays = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

          const active = clients.filter(c => c.is_active && new Date(c.expiry_date) > now).length;
          const expired = clients.filter(c => new Date(c.expiry_date) <= now).length;
          const suspended = clients.filter(c => !c.is_active).length;
          const expiring_soon = clients.filter(c => c.is_active && new Date(c.expiry_date) > now && new Date(c.expiry_date) <= sevenDays).length;

          // Group by month
          const byMonth: Record<string, number> = {};
          clients.forEach(c => {
            const m = c.created_at.substring(0, 7);
            byMonth[m] = (byMonth[m] || 0) + 1;
          });

          // Group by category
          const byCat: Record<string, number> = {};
          channels.forEach((ch: any) => {
            byCat[ch.category] = (byCat[ch.category] || 0) + 1;
          });

          setStats({
            clients: { total: clients.length, active, expired, suspended, expiring_soon },
            resellers: { total: resellers.length, active: resellers.filter((r: any) => r.is_active).length },
            channels: { total: channels.length, active: channels.filter((ch: any) => ch.is_active).length },
            ads_active: ads.filter((a: any) => a.is_active).length,
            connections_now: connections.length,
            recent_clients: clients.slice(-5).reverse().map((c: any) => ({
              id: c.id, username: c.username, is_active: c.is_active, expiry_date: c.expiry_date, created_at: c.created_at,
            })),
            clients_by_month: Object.entries(byMonth).sort().map(([month, count]) => ({ month, count })),
            categories: Object.entries(byCat).map(([category, count]) => ({ category, count })),
          });
        } else {
          const data = await apiGet('/api/stats');
          setStats(data);
        }
      } catch (err: any) {
        toast({ title: 'Error', description: err.message, variant: 'destructive' });
      }
      setLoading(false);
    };
    fetchStats();
  }, []);

  if (loading) {
    return (
      <div className="text-center py-12 text-muted-foreground">
        <div className="animate-spin w-8 h-8 border-2 border-primary border-t-transparent rounded-full mx-auto mb-3" />
        Cargando estadísticas...
      </div>
    );
  }

  if (!stats) return <div className="text-center py-12 text-muted-foreground">No se pudieron cargar las estadísticas</div>;

  const monthNames: Record<string, string> = {
    '01': 'Ene', '02': 'Feb', '03': 'Mar', '04': 'Abr', '05': 'May', '06': 'Jun',
    '07': 'Jul', '08': 'Ago', '09': 'Sep', '10': 'Oct', '11': 'Nov', '12': 'Dic',
  };
  const chartData = stats.clients_by_month.map(d => ({
    month: monthNames[d.month.split('-')[1]] || d.month,
    clientes: d.count,
  }));

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        <StatCard icon={Users} label="Clientes Total" value={stats.clients.total} />
        <StatCard icon={UserCheck} label="Activos" value={stats.clients.active} color="success" />
        <StatCard icon={UserX} label="Expirados" value={stats.clients.expired} color="destructive" />
        <StatCard icon={Wifi} label="Conectados Ahora" value={stats.connections_now} color="primary" />
        <StatCard icon={AlertTriangle} label="Por Expirar (7d)" value={stats.clients.expiring_soon} color="warning" />
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatCard icon={Store} label="Resellers" value={`${stats.resellers.active}/${stats.resellers.total}`} sub="activos/total" color="accent" />
        <StatCard icon={Tv} label="Canales" value={`${stats.channels.active}/${stats.channels.total}`} sub="activos/total" color="primary" />
        <StatCard icon={Megaphone} label="Anuncios Activos" value={stats.ads_active} color="accent" />
        <StatCard icon={Clock} label="Suspendidos" value={stats.clients.suspended} color="destructive" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="glass rounded-xl p-5">
          <h3 className="text-sm font-semibold text-foreground mb-4">Nuevos Clientes por Mes</h3>
          {chartData.length > 0 ? (
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={chartData}>
                <XAxis dataKey="month" tick={{ fill: 'hsl(215, 12%, 50%)', fontSize: 12 }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fill: 'hsl(215, 12%, 50%)', fontSize: 12 }} axisLine={false} tickLine={false} allowDecimals={false} />
                <Tooltip
                  contentStyle={{ background: 'hsl(220, 22%, 10%)', border: '1px solid hsl(220, 18%, 14%)', borderRadius: '8px', color: 'hsl(180, 10%, 94%)' }}
                  cursor={{ fill: 'hsl(175, 85%, 50%, 0.08)' }}
                />
                <Bar dataKey="clientes" fill="hsl(175, 85%, 50%)" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <p className="text-muted-foreground text-sm text-center py-10">Sin datos aún</p>
          )}
        </motion.div>

        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="glass rounded-xl p-5">
          <h3 className="text-sm font-semibold text-foreground mb-4">Canales por Categoría</h3>
          {stats.categories.length > 0 ? (
            <div className="flex items-center gap-4">
              <ResponsiveContainer width="50%" height={220}>
                <PieChart>
                  <Pie data={stats.categories} dataKey="count" nameKey="category" cx="50%" cy="50%" outerRadius={80} strokeWidth={0}>
                    {stats.categories.map((_, i) => (
                      <Cell key={i} fill={COLORS[i % COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip
                    contentStyle={{ background: 'hsl(220, 22%, 10%)', border: '1px solid hsl(220, 18%, 14%)', borderRadius: '8px', color: 'hsl(180, 10%, 94%)' }}
                  />
                </PieChart>
              </ResponsiveContainer>
              <div className="space-y-2 flex-1">
                {stats.categories.map((cat, i) => (
                  <div key={cat.category} className="flex items-center gap-2 text-xs">
                    <div className="w-3 h-3 rounded-full shrink-0" style={{ background: COLORS[i % COLORS.length] }} />
                    <span className="text-muted-foreground truncate">{cat.category}</span>
                    <span className="text-foreground font-semibold ml-auto">{cat.count}</span>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <p className="text-muted-foreground text-sm text-center py-10">Sin categorías</p>
          )}
        </motion.div>
      </div>

      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="glass rounded-xl p-5">
        <h3 className="text-sm font-semibold text-foreground mb-4">Últimos Clientes Registrados</h3>
        {stats.recent_clients.length > 0 ? (
          <div className="space-y-2">
            {stats.recent_clients.map(c => (
              <div key={c.id} className="flex items-center justify-between py-2 border-b border-border/30 last:border-0">
                <div className="flex items-center gap-3">
                  <div className={`w-2 h-2 rounded-full ${c.is_active && new Date(c.expiry_date) > new Date() ? 'bg-emerald-400' : 'bg-destructive'}`} />
                  <span className="text-sm text-foreground font-medium">{c.username}</span>
                </div>
                <div className="text-xs text-muted-foreground">
                  {format(new Date(c.created_at), 'dd/MM/yyyy')}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-muted-foreground text-sm text-center py-6">No hay clientes aún</p>
        )}
      </motion.div>

      {/* Access Links */}
      <AccessLinks />
    </div>
  );
};

const AccessLinks = () => {
  const [copiedLink, setCopiedLink] = useState<string | null>(null);
  const baseUrl = typeof window !== 'undefined' ? window.location.origin : '';

  const links = [
    { label: 'Login Cliente', path: '/login', icon: Users, color: 'text-primary' },
    { label: 'Panel Reseller', path: '/reseller', icon: Store, color: 'text-accent' },
    { label: 'Panel Admin', path: '/admin', icon: AlertTriangle, color: 'text-destructive' },
  ];

  const copyLink = (path: string) => {
    const url = `${baseUrl}${path}`;
    navigator.clipboard.writeText(url).then(() => {
      setCopiedLink(path);
      setTimeout(() => setCopiedLink(null), 2000);
    });
  };

  return (
    <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }} className="glass rounded-xl p-5">
      <h3 className="font-semibold text-foreground mb-3 flex items-center gap-2">
        <Link className="w-4 h-4 text-primary" /> Enlaces de Acceso
      </h3>
      <div className="space-y-2">
        {links.map((link) => (
          <div key={link.path} className="flex items-center justify-between glass rounded-lg px-4 py-3">
            <div className="flex items-center gap-3">
              <link.icon className={`w-4 h-4 ${link.color}`} />
              <div>
                <p className="text-sm font-medium text-foreground">{link.label}</p>
                <p className="text-xs text-muted-foreground font-mono">{baseUrl}{link.path}</p>
              </div>
            </div>
            <button
              onClick={() => copyLink(link.path)}
              className="p-2 rounded-lg hover:bg-secondary transition-colors text-muted-foreground hover:text-foreground"
            >
              {copiedLink === link.path ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
            </button>
          </div>
        ))}
      </div>
      <p className="text-[10px] text-muted-foreground mt-3">
        Estos enlaces usan el host actual. Si accedes por Cloudflare, los links serán con tu dominio. Si accedes por IP, serán con la IP del VPS.
      </p>
    </motion.div>
  );
};

export default AdminStats;
