import { useState, useEffect } from 'react';
import { apiGet } from '@/lib/api';
import { useToast } from '@/hooks/use-toast';
import { AlertTriangle, Clock, Bell, BellRing, Timer } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { format } from 'date-fns';

interface ExpiringClient {
  id: string;
  username: string;
  max_screens: number;
  expiry_date: string;
  notes: string | null;
  urgency: 'critical' | 'high' | 'low';
  days_left: number;
  hours_left: number;
}

interface ExpiringData {
  total: number;
  critical: number;
  high: number;
  low: number;
  clients: ExpiringClient[];
}

const urgencyConfig = {
  critical: {
    label: 'CRÍTICO',
    color: 'bg-red-500/15 text-red-400 border-red-500/30',
    dot: 'bg-red-400',
    icon: BellRing,
    badge: 'bg-red-500/20 text-red-300',
  },
  high: {
    label: 'ALTO',
    color: 'bg-orange-500/15 text-orange-400 border-orange-500/30',
    dot: 'bg-orange-400',
    icon: Bell,
    badge: 'bg-orange-500/20 text-orange-300',
  },
  low: {
    label: 'MEDIO',
    color: 'bg-yellow-500/15 text-yellow-400 border-yellow-500/30',
    dot: 'bg-yellow-400',
    icon: Clock,
    badge: 'bg-yellow-500/20 text-yellow-300',
  },
};

const ExpirationAlerts = () => {
  const { toast } = useToast();
  const [data, setData] = useState<ExpiringData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetch = async () => {
      try {
        const result = await apiGet('/api/clients/expiring');
        setData(result);
      } catch (err: any) {
        toast({ title: 'Error', description: err.message, variant: 'destructive' });
      }
      setLoading(false);
    };
    fetch();
  }, []);

  if (loading) {
    return (
      <div className="text-center py-8 text-muted-foreground">
        <div className="animate-spin w-6 h-6 border-2 border-primary border-t-transparent rounded-full mx-auto mb-2" />
        Cargando alertas...
      </div>
    );
  }

  if (!data || data.total === 0) {
    return (
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="glass rounded-xl p-8 text-center">
        <Timer className="w-10 h-10 text-emerald-400 mx-auto mb-3" />
        <p className="text-foreground font-medium">Sin alertas de expiración</p>
        <p className="text-xs text-muted-foreground mt-1">Ningún cliente expira en los próximos 7 días</p>
      </motion.div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Summary Banner */}
      <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }}
        className={`rounded-xl p-4 border ${data.critical > 0 ? 'bg-red-500/10 border-red-500/20' : 'bg-yellow-500/10 border-yellow-500/20'}`}>
        <div className="flex items-center gap-3">
          <AlertTriangle className={`w-6 h-6 shrink-0 ${data.critical > 0 ? 'text-red-400' : 'text-yellow-400'}`} />
          <div>
            <p className="text-foreground font-semibold text-sm">
              {data.total} cliente{data.total > 1 ? 's' : ''} por expirar en los próximos 7 días
            </p>
            <div className="flex gap-4 mt-1 text-xs">
              {data.critical > 0 && (
                <span className="text-red-400 font-medium">⚠ {data.critical} crítico{data.critical > 1 ? 's' : ''} (&lt;24h)</span>
              )}
              {data.high > 0 && (
                <span className="text-orange-400 font-medium">{data.high} alto{data.high > 1 ? 's' : ''} (1-3 días)</span>
              )}
              {data.low > 0 && (
                <span className="text-yellow-400 font-medium">{data.low} medio{data.low > 1 ? 's' : ''} (4-7 días)</span>
              )}
            </div>
          </div>
        </div>
      </motion.div>

      {/* Client List */}
      <div className="space-y-2">
        <AnimatePresence>
          {data.clients.map((client, i) => {
            const config = urgencyConfig[client.urgency];
            const Icon = config.icon;
            return (
              <motion.div
                key={client.id}
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: i * 0.05 }}
                className={`glass rounded-xl p-4 border ${config.color}`}
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-3 flex-1 min-w-0">
                    <div className={`w-10 h-10 rounded-lg flex items-center justify-center shrink-0 ${config.color}`}>
                      <Icon className="w-5 h-5" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-foreground font-semibold text-sm">{client.username}</p>
                      <p className="text-xs text-muted-foreground">
                        Expira: {format(new Date(client.expiry_date), 'dd/MM/yyyy HH:mm')}
                      </p>
                      {client.notes && (
                        <p className="text-[10px] text-muted-foreground/70 truncate">{client.notes}</p>
                      )}
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <span className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-bold uppercase ${config.badge}`}>
                      {config.label}
                    </span>
                    <p className="text-xs text-foreground font-mono mt-1">
                      {client.days_left > 0 
                        ? `${client.days_left}d ${client.hours_left}h`
                        : `${client.hours_left}h`
                      }
                    </p>
                  </div>
                </div>
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>
    </div>
  );
};

export default ExpirationAlerts;
