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

const DEFAULT_IDLE_TIMEOUT_MS = 300_000; // 5min default si encoder no define idle_timeout_seconds
const HEARTBEAT_INTERVAL_MS = 5_000;     // cada 5s actualiza stats
const VIEWER_HEARTBEAT_WINDOW_MS = 5 * 60_000; // 5min: ventana para considerar viewer activo
const PROVIDER_UA = 'VLC/3.0.20 LibVLC/3.0.20';
const FFMPEG_BIN = process.env.FFMPEG_PATH || '/usr/bin/ffmpeg';
const FFPROBE_BIN = process.env.FFPROBE_PATH || '/usr/bin/ffprobe';
// IP/interfaz por la que sale el multicast UDP. Por defecto apunta al túnel L2TP
// (ppp0 / 172.16.50.1). Para sectores LAN local el admin puede sobreescribir
// estos valores desde el panel (PUT /api/vpn/lan-config), que se persisten en
// system_settings.lan_network_config y se leen en cada arranque de encoder.
const DEFAULT_VPN_LOCAL_IP = process.env.VPN_LOCAL_IP || '172.16.50.1';
const DEFAULT_VPN_IFACE = process.env.VPN_IFACE || 'ppp0';

async function getNetworkConfig(pool) {
  try {
    const r = await pool.query(
      `SELECT value FROM system_settings WHERE key = 'lan_network_config'`
    );
    const cfg = r.rows[0]?.value || {};
    return {
      localIp: cfg.local_ip || DEFAULT_VPN_LOCAL_IP,
      iface: cfg.iface || DEFAULT_VPN_IFACE,
    };
  } catch {
    return { localIp: DEFAULT_VPN_LOCAL_IP, iface: DEFAULT_VPN_IFACE };
  }
}

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
function buildFfmpegArgs(sourceUrl, multicastIp, port, codec, netCfg) {
  const mode = (typeof codec === 'string') ? codec : codec.mode;
  const isH264 = (typeof codec === 'object') && codec.video === 'h264';
  const localIp = netCfg?.localIp || DEFAULT_VPN_LOCAL_IP;
  const dstUrl = `udp://${multicastIp}:${port}?pkt_size=1316&ttl=8&localaddr=${localIp}`;
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
function ensureMulticastRoute(iface) {
  try {
    execSync(`ip route replace 224.0.0.0/4 dev ${iface}`, { stdio: 'ignore' });
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

  const netCfg = await getNetworkConfig(pool);

  if (!ensureMulticastRoute(netCfg.iface)) {
    throw new Error(`No se pudo configurar la ruta multicast IPv4 por ${netCfg.iface}`);
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

  console.log(`[encoder] Iniciando ${name} → ${multicast_ip}:${port} (${codec.mode}, v=${codec.video}, a=${codec.audio}) iface=${netCfg.iface} src=${netCfg.localIp}`);

  const args = buildFfmpegArgs(url, multicast_ip, port, codec, netCfg);
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
              WHERE scm.multicast_group_id = me.multicast_group_id AND scm.is_active) AS sectors_using,
           (SELECT COUNT(*) FROM active_connections ac
              WHERE ac.watching_channel_id = me.channel_id
                AND ac.last_heartbeat > now() - INTERVAL '5 minutes') AS current_viewers
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
// Devuelve set de channel_id que TIENEN al menos un viewer activo en la APK
// (heartbeat dentro de los últimos 5 min)
async function getChannelsWithViewers(pool) {
  const r = await pool.query(`
    SELECT DISTINCT watching_channel_id AS channel_id
      FROM active_connections
     WHERE watching_channel_id IS NOT NULL
       AND last_heartbeat > now() - INTERVAL '5 minutes'
  `);
  return new Set(r.rows.map(x => x.channel_id));
}

// ----------------------------------------------------------
// Devuelve set de channel_id que tienen al menos un sector asignado activo
async function getChannelsAssignedToSectors(pool) {
  const r = await pool.query(`
    SELECT DISTINCT mg.channel_id
      FROM sector_channel_map scm
      JOIN multicast_groups mg ON mg.id = scm.multicast_group_id
      JOIN vpn_sectors vs ON vs.id = scm.sector_id
     WHERE scm.is_active = true AND vs.is_active = true AND mg.channel_id IS NOT NULL
  `);
  return new Set(r.rows.map(x => x.channel_id));
}

// ----------------------------------------------------------
// Devuelve mapa channel_id -> { mode, idle_timeout_seconds } leyendo BD.
// Si no hay registro en multicast_encoders aún, asume 'always_on' / 300s.
async function getChannelEncoderConfig(pool) {
  const r = await pool.query(`
    SELECT channel_id, mode, idle_timeout_seconds
      FROM multicast_encoders
  `);
  const map = new Map();
  for (const row of r.rows) {
    map.set(row.channel_id, {
      mode: row.mode || 'always_on',
      idleTimeoutMs: (row.idle_timeout_seconds || 300) * 1000,
    });
  }
  return map;
}

// ----------------------------------------------------------
// Sincroniza encoders con BD respetando mode (always_on / on_demand).
//   - always_on: arranca si tiene sectores asignados, no se apaga por idle
//   - on_demand: arranca solo si hay viewer real, se apaga tras idle_timeout
async function syncEncodersFromDB(pool) {
  const assigned = await getChannelsAssignedToSectors(pool);
  const viewers = await getChannelsWithViewers(pool);
  const config = await getChannelEncoderConfig(pool);

  // Determinar qué canales DEBEN estar activos según su modo
  const shouldRun = new Set();
  for (const channelId of assigned) {
    const cfg = config.get(channelId) || { mode: 'always_on' };
    if (cfg.mode === 'always_on') {
      shouldRun.add(channelId);
    } else if (cfg.mode === 'on_demand' && viewers.has(channelId)) {
      shouldRun.add(channelId);
    }
  }

  // Arrancar los que faltan
  const started = [];
  for (const channelId of shouldRun) {
    if (!encoders.has(channelId)) {
      try {
        await startEncoder(pool, channelId);
        started.push(channelId);
      } catch (e) {
        console.error(`[encoder] No se pudo arrancar ${channelId}: ${e.message}`);
      }
    }
  }

  // Refrescar last_viewer_at en BD para los on_demand con viewers
  for (const channelId of viewers) {
    if (assigned.has(channelId)) {
      try {
        await pool.query(
          `UPDATE multicast_encoders SET last_viewer_at = now() WHERE channel_id = $1`,
          [channelId]
        );
      } catch {}
    }
  }

  // Marcar idle a los que ya no deberían correr
  for (const [channelId, e] of encoders.entries()) {
    if (!shouldRun.has(channelId)) {
      if (!e.idleSince) e.idleSince = Date.now();
    } else {
      e.idleSince = null;
    }
  }

  return { started: started.length, total_active: encoders.size, viewers: viewers.size };
}

// ----------------------------------------------------------
// Loop de mantenimiento: chequea idle (con timeout por canal), heartbeats, y re-sincroniza
function startMaintenanceLoop(pool) {
  // Cada 15s re-sincroniza demanda
  setInterval(async () => {
    try { await syncEncodersFromDB(pool); } catch (e) { console.error('[encoder] sync error:', e.message); }
  }, 15_000);

  // Cada 5s chequea idle y heartbeat
  setInterval(async () => {
    const now = Date.now();
    const config = await getChannelEncoderConfig(pool).catch(() => new Map());
    for (const [channelId, e] of encoders.entries()) {
      const cfg = config.get(channelId) || { mode: 'always_on', idleTimeoutMs: DEFAULT_IDLE_TIMEOUT_MS };
      // Solo on_demand se auto-apaga; always_on se mantiene mientras haya sectores
      if (cfg.mode === 'on_demand' && e.idleSince && (now - e.idleSince) > cfg.idleTimeoutMs) {
        console.log(`[encoder] Auto-stop ${e.name} on_demand (idle ${Math.floor((now - e.idleSince)/1000)}s)`);
        await stopEncoder(pool, channelId).catch(() => {});
        continue;
      }
      // Para always_on usamos el default conservador solo si perdió sus sectores
      if (cfg.mode === 'always_on' && e.idleSince && (now - e.idleSince) > DEFAULT_IDLE_TIMEOUT_MS) {
        console.log(`[encoder] Auto-stop ${e.name} always_on sin sectores (idle ${Math.floor((now - e.idleSince)/1000)}s)`);
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
