// =============================================
// XTREAM UI BRIDGE - Conecta el reproductor Omnisync con Xtream UI
// NO modifica server/index.js — es un servidor independiente
// =============================================

const express = require('express');
const cors = require('cors');
const http = require('http');
const https = require('https');

const app = express();
app.use(cors());
app.use(express.json());

// =============================================
// CONFIGURACIÓN
// =============================================
const PORT = process.env.BRIDGE_PORT || 8080;
const XTREAM_HOST = process.env.XTREAM_HOST || 'http://localhost';
const XTREAM_PORT = process.env.XTREAM_PORT || '25461';

// =============================================
// SESIONES ACTIVAS (para proxy de streams)
// =============================================
const activeSessions = new Map(); // username -> { password, channels, loginAt, lastActivity }

// Limpiar sesiones inactivas cada 10 minutos (solo las que llevan >4h sin actividad)
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

// =============================================
// HELPER: Obtener credenciales de sesión activa
// =============================================
function getActiveCreds() {
  // Buscar la sesión más reciente
  let latest = null;
  let latestTime = 0;
  for (const [username, session] of activeSessions) {
    if (session.lastActivity > latestTime) {
      latestTime = session.lastActivity;
      latest = { username, password: session.password };
    }
  }
  if (latest) return latest;
  
  // Fallback: credenciales de env
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
      active_sessions: activeSessions.size,
      port: PORT
    });
  } catch (err) {
    res.json({ 
      status: 'ok', 
      mode: 'xtream-bridge',
      xtream_ui: 'unreachable',
      error: err.message,
      port: PORT
    });
  }
});

// =============================================
// LOGIN DE CLIENTES — Autentica contra Xtream UI
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

    // Guardar sesión — se renueva con cada heartbeat
    activeSessions.set(username, {
      password,
      channels: liveData || [],
      loginAt: Date.now(),
      lastActivity: Date.now(),
    });

    console.log(`✅ Login: ${username} (${channels.length} canales)`);

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
    });

  } catch (err) {
    console.error('Login error:', err.message);
    res.status(500).json({ error: 'Error conectando con el servidor de streams' });
  }
});

// =============================================
// HEARTBEAT — Renueva la sesión activa
// =============================================
app.post('/api/client/heartbeat', (req, res) => {
  const { username } = req.body;
  
  // Renovar la sesión si existe
  if (username && activeSessions.has(username)) {
    const session = activeSessions.get(username);
    session.lastActivity = Date.now();
  } else {
    // Renovar todas las sesiones activas (fallback)
    activeSessions.forEach(session => {
      session.lastActivity = Date.now();
    });
  }
  
  res.json({ ok: true });
});

// =============================================
// PROXY DE STREAMS — Oculta IP de Xtream UI
// =============================================

app.get('/api/restream/:streamId', (req, res) => {
  const { streamId } = req.params;
  const creds = getActiveCreds();

  if (!creds) {
    return res.status(403).json({ error: 'No hay sesión activa. Inicia sesión de nuevo.' });
  }

  // Renovar actividad de la sesión con cada petición de stream
  if (activeSessions.has(creds.username)) {
    activeSessions.get(creds.username).lastActivity = Date.now();
  }

  const streamUrl = `${XTREAM_HOST}:${XTREAM_PORT}/live/${creds.username}/${creds.password}/${streamId}.m3u8`;
  const client = streamUrl.startsWith('https') ? https : http;
  
  const proxyReq = client.get(streamUrl, { timeout: 20000 }, (proxyRes) => {
    if (proxyRes.statusCode !== 200) {
      // Fallback: .ts directo
      const tsUrl = `${XTREAM_HOST}:${XTREAM_PORT}/live/${creds.username}/${creds.password}/${streamId}.ts`;
      const tsReq = client.get(tsUrl, { timeout: 60000 }, (tsRes) => {
        res.writeHead(tsRes.statusCode, {
          'Content-Type': 'video/mp2t',
          'Cache-Control': 'no-cache',
          'Access-Control-Allow-Origin': '*',
          'Connection': 'keep-alive',
        });
        tsRes.pipe(res);
      });
      tsReq.on('error', (err) => {
        console.error(`TS proxy error [${streamId}]:`, err.message);
        if (!res.headersSent) res.status(502).json({ error: 'Stream no disponible' });
      });
      req.on('close', () => tsReq.destroy());
      return;
    }

    // Leer m3u8 y reescribir URLs
    let m3u8Data = '';
    proxyRes.on('data', chunk => m3u8Data += chunk);
    proxyRes.on('end', () => {
      const rewritten = rewriteM3U8(m3u8Data, creds);
      res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
      res.setHeader('Cache-Control', 'no-cache, no-store');
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.send(rewritten);
    });
  });

  proxyReq.on('error', (err) => {
    console.error(`Stream proxy error [${streamId}]:`, err.message);
    if (!res.headersSent) {
      res.status(502).json({ error: 'Error al conectar con el stream' });
    }
  });

  req.on('close', () => proxyReq.destroy());
});

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

  // Renovar sesión con cada segmento
  const creds = getActiveCreds();
  if (creds && activeSessions.has(creds.username)) {
    activeSessions.get(creds.username).lastActivity = Date.now();
  }

  const client = targetUrl.startsWith('https') ? https : http;
  
  const proxyReq = client.get(targetUrl, { timeout: 30000 }, (proxyRes) => {
    const contentType = proxyRes.headers['content-type'] || 
      (targetUrl.includes('.m3u8') ? 'application/vnd.apple.mpegurl' : 'video/mp2t');
    
    // Si es m3u8, reescribir URLs internas
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

    // Segmentos .ts → pipe directo con headers mejorados
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
// VOD — Obtener películas de Xtream UI
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
  console.log(`📺 Reproductor: http://TU_IP:${PORT}\n`);
});
