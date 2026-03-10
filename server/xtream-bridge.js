// =============================================
// XTREAM UI BRIDGE - Conecta el reproductor Omnisync con Xtream UI
// NO modifica server/index.js — es un servidor independiente
// =============================================

const express = require('express');
const cors = require('cors');
const http = require('http');
const https = require('https');
const { spawn, execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json());

// =============================================
// CONFIGURACIÓN
// =============================================
const PORT = process.env.BRIDGE_PORT || 8080;
const XTREAM_HOST = process.env.XTREAM_HOST || 'http://localhost';
const XTREAM_PORT = process.env.XTREAM_PORT || '25461';
const SEGMENTS_DIR = '/tmp/omnisync-hls';

// Detect FFmpeg
let FFMPEG_AVAILABLE = false;
try {
  execSync('ffmpeg -version', { stdio: 'ignore' });
  FFMPEG_AVAILABLE = true;
  console.log('✅ FFmpeg detectado — transcodificación ABR habilitada');
} catch (e) {
  console.log('⚠️ FFmpeg no encontrado — solo calidad original disponible');
}

// Ensure segments directory
if (FFMPEG_AVAILABLE && !fs.existsSync(SEGMENTS_DIR)) {
  fs.mkdirSync(SEGMENTS_DIR, { recursive: true });
}

// =============================================
// SESIONES ACTIVAS
// =============================================
const activeSessions = new Map();

setInterval(() => {
  const fourHoursAgo = Date.now() - 4 * 60 * 60 * 1000;
  activeSessions.forEach((session, key) => {
    if (session.lastActivity < fourHoursAgo) {
      console.log(`🧹 Sesión expirada: ${key}`);
      activeSessions.delete(key);
    }
  });
}, 10 * 60 * 1000);

// =============================================
// TRANSCODING MANAGER
// =============================================
const activeTranscodes = new Map(); // "streamId_height" -> { process, startedAt, viewers }

// Cleanup idle transcodes every 30s
setInterval(() => {
  const now = Date.now();
  activeTranscodes.forEach((tc, key) => {
    // Kill transcodes idle for >60s (no viewers)
    if (tc.viewers <= 0 && now - tc.lastAccess > 60000) {
      console.log(`🧹 Transcode idle, matando: ${key}`);
      try { tc.process.kill('SIGTERM'); } catch (e) { /* */ }
      activeTranscodes.delete(key);
      try { fs.rmSync(path.join(SEGMENTS_DIR, key), { recursive: true, force: true }); } catch (e) { /* */ }
    }
  });
}, 30000);

// Quality profiles
const QUALITY_PROFILES = {
  '1080': { height: 1080, videoBitrate: '4500k', audioBitrate: '192k', label: '1080p' },
  '720':  { height: 720,  videoBitrate: '2500k', audioBitrate: '128k', label: '720p' },
  '480':  { height: 480,  videoBitrate: '1200k', audioBitrate: '96k',  label: '480p' },
  '360':  { height: 360,  videoBitrate: '600k',  audioBitrate: '64k',  label: '360p' },
};

function startTranscode(streamId, height, sourceUrl) {
  const key = `${streamId}_${height}`;
  if (activeTranscodes.has(key)) {
    const tc = activeTranscodes.get(key);
    tc.viewers++;
    tc.lastAccess = Date.now();
    return tc;
  }

  const profile = QUALITY_PROFILES[String(height)];
  if (!profile) return null;

  const segDir = path.join(SEGMENTS_DIR, key);
  if (!fs.existsSync(segDir)) fs.mkdirSync(segDir, { recursive: true });

  const playlistPath = path.join(segDir, 'index.m3u8');

  console.log(`🎬 Iniciando transcode: ${key} (${profile.label} @ ${profile.videoBitrate})`);

  const ffmpeg = spawn('ffmpeg', [
    '-re',
    '-i', sourceUrl,
    '-vf', `scale=-2:${height}`,
    '-c:v', 'libx264',
    '-preset', 'ultrafast',
    '-tune', 'zerolatency',
    '-b:v', profile.videoBitrate,
    '-maxrate', profile.videoBitrate,
    '-bufsize', `${parseInt(profile.videoBitrate) * 2}k`,
    '-g', '48',
    '-keyint_min', '48',
    '-sc_threshold', '0',
    '-c:a', 'aac',
    '-b:a', profile.audioBitrate,
    '-ac', '2',
    '-f', 'hls',
    '-hls_time', '4',
    '-hls_list_size', '5',
    '-hls_flags', 'delete_segments+append_list+independent_segments',
    '-hls_segment_filename', path.join(segDir, 'seg%05d.ts'),
    playlistPath,
  ], { stdio: ['ignore', 'pipe', 'pipe'] });

  ffmpeg.stderr.on('data', (data) => {
    const msg = data.toString();
    if (msg.includes('Error') || msg.includes('error')) {
      console.error(`FFmpeg [${key}]:`, msg.trim());
    }
  });

  const tc = {
    process: ffmpeg,
    startedAt: Date.now(),
    lastAccess: Date.now(),
    viewers: 1,
    playlistPath,
    segDir,
    ready: false,
  };

  // Watch for playlist creation
  const checkReady = setInterval(() => {
    if (fs.existsSync(playlistPath)) {
      tc.ready = true;
      clearInterval(checkReady);
    }
  }, 300);

  ffmpeg.on('close', (code) => {
    console.log(`FFmpeg [${key}] terminado (code ${code})`);
    clearInterval(checkReady);
    activeTranscodes.delete(key);
    try { fs.rmSync(segDir, { recursive: true, force: true }); } catch (e) { /* */ }
  });

  activeTranscodes.set(key, tc);
  return tc;
}

// =============================================
// HELPER: Llamar a la API de Xtream UI
// =============================================
function callXtreamAPI(params) {
  return new Promise((resolve, reject) => {
    const url = `${XTREAM_HOST}:${XTREAM_PORT}/player_api.php?${params}`;
    const client = url.startsWith('https') ? https : http;
    
    client.get(url, { timeout: 15000 }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          reject(new Error(`Xtream UI respondió con datos inválidos: ${data.substring(0, 200)}`));
        }
      });
    }).on('error', (err) => {
      reject(new Error(`No se pudo conectar a Xtream UI: ${err.message}`));
    });
  });
}

function getActiveCreds() {
  let latest = null;
  let latestTime = 0;
  for (const [username, session] of activeSessions) {
    if (session.lastActivity > latestTime) {
      latestTime = session.lastActivity;
      latest = { username, password: session.password };
    }
  }
  if (latest) return latest;
  if (process.env.XTREAM_USER && process.env.XTREAM_PASS) {
    return { username: process.env.XTREAM_USER, password: process.env.XTREAM_PASS };
  }
  return null;
}

// =============================================
// HEALTH CHECK
// =============================================
app.get('/api/health', async (req, res) => {
  try {
    await callXtreamAPI('username=test&password=test');
    res.json({ 
      status: 'ok', 
      mode: 'xtream-bridge',
      xtream_ui: 'connected',
      ffmpeg: FFMPEG_AVAILABLE,
      active_sessions: activeSessions.size,
      active_transcodes: activeTranscodes.size,
      port: PORT
    });
  } catch (err) {
    res.json({ 
      status: 'ok', 
      mode: 'xtream-bridge',
      xtream_ui: 'unreachable',
      ffmpeg: FFMPEG_AVAILABLE,
      error: err.message,
      port: PORT
    });
  }
});

// =============================================
// QUALITY INFO — el frontend pregunta qué calidades hay
// =============================================
app.get('/api/restream/:streamId/qualities', (req, res) => {
  const qualities = [{ id: 'original', label: 'Original', height: 0, bandwidth: 5000000 }];
  
  if (FFMPEG_AVAILABLE) {
    qualities.push(
      { id: '720', label: '720p', height: 720, bandwidth: 2500000 },
      { id: '480', label: '480p', height: 480, bandwidth: 1200000 },
      { id: '360', label: '360p', height: 360, bandwidth: 600000 },
    );
  }

  res.json(qualities);
});

// =============================================
// ABR MASTER PLAYLIST — genera m3u8 maestro
// =============================================
app.get('/api/restream/:streamId/abr.m3u8', (req, res) => {
  const { streamId } = req.params;
  
  let playlist = '#EXTM3U\n';
  
  // Original quality (highest priority)
  playlist += '#EXT-X-STREAM-INF:BANDWIDTH=5000000,RESOLUTION=1920x1080,NAME="Original"\n';
  playlist += `/api/restream/${streamId}/variant/original.m3u8\n`;
  
  if (FFMPEG_AVAILABLE) {
    playlist += '#EXT-X-STREAM-INF:BANDWIDTH=2500000,RESOLUTION=1280x720,NAME="720p"\n';
    playlist += `/api/restream/${streamId}/variant/720.m3u8\n`;
    playlist += '#EXT-X-STREAM-INF:BANDWIDTH=1200000,RESOLUTION=854x480,NAME="480p"\n';
    playlist += `/api/restream/${streamId}/variant/480.m3u8\n`;
    playlist += '#EXT-X-STREAM-INF:BANDWIDTH=600000,RESOLUTION=640x360,NAME="360p"\n';
    playlist += `/api/restream/${streamId}/variant/360.m3u8\n`;
  }
  
  res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
  res.setHeader('Cache-Control', 'no-cache, no-store');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.send(playlist);
});

// =============================================
// VARIANT: ORIGINAL — proxy del stream original
// =============================================
app.get('/api/restream/:streamId/variant/original.m3u8', (req, res) => {
  const { streamId } = req.params;
  const creds = getActiveCreds();
  if (!creds) return res.status(403).json({ error: 'No hay sesión activa' });

  if (activeSessions.has(creds.username)) {
    activeSessions.get(creds.username).lastActivity = Date.now();
  }

  const streamUrl = `${XTREAM_HOST}:${XTREAM_PORT}/live/${creds.username}/${creds.password}/${streamId}.m3u8`;
  const client = streamUrl.startsWith('https') ? https : http;

  const proxyReq = client.get(streamUrl, { timeout: 10000 }, (proxyRes) => {
    if (proxyRes.statusCode !== 200) {
      proxyRes.resume();
      // If m3u8 not available, create a simple live playlist wrapping the TS stream
      const tsPlaylist = `#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-TARGETDURATION:10\n#EXT-X-MEDIA-SEQUENCE:0\n#EXTINF:10.0,\n/api/restream/${streamId}/original-ts\n`;
      res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Access-Control-Allow-Origin', '*');
      return res.send(tsPlaylist);
    }

    let data = '';
    proxyRes.on('data', chunk => data += chunk);
    proxyRes.on('end', () => {
      if (data.trim().startsWith('#EXTM3U')) {
        const rewritten = rewriteM3U8(data, creds);
        res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
        res.setHeader('Cache-Control', 'no-cache, no-store');
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.send(rewritten);
      } else {
        // Not valid m3u8, serve TS wrapper
        const tsPlaylist = `#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-TARGETDURATION:10\n#EXT-X-MEDIA-SEQUENCE:0\n#EXTINF:10.0,\n/api/restream/${streamId}/original-ts\n`;
        res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.send(tsPlaylist);
      }
    });
  });

  proxyReq.on('error', () => {
    if (!res.headersSent) res.status(502).json({ error: 'Stream no disponible' });
  });

  req.on('close', () => proxyReq.destroy());
});

// Original TS passthrough (for when m3u8 isn't available)
app.get('/api/restream/:streamId/original-ts', (req, res) => {
  const { streamId } = req.params;
  const creds = getActiveCreds();
  if (!creds) return res.status(403).json({ error: 'No session' });

  proxyTsStream(streamId, creds, req, res);
});

// =============================================
// VARIANT: TRANSCODED — FFmpeg transcode a calidad específica
// =============================================
app.get('/api/restream/:streamId/variant/:height.m3u8', (req, res) => {
  const { streamId, height } = req.params;
  
  if (height === 'original') {
    // Redirect to original handler (shouldn't hit here but just in case)
    return res.redirect(`/api/restream/${streamId}/variant/original.m3u8`);
  }

  if (!FFMPEG_AVAILABLE) {
    return res.status(503).json({ error: 'FFmpeg no disponible para transcodificación' });
  }

  const creds = getActiveCreds();
  if (!creds) return res.status(403).json({ error: 'No hay sesión activa' });

  const heightNum = parseInt(height);
  if (!QUALITY_PROFILES[String(heightNum)]) {
    return res.status(400).json({ error: 'Perfil de calidad no válido' });
  }

  // Source URL from Xtream UI
  const sourceUrl = `${XTREAM_HOST}:${XTREAM_PORT}/live/${creds.username}/${creds.password}/${streamId}.ts`;

  const tc = startTranscode(streamId, heightNum, sourceUrl);
  if (!tc) {
    return res.status(500).json({ error: 'No se pudo iniciar transcodificación' });
  }

  // Wait for playlist to be ready
  const waitStart = Date.now();
  const waitForReady = setInterval(() => {
    if (tc.ready && fs.existsSync(tc.playlistPath)) {
      clearInterval(waitForReady);
      tc.lastAccess = Date.now();
      
      // Read and rewrite segment URLs
      const playlist = fs.readFileSync(tc.playlistPath, 'utf8');
      const key = `${streamId}_${heightNum}`;
      const rewritten = playlist.replace(
        /^(seg\d+\.ts)$/gm,
        `/api/restream/${streamId}/segments/${key}/$1`
      );
      
      res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
      res.setHeader('Cache-Control', 'no-cache, no-store');
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.send(rewritten);
    } else if (Date.now() - waitStart > 15000) {
      clearInterval(waitForReady);
      if (!res.headersSent) {
        res.status(503).json({ error: 'Transcodificación tardó demasiado en iniciar' });
      }
    }
  }, 500);

  req.on('close', () => {
    clearInterval(waitForReady);
    // Decrease viewer count
    if (tc) tc.viewers = Math.max(0, tc.viewers - 1);
  });
});

// Serve transcoded segments
app.get('/api/restream/:streamId/segments/:key/:file', (req, res) => {
  const { key, file } = req.params;
  
  // Validate file name to prevent path traversal
  if (!/^seg\d+\.ts$/.test(file)) {
    return res.status(400).json({ error: 'Archivo no válido' });
  }

  const filePath = path.join(SEGMENTS_DIR, key, file);
  
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'Segmento no encontrado' });
  }

  // Update last access
  if (activeTranscodes.has(key)) {
    activeTranscodes.get(key).lastAccess = Date.now();
  }

  res.setHeader('Content-Type', 'video/mp2t');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Access-Control-Allow-Origin', '*');
  fs.createReadStream(filePath).pipe(res);
});

// =============================================
// RESTREAM PRINCIPAL — ahora sirve ABR master o directo
// =============================================
app.get('/api/restream/:streamId', (req, res) => {
  const { streamId } = req.params;
  const format = req.query.format;
  const quality = req.query.quality; // 'original', '720', '480', '360'
  const creds = getActiveCreds();

  if (!creds) {
    return res.status(403).json({ error: 'No hay sesión activa. Inicia sesión de nuevo.' });
  }

  if (activeSessions.has(creds.username)) {
    activeSessions.get(creds.username).lastActivity = Date.now();
  }

  // If quality param specified, redirect to specific variant
  if (quality && quality !== 'auto') {
    if (quality === 'original') {
      return res.redirect(`/api/restream/${streamId}/variant/original.m3u8`);
    }
    if (FFMPEG_AVAILABLE && QUALITY_PROFILES[quality]) {
      return res.redirect(`/api/restream/${streamId}/variant/${quality}.m3u8`);
    }
  }

  // If format=ts requested, go straight to TS
  if (format === 'ts') {
    return proxyTsStream(streamId, creds, req, res);
  }

  // Default: serve ABR master playlist if FFmpeg available
  if (FFMPEG_AVAILABLE && format !== 'direct') {
    return res.redirect(`/api/restream/${streamId}/abr.m3u8`);
  }

  // Fallback: try m3u8 first, then TS
  const streamUrl = `${XTREAM_HOST}:${XTREAM_PORT}/live/${creds.username}/${creds.password}/${streamId}.m3u8`;
  const client = streamUrl.startsWith('https') ? https : http;
  
  const proxyReq = client.get(streamUrl, { timeout: 10000 }, (proxyRes) => {
    if (proxyRes.statusCode !== 200) {
      proxyRes.resume();
      console.log(`📺 Canal ${streamId}: m3u8 no disponible (${proxyRes.statusCode}), usando TS directo`);
      return proxyTsStream(streamId, creds, req, res);
    }

    let m3u8Data = '';
    proxyRes.on('data', chunk => m3u8Data += chunk);
    proxyRes.on('end', () => {
      if (m3u8Data.trim().startsWith('#EXTM3U')) {
        const rewritten = rewriteM3U8(m3u8Data, creds);
        res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
        res.setHeader('Cache-Control', 'no-cache, no-store');
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.send(rewritten);
      } else {
        console.log(`📺 Canal ${streamId}: respuesta no es m3u8, usando TS directo`);
        proxyTsStream(streamId, creds, req, res);
      }
    });
  });

  proxyReq.on('error', (err) => {
    console.error(`Stream proxy error [${streamId}]:`, err.message);
    proxyTsStream(streamId, creds, req, res);
  });

  req.on('close', () => proxyReq.destroy());
});

// Dedicated TS stream proxy
function proxyTsStream(streamId, creds, req, res) {
  const tsUrl = `${XTREAM_HOST}:${XTREAM_PORT}/live/${creds.username}/${creds.password}/${streamId}.ts`;
  const client = tsUrl.startsWith('https') ? https : http;
  
  console.log(`📡 Proxy TS: ${streamId}`);
  
  const tsReq = client.get(tsUrl, { 
    timeout: 0,
    headers: { 'Connection': 'keep-alive' }
  }, (tsRes) => {
    if (tsRes.statusCode !== 200) {
      console.error(`TS error [${streamId}]: status ${tsRes.statusCode}`);
      if (!res.headersSent) {
        res.status(502).json({ error: 'Stream no disponible en ningún formato' });
      }
      return;
    }
    
    res.writeHead(200, {
      'Content-Type': 'video/mp2t',
      'Cache-Control': 'no-cache, no-store',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': '*',
      'Connection': 'keep-alive',
      'Transfer-Encoding': 'chunked',
    });
    
    tsRes.pipe(res);
    tsRes.on('error', (err) => console.error(`TS stream error [${streamId}]:`, err.message));
  });
  
  tsReq.on('error', (err) => {
    console.error(`TS proxy error [${streamId}]:`, err.message);
    if (!res.headersSent) res.status(502).json({ error: 'Stream no disponible' });
  });
  
  req.on('close', () => tsReq.destroy());
}

// Helper: reescribir URLs en m3u8
function rewriteM3U8(data, creds) {
  return data.replace(
    /^(?!#)(https?:\/\/[^\s]+|[^\s]+\.ts[^\s]*|[^\s]+\.m3u8[^\s]*)/gm,
    (match) => {
      if (match.startsWith('http')) {
        return `/api/stream-proxy?url=${encodeURIComponent(match)}`;
      }
      if (match.startsWith('/')) {
        return `/api/stream-proxy?url=${encodeURIComponent(`${XTREAM_HOST}:${XTREAM_PORT}${match}`)}`;
      }
      const base = `${XTREAM_HOST}:${XTREAM_PORT}/live/${creds.username}/${creds.password}/`;
      return `/api/stream-proxy?url=${encodeURIComponent(base + match)}`;
    }
  );
}

// Proxy genérico para segmentos .ts y sub-manifiestos
app.get('/api/stream-proxy', (req, res) => {
  const targetUrl = req.query.url;
  if (!targetUrl) return res.status(400).json({ error: 'URL requerida' });

  const creds = getActiveCreds();
  if (creds && activeSessions.has(creds.username)) {
    activeSessions.get(creds.username).lastActivity = Date.now();
  }

  const client = targetUrl.startsWith('https') ? https : http;
  
  const proxyReq = client.get(targetUrl, { timeout: 30000 }, (proxyRes) => {
    const contentType = proxyRes.headers['content-type'] || 
      (targetUrl.includes('.m3u8') ? 'application/vnd.apple.mpegurl' : 'video/mp2t');
    
    if (targetUrl.includes('.m3u8')) {
      let data = '';
      proxyRes.on('data', chunk => data += chunk);
      proxyRes.on('end', () => {
        const activeCreds = getActiveCreds();
        const rewritten = data.replace(
          /^(?!#)(https?:\/\/[^\s]+|[^\s]+\.ts[^\s]*|[^\s]+\.m3u8[^\s]*)/gm,
          (match) => {
            if (match.startsWith('http')) {
              return `/api/stream-proxy?url=${encodeURIComponent(match)}`;
            }
            if (match.startsWith('/')) {
              return `/api/stream-proxy?url=${encodeURIComponent(`${XTREAM_HOST}:${XTREAM_PORT}${match}`)}`;
            }
            const baseUrl = targetUrl.substring(0, targetUrl.lastIndexOf('/') + 1);
            return `/api/stream-proxy?url=${encodeURIComponent(baseUrl + match)}`;
          }
        );
        res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
        res.setHeader('Cache-Control', 'no-cache, no-store');
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.send(rewritten);
      });
      return;
    }

    res.writeHead(proxyRes.statusCode, {
      'Content-Type': contentType,
      'Cache-Control': 'no-cache',
      'Access-Control-Allow-Origin': '*',
      'Connection': 'keep-alive',
    });
    proxyRes.pipe(res);
  });

  proxyReq.on('error', (err) => {
    console.error('Stream proxy error:', err.message);
    if (!res.headersSent) res.status(502).json({ error: 'Error de proxy' });
  });

  req.on('close', () => proxyReq.destroy());
});

// =============================================
// LOGIN DE CLIENTES
// =============================================
app.post('/api/client/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) {
      return res.status(400).json({ error: 'Usuario y contraseña requeridos' });
    }

    const authData = await callXtreamAPI(
      `username=${encodeURIComponent(username)}&password=${encodeURIComponent(password)}`
    );

    if (!authData.user_info) {
      return res.status(401).json({ error: 'Credenciales inválidas' });
    }

    const userInfo = authData.user_info;

    if (userInfo.status !== 'Active') {
      return res.status(403).json({ error: 'Cuenta suspendida' });
    }

    if (userInfo.exp_date && userInfo.exp_date !== 'Unlimited') {
      const expiry = new Date(parseInt(userInfo.exp_date) * 1000);
      if (expiry < new Date()) {
        return res.status(403).json({ error: 'Suscripción expirada' });
      }
    }

    const liveData = await callXtreamAPI(
      `username=${encodeURIComponent(username)}&password=${encodeURIComponent(password)}&action=get_live_streams`
    );

    const catData = await callXtreamAPI(
      `username=${encodeURIComponent(username)}&password=${encodeURIComponent(password)}&action=get_live_categories`
    );

    const catMap = {};
    if (Array.isArray(catData)) {
      catData.forEach(cat => { catMap[cat.category_id] = cat.category_name; });
    }

    const channels = (Array.isArray(liveData) ? liveData : []).map((ch, idx) => ({
      id: String(ch.stream_id),
      name: ch.name || 'Sin nombre',
      url: `/api/restream/${ch.stream_id}`,
      category: catMap[ch.category_id] || 'General',
      logo_url: ch.stream_icon || null,
      sort_order: ch.num || idx,
      _xtream_stream_id: ch.stream_id,
      _xtream_ext: ch.container_extension || 'ts',
    }));

    let expiryDate = '2099-12-31';
    if (userInfo.exp_date && userInfo.exp_date !== 'Unlimited') {
      expiryDate = new Date(parseInt(userInfo.exp_date) * 1000).toISOString().split('T')[0];
    }

    activeSessions.set(username, {
      password,
      channels: liveData || [],
      loginAt: Date.now(),
      lastActivity: Date.now(),
    });

    console.log(`✅ Login: ${username} (${channels.length} canales, FFmpeg: ${FFMPEG_AVAILABLE})`);

    res.json({
      client: {
        id: String(userInfo.username),
        username: userInfo.username,
        max_screens: parseInt(userInfo.max_connections) || 1,
        expiry_date: expiryDate,
        vod_enabled: true,
      },
      channels,
      ads: [],
      stream_base_url: null,
      ffmpeg_available: FFMPEG_AVAILABLE,
    });

  } catch (err) {
    console.error('Login error:', err.message);
    res.status(500).json({ error: 'Error conectando con el servidor de streams' });
  }
});

// =============================================
// HEARTBEAT
// =============================================
app.post('/api/client/heartbeat', (req, res) => {
  const { username } = req.body;
  if (username && activeSessions.has(username)) {
    activeSessions.get(username).lastActivity = Date.now();
  } else {
    activeSessions.forEach(session => { session.lastActivity = Date.now(); });
  }
  res.json({ ok: true });
});

// =============================================
// VOD
// =============================================
app.get('/api/vod/public', async (req, res) => {
  const creds = getActiveCreds();
  if (!creds) return res.json([]);

  try {
    const vodData = await callXtreamAPI(
      `username=${encodeURIComponent(creds.username)}&password=${encodeURIComponent(creds.password)}&action=get_vod_streams`
    );

    const items = (Array.isArray(vodData) ? vodData : []).map(v => ({
      id: String(v.stream_id),
      title: v.name || 'Sin título',
      description: v.plot || null,
      category: v.category_name || 'General',
      poster_url: v.stream_icon || null,
      duration_minutes: v.duration ? Math.round(parseInt(v.duration) / 60) : null,
    }));

    res.json(items);
  } catch (err) {
    console.error('VOD fetch error:', err.message);
    res.json([]);
  }
});

// =============================================
// SERIES
// =============================================
app.get('/api/vod/series/public', async (req, res) => {
  const creds = getActiveCreds();
  if (!creds) return res.json([]);

  try {
    const seriesData = await callXtreamAPI(
      `username=${encodeURIComponent(creds.username)}&password=${encodeURIComponent(creds.password)}&action=get_series`
    );

    const items = (Array.isArray(seriesData) ? seriesData : []).map(s => ({
      id: String(s.series_id),
      title: s.name || 'Sin título',
      description: s.plot || null,
      category: s.category || 'General',
      poster_url: s.cover || null,
    }));

    res.json(items);
  } catch (err) {
    console.error('Series fetch error:', err.message);
    res.json([]);
  }
});

// =============================================
// CANALES PÚBLICOS
// =============================================
app.get('/api/channels/public', async (req, res) => {
  const creds = getActiveCreds();
  if (!creds) return res.json([]);

  try {
    const liveData = await callXtreamAPI(
      `username=${encodeURIComponent(creds.username)}&password=${encodeURIComponent(creds.password)}&action=get_live_streams`
    );

    const catData = await callXtreamAPI(
      `username=${encodeURIComponent(creds.username)}&password=${encodeURIComponent(creds.password)}&action=get_live_categories`
    );

    const catMap = {};
    if (Array.isArray(catData)) {
      catData.forEach(cat => { catMap[cat.category_id] = cat.category_name; });
    }

    const channels = (Array.isArray(liveData) ? liveData : []).map((ch, idx) => ({
      id: String(ch.stream_id),
      name: ch.name || 'Sin nombre',
      url: `/api/restream/${ch.stream_id}`,
      category: catMap[ch.category_id] || 'General',
      logo_url: ch.stream_icon || null,
      sort_order: ch.num || idx,
    }));

    res.json(channels);
  } catch (err) {
    res.json([]);
  }
});

// =============================================
// ADS & ERROR REPORT
// =============================================
app.get('/api/ads/public', (req, res) => res.json([]));

app.post('/api/channel/report-error', (req, res) => {
  const { channel_id, error_message, username } = req.body;
  console.log(`⚠️ Error canal ${channel_id}: ${error_message} (${username})`);
  res.json({ ok: true });
});

// =============================================
// INICIAR SERVIDOR
// =============================================
app.listen(PORT, '0.0.0.0', () => {
  console.log(`\n🎬 Omnisync Bridge en http://0.0.0.0:${PORT}`);
  console.log(`🔗 Xtream UI: ${XTREAM_HOST}:${XTREAM_PORT}`);
  console.log(`🎬 FFmpeg ABR: ${FFMPEG_AVAILABLE ? 'HABILITADO (720p, 480p, 360p)' : 'DESHABILITADO'}`);
  console.log(`📺 Reproductor: http://TU_IP:${PORT}\n`);
});
