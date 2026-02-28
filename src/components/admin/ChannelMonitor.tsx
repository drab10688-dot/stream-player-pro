import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { AlertTriangle, Wifi, WifiOff, RefreshCw, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useToast } from '@/hooks/use-toast';
import { format } from 'date-fns';

interface HealthLog {
  id: string;
  channel_id: string;
  status: string;
  error_message: string | null;
  checked_at: string;
  checked_by: string | null;
  channels?: { name: string } | null;
}

const ChannelMonitor = () => {
  const { toast } = useToast();
  const [logs, setLogs] = useState<HealthLog[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchLogs = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('channel_health_logs')
      .select('*, channels(name)')
      .order('checked_at', { ascending: false })
      .limit(100);

    if (error) {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    } else {
      setLogs(data || []);
    }
    setLoading(false);
  };

  useEffect(() => {
    fetchLogs();

    // Realtime updates
    const channel = supabase
      .channel('channel-health-monitor')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'channel_health_logs' }, () => {
        fetchLogs();
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, []);

  const clearLogs = async () => {
    const { error } = await supabase.from('channel_health_logs').delete().neq('id', '00000000-0000-0000-0000-000000000000');
    if (error) {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    } else {
      setLogs([]);
      toast({ title: 'Logs limpiados' });
    }
  };

  // Group errors by channel
  const errorsByChannel = logs.reduce((acc, log) => {
    const name = (log.channels as any)?.name || 'Desconocido';
    if (!acc[name]) acc[name] = [];
    acc[name].push(log);
    return acc;
  }, {} as Record<string, HealthLog[]>);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <AlertTriangle className="w-5 h-5 text-destructive" />
          <h3 className="font-semibold text-foreground">Monitoreo de Canales</h3>
          <span className="text-xs bg-destructive/20 text-destructive px-2 py-0.5 rounded-full">
            {logs.length} reportes
          </span>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={fetchLogs} disabled={loading}>
            <RefreshCw className={`w-4 h-4 mr-1 ${loading ? 'animate-spin' : ''}`} />
            Actualizar
          </Button>
          {logs.length > 0 && (
            <Button variant="destructive" size="sm" onClick={clearLogs}>
              <Trash2 className="w-4 h-4 mr-1" />
              Limpiar
            </Button>
          )}
        </div>
      </div>

      {logs.length === 0 ? (
        <div className="glass rounded-xl p-8 text-center">
          <Wifi className="w-8 h-8 text-primary mx-auto mb-2" />
          <p className="text-muted-foreground text-sm">Todos los canales funcionan correctamente</p>
        </div>
      ) : (
        <div className="space-y-3">
          {Object.entries(errorsByChannel).map(([channelName, channelLogs]) => (
            <div key={channelName} className="glass rounded-xl overflow-hidden">
              <div className="flex items-center gap-3 px-4 py-3 border-b border-border/30">
                <WifiOff className="w-4 h-4 text-destructive shrink-0" />
                <span className="font-medium text-foreground text-sm">{channelName}</span>
                <span className="text-xs bg-destructive/20 text-destructive px-2 py-0.5 rounded-full ml-auto">
                  {channelLogs.length} errores
                </span>
              </div>
              <ScrollArea className={channelLogs.length > 3 ? 'max-h-40' : ''}>
                <div className="divide-y divide-border/20">
                  {channelLogs.slice(0, 10).map(log => (
                    <div key={log.id} className="px-4 py-2 flex items-start gap-3 text-xs">
                      <span className="text-muted-foreground shrink-0 mt-0.5">
                        {format(new Date(log.checked_at), 'dd/MM HH:mm')}
                      </span>
                      <span className="text-foreground/80 flex-1">{log.error_message || 'Error desconocido'}</span>
                      <span className="text-muted-foreground/60 shrink-0">{log.checked_by || ''}</span>
                    </div>
                  ))}
                </div>
              </ScrollArea>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default ChannelMonitor;
