import { useState, useEffect } from 'react';
import { apiGet, apiPost } from '@/lib/api';
import { useToast } from '@/hooks/use-toast';
import { Bug, Play, RefreshCw, AlertTriangle, CheckCircle, XCircle, Search, Wifi, Clock, FileText, Copy, ClipboardCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { motion } from 'framer-motion';

interface Channel {
  id: string;
  name: string;
  url: string;
  category: string;
  logo_url: string | null;
  is_active: boolean;
}

interface DiagResult {
  channel_id: string;
  channel_name: string;
  url: string;
  status: 'ok' | 'error' | 'timeout' | 'testing';
  http_code: number | null;
  content_type: string | null;
  response_time_ms: number | null;
  error_message: string | null;
  headers: Record<string, string> | null;
  stream_type: string;
  details: string;
}

const detectStreamType = (url: string): string => {
  if (/\.m3u8?(\?|$)/i.test(url)) return 'HLS (.m3u8)';
  if (/\.ts(\?|$)/i.test(url) || /\/\d+\.ts/.test(url)) return 'MPEG-TS (.ts)';
  if (/\.mp4(\?|$)/i.test(url)) return 'MP4';
  if (/youtube\.com|youtu\.be/.test(url)) return 'YouTube';
  return 'Desconocido';
};

const StreamDiagnostics = () => {
  const { toast } = useToast();
  const [channels, setChannels] = useState<Channel[]>([]);
  const [results, setResults] = useState<Map<string, DiagResult>>(new Map());
  const [search, setSearch] = useState('');
  const [testing, setTesting] = useState(false);
  const [testingAll, setTestingAll] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    fetchChannels();
  }, []);

  const fetchChannels = async () => {
    try {
      const data = await apiGet('/api/channels');
      setChannels(data);
    } catch (err: any) {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    }
  };

  const testChannel = async (channel: Channel): Promise<DiagResult> => {
    const startTime = Date.now();
    const streamType = detectStreamType(channel.url);

    // Mark as testing
    const testingResult: DiagResult = {
      channel_id: channel.id,
      channel_name: channel.name,
      url: channel.url,
      status: 'testing',
      http_code: null,
      content_type: null,
      response_time_ms: null,
      error_message: null,
      headers: null,
      stream_type: streamType,
      details: 'Probando conexión...',
    };

    setResults(prev => new Map(prev).set(channel.id, testingResult));

    try {
      // Try server-side diagnostic endpoint first
      const diagData = await apiPost('/api/channels/diagnose', { 
        channel_id: channel.id,
        url: channel.url 
      });

      const elapsed = Date.now() - startTime;
      const result: DiagResult = {
        channel_id: channel.id,
        channel_name: channel.name,
        url: channel.url,
        status: diagData.status === 'ok' ? 'ok' : 'error',
        http_code: diagData.http_code || null,
        content_type: diagData.content_type || null,
        response_time_ms: diagData.response_time_ms || elapsed,
        error_message: diagData.error_message || null,
        headers: diagData.headers || null,
        stream_type: streamType,
        details: diagData.details || (diagData.status === 'ok' ? 'Stream accesible' : 'Stream inaccesible'),
      };

      setResults(prev => new Map(prev).set(channel.id, result));
      return result;
    } catch (err: any) {
      // Fallback: try a basic HEAD/GET from client
      const elapsed = Date.now() - startTime;
      let result: DiagResult;

      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 10000);
        
        const response = await fetch(channel.url, {
          method: 'HEAD',
          signal: controller.signal,
          mode: 'no-cors',
        });
        clearTimeout(timeout);

        const responseTime = Date.now() - startTime;
        result = {
          channel_id: channel.id,
          channel_name: channel.name,
          url: channel.url,
          status: 'ok',
          http_code: response.status || 0,
          content_type: response.headers.get('content-type') || 'opaque (CORS)',
          response_time_ms: responseTime,
          error_message: null,
          headers: null,
          stream_type: streamType,
          details: response.status === 0 ? 'Respuesta opaca (CORS) — el servidor responde pero no podemos ver detalles desde el navegador. Usar diagnóstico del servidor.' : 'Responde correctamente',
        };
      } catch (fetchErr: any) {
        result = {
          channel_id: channel.id,
          channel_name: channel.name,
          url: channel.url,
          status: fetchErr.name === 'AbortError' ? 'timeout' : 'error',
          http_code: null,
          content_type: null,
          response_time_ms: elapsed,
          error_message: fetchErr.name === 'AbortError' 
            ? 'Timeout: El servidor no respondió en 10 segundos'
            : `Error de conexión: ${fetchErr.message}`,
          headers: null,
          stream_type: streamType,
          details: fetchErr.name === 'AbortError'
            ? 'El servidor de origen no responde. Puede estar caído o bloqueando la IP del VPS.'
            : `No se pudo conectar: ${fetchErr.message}`,
        };
      }

      setResults(prev => new Map(prev).set(channel.id, result));
      return result;
    }
  };

  const testAllChannels = async () => {
    setTestingAll(true);
    setResults(new Map());
    
    const activeChannels = channels.filter(c => c.is_active);
    
    // Test in batches of 3
    for (let i = 0; i < activeChannels.length; i += 3) {
      const batch = activeChannels.slice(i, i + 3);
      await Promise.all(batch.map(ch => testChannel(ch)));
    }
    
    setTestingAll(false);
    toast({ title: 'Diagnóstico completo', description: `Se probaron ${activeChannels.length} canales` });
  };

  const generateReport = () => {
    const allResults = Array.from(results.values()).filter(r => r.status !== 'testing');
    if (allResults.length === 0) {
      toast({ title: 'Sin datos', description: 'Primero ejecuta el diagnóstico', variant: 'destructive' });
      return;
    }

    const now = new Date().toLocaleString();
    const ok = allResults.filter(r => r.status === 'ok');
    const errors = allResults.filter(r => r.status === 'error');
    const timeouts = allResults.filter(r => r.status === 'timeout');

    let report = `📋 REPORTE DE DIAGNÓSTICO DE STREAMS\n`;
    report += `📅 Fecha: ${now}\n`;
    report += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
    report += `✅ OK: ${ok.length} | ❌ Error: ${errors.length} | ⏱ Timeout: ${timeouts.length} | Total: ${allResults.length}\n\n`;

    if (errors.length > 0 || timeouts.length > 0) {
      report += `🔴 CANALES CON PROBLEMAS:\n`;
      report += `──────────────────────────\n`;
      [...errors, ...timeouts].forEach(r => {
        report += `\n▸ ${r.channel_name}\n`;
        report += `  URL: ${r.url}\n`;
        report += `  Estado: ${r.status.toUpperCase()}`;
        if (r.http_code) report += ` | HTTP ${r.http_code}`;
        if (r.response_time_ms) report += ` | ${r.response_time_ms}ms`;
        report += `\n`;
        if (r.content_type) report += `  Content-Type: ${r.content_type}\n`;
        report += `  Formato: ${r.stream_type}\n`;
        if (r.error_message) report += `  Error: ${r.error_message}\n`;
        if (r.details) report += `  Detalle: ${r.details}\n`;
      });
    }

    if (ok.length > 0) {
      report += `\n🟢 CANALES OK:\n`;
      report += `──────────────────────────\n`;
      ok.forEach(r => {
        report += `▸ ${r.channel_name} — HTTP ${r.http_code || '?'} | ${r.response_time_ms}ms | ${r.stream_type}\n`;
      });
    }

    report += `\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
    report += `Fin del reporte`;

    navigator.clipboard.writeText(report).then(() => {
      setCopied(true);
      toast({ title: 'Reporte copiado', description: 'Pégalo en el chat para que lo revise' });
      setTimeout(() => setCopied(false), 3000);
    }).catch(() => {
      // Fallback: show in a prompt
      prompt('Copia este reporte:', report);
    });
  };

  const filteredChannels = channels.filter(c => 
    c.name.toLowerCase().includes(search.toLowerCase()) || 
    c.category.toLowerCase().includes(search.toLowerCase())
  );

  const stats = {
    total: results.size,
    ok: Array.from(results.values()).filter(r => r.status === 'ok').length,
    error: Array.from(results.values()).filter(r => r.status === 'error').length,
    timeout: Array.from(results.values()).filter(r => r.status === 'timeout').length,
    testing: Array.from(results.values()).filter(r => r.status === 'testing').length,
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'ok': return <CheckCircle className="w-4 h-4 text-emerald-400" />;
      case 'error': return <XCircle className="w-4 h-4 text-destructive" />;
      case 'timeout': return <AlertTriangle className="w-4 h-4 text-yellow-400" />;
      case 'testing': return <RefreshCw className="w-4 h-4 text-primary animate-spin" />;
      default: return <Wifi className="w-4 h-4 text-muted-foreground" />;
    }
  };

  const getStatusBg = (status: string) => {
    switch (status) {
      case 'ok': return 'border-emerald-500/30 bg-emerald-500/5';
      case 'error': return 'border-destructive/30 bg-destructive/5';
      case 'timeout': return 'border-yellow-500/30 bg-yellow-500/5';
      case 'testing': return 'border-primary/30 bg-primary/5';
      default: return 'border-border';
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h2 className="font-display font-semibold text-xl text-foreground flex items-center gap-2">
          <Bug className="w-5 h-5 text-primary" />
          Diagnóstico de Streams
        </h2>
        <div className="flex items-center gap-2">
          <Button 
            onClick={generateReport} 
            disabled={results.size === 0 || testingAll}
            variant="outline"
            size="sm"
            className="gap-2 border-border text-foreground"
          >
            {copied ? <ClipboardCheck className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
            {copied ? 'Copiado!' : 'Generar Reporte'}
          </Button>
          <Button 
            onClick={testAllChannels} 
            disabled={testingAll} 
            className="gap-2 gradient-primary text-primary-foreground"
            size="sm"
          >
            {testingAll ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
            {testingAll ? `Probando... (${stats.testing} restantes)` : 'Probar Todos'}
          </Button>
        </div>
      </div>

      {/* Summary */}
      {stats.total > 0 && (
        <div className="grid grid-cols-4 gap-3">
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="glass rounded-xl p-3 text-center">
            <p className="text-2xl font-bold text-foreground">{stats.total}</p>
            <p className="text-xs text-muted-foreground">Probados</p>
          </motion.div>
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }} className="glass rounded-xl p-3 text-center">
            <p className="text-2xl font-bold text-emerald-400">{stats.ok}</p>
            <p className="text-xs text-muted-foreground">OK</p>
          </motion.div>
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }} className="glass rounded-xl p-3 text-center">
            <p className="text-2xl font-bold text-destructive">{stats.error}</p>
            <p className="text-xs text-muted-foreground">Error</p>
          </motion.div>
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 }} className="glass rounded-xl p-3 text-center">
            <p className="text-2xl font-bold text-yellow-400">{stats.timeout}</p>
            <p className="text-xs text-muted-foreground">Timeout</p>
          </motion.div>
        </div>
      )}

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <Input
          placeholder="Buscar canal..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="pl-9 glass border-border"
        />
      </div>

      {/* Channel List */}
      <div className="space-y-2 max-h-[60vh] overflow-y-auto pr-1">
        {filteredChannels.map((channel, i) => {
          const result = results.get(channel.id);
          return (
            <motion.div
              key={channel.id}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: i * 0.02 }}
              className={`glass rounded-xl p-4 border ${result ? getStatusBg(result.status) : 'border-border/30'}`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-start gap-3 min-w-0 flex-1">
                  {result ? getStatusIcon(result.status) : <Wifi className="w-4 h-4 text-muted-foreground mt-0.5" />}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="font-semibold text-foreground text-sm truncate">{channel.name}</p>
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground shrink-0">
                        {channel.category}
                      </span>
                      {!channel.is_active && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-destructive/20 text-destructive shrink-0">
                          Inactivo
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground truncate mt-0.5 font-mono">{channel.url}</p>
                    
                    {/* Diagnostic details */}
                    {result && result.status !== 'testing' && (
                      <div className="mt-2 space-y-1.5">
                        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
                          {result.http_code !== null && (
                            <span className="flex items-center gap-1 text-muted-foreground">
                              <FileText className="w-3 h-3" />
                              HTTP {result.http_code}
                            </span>
                          )}
                          {result.response_time_ms !== null && (
                            <span className="flex items-center gap-1 text-muted-foreground">
                              <Clock className="w-3 h-3" />
                              {result.response_time_ms}ms
                            </span>
                          )}
                          {result.content_type && (
                            <span className="text-muted-foreground">
                              Tipo: {result.content_type}
                            </span>
                          )}
                          <span className="text-muted-foreground">
                            Formato: {result.stream_type}
                          </span>
                        </div>
                        
                        {result.error_message && (
                          <div className="bg-destructive/10 text-destructive text-xs rounded-lg px-3 py-2 font-mono">
                            {result.error_message}
                          </div>
                        )}
                        
                        {result.details && (
                          <p className="text-xs text-muted-foreground italic">{result.details}</p>
                        )}
                      </div>
                    )}

                    {result?.status === 'testing' && (
                      <p className="text-xs text-primary mt-1 animate-pulse">Probando conexión...</p>
                    )}
                  </div>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => testChannel(channel)}
                  disabled={result?.status === 'testing' || testingAll}
                  className="shrink-0 gap-1.5 text-xs border-border text-foreground"
                >
                  {result?.status === 'testing' 
                    ? <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    : <Play className="w-3.5 h-3.5" />
                  }
                  Probar
                </Button>
              </div>
            </motion.div>
          );
        })}
      </div>

      {/* Help Note */}
      <div className="glass rounded-xl p-4 border border-primary/20">
        <div className="flex items-start gap-3">
          <div className="w-8 h-8 rounded-lg bg-primary/15 flex items-center justify-center shrink-0">
            <Bug className="w-4 h-4 text-primary" />
          </div>
          <div>
            <p className="text-sm font-semibold text-foreground">Causas comunes de error</p>
            <ul className="text-xs text-muted-foreground mt-1 space-y-1 list-disc list-inside">
              <li><strong className="text-foreground">HTTP 403/401:</strong> URL con autenticación o IP bloqueada</li>
              <li><strong className="text-foreground">Timeout:</strong> Servidor de origen caído o bloquea tu VPS</li>
              <li><strong className="text-foreground">CORS/Opaco:</strong> Prueba desde el servidor con el botón "Probar Todos"</li>
              <li><strong className="text-foreground">URL encriptada:</strong> El proveedor tiene "Encrypt URL" activo — no compatible</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
};

export default StreamDiagnostics;
