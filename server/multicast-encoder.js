// ============================================================
// Omnisync - Multicast Encoder Manager
// Convierte HTTP/HLS/TS unicast → UDP multicast usando FFmpeg
// On-demand: arranca cuando un sector lo pide, para si nadie lo usa
// ============================================================
//
// Estrategia de codecs:
//   1. ffprobe rápido al origen (timeout 5s)
//   2. Si video=h264 y audio=aac → "copy" (CPU mínima ~1-2%)
//   3. Si no → transcode a h264+aac (CPU ~15-25% por canal SD)
//
// Auto-shutdown: si encoder no tiene sectores activos por IDLE_TIMEOUT_MS, se detiene.
// ============================================================

const { spawn, execSync } = require('child_process');
const fs = require('fs');

const IDLE_TIMEOUT_MS = 60_000;          // 60s sin sectores activos → stop
const HEARTBEAT_INTERVAL_MS = 5_000;     // cada 5s actualiza stats
const PROVIDER_UA = 'VLC/3.0.20 LibVLC/3.0.20';
const FFMPEG_BIN = process.env.FFMPEG_PATH || '/usr/bin/ffmpeg';
const FFPROBE_BIN = process.env.FFPROBE_PATH || '/usr/bin/ffprobe';
// IP del VPS dentro de la VPN L2TP (interfaz ppp0). Se usa como localaddr en el
// destino UDP para forzar que el multicast salga directamente por ppp0 hacia los
// MikroTik remotos, sin necesidad de GRE ni smcroute.
const VPN_LOCAL_IP = process.env.VPN_LOCAL_IP || '172.16.50.1';
const VPN_IFACE = process.env.VPN_IFACE || 'ppp0';

// Estado en memoria de encoders activos
// key = channel_id, value = { proc, multicastIp, port, codec, startedAt, idleSince, lastBytes, lastTs }
const encoders = new Map();

// ----------------------------------------------------------
function ffmpegInstalled() {
  try { execSync(`${FFMPEG_BIN} -version`, { stdio: 'ignore' }); return true; }
  catch { return false; }
}

function ffprobeCodecs(url) {
  if (!fs.existsSync(FFPROBE_BIN) && !commandExists(FFPROBE_BIN)) return null;
  // Probe SEPARADO por tipo de stream → evita que el orden de PIDs confunda el parsing
  const probeOne = (selector) => {
    try {
      const out = execSync(
        `${FFPROBE_BIN} -v error -timeout 5000000 -user_agent "${PROVIDER_UA}" ` +
        `-select_streams ${selector} -show_entries stream=codec_name ` +
        `-of default=nw=1:nk=1 "${url}"`,
        { timeout: 8000, encoding: 'utf8' }
      );
      const first = out.split('\n').map(s => s.trim()).filter(Boolean)[0];
      return first || null;
    } catch (e) {
      return null;
    }
  };
  return {
    video: probeOne('v:0'),
    audio: probeOne('a:0'),
  };
}

function commandExists(cmd) {
  try { execSync(`command -v ${cmd}`, { stdio: 'ignore' }); return true; }
  catch { return false; }
}

// ----------------------------------------------------------
// Decide modo: copy SOLO si confirmamos h264+aac. Si el probe falla o devuelve
// algo distinto, transcode (más seguro que un copy roto que cae en exit=8).
function pickCodecMode(probe) {
  if (!probe || !probe.video || !probe.audio) {
    // Probe falló → transcode garantiza compatibilidad
    return { mode: 'transcode', video: probe?.video || null, audio: probe?.audio || null };
  }
  // Video válido para copy: h264, hevc, mpeg2video (todos soportados por mpegts)
  const videoOk = ['h264', 'hevc', 'mpeg2video'].includes(probe.video);
  // Audio válido para copy: aac, mp2, mp3, ac3
  const audioOk = ['aac', 'mp2', 'mp3', 'ac3'].includes(probe.audio);
  return {
    mode: (videoOk && audioOk) ? 'copy' : 'transcode',
    video: probe.video,
    audio: probe.audio,
  };
}

// ----------------------------------------------------------
function buildFfmpegArgs(sourceUrl, multicastIp, port, codec) {
  const mode = (typeof codec === 'string') ? codec : codec.mode;
  const isH264 = (typeof codec === 'object') && codec.video === 'h264';
  // ============================================================
  // ANTI-MICRO-CORTES para orígenes TS unicast inestables:
  //
  // ENTRADA:
  //   -fflags +genpts+discardcorrupt+igndts → regenera PTS, descarta paquetes
  //                                            corruptos en lugar de abortar
  //   -err_detect ignore_err            → continúa ante errores menores TS
  //   -analyzeduration 5M / -probesize 5M → analiza 5s/5MB para detectar PIDs
  //                                          correctos (evita "no streams found")
  //   -thread_queue_size 4096           → cola grande entre demuxer y muxer
  //   -rw_timeout 30s                   → más tolerante a stalls del origen
  //   -reconnect_delay_max 2            → reconecta rápido en drops cortos
  //   -reconnect_at_eof / on_network_error → reintenta ante cualquier corte
  //
  // SALIDA UDP (multicast por L2TP MTU 1400):
  //   pkt_size=1316        → 7×188 bytes TS, sin fragmentar IP
  //   buffer_size=8000000  → 8MB buffer kernel UDP send (absorbe jitter L2TP)
  //   fifo_size=2000000    → 2MB FIFO interna ffmpeg → no overflow en ráfagas
  //   overrun_nonfatal=1   → si FIFO se llena, descarta sin morir
  //   ttl=8                → varios saltos de túnel
  //
  // MUX MPEG-TS:
  //   muxrate 5000k        → CBR holgado (~25% sobre el bitrate típico SD)
  //   pcr_period 20        → PCR cada 20ms = sync A/V perfecto
  //   resend_headers + pat_pmt_at_frames → tablas PAT/PMT cada GOP, joins más rápidos
  //   muxdelay 0 muxpreload 0 → mínima latencia interna
  // ============================================================
  // ============================================================
  // MODO PROBADO EN PRODUCCIÓN (TS directo + HLS):
  //   - Salida UDP: pkt_size=1316 (7×188 TS) + localaddr=ppp0, sin buffers extra
  //   - Input: -fflags +genpts (solo PTS) + reconnect básico para HLS
  //   - Mux: passthrough crudo, sin muxrate forzado (deja al origen marcar bitrate)
  //   - muxdelay/muxpreload 0 → mínima latencia interna
  //   - mpegts_copyts 1 → preserva timestamps originales (mejor sync TS directo)
  // ============================================================
  const dstUrl = `udp://${multicastIp}:${port}?pkt_size=1316&ttl=8&localaddr=${VPN_LOCAL_IP}`;
  const baseInput = [
    '-nostdin',
    '-hide_banner', '-loglevel', 'warning',
    '-user_agent', PROVIDER_UA,
    '-fflags', '+genpts',
    '-reconnect', '1',
    '-reconnect_streamed', '1',
    '-reconnect_delay_max', '5',
    '-i', sourceUrl,
  ];
  const muxOut = [
    '-f', 'mpegts',
    '-mpegts_flags', '+resend_headers',
    '-mpegts_copyts', '1',
    '-muxdelay', '0',
    '-muxpreload', '0',
    dstUrl,
  ];
  const output = (mode === 'copy')
    ? [
        '-c', 'copy',
        ...(isH264 ? ['-bsf:v', 'h264_mp4toannexb'] : []),
        ...muxOut,
      ]
    : [
        '-c:v', 'libx264', '-preset', 'veryfast', '-tune', 'zerolatency',
        '-b:v', '2500k', '-maxrate', '2800k', '-bufsize', '5600k',
        '-g', '50', '-keyint_min', '50', '-sc_threshold', '0',
        '-c:a', 'aac', '-b:a', '128k', '-ac', '2',
        ...muxOut,
      ];
  return [...baseInput, ...output];
}

// ----------------------------------------------------------
function ensureMulticastRoute() {
  try {
    execSync(`ip route replace 224.0.0.0/4 dev ${VPN_IFACE}`, { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

// ----------------------------------------------------------
// Arranca encoder para un canal. Si ya está corriendo, refresca idleSince.
async function startEncoder(pool, channelId) {
  if (!ffmpegInstalled()) {
    throw new Error('FFmpeg no está instalado en el VPS. Ejecuta install-vpn.sh.');
  }

  if (!ensureMulticastRoute()) {
    throw new Error(`No se pudo configurar la ruta multicast IPv4 por ${VPN_IFACE}`);
  }

  // Si ya está activo: solo resetear idleSince
  if (encoders.has(channelId)) {
    const e = encoders.get(channelId);
    e.idleSince = null;
    return { ok: true, alreadyRunning: true, mode: e.codec.mode };
  }

  // Buscar canal y grupo multicast asignado
  const r = await pool.query(`
    SELECT c.id AS channel_id, c.name, c.url,
           mg.id AS mg_id, mg.multicast_ip, mg.port
      FROM channels c
      JOIN multicast_groups mg ON mg.channel_id = c.id
     WHERE c.id = $1 AND mg.is_assigned = true
     LIMIT 1
  `, [channelId]);
  if (!r.rows[0]) throw new Error('Canal no asignado a ningún grupo multicast');

  const { name, url, mg_id, multicast_ip, port } = r.rows[0];

  // Detectar codecs
  const probe = ffprobeCodecs(url);
  const codec = pickCodecMode(probe);

  console.log(`[encoder] Iniciando ${name} → ${multicast_ip}:${port} (${codec.mode}, v=${codec.video}, a=${codec.audio})`);

  const args = buildFfmpegArgs(url, multicast_ip, port, codec);
  const proc = spawn(FFMPEG_BIN, args, { stdio: ['ignore', 'ignore', 'pipe'] });

  let lastError = '';
  proc.stderr.on('data', (chunk) => {
    const s = chunk.toString();
    if (s.includes('error') || s.includes('Error') || s.includes('fail')) {
      lastError = s.split('\n').slice(-3).join(' ').slice(-300);
    }
  });

  proc.on('exit', async (code, signal) => {
    console.log(`[encoder] ${name} exit code=${code} sig=${signal}`);
    encoders.delete(channelId);
    try {
      await pool.query(
        `UPDATE multicast_encoders SET status='stopped', pid=NULL, last_error=$1
           WHERE channel_id=$2`,
        [code === 0 ? null : (lastError || `exit ${code}`), channelId]
      );
    } catch {}
  });

  encoders.set(channelId, {
    proc,
    pid: proc.pid,
    channelId,
    name,
    multicastGroupId: mg_id,
    multicastIp: multicast_ip,
    port,
    codec,
    startedAt: new Date(),
    idleSince: null,
    lastError: '',
  });

  // Persistir estado
  await pool.query(`
    INSERT INTO multicast_encoders (channel_id, multicast_group_id, pid, status, codec_mode,
                                    source_codec_video, source_codec_audio, started_at, auto_started)
    VALUES ($1, $2, $3, 'running', $4, $5, $6, now(), true)
    ON CONFLICT (channel_id) DO UPDATE
       SET pid = EXCLUDED.pid,
           status = 'running',
           codec_mode = EXCLUDED.codec_mode,
           source_codec_video = EXCLUDED.source_codec_video,
           source_codec_audio = EXCLUDED.source_codec_audio,
           started_at = now(),
           last_error = NULL,
           multicast_group_id = EXCLUDED.multicast_group_id
  `, [channelId, mg_id, proc.pid, codec.mode, codec.video, codec.audio]);

  return { ok: true, mode: codec.mode, multicast: `${multicast_ip}:${port}` };
}

// ----------------------------------------------------------
async function stopEncoder(pool, channelId) {
  const e = encoders.get(channelId);
  if (!e) return { ok: true, wasRunning: false };
  try {
    e.proc.kill('SIGTERM');
    setTimeout(() => { try { e.proc.kill('SIGKILL'); } catch {} }, 3000);
  } catch {}
  encoders.delete(channelId);
  await pool.query(
    `UPDATE multicast_encoders SET status='stopped', pid=NULL WHERE channel_id=$1`,
    [channelId]
  );
  return { ok: true, wasRunning: true };
}

// ----------------------------------------------------------
// Lista todos los encoders (en memoria + BD)
async function listEncoders(pool) {
  const r = await pool.query(`
    SELECT me.*, c.name AS channel_name, c.category, mg.multicast_ip, mg.port,
           (SELECT COUNT(*) FROM sector_channel_map scm
              WHERE scm.multicast_group_id = me.multicast_group_id AND scm.is_active) AS sectors_using
      FROM multicast_encoders me
      JOIN channels c ON c.id = me.channel_id
      LEFT JOIN multicast_groups mg ON mg.id = me.multicast_group_id
     ORDER BY me.started_at DESC NULLS LAST
  `);
  // Enriquecer con estado runtime
  return r.rows.map(row => {
    const live = encoders.get(row.channel_id);
    return {
      ...row,
      runtime_alive: !!live,
      runtime_pid: live?.pid || null,
      idle_seconds: live?.idleSince ? Math.floor((Date.now() - live.idleSince) / 1000) : null,
    };
  });
}

// ----------------------------------------------------------
// Sincroniza encoders con BD: arranca los que tienen sectores activos, detiene los huérfanos
async function syncEncodersFromDB(pool) {
  // Canales que DEBERÍAN estar activos (al menos un sector los recibe)
  const needed = await pool.query(`
    SELECT DISTINCT mg.channel_id
      FROM sector_channel_map scm
      JOIN multicast_groups mg ON mg.id = scm.multicast_group_id
      JOIN vpn_sectors vs ON vs.id = scm.sector_id
     WHERE scm.is_active = true AND vs.is_active = true AND mg.channel_id IS NOT NULL
  `);
  const neededSet = new Set(needed.rows.map(r => r.channel_id));

  // Arrancar los que faltan
  const started = [];
  for (const channelId of neededSet) {
    if (!encoders.has(channelId)) {
      try {
        await startEncoder(pool, channelId);
        started.push(channelId);
      } catch (e) {
        console.error(`[encoder] No se pudo arrancar ${channelId}: ${e.message}`);
      }
    }
  }

  // Marcar idle a los que ya no tienen sectores (no parar inmediatamente, dejar IDLE_TIMEOUT)
  const stopped = [];
  for (const [channelId, e] of encoders.entries()) {
    if (!neededSet.has(channelId) && !e.idleSince) {
      e.idleSince = Date.now();
    } else if (neededSet.has(channelId)) {
      e.idleSince = null;
    }
  }

  return { started: started.length, total_active: encoders.size };
}

// ----------------------------------------------------------
// Loop de mantenimiento: chequea idle, actualiza heartbeats
function startMaintenanceLoop(pool) {
  setInterval(async () => {
    const now = Date.now();
    for (const [channelId, e] of encoders.entries()) {
      // Auto-stop por idle
      if (e.idleSince && (now - e.idleSince) > IDLE_TIMEOUT_MS) {
        console.log(`[encoder] Auto-stop ${e.name} (idle ${Math.floor((now - e.idleSince)/1000)}s)`);
        await stopEncoder(pool, channelId).catch(() => {});
        continue;
      }
      // Heartbeat
      try {
        await pool.query(
          `UPDATE multicast_encoders SET last_heartbeat = now() WHERE channel_id = $1`,
          [channelId]
        );
      } catch {}
    }
  }, HEARTBEAT_INTERVAL_MS);
}

// ----------------------------------------------------------
function shutdownAll() {
  for (const [id, e] of encoders.entries()) {
    try { e.proc.kill('SIGTERM'); } catch {}
  }
  encoders.clear();
}

process.on('SIGTERM', shutdownAll);
process.on('SIGINT', shutdownAll);

module.exports = {
  startEncoder,
  stopEncoder,
  listEncoders,
  syncEncodersFromDB,
  startMaintenanceLoop,
  ffmpegInstalled,
  shutdownAll,
};
