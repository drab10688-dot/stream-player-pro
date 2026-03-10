// =============================================
// XTREAM UI BRIDGE - Conecta el reproductor Omnisync con Xtream UI
// NO modifica server/index.js — es un servidor independiente
// Puerto: 8080 (o el que configures)
// =============================================

const express = require('express');
const cors = require('cors');
const http = require('http');
const https = require('https');
const path = require('path');
const fs = require('fs');
const { spawn, execSync } = require('child_process');

const app = express();
app.use(cors());
app.use(express.json());

// =============================================
// CONFIGURACIÓN
// =============================================
const PORT = process.env.BRIDGE_PORT || 8080;
const XTREAM_HOST = process.env.XTREAM_HOST || 'http://localhost';
const XTREAM_PORT = process.env.XTREAM_PORT || '25461'; // Puerto donde Xtream UI sirve streams

// =============================================
// HELPER: Llamar a la API de Xtream UI
// =============================================
function callXtreamAPI(params) {
  return new Promise((resolve, reject) => {
    const url = `${XTREAM_HOST}:${XTREAM_PORT}/player_api.php?${params}`;
    const client = url.startsWith('https') ? https : http;
    
    client.get(url, { timeout: 10000 }, (res) => {
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
// HEALTH CHECK
// =============================================
app.get('/api/health', async (req, res) => {
  try {
    // Verificar que Xtream UI responde
    const test = await callXtreamAPI('username=test&password=test');
    res.json({ 
      status: 'ok', 
      mode: 'xtream-bridge',
      xtream_ui: 'connected',
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

    // 1. Autenticar contra Xtream UI
    const authData = await callXtreamAPI(
      `username=${encodeURIComponent(username)}&password=${encodeURIComponent(password)}`
    );

    // Xtream UI devuelve user_info si las credenciales son válidas
    if (!authData.user_info) {
      return res.status(401).json({ error: 'Credenciales inválidas' });
    }

    const userInfo = authData.user_info;

    // Verificar que la cuenta esté activa
    if (userInfo.status !== 'Active') {
      return res.status(403).json({ error: 'Cuenta suspendida' });
    }

    // Verificar expiración
    if (userInfo.exp_date && userInfo.exp_date !== 'Unlimited') {
      const expiry = new Date(parseInt(userInfo.exp_date) * 1000);
      if (expiry < new Date()) {
        return res.status(403).json({ error: 'Suscripción expirada' });
      }
    }

    // 2. Obtener canales (live streams)
    const liveData = await callXtreamAPI(
      `username=${encodeURIComponent(username)}&password=${encodeURIComponent(password)}&action=get_live_streams`
    );

    // 3. Obtener categorías
    const catData = await callXtreamAPI(
      `username=${encodeURIComponent(username)}&password=${encodeURIComponent(password)}&action=get_live_categories`
    );

    // Mapear categorías por ID
    const catMap = {};
    if (Array.isArray(catData)) {
      catData.forEach(cat => {
        catMap[cat.category_id] = cat.category_name;
      });
    }

    // 4. Mapear canales al formato de Omnisync
    const channels = (Array.isArray(liveData) ? liveData : []).map((ch, idx) => ({
      id: String(ch.stream_id),
      name: ch.name || 'Sin nombre',
      // El stream se sirve via proxy local para ocultar IP origen
      url: `/api/restream/${ch.stream_id}`,
      category: catMap[ch.category_id] || 'General',
      logo_url: ch.stream_icon || null,
      sort_order: ch.num || idx,
      // Guardar datos internos para el proxy
      _xtream_stream_id: ch.stream_id,
      _xtream_ext: ch.container_extension || 'ts',
    }));

    // 5. Calcular fecha de expiración
    let expiryDate = '2099-12-31';
    if (userInfo.exp_date && userInfo.exp_date !== 'Unlimited') {
      expiryDate = new Date(parseInt(userInfo.exp_date) * 1000).toISOString().split('T')[0];
    }

    // 6. Guardar sesión internamente para el proxy de streams
    activeSessions.set(username, {
      password,
      channels: liveData || [],
      loginAt: Date.now(),
    });

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
// SESIONES ACTIVAS (para proxy de streams)
// =============================================
const activeSessions = new Map(); // username -> { password, channels, loginAt }

// Limpiar sesiones viejas cada 30 minutos
setInterval(() => {
  const thirtyMinAgo = Date.now() - 30 * 60 * 1000;
  activeSessions.forEach((session, key) => {
    if (session.loginAt < thirtyMinAgo) activeSessions.delete(key);
  });
}, 30 * 60 * 1000);

// =============================================
// HEARTBEAT (mantener sesión activa)
// =============================================
app.post('/api/client/heartbeat', (req, res) => {
  res.json({ ok: true });
});

// =============================================
// HELPER: Obtener credenciales de sesión activa
// =============================================
function getActiveCreds() {
  for (const [username, session] of activeSessions) {
    return { username, password: session.password };
  }
  return null;
}

// =============================================
// PROXY DE STREAMS — Oculta IP de Xtream UI
// Sirve HLS (m3u8) reescribiendo URLs internas
// =============================================

// Proxy del manifiesto m3u8 (reescribe URLs para que pasen por nuestro proxy)
app.get('/api/restream/:streamId', (req, res) => {
  const { streamId } = req.params;
  const creds = getActiveCreds();

  if (!creds) {
    return res.status(403).json({ error: 'No hay sesión activa' });
  }

  // Pedir m3u8 a Xtream UI
  const streamUrl = `${XTREAM_HOST}:${XTREAM_PORT}/live/${creds.username}/${creds.password}/${streamId}.m3u8`;
  
  const client = streamUrl.startsWith('https') ? https : http;
  
  const proxyReq = client.get(streamUrl, { timeout: 15000 }, (proxyRes) => {
    if (proxyRes.statusCode !== 200) {
      // Fallback: intentar .ts directo si m3u8 no existe
      const tsUrl = `${XTREAM_HOST}:${XTREAM_PORT}/live/${creds.username}/${creds.password}/${streamId}.ts`;
      const tsReq = client.get(tsUrl, { timeout: 30000 }, (tsRes) => {
        res.writeHead(tsRes.statusCode, {
          'Content-Type': 'video/mp2t',
          'Cache-Control': 'no-cache',
          'Access-Control-Allow-Origin': '*',
        });
        tsRes.pipe(res);
      });
      tsReq.on('error', (err) => {
        if (!res.headersSent) res.status(502).json({ error: 'Stream no disponible' });
      });
      req.on('close', () => tsReq.destroy());
      return;
    }

    // Leer el m3u8 completo para reescribir URLs
    let m3u8Data = '';
    proxyRes.on('data', chunk => m3u8Data += chunk);
    proxyRes.on('end', () => {
      // Reescribir URLs absolutas/relativas para que pasen por nuestro proxy
      const rewritten = m3u8Data.replace(
        /^(?!#)(https?:\/\/[^\s]+|[^\s]+\.ts[^\s]*|[^\s]+\.m3u8[^\s]*)/gm,
        (match) => {
          if (match.startsWith('http')) {
            return `/api/stream-proxy?url=${encodeURIComponent(match)}`;
          }
          // Path absoluto (empieza con /) → usar host+port directamente
          if (match.startsWith('/')) {
            return `/api/stream-proxy?url=${encodeURIComponent(`${XTREAM_HOST}:${XTREAM_PORT}${match}`)}`;
          }
          // Path relativo → construir desde base
          const base = `${XTREAM_HOST}:${XTREAM_PORT}/live/${creds.username}/${creds.password}/`;
          return `/api/stream-proxy?url=${encodeURIComponent(base + match)}`;
        }
      );

      res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
      res.setHeader('Cache-Control', 'no-cache');
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

// Proxy genérico para segmentos .ts y sub-manifiestos
app.get('/api/stream-proxy', (req, res) => {
  const targetUrl = req.query.url;
  if (!targetUrl) return res.status(400).json({ error: 'URL requerida' });

  const client = targetUrl.startsWith('https') ? https : http;
  
  const proxyReq = client.get(targetUrl, { timeout: 15000 }, (proxyRes) => {
    const contentType = proxyRes.headers['content-type'] || 
      (targetUrl.includes('.m3u8') ? 'application/vnd.apple.mpegurl' : 'video/mp2t');
    
    // Si es m3u8, reescribir URLs internas también
    if (targetUrl.includes('.m3u8')) {
      let data = '';
      proxyRes.on('data', chunk => data += chunk);
      proxyRes.on('end', () => {
        const creds = getActiveCreds();
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
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.send(rewritten);
      });
      return;
    }

    // Segmentos .ts → pipe directo
    res.writeHead(proxyRes.statusCode, {
      'Content-Type': contentType,
      'Cache-Control': 'no-cache',
      'Access-Control-Allow-Origin': '*',
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
  // Buscar credenciales activas
  let creds = null;
  for (const [username, session] of activeSessions) {
    creds = { username, password: session.password };
    break;
  }

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
// SERIES — Obtener series de Xtream UI  
// =============================================
app.get('/api/vod/series/public', async (req, res) => {
  let creds = null;
  for (const [username, session] of activeSessions) {
    creds = { username, password: session.password };
    break;
  }

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
// CANALES PÚBLICOS (para refresh después del login)
// =============================================
app.get('/api/channels/public', async (req, res) => {
  let creds = null;
  for (const [username, session] of activeSessions) {
    creds = { username, password: session.password };
    break;
  }

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
// ADS (vacío en modo bridge)
// =============================================
app.get('/api/ads/public', (req, res) => res.json([]));

// =============================================
// REPORT ERROR (log solamente)
// =============================================
app.post('/api/channel/report-error', (req, res) => {
  const { channel_id, error_message, username } = req.body;
  console.log(`⚠️ Error reportado por ${username} en canal ${channel_id}: ${error_message}`);
  res.json({ ok: true });
});

// =============================================
// INICIAR SERVIDOR
// =============================================
app.listen(PORT, '0.0.0.0', () => {
  console.log(`\n🎬 Omnisync Player Bridge corriendo en http://0.0.0.0:${PORT}`);
  console.log(`🔗 Conectado a Xtream UI en ${XTREAM_HOST}:${XTREAM_PORT}`);
  console.log(`📺 Reproductor: http://TU_IP:${PORT}`);
  console.log(`🌐 Cloudflare Tunnel: cloudflared tunnel --url http://localhost:${PORT}\n`);
});
