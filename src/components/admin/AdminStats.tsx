import { useState, useEffect } from 'react';
import { apiGet } from '@/lib/api';
import { useToast } from '@/hooks/use-toast';
import { Users, UserCheck, UserX, Clock, Tv, Store, Megaphone, Wifi, AlertTriangle } from 'lucide-react';
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
    const fetch = async () => {
      try {
        const data = await apiGet('/api/stats');
        setStats(data);
      } catch (err: any) {
        toast({ title: 'Error', description: err.message, variant: 'destructive' });
      }
      setLoading(false);
    };
    fetch();
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
      {/* Stat Cards */}
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

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Bar Chart - Clientes por Mes */}
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

        {/* Pie Chart - Categorías */}
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

      {/* Recent Clients */}
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
    </div>
  );
};

export default AdminStats;
