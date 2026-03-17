const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const http = require('http');
const https = require('https');
const { URL } = require('url');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const crypto = require('crypto');
const { spawn } = require('child_process');

const app = express();
app.use(cors());
app.use(express.json());

// Aumentar timeout para uploads grandes (30 minutos)
app.use((req, res, next) => {
  if (req.path.startsWith('/api/vod')) {
    req.setTimeout(30 * 60 * 1000);
    res.setTimeout(30 * 60 * 1000);
  }
  next();
});

// Helper: obtener IP real del cliente (soporta proxies/tunnels)
const getClientIP = (req) => {
  return req.headers['cf-connecting-ip'] 
    || req.headers['x-real-ip'] 
    || req.headers['x-forwarded-for']?.split(',')[0]?.trim() 
    || req.connection?.remoteAddress 
    || req.ip;
};

// Helper: geolocalizar IP usando ip-api.com (gratis, 45 req/min)
const geoCache = new Map();
const geoLookup = async (ip) => {
  if (!ip || ip === '127.0.0.1' || ip === '::1' || ip.startsWith('192.168.') || ip.startsWith('10.')) {
    return { country: 'Local', city: 'LAN' };
  }
  if (geoCache.has(ip)) return geoCache.get(ip);
  try {
    const res = await new Promise((resolve, reject) => {
      http.get(`http://ip-api.com/json/${ip}?fields=country,city,status`, (resp) => {
        let data = '';
        resp.on('data', chunk => data += chunk);
        resp.on('end', () => resolve(JSON.parse(data)));
      }).on('error', reject);
    });
    const result = res.status === 'success' ? { country: res.country, city: res.city } : { country: 'Desconocido', city: '' };
    geoCache.set(ip, result);
    // Limpiar caché cada 1 hora
    setTimeout(() => geoCache.delete(ip), 3600000);
    return result;
  } catch {
    return { country: 'Desconocido', city: '' };
  }
};

// Servir logos estáticos
const LOGOS_DIR = path.join(__dirname, 'uploads', 'logos');
if (!fs.existsSync(LOGOS_DIR)) fs.mkdirSync(LOGOS_DIR, { recursive: true });
app.use('/uploads/logos', express.static(LOGOS_DIR));

// Multer config for logo uploads
const logoStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, LOGOS_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname) || '.png';
    cb(null, `${Date.now()}-${Math.random().toString(36).substring(2, 8)}${ext}`);
  }
});
const uploadLogo = multer({ storage: logoStorage, limits: { fileSize: 2 * 1024 * 1024 }, fileFilter: (req, file, cb) => {
  if (file.mimetype.startsWith('image/')) cb(null, true);
  else cb(new Error('Solo se permiten imágenes'));
}});

// =============================================
// CONFIGURACIÓN - Cambiar según tu servidor
// =============================================
const JWT_SECRET = 'cambia-este-secreto-por-uno-seguro-abc123';
const PORT = 3001;

const pool = new Pool({
  host: 'localhost',
  port: 5432,
  database: 'streambox',
  user: 'streambox_user',
  password: 'tu_password_seguro',
});

// Verificar conexión a la base de datos al iniciar
pool.query('SELECT 1')
  .then(() => console.log('✅ Conectado a PostgreSQL'))
  .catch(err => {
    console.error('❌ ERROR: No se pudo conectar a PostgreSQL:', err.message);
    console.error('   Verifica que PostgreSQL esté corriendo y las credenciales sean correctas');
  });

// =============================================
// HEALTH CHECK - para diagnóstico
// =============================================
app.get('/api/health', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ status: 'ok', db: 'connected', uptime: process.uptime() });
  } catch (err) {
    res.status(500).json({ status: 'error', db: 'disconnected', error: err.message });
  }
});

// =============================================
// MIDDLEWARE: Verificar token de admin
// =============================================
const authAdmin = async (req, res, next) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'Token requerido' });

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const { rows } = await pool.query('SELECT id, email FROM admins WHERE id = $1', [decoded.id]);
    if (rows.length === 0) return res.status(401).json({ error: 'Admin no encontrado' });
    req.admin = rows[0];
    next();
  } catch {
    res.status(401).json({ error: 'Token inválido' });
  }
};

// =============================================
// RUTAS: ADMIN AUTH
// =============================================

// Crear primer admin (solo funciona si no hay admins)
app.post('/api/admin/setup', async (req, res) => {
  try {
    const { rows: existing } = await pool.query('SELECT id FROM admins LIMIT 1');
    if (existing.length > 0) return res.status(403).json({ error: 'Ya existe un admin' });

    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email y password requeridos' });

    const hash = await bcrypt.hash(password, 10);
    const { rows } = await pool.query(
      'INSERT INTO admins (email, password_hash) VALUES ($1, $2) RETURNING id, email',
      [email, hash]
    );

    const token = jwt.sign({ id: rows[0].id }, JWT_SECRET, { expiresIn: '24h' });
    res.json({ admin: rows[0], token });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Login admin
app.post('/api/admin/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const { rows } = await pool.query('SELECT * FROM admins WHERE email = $1', [email]);
    if (rows.length === 0) return res.status(401).json({ error: 'Credenciales inválidas' });

    const valid = await bcrypt.compare(password, rows[0].password_hash);
    if (!valid) return res.status(401).json({ error: 'Credenciales inválidas' });

    const token = jwt.sign({ id: rows[0].id }, JWT_SECRET, { expiresIn: '24h' });
    res.json({ admin: { id: rows[0].id, email: rows[0].email }, token });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// =============================================
// RUTAS: CANALES (requiere admin)
// =============================================
app.get('/api/channels', authAdmin, async (req, res) => {
  // Admin SÍ ve las URLs reales para poder editarlas
  const { rows } = await pool.query('SELECT * FROM channels ORDER BY sort_order');
  res.json(rows);
});

// Ping de canales con auto-gestión (requiere admin)
const FAILURE_THRESHOLD = 3;

// =============================================
// AUTO-PING SERVER-SIDE (persiste sin sesión)
// =============================================
let autoPingInterval = null;
let autoPingRunning = false;
let autoPingIntervalMs = 5 * 60 * 1000; // 5 minutos por defecto
let lastAutoPingResult = null;

async function runAutoPing() {
  try {
    const { rows: channels } = await pool.query(
      'SELECT id, name, url, category, logo_url, is_active, auto_disabled, consecutive_failures FROM channels WHERE is_active = true OR auto_disabled = true'
    );

    const results = await Promise.all(channels.map(async (ch) => {
      const start = Date.now();
      try {
        const isYouTube = /youtube\.com|youtu\.be/.test(ch.url);
        if (isYouTube) {
          return { id: ch.id, name: ch.name, status: 'online', consecutive_failures: ch.consecutive_failures, was_auto_disabled: ch.auto_disabled };
        }
        const parsedUrl = new URL(ch.url);
        const httpClient = parsedUrl.protocol === 'https:' ? https : http;
        const result = await new Promise((resolve) => {
          const req = httpClient.request(ch.url, { method: 'GET', headers: { 'User-Agent': 'StreamBox-HealthCheck/1.0', 'Range': 'bytes=0-1024' } }, (response) => {
            response.destroy();
            const isOk = response.statusCode >= 200 && response.statusCode < 400;
            resolve({ id: ch.id, name: ch.name, status: isOk ? 'online' : 'offline', consecutive_failures: ch.consecutive_failures, was_auto_disabled: ch.auto_disabled, error: isOk ? null : `HTTP ${response.statusCode}` });
          });
          req.on('error', (err) => resolve({ id: ch.id, name: ch.name, status: 'offline', consecutive_failures: ch.consecutive_failures, was_auto_disabled: ch.auto_disabled, error: err.message }));
          req.setTimeout(10000, () => { req.destroy(); resolve({ id: ch.id, name: ch.name, status: 'offline', consecutive_failures: ch.consecutive_failures, was_auto_disabled: ch.auto_disabled, error: 'Timeout' }); });
          req.end();
        });
        return result;
      } catch (err) {
        return { id: ch.id, name: ch.name, status: 'offline', consecutive_failures: ch.consecutive_failures, was_auto_disabled: ch.auto_disabled, error: err.message };
      }
    }));

    // Auto-manage
    const disabled = [];
    const reactivated = [];
    for (const r of results) {
      if (r.status === 'offline') {
        const newFailures = (r.consecutive_failures || 0) + 1;
        if (newFailures >= FAILURE_THRESHOLD) {
          await pool.query('UPDATE channels SET consecutive_failures = $1, is_active = false, auto_disabled = true, last_checked_at = now() WHERE id = $2', [newFailures, r.id]);
          disabled.push(r.name);
        } else {
          await pool.query('UPDATE channels SET consecutive_failures = $1, last_checked_at = now() WHERE id = $2', [newFailures, r.id]);
        }
      } else if (r.status === 'online') {
        if (r.was_auto_disabled) {
          await pool.query('UPDATE channels SET consecutive_failures = 0, is_active = true, auto_disabled = false, last_checked_at = now() WHERE id = $1', [r.id]);
          reactivated.push(r.name);
        } else {
          await pool.query('UPDATE channels SET consecutive_failures = 0, last_checked_at = now() WHERE id = $1', [r.id]);
        }
      }
    }

    // Log offline
    const offlineResults = results.filter(r => r.status === 'offline');
    for (const ch of offlineResults) {
      await pool.query(
        'INSERT INTO channel_health_logs (channel_id, status, response_code, error_message, checked_by) VALUES ($1, $2, $3, $4, $5)',
        [ch.id, 'error', 0, ch.error || 'Canal no responde', 'system:auto-ping']
      );
    }

    const online = results.filter(r => r.status === 'online').length;
    lastAutoPingResult = {
      timestamp: new Date().toISOString(),
      total: results.length,
      online,
      offline: offlineResults.length,
      disabled,
      reactivated
    };

    if (disabled.length > 0) console.log(`⚠️  Auto-ping: Desactivados: ${disabled.join(', ')}`);
    if (reactivated.length > 0) console.log(`✅ Auto-ping: Reactivados: ${reactivated.join(', ')}`);
    console.log(`📡 Auto-ping: ${online}/${results.length} online`);
  } catch (err) {
    console.error('Auto-ping error:', err.message);
  }
}

function startAutoPing(intervalMs) {
  if (autoPingInterval) clearInterval(autoPingInterval);
  autoPingIntervalMs = intervalMs || autoPingIntervalMs;
  autoPingRunning = true;
  runAutoPing(); // run immediately
  autoPingInterval = setInterval(runAutoPing, autoPingIntervalMs);
  console.log(`📡 Auto-ping iniciado (cada ${autoPingIntervalMs / 1000}s)`);
}

function stopAutoPing() {
  if (autoPingInterval) clearInterval(autoPingInterval);
  autoPingInterval = null;
  autoPingRunning = false;
  console.log('📡 Auto-ping detenido');
}

// API endpoints for auto-ping control
app.post('/api/auto-ping/start', authAdmin, (req, res) => {
  const { interval_minutes = 5 } = req.body || {};
  startAutoPing(interval_minutes * 60 * 1000);
  res.json({ success: true, running: true, interval_minutes });
});

app.post('/api/auto-ping/stop', authAdmin, (req, res) => {
  stopAutoPing();
  res.json({ success: true, running: false });
});

app.get('/api/auto-ping/status', authAdmin, (req, res) => {
  res.json({
    running: autoPingRunning,
    interval_minutes: autoPingIntervalMs / 60000,
    last_result: lastAutoPingResult
  });
});

// Auto-ping sin auth para consulta interna
app.get('/api/auto-ping/health', (req, res) => {
  res.json({ running: autoPingRunning });
});

app.post('/api/channels/ping', authAdmin, async (req, res) => {
  try {
    const { auto_manage = true } = req.body || {};

    // Include auto_disabled channels for recovery check
    const { rows: channels } = await pool.query(
      'SELECT id, name, url, category, logo_url, is_active, auto_disabled, consecutive_failures FROM channels WHERE is_active = true OR auto_disabled = true'
    );

    const results = await Promise.all(channels.map(async (ch) => {
      const start = Date.now();
      try {
        const isYouTube = /youtube\.com|youtu\.be/.test(ch.url);
        if (isYouTube) {
          return { id: ch.id, name: ch.name, category: ch.category, logo_url: ch.logo_url, status: 'online', response_time: 0, status_code: 200, error: null, was_auto_disabled: ch.auto_disabled, consecutive_failures: ch.consecutive_failures };
        }

        const parsedUrl = new URL(ch.url);
        const httpClient = parsedUrl.protocol === 'https:' ? https : http;

        const result = await new Promise((resolve) => {
          const req = httpClient.request(ch.url, { method: 'GET', headers: { 'User-Agent': 'StreamBox-HealthCheck/1.0', 'Range': 'bytes=0-1024' } }, (response) => {
            response.destroy();
            const responseTime = Date.now() - start;
            const isOk = response.statusCode >= 200 && response.statusCode < 400;
            resolve({ id: ch.id, name: ch.name, category: ch.category, logo_url: ch.logo_url, status: isOk ? 'online' : 'offline', response_time: responseTime, status_code: response.statusCode, error: isOk ? null : `HTTP ${response.statusCode}`, was_auto_disabled: ch.auto_disabled, consecutive_failures: ch.consecutive_failures });
          });
          req.on('error', (err) => {
            resolve({ id: ch.id, name: ch.name, category: ch.category, logo_url: ch.logo_url, status: 'offline', response_time: Date.now() - start, status_code: 0, error: err.message, was_auto_disabled: ch.auto_disabled, consecutive_failures: ch.consecutive_failures });
          });
          req.setTimeout(10000, () => { req.destroy(); resolve({ id: ch.id, name: ch.name, category: ch.category, logo_url: ch.logo_url, status: 'offline', response_time: 10000, status_code: 0, error: 'Timeout', was_auto_disabled: ch.auto_disabled, consecutive_failures: ch.consecutive_failures }); });
          req.end();
        });

        return result;
      } catch (err) {
        return { id: ch.id, name: ch.name, category: ch.category, logo_url: ch.logo_url, status: 'offline', response_time: Date.now() - start, status_code: 0, error: err.message, was_auto_disabled: ch.auto_disabled, consecutive_failures: ch.consecutive_failures };
      }
    }));

    // Auto-manage: disable failing channels, re-enable recovered ones
    const autoActions = { disabled: [], reactivated: [] };

    if (auto_manage) {
      for (const r of results) {
        if (r.status === 'offline') {
          const newFailures = (r.consecutive_failures || 0) + 1;
          if (newFailures >= FAILURE_THRESHOLD) {
            await pool.query('UPDATE channels SET consecutive_failures = $1, is_active = false, auto_disabled = true, last_checked_at = now() WHERE id = $2', [newFailures, r.id]);
            autoActions.disabled.push(r.name);
          } else {
            await pool.query('UPDATE channels SET consecutive_failures = $1, last_checked_at = now() WHERE id = $2', [newFailures, r.id]);
          }
        } else if (r.status === 'online') {
          if (r.was_auto_disabled) {
            await pool.query('UPDATE channels SET consecutive_failures = 0, is_active = true, auto_disabled = false, last_checked_at = now() WHERE id = $1', [r.id]);
            autoActions.reactivated.push(r.name);
          } else {
            await pool.query('UPDATE channels SET consecutive_failures = 0, last_checked_at = now() WHERE id = $1', [r.id]);
          }
        }
      }
    }

    // Log offline channels
    const offlineChannels = results.filter(r => r.status === 'offline');
    if (offlineChannels.length > 0) {
      for (const ch of offlineChannels) {
        await pool.query(
          'INSERT INTO channel_health_logs (channel_id, status, response_code, error_message, checked_by) VALUES ($1, $2, $3, $4, $5)',
          [ch.id, 'error', ch.status_code, ch.error || 'Canal no responde', 'system:auto-ping']
        );
      }
    }

    const online = results.filter(r => r.status === 'online').length;
    const offline = offlineChannels.length;
    res.json({ results, summary: { total: results.length, online, offline }, auto_actions: autoActions });
  } catch (err) {
    console.error('Ping error:', err);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// Logs de salud de canales (requiere admin)
app.get('/api/channel-health-logs', authAdmin, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT chl.*, json_build_object('name', c.name) as channels 
       FROM channel_health_logs chl 
       LEFT JOIN channels c ON c.id = chl.channel_id 
       ORDER BY chl.checked_at DESC LIMIT 50`
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: 'Error del servidor' });
  }
});

app.delete('/api/channel-health-logs', authAdmin, async (req, res) => {
  await pool.query('DELETE FROM channel_health_logs');
  res.json({ ok: true });
});

app.get('/api/channels/public', async (req, res) => {
  const { rows } = await pool.query(
    'SELECT id, name, url, category, logo_url, sort_order FROM channels WHERE is_active = true ORDER BY sort_order'
  );
  // YouTube mantiene URL original, el resto se oculta (acceso vía /api/restream)
  const safe = rows.map(ch => {
    const isYouTube = /youtube\.com|youtu\.be/.test(ch.url);
    return { ...ch, url: isYouTube ? ch.url : null };
  });
  res.json(safe);
});

// Endpoint público de ads (sin auth)
app.get('/api/ads/public', async (req, res) => {
  const { rows } = await pool.query(
    'SELECT id, title, message, image_url FROM ads WHERE is_active = true'
  );
  res.json(rows);
});

// Upload channel logo
app.post('/api/channels/upload-logo', authAdmin, uploadLogo.single('logo'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No se recibió archivo' });
  const url = `/uploads/logos/${req.file.filename}`;
  res.json({ url });
});

app.post('/api/channels', authAdmin, async (req, res) => {
  try {
    const { name, url, category, sort_order, logo_url } = req.body;
    const validation = validateStreamSourceUrl(url);
    if (!validation.valid) {
      return res.status(400).json({ error: `URL de canal inválida: ${validation.reason}` });
    }

    const { rows } = await pool.query(
      'INSERT INTO channels (name, url, category, sort_order, logo_url) VALUES ($1, $2, $3, $4, $5) RETURNING *',
      [name, validation.normalizedUrl, category || 'General', sort_order || 0, logo_url || null]
    );
    res.json(rows[0]);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.put('/api/channels/:id', authAdmin, async (req, res) => {
  try {
    const { rows: current } = await pool.query('SELECT * FROM channels WHERE id = $1', [req.params.id]);
    if (current.length === 0) return res.status(404).json({ error: 'Canal no encontrado' });

    const c = current[0];
    const name = req.body.name !== undefined ? req.body.name : c.name;
    const url = req.body.url !== undefined ? req.body.url : c.url;
    const category = req.body.category !== undefined ? req.body.category : c.category;
    const sort_order = req.body.sort_order !== undefined ? req.body.sort_order : c.sort_order;
    const is_active = req.body.is_active !== undefined ? req.body.is_active : c.is_active;
    const keep_alive = req.body.keep_alive !== undefined ? req.body.keep_alive : c.keep_alive;
    const logo_url = req.body.logo_url !== undefined ? req.body.logo_url : c.logo_url;

    const urlValidation = validateStreamSourceUrl(url);
    if (!urlValidation.valid) {
      return res.status(400).json({ error: `URL de canal inválida: ${urlValidation.reason}` });
    }

    if (keep_alive) {
      const keepAliveValidation = validateStreamSourceUrl(urlValidation.normalizedUrl);
      if (!keepAliveValidation.valid) {
        return res.status(400).json({ error: `No se puede activar Keep Alive: ${keepAliveValidation.reason}` });
      }
    }

    const { rows } = await pool.query(
      'UPDATE channels SET name=$1, url=$2, category=$3, sort_order=$4, is_active=$5, keep_alive=$6, logo_url=$7 WHERE id=$8 RETURNING *',
      [name, urlValidation.normalizedUrl, category, sort_order, is_active, keep_alive, logo_url, req.params.id]
    );

    // If keep_alive was toggled ON, start the transcoder immediately
    if (keep_alive && !c.keep_alive && is_active) {
      startKeepAliveChannel(req.params.id, urlValidation.normalizedUrl);
    }
    // If keep_alive was toggled OFF, stop poller and release
    if (!keep_alive && c.keep_alive) {
      stopHLSKeepAlivePoller(req.params.id); // detener poller si existe
      const entry = activeTranscoders.get(req.params.id);
      if (entry) {
        entry.keepAlive = false;
        if (entry.clients <= 0) releaseTranscoder(req.params.id);
      }
    }

    res.json(rows[0]);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.delete('/api/channels/:id', authAdmin, async (req, res) => {
  await pool.query('DELETE FROM channels WHERE id = $1', [req.params.id]);
  res.json({ ok: true });
});

// =============================================
// RUTAS: CLIENTES (requiere admin)
// =============================================
app.get('/api/clients', authAdmin, async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM clients ORDER BY created_at DESC');
  res.json(rows);
});

app.post('/api/clients', authAdmin, async (req, res) => {
  const { username, password, max_screens, expiry_date, notes, plan_id } = req.body;
  try {
    // Auto-generate playlist token
    const playlist_token = crypto.randomBytes(16).toString('hex');
    const { rows } = await pool.query(
      'INSERT INTO clients (username, password, max_screens, expiry_date, notes, plan_id, playlist_token) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *',
      [username, password, max_screens || 1, expiry_date, notes, plan_id || null, playlist_token]
    );
    res.json(rows[0]);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.put('/api/clients/:id', authAdmin, async (req, res) => {
  try {
    // Obtener datos actuales del cliente
    const { rows: current } = await pool.query('SELECT * FROM clients WHERE id = $1', [req.params.id]);
    if (current.length === 0) return res.status(404).json({ error: 'Cliente no encontrado' });

    const c = current[0];
    const username = req.body.username !== undefined ? req.body.username : c.username;
    const password = req.body.password !== undefined ? req.body.password : c.password;
    const max_screens = req.body.max_screens !== undefined ? req.body.max_screens : c.max_screens;
    const expiry_date = req.body.expiry_date !== undefined ? req.body.expiry_date : c.expiry_date;
    const is_active = req.body.is_active !== undefined ? req.body.is_active : c.is_active;
    const notes = req.body.notes !== undefined ? req.body.notes : c.notes;
    const plan_id = req.body.plan_id !== undefined ? req.body.plan_id : c.plan_id;
    const vod_enabled = req.body.vod_enabled !== undefined ? req.body.vod_enabled : c.vod_enabled;

    const { rows } = await pool.query(
      'UPDATE clients SET username=$1, password=$2, max_screens=$3, expiry_date=$4, is_active=$5, notes=$6, plan_id=$7, vod_enabled=$8 WHERE id=$9 RETURNING *',
      [username, password, max_screens, expiry_date, is_active, notes, plan_id, vod_enabled, req.params.id]
    );
    res.json(rows[0]);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.delete('/api/clients/:id', authAdmin, async (req, res) => {
  await pool.query('DELETE FROM clients WHERE id = $1', [req.params.id]);
  res.json({ ok: true });
});

// =============================================
// RUTAS: PUBLICIDAD (requiere admin)
// =============================================
app.get('/api/ads', authAdmin, async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM ads ORDER BY created_at DESC');
  res.json(rows);
});

app.post('/api/ads', authAdmin, async (req, res) => {
  const { title, message, image_url } = req.body;
  const { rows } = await pool.query(
    'INSERT INTO ads (title, message, image_url) VALUES ($1, $2, $3) RETURNING *',
    [title, message, image_url]
  );
  res.json(rows[0]);
});

app.put('/api/ads/:id', authAdmin, async (req, res) => {
  try {
    const { rows: current } = await pool.query('SELECT * FROM ads WHERE id = $1', [req.params.id]);
    if (current.length === 0) return res.status(404).json({ error: 'Ad no encontrado' });

    const c = current[0];
    const title = req.body.title !== undefined ? req.body.title : c.title;
    const message = req.body.message !== undefined ? req.body.message : c.message;
    const image_url = req.body.image_url !== undefined ? req.body.image_url : c.image_url;
    const is_active = req.body.is_active !== undefined ? req.body.is_active : c.is_active;

    const { rows } = await pool.query(
      'UPDATE ads SET title=$1, message=$2, image_url=$3, is_active=$4 WHERE id=$5 RETURNING *',
      [title, message, image_url, is_active, req.params.id]
    );
    res.json(rows[0]);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.delete('/api/ads/:id', authAdmin, async (req, res) => {
  await pool.query('DELETE FROM ads WHERE id = $1', [req.params.id]);
  res.json({ ok: true });
});

// =============================================
// RUTAS: RESELLERS (requiere admin)
// =============================================
app.get('/api/resellers', authAdmin, async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM resellers ORDER BY created_at DESC');
    // Get client counts
    const { rows: clients } = await pool.query('SELECT reseller_id FROM clients WHERE reseller_id IS NOT NULL');
    const counts = {};
    clients.forEach(c => { counts[c.reseller_id] = (counts[c.reseller_id] || 0) + 1; });
    const result = rows.map(r => ({ ...r, client_count: counts[r.id] || 0 }));
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/resellers', authAdmin, async (req, res) => {
  const { name, email, phone, username, password, max_clients, commission_percent, notes } = req.body;
  try {
    const { rows } = await pool.query(
      'INSERT INTO resellers (name, email, phone, username, password, max_clients, commission_percent, notes) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *',
      [name, email, phone, username, password, max_clients || 10, commission_percent || 0, notes]
    );
    res.json(rows[0]);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.put('/api/resellers/:id', authAdmin, async (req, res) => {
  try {
    const { rows: current } = await pool.query('SELECT * FROM resellers WHERE id = $1', [req.params.id]);
    if (current.length === 0) return res.status(404).json({ error: 'Reseller no encontrado' });

    const c = current[0];
    const name = req.body.name !== undefined ? req.body.name : c.name;
    const email = req.body.email !== undefined ? req.body.email : c.email;
    const phone = req.body.phone !== undefined ? req.body.phone : c.phone;
    const username = req.body.username !== undefined ? req.body.username : c.username;
    const password = req.body.password !== undefined ? req.body.password : c.password;
    const max_clients = req.body.max_clients !== undefined ? req.body.max_clients : c.max_clients;
    const is_active = req.body.is_active !== undefined ? req.body.is_active : c.is_active;
    const commission_percent = req.body.commission_percent !== undefined ? req.body.commission_percent : c.commission_percent;
    const notes = req.body.notes !== undefined ? req.body.notes : c.notes;

    const { rows } = await pool.query(
      'UPDATE resellers SET name=$1, email=$2, phone=$3, username=$4, password=$5, max_clients=$6, is_active=$7, commission_percent=$8, notes=$9 WHERE id=$10 RETURNING *',
      [name, email, phone, username, password, max_clients, is_active, commission_percent, notes, req.params.id]
    );
    res.json(rows[0]);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.delete('/api/resellers/:id', authAdmin, async (req, res) => {
  try {
    await pool.query('UPDATE clients SET reseller_id = NULL WHERE reseller_id = $1', [req.params.id]);
    await pool.query('DELETE FROM resellers WHERE id = $1', [req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// =============================================
// RUTAS: LOGIN DE CLIENTES (público, para la app)
// =============================================
app.post('/api/client/login', async (req, res) => {
  try {
    const { username, password, device_id } = req.body;

    const { rows } = await pool.query(
      'SELECT * FROM clients WHERE username = $1 AND password = $2',
      [username, password]
    );

    if (rows.length === 0) return res.status(401).json({ error: 'Credenciales inválidas' });

    const client = rows[0];

    if (!client.is_active) return res.status(403).json({ error: 'Cuenta suspendida' });

    if (new Date(client.expiry_date) < new Date()) {
      await pool.query('UPDATE clients SET is_active = false WHERE id = $1', [client.id]);
      return res.status(403).json({ error: 'Suscripción expirada' });
    }

    // Control de pantallas
    if (device_id) {
      const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
      const { rows: conns } = await pool.query(
        'SELECT id, device_id FROM active_connections WHERE client_id = $1 AND last_heartbeat >= $2',
        [client.id, fiveMinAgo]
      );

      const otherDevices = conns.filter(c => c.device_id !== device_id).length;
      if (otherDevices >= client.max_screens) {
        return res.status(403).json({ error: `Límite de ${client.max_screens} pantalla(s) alcanzado` });
      }

      // Registrar conexión con IP y geo
      const clientIP = getClientIP(req);
      const geo = await geoLookup(clientIP);
      await pool.query(
        `INSERT INTO active_connections (client_id, device_id, ip_address, country, city, last_heartbeat) 
         VALUES ($1, $2, $3, $4, $5, now()) 
         ON CONFLICT (client_id, device_id) DO UPDATE SET last_heartbeat = now(), ip_address = $3, country = $4, city = $5`,
        [client.id, device_id, clientIP, geo.country, geo.city]
      );
    }

    // Obtener canales y ads
    const [channelsRes, adsRes] = await Promise.all([
      pool.query('SELECT id, name, url, category, logo_url, sort_order FROM channels WHERE is_active = true ORDER BY sort_order'),
      pool.query('SELECT id, title, message, image_url FROM ads WHERE is_active = true')
    ]);

    // RESTREAMING: Todo pasa por HLS unificado
    // YouTube mantiene su URL original (iframe), todo lo demás es HLS via restream
    const safeChannels = channelsRes.rows.map(ch => {
      const isYouTube = /youtube\.com|youtu\.be/.test(ch.url);
      return {
        ...ch,
        url: isYouTube ? ch.url : `/api/restream/${ch.id}`,
      };
    });

    // En modo hybrid, incluir stream_base_url para que el frontend use IP directa para streams
    const serverIP = getServerIP();
    const streamBaseUrl = (tunnelMode === 'hybrid' && tunnelUrl && serverIP) ? `http://${serverIP}` : null;

    res.json({
      client: { id: client.id, username: client.username, max_screens: client.max_screens, expiry_date: client.expiry_date, vod_enabled: client.vod_enabled || false },
      channels: safeChannels,
      ads: adsRes.rows,
      stream_base_url: streamBaseUrl,
    });
  } catch (err) {
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// Heartbeat (mantener conexión activa + canal que ve + log de actividad)
// Map para tracking de actividad activa: `clientId:deviceId` → { logId, channelId }
const activeActivityLogs = new Map();

app.post('/api/client/heartbeat', async (req, res) => {
  const { client_id, device_id, channel_id } = req.body;
  if (client_id && device_id) {
    const updates = ['last_heartbeat = now()'];
    const vals = [client_id, device_id];
    if (channel_id) {
      updates.push(`watching_channel_id = $3`);
      vals.push(channel_id);
    }
    await pool.query(
      `UPDATE active_connections SET ${updates.join(', ')} WHERE client_id = $1 AND device_id = $2`,
      vals
    );

    // Activity logging: track channel changes
    const logKey = `${client_id}:${device_id}`;
    const currentLog = activeActivityLogs.get(logKey);
    
    if (channel_id && (!currentLog || currentLog.channelId !== channel_id)) {
      // Close previous log if exists
      if (currentLog && currentLog.logId) {
        try {
          await pool.query(
            `UPDATE activity_logs SET ended_at = now(), duration_seconds = EXTRACT(EPOCH FROM (now() - started_at))::int WHERE id = $1`,
            [currentLog.logId]
          );
        } catch {}
      }
      
      // Start new activity log
      try {
        // Get client info and channel name
        const { rows: clientRows } = await pool.query('SELECT username FROM clients WHERE id = $1', [client_id]);
        const { rows: channelRows } = await pool.query('SELECT name FROM channels WHERE id = $1', [channel_id]);
        const { rows: connRows } = await pool.query(
          'SELECT ip_address, country, city FROM active_connections WHERE client_id = $1 AND device_id = $2', [client_id, device_id]
        );
        
        if (clientRows.length > 0) {
          const conn = connRows[0] || {};
          const { rows: logRows } = await pool.query(
            `INSERT INTO activity_logs (client_id, client_username, channel_id, channel_name, ip_address, country, city, device_id, source)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'panel') RETURNING id`,
            [client_id, clientRows[0].username, channel_id, channelRows[0]?.name || null, conn.ip_address || null, conn.country || null, conn.city || null, device_id]
          );
          activeActivityLogs.set(logKey, { logId: logRows[0].id, channelId: channel_id });
        }
      } catch (err) {
        console.error('Activity log error:', err.message);
      }
    } else if (!channel_id && currentLog) {
      // Client stopped watching - close log
      try {
        await pool.query(
          `UPDATE activity_logs SET ended_at = now(), duration_seconds = EXTRACT(EPOCH FROM (now() - started_at))::int WHERE id = $1`,
          [currentLog.logId]
        );
      } catch {}
      activeActivityLogs.delete(logKey);
    }
  }
  res.json({ ok: true });
});

// =============================================
// RUTA: Validación para Nginx (sub_request)
// =============================================
app.get('/api/validate-stream', async (req, res) => {
  const { username, password } = req.query;
  if (!username || !password) return res.status(403).send('Forbidden');

  const { rows } = await pool.query(
    'SELECT id, is_active, expiry_date FROM clients WHERE username = $1 AND password = $2',
    [username, password]
  );

  if (rows.length === 0 || !rows[0].is_active || new Date(rows[0].expiry_date) < new Date()) {
    return res.status(403).send('Forbidden');
  }

  res.status(200).send('OK');
});

// =============================================
// SISTEMA DE RESTREAMING UNIFICADO CON FFMPEG
// Todos los streams (TS, HLS) se convierten a HLS local
// UNA sola conexión al origen por canal
// FFmpeg transcodifica TS → HLS con segmentos en disco
// HLS nativo se proxea con caché de segmentos
// =============================================
// child_process, fs, path ya importados arriba

// Directorios de caché HLS - SSD por defecto (soporta 100+ canales)
// El instalador configura /opt/streambox/hls-cache en SSD
// Fallback a /tmp si no existe (compatibilidad con instalaciones anteriores)
const HLS_DIR = fs.existsSync('/opt/streambox/hls-cache') ? '/opt/streambox/hls-cache' : '/tmp/streambox-hls';
const HLS_CACHE_DIR = fs.existsSync('/opt/streambox/hls-proxy-cache') ? '/opt/streambox/hls-proxy-cache' : '/tmp/streambox-cache';
const activeTranscoders = new Map(); // channelId -> { ffmpeg, clients, lastAccess, type }

// Crear directorios base
[HLS_DIR, HLS_CACHE_DIR].forEach(dir => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

// Detectar tipo de almacenamiento
const storageInfo = (() => {
  try {
    const { execSync } = require('child_process');
    const output = execSync(`df -T ${HLS_DIR} 2>/dev/null`).toString();
    const isTmpfs = output.includes('tmpfs');
    const parts = output.split('\n')[1]?.split(/\s+/) || [];
    const totalGB = Math.round((parseInt(parts[2]) || 0) / 1024 / 1024);
    const usedGB = Math.round((parseInt(parts[3]) || 0) / 1024 / 1024);
    const availGB = Math.round((parseInt(parts[4]) || 0) / 1024 / 1024);
    
    if (isTmpfs) {
      const sizeMB = Math.round((parseInt(parts[2]) || 0) / 1024);
      console.log(`⚡ HLS en RAM (tmpfs): ${sizeMB}MB disponibles`);
      return { type: 'tmpfs', totalGB, availGB };
    } else {
      console.log(`💾 HLS en disco SSD: ${HLS_DIR} (${availGB}GB libres de ${totalGB}GB)`);
      console.log(`   📊 Capacidad estimada: ~${Math.floor(availGB / 0.5)} canales keep-alive (30min caché)`);
      return { type: 'ssd', totalGB, availGB };
    }
  } catch { 
    console.log(`💾 HLS en: ${HLS_DIR}`);
    return { type: 'unknown', totalGB: 0, availGB: 0 }; 
  }
})();

// Monitor de uso de disco (cada 60s)
setInterval(() => {
  try {
    const { execSync } = require('child_process');
    const output = execSync(`df -h ${HLS_DIR} 2>/dev/null`).toString();
    const parts = output.split('\n')[1]?.split(/\s+/) || [];
    const used = parts[2] || '?';
    const total = parts[1] || '?';
    const pct = parts[4] || '?';
    const pctNum = parseInt(pct) || 0;
    if (pctNum > 85) {
      console.warn(`⚠️ Disco casi lleno: ${used}/${total} (${pct})`);
      // Limpieza agresiva: borrar canales sin clientes activos (excepto keep-alive)
      const dirs = fs.readdirSync(HLS_DIR);
      dirs.forEach(dir => {
        const entry = activeTranscoders.get(dir);
        if (!entry || (!entry.keepAlive && entry.clients <= 0)) {
          cleanChannelDir(dir);
          console.log(`🧹 Canal ${dir} limpiado por presión de disco`);
        }
      });
    }
  } catch {}
}, 60000);

// Limpiar directorio de un canal
function cleanChannelDir(channelId) {
  const dir = path.join(HLS_DIR, channelId);
  if (fs.existsSync(dir)) {
    try {
      // Recursive delete for adaptive subdirectories (low/med/high)
      const deleteRecursive = (dirPath) => {
        fs.readdirSync(dirPath).forEach(f => {
          const fullPath = path.join(dirPath, f);
          if (fs.statSync(fullPath).isDirectory()) {
            deleteRecursive(fullPath);
            fs.rmdirSync(fullPath);
          } else {
            fs.unlinkSync(fullPath);
          }
        });
      };
      deleteRecursive(dir);
      fs.rmdirSync(dir);
    } catch {}
  }
}

// =============================================
// TRANSCODIFICADOR TS → HLS con FFmpeg
// =============================================
// =============================================
// CALIDADES ADAPTATIVAS (tipo Netflix)
// Low: 480p ~800kbps (para 2-3 Mbps)
// Med: 720p ~2Mbps (para 4-6 Mbps) 
// High: original (copy, sin re-encode)
// =============================================
const QUALITY_PROFILES = [
  { name: 'low', width: 854, height: 480, vBitrate: '800k', maxrate: '900k', bufsize: '1200k', aBitrate: '96k', bandwidth: 900000 },
  { name: 'med', width: 1280, height: 720, vBitrate: '2000k', maxrate: '2200k', bufsize: '3000k', aBitrate: '128k', bandwidth: 2200000 },
];

// Configuración de caché según modo
const CACHE_NORMAL = { hls_list_size: 30, hls_time: 4 };       // 30×4s = 2 min
const CACHE_KEEPALIVE = { hls_list_size: 450, hls_time: 4 };   // 450×4s = 30 min

function validateStreamSourceUrl(sourceUrl) {
  if (!sourceUrl || typeof sourceUrl !== 'string') {
    return { valid: false, reason: 'URL vacía' };
  }

  const normalizedUrl = sourceUrl.trim();
  if (!/^(https?|rtmp|rtsp):\/\//i.test(normalizedUrl)) {
    return { valid: false, reason: 'protocolo no soportado (usa http/https/rtmp/rtsp)' };
  }

  if (/#EXTM3U|#EXTINF/i.test(normalizedUrl)) {
    return { valid: false, reason: 'la URL contiene metadatos M3U incrustados' };
  }

  return { valid: true, normalizedUrl };
}

function startFFmpegTranscoder(channelId, sourceUrl, isKeepAlive = false) {
  // Validación de URL antes de lanzar FFmpeg
  const validation = validateStreamSourceUrl(sourceUrl);
  if (!validation.valid) {
    console.log(`⚠️ [${channelId}] FFmpeg abortado: ${validation.reason}`);
    return null;
  }

  const streamUrl = validation.normalizedUrl;

  if (activeTranscoders.has(channelId)) {
    const existing = activeTranscoders.get(channelId);
    existing.clients++;
    existing.lastAccess = Date.now();
    return existing;
  }

  const channelDir = path.join(HLS_DIR, channelId);
  if (!fs.existsSync(channelDir)) {
    fs.mkdirSync(channelDir, { recursive: true });
  }

  return startAdaptiveTranscoder(channelId, streamUrl, channelDir, isKeepAlive);
}

// Adaptive multi-bitrate transcoder (Netflix-style)
function startAdaptiveTranscoder(channelId, sourceUrl, channelDir, isKeepAlive = false) {
  const masterPlaylistPath = path.join(channelDir, 'master.m3u8');
  const copyManifestPath = path.join(channelDir, 'high', 'stream.m3u8');
  const cacheConfig = isKeepAlive ? CACHE_KEEPALIVE : CACHE_NORMAL;

  // Create subdirectories for each quality
  ['low', 'med', 'high'].forEach(q => {
    const qDir = path.join(channelDir, q);
    if (!fs.existsSync(qDir)) fs.mkdirSync(qDir, { recursive: true });
  });

  const cacheLabel = isKeepAlive ? `${cacheConfig.hls_list_size}seg ≈ ${Math.round(cacheConfig.hls_list_size * cacheConfig.hls_time / 60)}min` : '2min';
  console.log(`🎬 [${channelId}] FFmpeg adaptativo (3 calidades, caché: ${cacheLabel}): ${sourceUrl}`);

  // Build FFmpeg command for multi-output adaptive streaming
  const ffmpegArgs = [
    '-reconnect', '1',
    '-reconnect_streamed', '1',
    '-reconnect_delay_max', '10',
    '-rw_timeout', '10000000',
    '-i', sourceUrl,

    // --- Output 0: LOW (480p) ---
    '-map', '0:v:0', '-map', '0:a:0?',
    '-c:v:0', 'libx264', '-preset', 'ultrafast', '-tune', 'zerolatency',
    '-b:v:0', QUALITY_PROFILES[0].vBitrate,
    '-maxrate:v:0', QUALITY_PROFILES[0].maxrate,
    '-bufsize:v:0', QUALITY_PROFILES[0].bufsize,
    '-vf:0', `scale=${QUALITY_PROFILES[0].width}:${QUALITY_PROFILES[0].height}`,
    '-c:a:0', 'aac', '-b:a:0', QUALITY_PROFILES[0].aBitrate,
    '-g', '48', '-keyint_min', '48', '-sc_threshold', '0',

    // --- Output 1: MED (720p) ---
    '-map', '0:v:0', '-map', '0:a:0?',
    '-c:v:1', 'libx264', '-preset', 'veryfast', '-tune', 'zerolatency',
    '-b:v:1', QUALITY_PROFILES[1].vBitrate,
    '-maxrate:v:1', QUALITY_PROFILES[1].maxrate,
    '-bufsize:v:1', QUALITY_PROFILES[1].bufsize,
    '-vf:1', `scale=${QUALITY_PROFILES[1].width}:${QUALITY_PROFILES[1].height}`,
    '-c:a:1', 'aac', '-b:a:1', QUALITY_PROFILES[1].aBitrate,
    '-g', '48', '-keyint_min', '48',

    // --- Output 2: HIGH (original, copy) ---
    '-map', '0:v:0', '-map', '0:a:0?',
    '-c:v:2', 'copy',
    '-c:a:2', 'aac', '-b:a:2', '128k',

    // --- HLS output ---
    '-f', 'hls',
    '-hls_time', String(cacheConfig.hls_time),
    '-hls_list_size', String(cacheConfig.hls_list_size),
    '-hls_flags', isKeepAlive ? 'append_list+delete_segments+temp_file' : 'append_list+temp_file',
    '-hls_segment_type', 'mpegts',
    '-hls_segment_filename', path.join(channelDir, 'low', 'seg_%05d.ts'),
    '-hls_allow_cache', '1',
    '-var_stream_map', 'v:0,a:0 v:1,a:1 v:2,a:2',
    '-master_pl_name', 'master.m3u8',
    '-hls_segment_filename', path.join(channelDir, '%v', 'seg_%05d.ts'),
    '-y',
    path.join(channelDir, '%v', 'stream.m3u8'),
  ];

  // Try adaptive first, fallback to single-quality if FFmpeg doesn't support var_stream_map
  let ffmpeg;
  try {
    ffmpeg = spawn('ffmpeg', ffmpegArgs, { stdio: ['pipe', 'pipe', 'pipe'] });
  } catch (err) {
    console.error(`❌ [${channelId}] FFmpeg spawn error:`, err.message);
    return null;
  }

  const entry = {
    ffmpeg,
    clients: 1,
    lastAccess: Date.now(),
    startTime: Date.now(),
    type: 'ffmpeg-adaptive',
    channelDir,
    manifestPath: masterPlaylistPath,
    fallbackManifest: path.join(channelDir, 'stream.m3u8'),
    ready: false,
    retryCount: 0,
    maxRetries: 5,
    adaptive: true,
  };
  activeTranscoders.set(channelId, entry);

  let fallbackTriggered = false;

  ffmpeg.stderr.on('data', (data) => {
    const msg = data.toString();

    // If var_stream_map fails, fallback to single quality optimized for slow internet
    if (!fallbackTriggered && (msg.includes('var_stream_map') && msg.includes('Error')) || 
        (msg.includes('Option var_stream_map not found'))) {
      fallbackTriggered = true;
      console.log(`⚠️ [${channelId}] var_stream_map no soportado, usando calidad única optimizada`);
      ffmpeg.kill('SIGTERM');
      startSingleQualityTranscoder(channelId, sourceUrl, channelDir, isKeepAlive);
      return;
    }

    if (!entry.ready && (msg.includes('Opening') || msg.includes('muxing'))) {
      entry.ready = true;
      console.log(`✅ [${channelId}] FFmpeg adaptativo listo (480p/720p/original)`);
    }
  });

  ffmpeg.on('error', (err) => {
    console.error(`❌ [${channelId}] FFmpeg error:`, err.message);
  });

  ffmpeg.on('close', (code) => {
    console.log(`⚠️ [${channelId}] FFmpeg terminó (code: ${code})`);

    const wasKeepAlive = entry.keepAlive;

    // If it crashed immediately and no fallback, try single quality
    if (!fallbackTriggered && code !== 0 && entry.retryCount === 0) {
      fallbackTriggered = true;
      console.log(`🔄 [${channelId}] Fallback a calidad única optimizada`);
      activeTranscoders.delete(channelId);
      const fallbackEntry = startSingleQualityTranscoder(channelId, sourceUrl, channelDir, wasKeepAlive);
      if (fallbackEntry) {
        fallbackEntry.clients = entry.clients;
        fallbackEntry.keepAlive = wasKeepAlive; // PRESERVAR keepAlive
      }
      return;
    }

    activeTranscoders.delete(channelId);
    // Keep-alive channels ALWAYS retry, sin límite de reintentos
    const shouldRetry = wasKeepAlive || (entry.clients > 0 && entry.retryCount < entry.maxRetries);
    if (shouldRetry) {
      entry.retryCount++;
      const delay = wasKeepAlive 
        ? Math.min(3000 * entry.retryCount, 30000) // keep-alive: más paciencia
        : Math.min(2000 * entry.retryCount, 15000);
      const maxLabel = wasKeepAlive ? '∞' : entry.maxRetries;
      console.log(`🔄 [${channelId}] Reiniciando en ${delay}ms (intento ${entry.retryCount}/${maxLabel})${wasKeepAlive ? ' [KEEP-ALIVE]' : ''}`);
      setTimeout(() => {
        cleanChannelDir(channelId);
        startFFmpegTranscoder(channelId, sourceUrl, wasKeepAlive);
        const newEntry = activeTranscoders.get(channelId);
        if (newEntry) {
          newEntry.clients = entry.clients;
          newEntry.keepAlive = wasKeepAlive; // PRESERVAR keepAlive
          // Reset retry count si era keep-alive (reintentos infinitos)
          if (wasKeepAlive) newEntry.retryCount = 0;
        }
      }, delay);
    } else {
      cleanChannelDir(channelId);
    }
  });

  return entry;
}

// Fallback: single quality optimized for 2-3 Mbps
function startSingleQualityTranscoder(channelId, sourceUrl, channelDir, isKeepAlive = false) {
  const manifestPath = path.join(channelDir, 'stream.m3u8');
  const cacheConfig = isKeepAlive ? CACHE_KEEPALIVE : CACHE_NORMAL;

  const cacheLabel = isKeepAlive ? `${cacheConfig.hls_list_size}seg ≈ ${Math.round(cacheConfig.hls_list_size * cacheConfig.hls_time / 60)}min` : '2min';
  console.log(`🎬 [${channelId}] FFmpeg calidad única (caché: ${cacheLabel}): ${sourceUrl}`);

  const ffmpeg = spawn('ffmpeg', [
    '-reconnect', '1',
    '-reconnect_streamed', '1',
    '-reconnect_delay_max', '10',
    '-rw_timeout', '10000000',
    '-i', sourceUrl,
    '-c:v', 'libx264', '-preset', 'ultrafast', '-tune', 'zerolatency',
    '-b:v', '1200k', '-maxrate', '1400k', '-bufsize', '2000k',
    '-vf', 'scale=1280:720',
    '-c:a', 'aac', '-b:a', '96k',
    '-g', '48', '-keyint_min', '48', '-sc_threshold', '0',
    '-f', 'hls',
    '-hls_time', String(cacheConfig.hls_time),
    '-hls_list_size', String(cacheConfig.hls_list_size),
    '-hls_flags', isKeepAlive ? 'append_list+delete_segments+temp_file' : 'append_list+temp_file',
    '-hls_segment_type', 'mpegts',
    '-hls_segment_filename', path.join(channelDir, 'seg_%05d.ts'),
    '-hls_allow_cache', '1',
    '-y',
    manifestPath,
  ], { stdio: ['pipe', 'pipe', 'pipe'] });

  const entry = {
    ffmpeg,
    clients: 1,
    lastAccess: Date.now(),
    startTime: Date.now(),
    type: 'ffmpeg',
    channelDir,
    manifestPath,
    ready: false,
    retryCount: 0,
    maxRetries: 5,
    adaptive: false,
  };
  activeTranscoders.set(channelId, entry);

  // Monitorear salida de FFmpeg
  ffmpeg.stderr.on('data', (data) => {
    const msg = data.toString();
    // Detectar cuando el primer segmento está listo
    if (!entry.ready && (msg.includes('Opening') || msg.includes('muxing'))) {
      entry.ready = true;
      console.log(`✅ [${channelId}] FFmpeg listo, generando segmentos HLS`);
    }
  });

  ffmpeg.on('error', (err) => {
    console.error(`❌ [${channelId}] FFmpeg error:`, err.message);
  });

  ffmpeg.on('close', (code) => {
    console.log(`⚠️ [${channelId}] FFmpeg terminó (code: ${code})`);
    const wasKeepAlive = entry.keepAlive;
    activeTranscoders.delete(channelId);

    // Keep-alive channels ALWAYS retry
    const shouldRetry = wasKeepAlive || (entry.clients > 0 && entry.retryCount < entry.maxRetries);
    if (shouldRetry) {
      entry.retryCount++;
      const delay = wasKeepAlive 
        ? Math.min(3000 * entry.retryCount, 30000)
        : Math.min(2000 * entry.retryCount, 15000);
      const maxLabel = wasKeepAlive ? '∞' : entry.maxRetries;
      console.log(`🔄 [${channelId}] Reiniciando FFmpeg en ${delay}ms (intento ${entry.retryCount}/${maxLabel})${wasKeepAlive ? ' [KEEP-ALIVE]' : ''}`);
      setTimeout(() => {
        cleanChannelDir(channelId);
        startFFmpegTranscoder(channelId, sourceUrl, wasKeepAlive);
        const newEntry = activeTranscoders.get(channelId);
        if (newEntry) {
          newEntry.clients = entry.clients;
          newEntry.keepAlive = wasKeepAlive;
          if (wasKeepAlive) newEntry.retryCount = 0;
        }
      }, delay);
    } else {
      cleanChannelDir(channelId);
    }
  });

  return entry;
}

// Detener transcodificador cuando no hay clientes
function releaseTranscoder(channelId) {
  const entry = activeTranscoders.get(channelId);
  if (!entry) return;

  entry.clients--;
  if (entry.clients <= 0) {
    // Keep alive channels NEVER stop
    if (entry.keepAlive) {
      entry.clients = 0; // Floor at 0
      console.log(`💚 [${channelId}] Keep-alive activo, ${entry.type === 'hls-proxy' ? 'poller' : 'FFmpeg'} permanece encendido`);
      return;
    }
    // Esperar 30 segundos antes de matar, por si alguien vuelve
    setTimeout(() => {
      const current = activeTranscoders.get(channelId);
      if (current && current.clients <= 0 && !current.keepAlive) {
        console.log(`🔴 [${channelId}] Sin clientes, deteniendo`);
        stopHLSKeepAlivePoller(channelId); // detener poller si existe
        if ((current.type === 'ffmpeg' || current.type === 'ffmpeg-adaptive') && current.ffmpeg) {
          current.ffmpeg.kill('SIGTERM');
        }
        activeTranscoders.delete(channelId);
        cleanChannelDir(channelId);
      }
    }, 30000);
  }
}

// =============================================
// KEEP ALIVE: Iniciar canal persistente
// =============================================
function startKeepAliveChannel(channelId, sourceUrl) {
  const validation = validateStreamSourceUrl(sourceUrl);
  if (!validation.valid) {
    console.log(`⚠️ [${channelId}] Keep-alive omitido: ${validation.reason}`);
    return;
  }

  const streamUrl = validation.normalizedUrl;
  const isHLS = /\.m3u8?(\?|$)/i.test(streamUrl);
  const isYouTube = /youtube\.com|youtu\.be/.test(streamUrl);

  if (isYouTube) return; // YouTube no necesita keep_alive

  if (isHLS) {
    const entry = startHLSProxy(channelId, streamUrl);
    if (entry) {
      entry.keepAlive = true;
      entry.clients = 0;
      // Iniciar poller activo que pre-descarga manifiestos y segmentos
      startHLSKeepAlivePoller(channelId, streamUrl);
      console.log(`💚 [${channelId}] Keep-alive HLS proxy + poller activo`);
    }
  } else {
    const entry = startFFmpegTranscoder(channelId, streamUrl, true); // isKeepAlive = true → 30 min caché
    if (entry) {
      entry.keepAlive = true;
      entry.clients = 0;
      console.log(`💚 [${channelId}] Keep-alive FFmpeg iniciado (caché: 30 min)`);
    }
  }
}

// Iniciar todos los canales keep_alive al arrancar el servidor
async function initKeepAliveChannels() {
  try {
    const { rows } = await pool.query(
      'SELECT id, url FROM channels WHERE is_active = true AND keep_alive = true'
    );
    if (rows.length === 0) {
      console.log('📡 No hay canales keep-alive configurados');
      return;
    }
    console.log(`\n💚 Iniciando ${rows.length} canal(es) keep-alive...`);
    for (const ch of rows) {
      startKeepAliveChannel(ch.id, ch.url);
      // Stagger starts to avoid overwhelming the server
      await new Promise(r => setTimeout(r, 2000));
    }
    console.log(`✅ ${rows.length} canal(es) keep-alive iniciados\n`);
  } catch (err) {
    console.error('❌ Error iniciando canales keep-alive:', err.message);
  }
}

// Health monitor: restart crashed keep-alive channels every 30s (más rápido)
setInterval(async () => {
  try {
    const { rows } = await pool.query(
      'SELECT id, url FROM channels WHERE is_active = true AND keep_alive = true'
    );
    for (const ch of rows) {
      const entry = activeTranscoders.get(ch.id);
      if (!entry) {
        console.log(`🔄 [${ch.id}] Keep-alive caído, reiniciando...`);
        startKeepAliveChannel(ch.id, ch.url);
        await new Promise(r => setTimeout(r, 1000)); // stagger
      }
    }
  } catch {}
}, 30000);

// API: Estado de keep-alive y caché de todos los canales
app.get('/api/channels/cache-status', authAdmin, async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT id, name, keep_alive, is_active FROM channels ORDER BY sort_order'
    );
    const status = rows.map(ch => {
      const entry = activeTranscoders.get(ch.id);
      let cacheSize = 0;
      let segmentCount = 0;
      if (entry && entry.channelDir && fs.existsSync(entry.channelDir)) {
        try {
          const countFiles = (dir) => {
            let count = 0, size = 0;
            fs.readdirSync(dir).forEach(f => {
              const fp = path.join(dir, f);
              const stat = fs.statSync(fp);
              if (stat.isDirectory()) {
                const sub = countFiles(fp);
                count += sub.count;
                size += sub.size;
              } else if (f.endsWith('.ts')) {
                count++;
                size += stat.size;
              }
            });
            return { count, size };
          };
          const result = countFiles(entry.channelDir);
          segmentCount = result.count;
          cacheSize = result.size;
        } catch {}
      }
      return {
        id: ch.id,
        name: ch.name,
        keep_alive: ch.keep_alive,
        is_active: ch.is_active,
        transcoder_active: !!entry,
        transcoder_ready: entry?.ready || false,
        transcoder_type: entry?.type || null,
        clients: entry?.clients || 0,
        uptime_seconds: entry ? Math.round((Date.now() - (entry.startTime || entry.lastAccess)) / 1000) : 0,
        cache_segments: segmentCount,
        cache_size_mb: Math.round(cacheSize / 1024 / 1024 * 10) / 10,
        adaptive: entry?.adaptive || false,
      };
    });
    res.json(status);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// =============================================
// PROXY HLS NATIVO (para canales que ya son m3u8)
// Caché de manifiestos y segmentos compartido
// =============================================
const streamCache = new Map(); // cacheKey -> { data, timestamp }
const segmentCache = new Map(); // url -> { data: Buffer, timestamp }
const SEGMENT_CACHE_TTL = 15000;
const pendingSegments = new Map();

// Limpiar segmentos viejos cada 30s
setInterval(() => {
  const now = Date.now();
  segmentCache.forEach((entry, key) => {
    if (now - entry.timestamp > SEGMENT_CACHE_TTL) segmentCache.delete(key);
  });
}, 30000);

// Limpiar manifiestos viejos cada 5min
setInterval(() => {
  const now = Date.now();
  streamCache.forEach((entry, key) => {
    if (now - entry.timestamp > 60000) streamCache.delete(key);
  });
}, 5 * 60 * 1000);

function startHLSProxy(channelId, sourceUrl) {
  if (activeTranscoders.has(channelId)) {
    const existing = activeTranscoders.get(channelId);
    existing.clients++;
    existing.lastAccess = Date.now();
    return existing;
  }

  const entry = {
    clients: 1,
    lastAccess: Date.now(),
    startTime: Date.now(),
    type: 'hls-proxy',
    sourceUrl,
    ready: true,
    keepAlivePoller: null, // interval for active keep-alive polling
  };
  activeTranscoders.set(channelId, entry);
  console.log(`📡 [${channelId}] Proxy HLS iniciado: ${sourceUrl}`);
  return entry;
}

// =============================================
// KEEP-ALIVE ACTIVO para HLS Proxy
// Pre-descarga manifiestos y segmentos cada ~5s
// para mantener el caché caliente (como Xtream UI)
// =============================================
function startHLSKeepAlivePoller(channelId, sourceUrl) {
  const entry = activeTranscoders.get(channelId);
  if (!entry || entry.keepAlivePoller) return; // ya tiene poller

  let lastSegments = new Set();

  const poll = async () => {
    try {
      // 1. Descargar el manifiesto maestro/variante
      const parsedUrl = new URL(sourceUrl);
      const httpClient = parsedUrl.protocol === 'https:' ? https : http;
      
      const fetchUrl = (url) => new Promise((resolve, reject) => {
        const req = httpClient.request(url, {
          method: 'GET',
          headers: { 'User-Agent': 'StreamBox/1.0' },
        }, (res) => {
          if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
            fetchUrl(res.headers.location).then(resolve).catch(reject);
            return;
          }
          const chunks = [];
          res.on('data', chunk => chunks.push(chunk));
          res.on('end', () => resolve(Buffer.concat(chunks)));
          res.on('error', reject);
        });
        req.on('error', reject);
        req.setTimeout(10000, () => { req.destroy(); reject(new Error('Timeout')); });
        req.end();
      });

      const manifestBuf = await fetchUrl(sourceUrl);
      const manifest = manifestBuf.toString();
      const baseUrl = sourceUrl.substring(0, sourceUrl.lastIndexOf('/') + 1);

      // Si es master playlist, seguir el primer variant
      let mediaPlaylistUrl = sourceUrl;
      let mediaManifest = manifest;
      
      const variantMatch = manifest.match(/^(?!#)(.+\.m3u8.*)$/m);
      if (variantMatch) {
        mediaPlaylistUrl = variantMatch[1].startsWith('http') 
          ? variantMatch[1] 
          : baseUrl + variantMatch[1];
        const mediaBuf = await fetchUrl(mediaPlaylistUrl);
        mediaManifest = mediaBuf.toString();
      }

      // Cachear el manifiesto
      const cacheKey = `m3u8_${channelId}`;
      const mediaBase = mediaPlaylistUrl.substring(0, mediaPlaylistUrl.lastIndexOf('/') + 1);
      
      // Reescribir URLs en el manifiesto para el proxy
      const rewritten = mediaManifest.replace(/^(?!#)(.+\.ts.*)$/gm, (match) => {
        const fullUrl = match.startsWith('http') ? match : mediaBase + match;
        return `/api/hls-segment/${channelId}?url=${encodeURIComponent(fullUrl)}`;
      }).replace(/^(?!#)(.+\.m3u8.*)$/gm, (match) => {
        const fullUrl = match.startsWith('http') ? match : mediaBase + match;
        return `/api/hls-manifest/${channelId}?url=${encodeURIComponent(fullUrl)}`;
      });
      streamCache.set(cacheKey, { data: rewritten, timestamp: Date.now() });

      // 2. Pre-descargar los últimos segmentos .ts (solo los nuevos)
      const segmentLines = mediaManifest.match(/^(?!#)(.+\.ts.*)$/gm) || [];
      // Solo los últimos 3 segmentos (para no saturar)
      const recentSegments = segmentLines.slice(-3);
      const newSegments = new Set();

      for (const seg of recentSegments) {
        const segUrl = seg.startsWith('http') ? seg : mediaBase + seg;
        newSegments.add(segUrl);
        
        // Solo descargar si es un segmento nuevo que no teníamos
        if (!lastSegments.has(segUrl) && !segmentCache.has(segUrl)) {
          try {
            const segData = await fetchUrl(segUrl);
            segmentCache.set(segUrl, { data: segData, timestamp: Date.now() });
          } catch (segErr) {
            // Segmento individual falló, no es crítico
          }
        }
      }
      lastSegments = newSegments;

      // Marcar como ready
      const currentEntry = activeTranscoders.get(channelId);
      if (currentEntry) currentEntry.ready = true;

    } catch (err) {
      // Si falla la descarga, no hacer nada (reintentará en el próximo ciclo)
      const currentEntry = activeTranscoders.get(channelId);
      if (currentEntry) currentEntry.ready = false;
    }
  };

  // Primera descarga inmediata, luego cada 5 segundos
  poll();
  entry.keepAlivePoller = setInterval(poll, 5000);
  console.log(`💚 [${channelId}] Keep-alive HLS poller activo (cada 5s)`);
}

function stopHLSKeepAlivePoller(channelId) {
  const entry = activeTranscoders.get(channelId);
  if (entry && entry.keepAlivePoller) {
    clearInterval(entry.keepAlivePoller);
    entry.keepAlivePoller = null;
    console.log(`🔴 [${channelId}] Keep-alive HLS poller detenido`);
  }
}

// Obtener manifiesto m3u8 con caché y reescritura de URLs
const getCachedM3U8 = async (channelId, targetUrl) => {
  const cacheKey = `m3u8_${channelId}`;
  const cached = streamCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < 5000) return cached.data;

  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(targetUrl);
    const httpClient = parsedUrl.protocol === 'https:' ? https : http;
    const req = httpClient.request(targetUrl, {
      method: 'GET',
      headers: { 'User-Agent': 'StreamBox/1.0' },
    }, (res) => {
      let body = '';
      res.on('data', chunk => { body += chunk.toString(); });
      res.on('end', () => {
        const baseUrl = targetUrl.substring(0, targetUrl.lastIndexOf('/') + 1);
        const rewritten = body.replace(/^(?!#)(.+\.ts.*)$/gm, (match) => {
          const fullUrl = match.startsWith('http') ? match : baseUrl + match;
          return `/api/hls-segment/${channelId}?url=${encodeURIComponent(fullUrl)}`;
        }).replace(/^(?!#)(.+\.m3u8.*)$/gm, (match) => {
          const fullUrl = match.startsWith('http') ? match : baseUrl + match;
          return `/api/hls-manifest/${channelId}?url=${encodeURIComponent(fullUrl)}`;
        });
        streamCache.set(cacheKey, { data: rewritten, timestamp: Date.now() });
        resolve(rewritten);
      });
    });
    req.on('error', reject);
    req.setTimeout(15000, () => { req.destroy(); reject(new Error('Timeout')); });
    req.end();
  });
};

// Descargar segmento con caché compartido
const fetchSegment = (segmentUrl) => {
  if (pendingSegments.has(segmentUrl)) return pendingSegments.get(segmentUrl);
  const cached = segmentCache.get(segmentUrl);
  if (cached && Date.now() - cached.timestamp < SEGMENT_CACHE_TTL) return Promise.resolve(cached.data);

  const promise = new Promise((resolve, reject) => {
    const parsedUrl = new URL(segmentUrl);
    const httpClient = parsedUrl.protocol === 'https:' ? https : http;
    const req = httpClient.request(segmentUrl, {
      method: 'GET',
      headers: { 'User-Agent': 'StreamBox/1.0' },
    }, (res) => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => {
        const buffer = Buffer.concat(chunks);
        segmentCache.set(segmentUrl, { data: buffer, timestamp: Date.now() });
        pendingSegments.delete(segmentUrl);
        resolve(buffer);
      });
      res.on('error', (err) => { pendingSegments.delete(segmentUrl); reject(err); });
    });
    req.on('error', (err) => { pendingSegments.delete(segmentUrl); reject(err); });
    req.setTimeout(15000, () => { req.destroy(); pendingSegments.delete(segmentUrl); reject(new Error('Timeout')); });
    req.end();
  });
  pendingSegments.set(segmentUrl, promise);
  return promise;
};

// Limpieza general a medianoche
const scheduleCacheCleanup = () => {
  const now = new Date();
  const midnight = new Date(now);
  midnight.setDate(midnight.getDate() + 1);
  midnight.setHours(0, 0, 0, 0);
  setTimeout(() => {
    console.log('🧹 Limpieza de caché a medianoche...');
    // Matar todos los FFmpeg sin clientes (excepto keep-alive)
    activeTranscoders.forEach((entry, key) => {
      if (entry.clients <= 0 && !entry.keepAlive) {
        if ((entry.type === 'ffmpeg' || entry.type === 'ffmpeg-adaptive') && entry.ffmpeg) entry.ffmpeg.kill('SIGTERM');
        activeTranscoders.delete(key);
        cleanChannelDir(key);
      }
    });
    streamCache.clear();
    segmentCache.clear();
    scheduleCacheCleanup();
  }, midnight.getTime() - now.getTime());
  console.log(`⏰ Próxima limpieza: ${midnight.toLocaleString()}`);
};
scheduleCacheCleanup();

// =============================================
// ENDPOINT PRINCIPAL: /api/restream/:channelId
// Sirve HLS para TODOS los tipos de canal
// =============================================
app.get('/api/restream/:channelId', async (req, res) => {
  try {
    const { rows: channels } = await pool.query(
      'SELECT url FROM channels WHERE id = $1 AND is_active = true',
      [req.params.channelId]
    );
    if (channels.length === 0) return res.status(404).json({ error: 'Canal no encontrado' });

    const targetUrl = channels[0].url;
    const channelId = req.params.channelId;
    const isHLS = /\.m3u8?(\?|$)/i.test(targetUrl);

    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Cache-Control', 'no-cache, no-store');

    if (isHLS) {
      // Canal ya es HLS → proxy con caché
      startHLSProxy(channelId, targetUrl);
      try {
        const manifest = await getCachedM3U8(channelId, targetUrl);
        res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
        res.send(manifest);
      } catch (err) {
        console.error('HLS proxy error:', err.message);
        res.status(502).json({ error: 'No se pudo obtener el manifiesto HLS' });
      }
      // Liberar al terminar respuesta
      res.on('finish', () => releaseTranscoder(channelId));
    } else {
      // Canal TS → FFmpeg → HLS (adaptive o single)
      const entry = startFFmpegTranscoder(channelId, targetUrl);

      // Esperar a que FFmpeg genere el manifiesto (máximo 20s para adaptive)
      let waited = 0;
      const waitForManifest = () => {
        // Check for master playlist first (adaptive), then fallback manifest
        const masterPath = path.join(HLS_DIR, channelId, 'master.m3u8');
        const singlePath = entry.manifestPath || path.join(HLS_DIR, channelId, 'stream.m3u8');
        const fallbackPath = entry.fallbackManifest || singlePath;

        let manifestFile = null;
        if (fs.existsSync(masterPath)) {
          manifestFile = masterPath;
        } else if (fs.existsSync(singlePath)) {
          manifestFile = singlePath;
        } else if (fs.existsSync(fallbackPath)) {
          manifestFile = fallbackPath;
        }

        if (manifestFile) {
          let manifest = fs.readFileSync(manifestFile, 'utf8');

          if (manifestFile.includes('master.m3u8')) {
            // Rewrite sub-playlist paths in master playlist
            manifest = manifest.replace(/(low|med|high)\/stream\.m3u8/g, (match, quality) => {
              return `/api/hls-adaptive/${channelId}/${quality}/stream.m3u8`;
            });
          } else {
            // Single quality: rewrite segment paths
            manifest = manifest.replace(/seg_\d+\.ts/g, (match) => {
              return `/api/hls-local/${channelId}/${match}`;
            });
          }

          res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
          res.send(manifest);
          res.on('finish', () => releaseTranscoder(channelId));
        } else if (waited < 20000) {
          waited += 500;
          setTimeout(waitForManifest, 500);
        } else {
          releaseTranscoder(channelId);
          res.status(504).json({ error: 'FFmpeg no generó el manifiesto a tiempo' });
        }
      };
      waitForManifest();
    }
  } catch (err) {
    console.error('Restream error:', err);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// Servir sub-playlists adaptativas (low/med/high)
app.get('/api/hls-adaptive/:channelId/:quality/stream.m3u8', (req, res) => {
  const { channelId, quality } = req.params;
  const filePath = path.join(HLS_DIR, channelId, quality, 'stream.m3u8');
  if (!fs.existsSync(filePath)) {
    return res.status(404).send('Quality playlist not found');
  }
  let manifest = fs.readFileSync(filePath, 'utf8');
  // Rewrite segment paths
  manifest = manifest.replace(/seg_\d+\.ts/g, (match) => {
    return `/api/hls-local/${channelId}/${quality}/${match}`;
  });
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
  res.setHeader('Cache-Control', 'no-cache');
  res.send(manifest);
});

// Servir segmentos locales generados por FFmpeg (con o sin calidad)
app.get('/api/hls-local/:channelId/:qualityOrFile/:filename?', (req, res) => {
  const { channelId, qualityOrFile, filename } = req.params;
  let filePath;
  if (filename) {
    // /api/hls-local/:channelId/:quality/:filename
    filePath = path.join(HLS_DIR, channelId, qualityOrFile, filename);
  } else {
    // /api/hls-local/:channelId/:filename (legacy single quality)
    filePath = path.join(HLS_DIR, channelId, qualityOrFile);
  }
  if (!fs.existsSync(filePath)) {
    return res.status(404).send('Segment not found');
  }
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Content-Type', 'video/mp2t');
  res.setHeader('Cache-Control', 'public, max-age=10');
  fs.createReadStream(filePath).pipe(res);
});

// Proxy de segmentos HLS remotos (para canales que ya son HLS)
app.get('/api/hls-segment/:channelId', async (req, res) => {
  try {
    const segmentUrl = req.query.url;
    if (!segmentUrl) return res.status(400).send('Missing url');
    const data = await fetchSegment(segmentUrl);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Content-Type', 'video/mp2t');
    res.setHeader('Cache-Control', 'public, max-age=10');
    res.send(data);
  } catch (err) {
    console.error('Segment proxy error:', err.message);
    res.status(502).send('Segment fetch failed');
  }
});

// Proxy de sub-manifiestos HLS (multi-bitrate)
app.get('/api/hls-manifest/:channelId', async (req, res) => {
  try {
    const hlsUrl = req.query.url;
    if (!hlsUrl) return res.status(400).send('Missing url');
    const manifest = await getCachedM3U8(req.params.channelId + '_sub', hlsUrl);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
    res.setHeader('Cache-Control', 'no-cache');
    res.send(manifest);
  } catch (err) {
    console.error('HLS sub-manifest error:', err.message);
    res.status(502).send('Manifest fetch failed');
  }
});

// =============================================
// RUTA: DIAGNÓSTICO DE CANAL
// Prueba la conexión al origen y reporta detalles
// =============================================
app.post('/api/channels/diagnose', authAdmin, async (req, res) => {
  try {
    const { url, channel_id } = req.body;
    if (!url) return res.status(400).json({ error: 'URL requerida' });

    const startTime = Date.now();
    const isHttps = url.startsWith('https');
    const client = isHttps ? https : http;

    const result = await new Promise((resolve) => {
      const timeout = setTimeout(() => {
        resolve({
          status: 'timeout',
          http_code: null,
          content_type: null,
          response_time_ms: Date.now() - startTime,
          error_message: 'Timeout: El servidor de origen no respondió en 15 segundos',
          headers: null,
          details: 'El servidor de origen no responde. Puede estar caído, la URL incorrecta, o bloqueando la IP de este VPS.',
        });
      }, 15000);

      const req = client.get(url, { timeout: 15000 }, (response) => {
        clearTimeout(timeout);
        const elapsed = Date.now() - startTime;
        const headers = {};
        for (const [k, v] of Object.entries(response.headers)) {
          if (typeof v === 'string') headers[k] = v;
        }
        
        const contentType = response.headers['content-type'] || 'desconocido';
        const httpCode = response.statusCode;
        let details = '';
        
        if (httpCode >= 200 && httpCode < 300) {
          details = 'Stream accesible correctamente desde el VPS';
        } else if (httpCode === 301 || httpCode === 302) {
          details = `Redirección a: ${response.headers.location || 'desconocido'}. Puede necesitar la URL final.`;
        } else if (httpCode === 403) {
          details = 'Acceso denegado (403). La IP del VPS puede estar bloqueada o la URL requiere autenticación.';
        } else if (httpCode === 404) {
          details = 'No encontrado (404). La URL del canal puede haber cambiado o ser incorrecta.';
        } else if (httpCode === 500 || httpCode === 502 || httpCode === 503) {
          details = `Error del servidor origen (${httpCode}). El proveedor puede tener problemas.`;
        } else {
          details = `Respuesta HTTP ${httpCode}`;
        }

        // Read a small chunk to verify data flows
        let bytesRead = 0;
        response.on('data', (chunk) => {
          bytesRead += chunk.length;
          if (bytesRead > 4096) {
            response.destroy(); // Got enough data
          }
        });

        response.on('end', () => finalize());
        response.on('close', () => finalize());
        
        let finalized = false;
        function finalize() {
          if (finalized) return;
          finalized = true;
          
          if (httpCode >= 200 && httpCode < 300 && bytesRead > 0) {
            details += ` — Recibidos ${bytesRead} bytes de datos.`;
          } else if (httpCode >= 200 && httpCode < 300 && bytesRead === 0) {
            details += ' — ADVERTENCIA: No se recibieron datos. El stream puede estar vacío.';
          }

          resolve({
            status: httpCode >= 200 && httpCode < 400 ? 'ok' : 'error',
            http_code: httpCode,
            content_type: contentType,
            response_time_ms: elapsed,
            error_message: httpCode >= 400 ? `HTTP ${httpCode}: ${details}` : null,
            headers,
            details,
          });
        }
      });

      req.on('error', (err) => {
        clearTimeout(timeout);
        resolve({
          status: 'error',
          http_code: null,
          content_type: null,
          response_time_ms: Date.now() - startTime,
          error_message: `Error de conexión: ${err.message}`,
          headers: null,
          details: err.code === 'ECONNREFUSED' 
            ? 'Conexión rechazada. El servidor de origen no acepta conexiones en ese puerto.'
            : err.code === 'ENOTFOUND'
            ? 'DNS no encontrado. El dominio de la URL no existe o no resuelve.'
            : err.code === 'ETIMEDOUT'
            ? 'Timeout de conexión. El servidor no responde.'
            : `Error: ${err.message} (${err.code || 'unknown'})`,
        });
      });
    });

    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// RUTA: IMPORTAR CANALES DESDE M3U
// Parsea listas M3U/M3U8 y las agrega como canales
// =============================================
app.post('/api/channels/import-m3u', authAdmin, async (req, res) => {
  try {
    const { m3u_content, m3u_url, keep_alive } = req.body;
    let content = m3u_content;

    // Si se proporcionó una URL, descargar el contenido
    if (m3u_url && !content) {
      const response = await new Promise((resolve, reject) => {
        const client = m3u_url.startsWith('https') ? https : http;
        client.get(m3u_url, (res) => {
          let data = '';
          res.on('data', chunk => data += chunk);
          res.on('end', () => resolve(data));
        }).on('error', reject);
      });
      content = response;
    }

    if (!content) {
      return res.status(400).json({ error: 'Proporciona m3u_content o m3u_url' });
    }

    // Parsear M3U
    const lines = content.split('\n').map(l => l.trim()).filter(l => l);
    const channels = [];
    let currentName = '';
    let currentCategory = 'General';
    let currentLogo = null;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      if (line.startsWith('#EXTINF:')) {
        // Extraer nombre
        const nameMatch = line.match(/,(.+)$/);
        currentName = nameMatch ? nameMatch[1].trim() : `Canal ${channels.length + 1}`;

        // Extraer grupo/categoría
        const groupMatch = line.match(/group-title="([^"]+)"/);
        currentCategory = groupMatch ? groupMatch[1] : 'General';

        // Extraer logo
        const logoMatch = line.match(/tvg-logo="([^"]+)"/);
        currentLogo = logoMatch ? logoMatch[1] : null;
      } else if (!line.startsWith('#') && line.length > 0) {
        // Es una URL de stream
        const validation = validateStreamSourceUrl(line);
        if (!validation.valid) {
          continue;
        }

        channels.push({
          name: currentName || `Canal ${channels.length + 1}`,
          url: validation.normalizedUrl,
          category: currentCategory,
          logo_url: currentLogo,
          sort_order: channels.length,
          is_active: true,
        });
        currentName = '';
        currentCategory = 'General';
        currentLogo = null;
      }
    }

    if (channels.length === 0) {
      return res.status(400).json({ error: 'No se encontraron canales en el contenido M3U' });
    }

    // Insertar canales
    let inserted = 0;
    for (const ch of channels) {
      try {
        await pool.query(
          'INSERT INTO channels (name, url, category, logo_url, sort_order, is_active, keep_alive) VALUES ($1, $2, $3, $4, $5, $6, $7)',
          [ch.name, ch.url, ch.category, ch.logo_url, ch.sort_order, ch.is_active, keep_alive ? true : false]
        );
        inserted++;
      } catch (err) {
        // Ignorar duplicados u otros errores individuales
        console.error(`Error importando canal ${ch.name}:`, err.message);
      }
    }

    res.json({ imported: inserted, total: channels.length });
  } catch (err) {
    res.status(500).json({ error: 'Error al importar M3U: ' + err.message });
  }
});

// =============================================
// RUTA: DASHBOARD ESTADÍSTICAS
// =============================================
app.get('/api/stats', authAdmin, async (req, res) => {
  try {
    const now = new Date().toISOString();

    // Consultas en paralelo para rendimiento
    const [
      totalClients,
      activeClients,
      expiredClients,
      suspendedClients,
      expiringClients,
      totalResellers,
      activeResellers,
      totalChannels,
      activeChannels,
      totalAds,
      activeConnections,
      recentClients,
      clientsByMonth,
      categoryStats
    ] = await Promise.all([
      pool.query('SELECT COUNT(*)::int AS count FROM clients'),
      pool.query('SELECT COUNT(*)::int AS count FROM clients WHERE is_active = true AND expiry_date > $1', [now]),
      pool.query('SELECT COUNT(*)::int AS count FROM clients WHERE expiry_date <= $1', [now]),
      pool.query('SELECT COUNT(*)::int AS count FROM clients WHERE is_active = false'),
      pool.query('SELECT COUNT(*)::int AS count FROM clients WHERE is_active = true AND expiry_date > $1 AND expiry_date <= $2', [now, new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()]),
      pool.query('SELECT COUNT(*)::int AS count FROM resellers'),
      pool.query('SELECT COUNT(*)::int AS count FROM resellers WHERE is_active = true'),
      pool.query('SELECT COUNT(*)::int AS count FROM channels'),
      pool.query('SELECT COUNT(*)::int AS count FROM channels WHERE is_active = true'),
      pool.query('SELECT COUNT(*)::int AS count FROM ads WHERE is_active = true'),
      pool.query('SELECT COUNT(*)::int AS count FROM active_connections WHERE last_heartbeat >= $1', [new Date(Date.now() - 5 * 60 * 1000).toISOString()]),
      pool.query('SELECT id, username, is_active, expiry_date, created_at FROM clients ORDER BY created_at DESC LIMIT 5'),
      pool.query(`SELECT TO_CHAR(created_at, 'YYYY-MM') AS month, COUNT(*)::int AS count FROM clients WHERE created_at >= NOW() - INTERVAL '6 months' GROUP BY month ORDER BY month`),
      pool.query('SELECT category, COUNT(*)::int AS count FROM channels WHERE is_active = true GROUP BY category ORDER BY count DESC')
    ]);

    res.json({
      clients: {
        total: totalClients.rows[0].count,
        active: activeClients.rows[0].count,
        expired: expiredClients.rows[0].count,
        suspended: suspendedClients.rows[0].count,
        expiring_soon: expiringClients.rows[0].count,
      },
      resellers: {
        total: totalResellers.rows[0].count,
        active: activeResellers.rows[0].count,
      },
      channels: {
        total: totalChannels.rows[0].count,
        active: activeChannels.rows[0].count,
      },
      ads_active: totalAds.rows[0].count,
      connections_now: activeConnections.rows[0].count,
      recent_clients: recentClients.rows,
      clients_by_month: clientsByMonth.rows,
      categories: categoryStats.rows,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// =============================================
// RUTA: STREAMS ACTIVOS (monitor de conexiones al origen)
// =============================================
app.get('/api/streams/active', authAdmin, async (req, res) => {
  try {
    const streams = [];
    for (const [channelId, entry] of activeTranscoders) {
      const { rows } = await pool.query('SELECT name, url FROM channels WHERE id = $1', [channelId]);
      const channelName = rows.length > 0 ? rows[0].name : 'Desconocido';
      const sourceUrl = rows.length > 0 ? rows[0].url : entry.sourceUrl || 'N/A';
      
      streams.push({
        channel_id: channelId,
        channel_name: channelName,
        type: entry.type,
        clients: Math.max(0, entry.clients),
        ready: entry.ready !== undefined ? entry.ready : true,
        keep_alive: entry.keepAlive || false,
        uptime_seconds: Math.floor((Date.now() - entry.lastAccess) / 1000),
        source_url: sourceUrl.substring(0, 60) + (sourceUrl.length > 60 ? '...' : ''),
      });
    }
    
    res.json({
      total_streams: streams.length,
      total_clients_watching: streams.reduce((sum, s) => sum + s.clients, 0),
      origin_connections: streams.length,
      streams,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// =============================================
// RUTA: ESPECTADORES ACTIVOS (quién ve qué, desde dónde)
// =============================================
app.get('/api/viewers/active', authAdmin, async (req, res) => {
  try {
    const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    const { rows } = await pool.query(`
      SELECT 
        ac.id, ac.device_id, ac.ip_address, ac.country, ac.city, ac.connected_at, ac.last_heartbeat,
        c.username AS client_username, c.id AS client_id,
        ch.name AS channel_name, ch.category AS channel_category, ch.logo_url AS channel_logo
      FROM active_connections ac
      JOIN clients c ON ac.client_id = c.id
      LEFT JOIN channels ch ON ac.watching_channel_id = ch.id
      WHERE ac.last_heartbeat >= $1
      ORDER BY ac.last_heartbeat DESC
    `, [fiveMinAgo]);
    
    res.json({
      total_viewers: rows.length,
      viewers: rows,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/clients/expiring', authAdmin, async (req, res) => {
  try {
    const now = new Date();
    const in1Day = new Date(Date.now() + 1 * 24 * 60 * 60 * 1000).toISOString();
    const in3Days = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString();
    const in7Days = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
    const nowISO = now.toISOString();

    const { rows } = await pool.query(
      `SELECT id, username, max_screens, expiry_date, notes, reseller_id 
       FROM clients 
       WHERE is_active = true AND expiry_date > $1 AND expiry_date <= $2 
       ORDER BY expiry_date ASC`,
      [nowISO, in7Days]
    );

    const clients = rows.map(c => {
      const expDate = new Date(c.expiry_date);
      let urgency = 'low';
      if (expDate <= new Date(in1Day)) urgency = 'critical';
      else if (expDate <= new Date(in3Days)) urgency = 'high';
      
      const diffMs = expDate.getTime() - now.getTime();
      const days_left = Math.max(0, Math.floor(diffMs / (1000 * 60 * 60 * 24)));
      const hours_left = Math.max(0, Math.floor((diffMs % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60)));

      return { ...c, urgency, days_left, hours_left };
    });

    res.json({
      total: clients.length,
      critical: clients.filter(c => c.urgency === 'critical').length,
      high: clients.filter(c => c.urgency === 'high').length,
      low: clients.filter(c => c.urgency === 'low').length,
      clients,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// =============================================
// CLOUDFLARE TUNNEL - Gestión desde admin panel
// =============================================
const { execSync } = require('child_process');

let tunnelProcess = null;
let tunnelUrl = null;
let tunnelStatus = 'stopped'; // stopped | starting | running | error
let tunnelError = null;
let tunnelMode = 'full'; // 'full' = todo por túnel, 'hybrid' = solo admin por túnel

// Detectar IP local del servidor
const getServerIP = () => {
  try {
    const os = require('os');
    const interfaces = os.networkInterfaces();
    for (const name of Object.keys(interfaces)) {
      for (const iface of interfaces[name]) {
        if (iface.family === 'IPv4' && !iface.internal) {
          return iface.address;
        }
      }
    }
  } catch {}
  return null;
};

// Check if cloudflared is installed
const isCloudflaredInstalled = () => {
  try {
    execSync('which cloudflared', { stdio: 'ignore' });
    return true;
  } catch { return false; }
};

// Get tunnel status
app.get('/api/tunnel/status', authAdmin, (req, res) => {
  const serverIP = getServerIP();
  res.json({
    installed: isCloudflaredInstalled(),
    status: tunnelStatus,
    url: tunnelUrl,
    error: tunnelError,
    https: tunnelUrl ? tunnelUrl.startsWith('https://') : false,
    mode: tunnelMode,
    server_ip: serverIP,
    stream_base_url: tunnelMode === 'hybrid' && tunnelUrl && serverIP ? `http://${serverIP}` : null,
  });
});

// Set tunnel mode
app.post('/api/tunnel/mode', authAdmin, (req, res) => {
  const { mode } = req.body;
  if (!['full', 'hybrid'].includes(mode)) {
    return res.status(400).json({ error: 'Modo inválido. Usa "full" o "hybrid"' });
  }
  tunnelMode = mode;
  console.log(`🔄 Modo de túnel cambiado a: ${mode}`);
  res.json({ success: true, mode: tunnelMode });
});

// Install cloudflared
app.post('/api/tunnel/install', authAdmin, (req, res) => {
  if (isCloudflaredInstalled()) {
    return res.json({ success: true, message: 'cloudflared ya está instalado' });
  }
  try {
    console.log('📦 Instalando cloudflared...');
    execSync('curl -fsSL https://pkg.cloudflare.com/cloudflare-main.gpg | sudo tee /usr/share/keyrings/cloudflare-main.gpg >/dev/null && echo "deb [signed-by=/usr/share/keyrings/cloudflare-main.gpg] https://pkg.cloudflare.com/cloudflared any main" | sudo tee /etc/apt/sources.list.d/cloudflared.list && sudo apt-get update && sudo apt-get install -y cloudflared', { stdio: 'pipe', timeout: 120000 });
    res.json({ success: true, message: 'cloudflared instalado correctamente' });
  } catch (err) {
    // Fallback: download binary directly
    try {
      execSync('curl -fsSL -o /usr/local/bin/cloudflared https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64 && chmod +x /usr/local/bin/cloudflared', { stdio: 'pipe', timeout: 60000 });
      res.json({ success: true, message: 'cloudflared instalado (binario directo)' });
    } catch (err2) {
      res.status(500).json({ success: false, error: `Error instalando: ${err2.message}` });
    }
  }
});

// Start tunnel
app.post('/api/tunnel/start', authAdmin, (req, res) => {
  if (!isCloudflaredInstalled()) {
    return res.status(400).json({ error: 'cloudflared no está instalado. Instálalo primero.' });
  }
  if (tunnelProcess) {
    return res.json({ success: true, url: tunnelUrl, message: 'El túnel ya está corriendo' });
  }

  tunnelStatus = 'starting';
  tunnelUrl = null;
  tunnelError = null;

  const targetPort = req.body.port || 80;
  tunnelProcess = spawn('cloudflared', ['tunnel', '--url', `http://localhost:${targetPort}`, '--no-autoupdate'], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let output = '';

  const extractUrl = (data) => {
    const text = data.toString();
    output += text;
    // Cloudflared prints the URL to stderr
    const match = text.match(/https:\/\/[a-zA-Z0-9-]+\.trycloudflare\.com/);
    if (match && !tunnelUrl) {
      tunnelUrl = match[0];
      tunnelStatus = 'running';
      console.log(`🌐 Cloudflare Tunnel activo: ${tunnelUrl}`);
    }
  };

  tunnelProcess.stdout.on('data', extractUrl);
  tunnelProcess.stderr.on('data', extractUrl);

  tunnelProcess.on('error', (err) => {
    tunnelStatus = 'error';
    tunnelError = err.message;
    tunnelProcess = null;
  });

  tunnelProcess.on('exit', (code) => {
    if (tunnelStatus !== 'stopped') {
      tunnelStatus = code === 0 ? 'stopped' : 'error';
      if (code !== 0) tunnelError = `Proceso terminó con código ${code}`;
    }
    tunnelProcess = null;
    tunnelUrl = null;
  });

  // Wait a few seconds for URL to appear
  setTimeout(() => {
    res.json({ success: true, status: tunnelStatus, url: tunnelUrl, message: tunnelUrl ? 'Túnel iniciado' : 'Iniciando túnel, espera unos segundos...' });
  }, 5000);
});

// Stop tunnel
app.post('/api/tunnel/stop', authAdmin, (req, res) => {
  if (tunnelProcess) {
    tunnelStatus = 'stopped';
    tunnelProcess.kill('SIGTERM');
    tunnelProcess = null;
    tunnelUrl = null;
    tunnelError = null;
    res.json({ success: true, message: 'Túnel detenido' });
  } else {
    tunnelStatus = 'stopped';
    tunnelUrl = null;
    res.json({ success: true, message: 'El túnel no estaba corriendo' });
  }
});

// =============================================
// PLAYLIST M3U - Token-based, compatible con OTT Player, Smart IPTV, etc.
// =============================================

// Regenerar token de playlist
app.post('/api/clients/:id/regenerate-token', authAdmin, async (req, res) => {
  try {
    const newToken = crypto.randomBytes(16).toString('hex');
    const { rows } = await pool.query(
      'UPDATE clients SET playlist_token = $1 WHERE id = $2 RETURNING *',
      [newToken, req.params.id]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Cliente no encontrado' });
    res.json({ token: newToken, client: rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Generar tokens para clientes existentes que no tienen uno
app.post('/api/clients/generate-tokens', authAdmin, async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT id FROM clients WHERE playlist_token IS NULL');
    let updated = 0;
    for (const client of rows) {
      const token = crypto.randomBytes(16).toString('hex');
      await pool.query('UPDATE clients SET playlist_token = $1 WHERE id = $2', [token, client.id]);
      updated++;
    }
    res.json({ updated, message: `${updated} tokens generados` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Endpoint público: M3U playlist por token
// GET /api/playlist/:token
// Compatible con OTT Player, Smart IPTV, SS IPTV, etc.
app.get('/api/playlist/:token', async (req, res) => {
  try {
    const { token } = req.params;
    
    // Buscar cliente por token
    const { rows: clients } = await pool.query(
      'SELECT c.*, p.categories as plan_categories FROM clients c LEFT JOIN plans p ON c.plan_id = p.id WHERE c.playlist_token = $1',
      [token]
    );
    
    if (clients.length === 0) {
      return res.status(404).send('#EXTM3U\n#EXTINF:-1,Token inválido\nhttp://invalid');
    }
    
    const client = clients[0];
    
    // Verificar que el cliente esté activo
    if (!client.is_active) {
      return res.status(403).send('#EXTM3U\n#EXTINF:-1,Cuenta suspendida\nhttp://suspended');
    }
    
    // Verificar expiración
    if (new Date(client.expiry_date) < new Date()) {
      await pool.query('UPDATE clients SET is_active = false WHERE id = $1', [client.id]);
      return res.status(403).send('#EXTM3U\n#EXTINF:-1,Suscripción expirada\nhttp://expired');
    }
    
    // Obtener canales activos
    let channelsQuery = 'SELECT id, name, url, category, logo_url, sort_order FROM channels WHERE is_active = true ORDER BY sort_order';
    const { rows: channels } = await pool.query(channelsQuery);
    
    // Filtrar por plan si tiene uno asignado
    let filteredChannels = channels;
    if (client.plan_categories && client.plan_categories.length > 0) {
      filteredChannels = channels.filter(ch => client.plan_categories.includes(ch.category));
    }
    
    // Determinar base URL para los streams
    // Cloudflare tunnel pone el dominio en Host header y proto en X-Forwarded-Proto
    // X-Forwarded-Host tiene prioridad si existe, luego Host header
    const proto = req.headers['x-forwarded-proto'] || req.protocol || 'http';
    const host = req.headers['x-forwarded-host'] || req.headers.host || `localhost:${PORT}`;
    const baseUrl = `${proto}://${host}`;
    
    // Generar M3U
    let m3u = '#EXTM3U\n';
    m3u += `#PLAYLIST:${client.username}\n`;
    m3u += `# StreamBox - Generado para ${client.username}\n`;
    m3u += `# Canales: ${filteredChannels.length}\n\n`;
    
    for (const ch of filteredChannels) {
      const isYouTube = /youtube\.com|youtu\.be/.test(ch.url);
      
      // Logo attribute
      const logoAttr = ch.logo_url ? ` tvg-logo="${ch.logo_url.startsWith('http') ? ch.logo_url : baseUrl + ch.logo_url}"` : '';
      
      m3u += `#EXTINF:-1 group-title="${ch.category}"${logoAttr},${ch.name}\n`;
      
      if (isYouTube) {
        // YouTube: URL directa (no se puede restream)
        m3u += `${ch.url}\n`;
      } else {
        // Todo lo demás: via restream para ocultar origen
        m3u += `${baseUrl}/api/restream/${ch.id}\n`;
      }
    }
    
    res.set({
      'Content-Type': 'audio/mpegurl',
      'Content-Disposition': `inline; filename="${client.username}.m3u"`,
      'Cache-Control': 'no-cache',
    });
    res.send(m3u);
    
  } catch (err) {
    console.error('Playlist error:', err);
    res.status(500).send('#EXTM3U\n#EXTINF:-1,Error del servidor\nhttp://error');
  }
});

// =============================================
// RUTAS: PLANES (requiere admin)
// =============================================
app.get('/api/plans', authAdmin, async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM plans ORDER BY sort_order');
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/plans', authAdmin, async (req, res) => {
  const { name, description, categories, price, sort_order } = req.body;
  try {
    const { rows } = await pool.query(
      'INSERT INTO plans (name, description, categories, price, sort_order) VALUES ($1, $2, $3, $4, $5) RETURNING *',
      [name, description || null, categories || '{}', price || 0, sort_order || 0]
    );
    res.json(rows[0]);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.put('/api/plans/:id', authAdmin, async (req, res) => {
  try {
    const { rows: current } = await pool.query('SELECT * FROM plans WHERE id = $1', [req.params.id]);
    if (current.length === 0) return res.status(404).json({ error: 'Plan no encontrado' });
    const p = current[0];
    const name = req.body.name !== undefined ? req.body.name : p.name;
    const description = req.body.description !== undefined ? req.body.description : p.description;
    const categories = req.body.categories !== undefined ? req.body.categories : p.categories;
    const price = req.body.price !== undefined ? req.body.price : p.price;
    const is_active = req.body.is_active !== undefined ? req.body.is_active : p.is_active;
    const sort_order = req.body.sort_order !== undefined ? req.body.sort_order : p.sort_order;
    const { rows } = await pool.query(
      'UPDATE plans SET name=$1, description=$2, categories=$3, price=$4, is_active=$5, sort_order=$6 WHERE id=$7 RETURNING *',
      [name, description, categories, price, is_active, sort_order, req.params.id]
    );
    res.json(rows[0]);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.delete('/api/plans/:id', authAdmin, async (req, res) => {
  await pool.query('DELETE FROM plans WHERE id = $1', [req.params.id]);
  res.json({ ok: true });
});

// =============================================
// RUTAS: BACKUPS (requiere admin)
// =============================================
const backupDir = path.join(__dirname, 'backups');
if (!fs.existsSync(backupDir)) fs.mkdirSync(backupDir, { recursive: true });

app.get('/api/backups', authAdmin, async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM system_backups ORDER BY created_at DESC');
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/backups', authAdmin, async (req, res) => {
  const { type = 'full' } = req.body;
  try {
    const tables = ['plans', 'resellers', 'channels', 'ads', 'clients', 'active_connections'];
    const backupData = {};
    for (const table of tables) {
      const { rows } = await pool.query(`SELECT * FROM ${table}`);
      backupData[table] = rows;
    }
    const backupContent = JSON.stringify({ version: '1.0', created_at: new Date().toISOString(), type, tables: backupData }, null, 2);
    const fileName = `backup-${type}-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
    const filePath = path.join(backupDir, fileName);
    fs.writeFileSync(filePath, backupContent);
    const fileSize = Buffer.byteLength(backupContent);
    const { rows } = await pool.query(
      'INSERT INTO system_backups (name, type, file_size, status, includes_db, includes_config) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *',
      [fileName, type, fileSize, 'completed', type === 'full' || type === 'database', type === 'full' || type === 'config']
    );
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/backups/:id/download', authAdmin, async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM system_backups WHERE id = $1', [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ error: 'Backup no encontrado' });
    const filePath = path.join(backupDir, rows[0].name);
    if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'Archivo no encontrado' });
    res.download(filePath, rows[0].name);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/backups/:id/restore', authAdmin, async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM system_backups WHERE id = $1', [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ error: 'Backup no encontrado' });
    const filePath = path.join(backupDir, rows[0].name);
    if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'Archivo no encontrado' });
    const content = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    if (!content.tables) return res.status(400).json({ error: 'Formato de backup inválido' });
    const restoreOrder = ['plans', 'resellers', 'channels', 'ads', 'clients'];
    for (const table of restoreOrder) {
      if (content.tables[table]) {
        await pool.query(`DELETE FROM ${table}`);
        for (const row of content.tables[table]) {
          const keys = Object.keys(row);
          const values = keys.map((_, i) => `$${i + 1}`);
          await pool.query(`INSERT INTO ${table} (${keys.join(',')}) VALUES (${values.join(',')}) ON CONFLICT DO NOTHING`, keys.map(k => row[k]));
        }
      }
    }
    res.json({ ok: true, message: 'Backup restaurado' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/backups/:id', authAdmin, async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM system_backups WHERE id = $1', [req.params.id]);
    if (rows.length > 0) {
      const filePath = path.join(backupDir, rows[0].name);
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    }
    await pool.query('DELETE FROM system_backups WHERE id = $1', [req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// =============================================
// XTREAM CODES API - Compatible con OTT Navigator,
// TiviMate, IPTV Smarters, XCIPTV, GSE, Purple, etc.
// Endpoints: /player_api.php, /live/, /get.php, /xmltv.php
// =============================================

// Helper: authenticate Xtream client
const xtreamAuth = async (username, password) => {
  const { rows } = await pool.query(
    'SELECT * FROM clients WHERE username = $1 AND password = $2',
    [username, password]
  );
  if (rows.length === 0) return null;
  const client = rows[0];
  if (!client.is_active) return null;
  if (new Date(client.expiry_date) < new Date()) return null;
  return client;
};

// Helper: get channels for client (filtered by plan)
const getXtreamChannels = async (client) => {
  let query = 'SELECT * FROM channels WHERE is_active = true ORDER BY sort_order';
  let { rows: channels } = await pool.query(query);

  // Filter by plan if client has one
  if (client.plan_id) {
    const { rows: planRows } = await pool.query('SELECT categories FROM plans WHERE id = $1', [client.plan_id]);
    if (planRows.length > 0 && planRows[0].categories && planRows[0].categories.length > 0) {
      const allowedCategories = planRows[0].categories;
      channels = channels.filter(ch => allowedCategories.includes(ch.category));
    }
  }
  return channels;
};

// Helper: get unique categories from channels
const getXtreamCategories = (channels) => {
  const cats = {};
  channels.forEach(ch => {
    if (!cats[ch.category]) {
      cats[ch.category] = { category_id: Object.keys(cats).length + 1, category_name: ch.category, parent_id: 0 };
    }
  });
  return Object.values(cats);
};

// Main Xtream API endpoint - /player_api.php
app.get('/player_api.php', async (req, res) => {
  try {
    const { username, password, action } = req.query;
    if (!username || !password) {
      return res.status(401).json({ user_info: { auth: 0, message: 'Authentication required' } });
    }

    const client = await xtreamAuth(username, password);
    if (!client) {
      return res.status(401).json({ user_info: { auth: 0, message: 'Authentication failed' } });
    }

    const serverUrl = `${req.protocol}://${req.get('host')}`;
    const now = new Date();
    const expiry = new Date(client.expiry_date);
    const hostParts = (req.get('host') || '').split(':');
    const serverPort = hostParts[1] || (req.protocol === 'https' ? '443' : '80');

    // No action = auth info (panel login)
    if (!action) {
      return res.json({
        user_info: {
          username: client.username,
          password: client.password,
          message: 'Welcome',
          auth: 1,
          status: 'Active',
          exp_date: Math.floor(expiry.getTime() / 1000).toString(),
          is_trial: '0',
          active_cons: '0',
          created_at: Math.floor(new Date(client.created_at).getTime() / 1000).toString(),
          max_connections: client.max_screens.toString(),
          allowed_output_formats: ['ts', 'm3u8'],
        },
        server_info: {
          url: serverUrl,
          port: serverPort,
          https_port: req.protocol === 'https' ? serverPort : '443',
          server_protocol: req.protocol,
          rtmp_port: '0',
          timezone: 'America/New_York',
          timestamp_now: Math.floor(now.getTime() / 1000),
          time_now: now.toISOString(),
        },
      });
    }

    const channels = await getXtreamChannels(client);
    const categories = getXtreamCategories(channels);

    // GET LIVE CATEGORIES
    if (action === 'get_live_categories') {
      return res.json(categories);
    }

    // GET LIVE STREAMS
    if (action === 'get_live_streams') {
      const categoryFilter = req.query.category_id;
      let filteredChannels = channels;
      if (categoryFilter) {
        const cat = categories.find(c => c.category_id === parseInt(categoryFilter));
        if (cat) filteredChannels = channels.filter(ch => ch.category === cat.category_name);
      }

      const streams = filteredChannels.map((ch, idx) => {
        const cat = categories.find(c => c.category_name === ch.category);
        return {
          num: idx + 1,
          name: ch.name,
          stream_type: 'live',
          stream_id: ch.id,
          stream_icon: ch.logo_url || '',
          epg_channel_id: null,
          added: Math.floor(new Date(ch.created_at).getTime() / 1000).toString(),
          category_id: cat ? cat.category_id.toString() : '1',
          category_name: ch.category,
          custom_sid: null,
          tv_archive: 0,
          direct_source: '',
          tv_archive_duration: 0,
        };
      });
      return res.json(streams);
    }

    // GET VOD CATEGORIES (empty - no VOD support)
    if (action === 'get_vod_categories') return res.json([]);
    // GET VOD STREAMS (empty)
    if (action === 'get_vod_streams') return res.json([]);
    // GET SERIES CATEGORIES (empty)
    if (action === 'get_series_categories') return res.json([]);
    // GET SERIES (empty)
    if (action === 'get_series') return res.json([]);

    // GET SHORT EPG (empty for now)
    if (action === 'get_short_epg' || action === 'get_simple_data_table') {
      return res.json({ epg_listings: [] });
    }

    return res.json({ error: 'Unknown action' });
  } catch (err) {
    console.error('Xtream API error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Also support POST for some apps (Smarters Pro, etc.)
app.post('/player_api.php', async (req, res) => {
  // Merge body params into query so the GET handler logic works
  req.query = { ...req.query, ...req.body };
  // Re-route through the GET handler directly
  const originalMethod = req.method;
  req.method = 'GET';
  app._router.handle(req, res, () => {
    req.method = originalMethod;
    res.status(404).json({ error: 'Not found' });
  });
});

// XMLTV EPG endpoint (empty for now)
app.get('/xmltv.php', (req, res) => {
  res.set('Content-Type', 'application/xml');
  res.send('<?xml version="1.0" encoding="UTF-8"?>\n<tv generator-info-name="StreamBox"></tv>');
});

// GET M3U via Xtream format: /get.php?username=X&password=X&type=m3u_plus&output=ts
app.get('/get.php', async (req, res) => {
  try {
    const { username, password, type } = req.query;
    const client = await xtreamAuth(username, password);
    if (!client) return res.status(401).send('#EXTM3U\n#EXTINF:-1,Auth Error\nhttp://error');

    const channels = await getXtreamChannels(client);
    const serverUrl = `${req.protocol}://${req.get('host')}`;

    let m3u = '#EXTM3U\n';
    channels.forEach(ch => {
      const logoTag = ch.logo_url ? ` tvg-logo="${ch.logo_url}"` : '';
      m3u += `#EXTINF:-1 tvg-id="${ch.id}" tvg-name="${ch.name}"${logoTag} group-title="${ch.category}",${ch.name}\n`;
      m3u += `${serverUrl}/live/${username}/${password}/${ch.id}.ts\n`;
    });

    res.set({
      'Content-Type': 'audio/mpegurl',
      'Content-Disposition': `inline; filename="${username}.m3u"`,
    });
    res.send(m3u);
  } catch (err) {
    res.status(500).send('#EXTM3U\n#EXTINF:-1,Server Error\nhttp://error');
  }
});

// LIVE STREAM endpoint: /live/username/password/channelId.ts (or .m3u8)
// This is the core streaming endpoint that all Xtream-compatible apps use
app.get('/live/:username/:password/:streamId', async (req, res) => {
  try {
    const { username, password, streamId } = req.params;
    const client = await xtreamAuth(username, password);
    if (!client) return res.status(403).send('Forbidden');

    // Remove extension (.ts, .m3u8, .mp4)
    const channelId = streamId.replace(/\.(ts|m3u8|mp4|mkv)$/, '');

    // Verify channel exists and client has access
    const channels = await getXtreamChannels(client);
    const channel = channels.find(ch => ch.id === channelId);
    if (!channel) return res.status(404).send('Channel not found');

    // Redirect to the restream endpoint (reuses existing FFmpeg infrastructure)
    // This avoids duplicating the entire restreaming logic
    req.url = `/api/restream/${channelId}`;
    app.handle(req, res);
  } catch (err) {
    console.error('Xtream live error:', err);
    res.status(500).send('Server error');
  }
});

// Also support /live/username/password/channelId/segment.ts for HLS segments
app.get('/live/:username/:password/:streamId/:segment', async (req, res) => {
  try {
    const { username, password, streamId, segment } = req.params;
    const client = await xtreamAuth(username, password);
    if (!client) return res.status(403).send('Forbidden');

    const channelId = streamId.replace(/\.(ts|m3u8|mp4|mkv)$/, '');
    const channels = await getXtreamChannels(client);
    const channel = channels.find(ch => ch.id === channelId);
    if (!channel) return res.status(404).send('Channel not found');

    // Forward to restream segment handler
    req.url = `/api/restream/${channelId}/${segment}`;
    app.handle(req, res);
  } catch (err) {
    res.status(500).send('Server error');
  }
});

console.log('📡 Xtream Codes API habilitada: /player_api.php, /live/, /get.php, /xmltv.php');

// =============================================
// RUTAS: VOD - Videos/Películas (requiere admin)
// =============================================
const VOD_DIR = path.join(__dirname, 'uploads', 'vod');
const VOD_POSTERS_DIR = path.join(__dirname, 'uploads', 'vod-posters');
[VOD_DIR, VOD_POSTERS_DIR].forEach(dir => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

// Serve VOD posters statically
app.use('/uploads/vod-posters', express.static(VOD_POSTERS_DIR));

// Multer for VOD video uploads (up to 10GB)
const vodStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    if (file.fieldname === 'poster') cb(null, VOD_POSTERS_DIR);
    else cb(null, VOD_DIR);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname) || (file.fieldname === 'poster' ? '.jpg' : '.mp4');
    cb(null, `${Date.now()}-${Math.random().toString(36).substring(2, 8)}${ext}`);
  }
});
const uploadVod = multer({ 
  storage: vodStorage, 
  limits: { fileSize: 10 * 1024 * 1024 * 1024 }, // 10GB
});

// List all VOD items (admin)
app.get('/api/vod', authAdmin, async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM vod_items ORDER BY sort_order, created_at DESC');
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Create VOD item with file upload
app.post('/api/vod', authAdmin, uploadVod.fields([
  { name: 'video', maxCount: 1 },
  { name: 'poster', maxCount: 1 }
]), async (req, res) => {
  try {
    const videoFile = req.files?.['video']?.[0];
    const posterFile = req.files?.['poster']?.[0];
    if (!videoFile) return res.status(400).json({ error: 'Se requiere un archivo de video' });

    const { title, description, category, duration_minutes, sort_order } = req.body;
    if (!title) return res.status(400).json({ error: 'Se requiere un título' });

    const poster_url = posterFile ? `/uploads/vod-posters/${posterFile.filename}` : null;

    const { rows } = await pool.query(
      'INSERT INTO vod_items (title, description, category, poster_url, video_filename, duration_minutes, sort_order) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *',
      [title, description || null, category || 'Películas', poster_url, videoFile.filename, parseInt(duration_minutes) || null, parseInt(sort_order) || 0]
    );
    res.json(rows[0]);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Update VOD item
app.put('/api/vod/:id', authAdmin, uploadVod.fields([
  { name: 'poster', maxCount: 1 }
]), async (req, res) => {
  try {
    const { rows: current } = await pool.query('SELECT * FROM vod_items WHERE id = $1', [req.params.id]);
    if (current.length === 0) return res.status(404).json({ error: 'VOD no encontrado' });

    const v = current[0];
    const posterFile = req.files?.['poster']?.[0];
    const title = req.body.title !== undefined ? req.body.title : v.title;
    const description = req.body.description !== undefined ? req.body.description : v.description;
    const category = req.body.category !== undefined ? req.body.category : v.category;
    const is_active = req.body.is_active !== undefined ? (req.body.is_active === 'true' || req.body.is_active === true) : v.is_active;
    const duration_minutes = req.body.duration_minutes !== undefined ? parseInt(req.body.duration_minutes) || null : v.duration_minutes;
    const sort_order = req.body.sort_order !== undefined ? parseInt(req.body.sort_order) || 0 : v.sort_order;
    const poster_url = posterFile ? `/uploads/vod-posters/${posterFile.filename}` : v.poster_url;

    const { rows } = await pool.query(
      'UPDATE vod_items SET title=$1, description=$2, category=$3, poster_url=$4, is_active=$5, duration_minutes=$6, sort_order=$7 WHERE id=$8 RETURNING *',
      [title, description, category, poster_url, is_active, duration_minutes, sort_order, req.params.id]
    );
    res.json(rows[0]);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Delete VOD item (also delete files)
app.delete('/api/vod/:id', authAdmin, async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT video_filename, poster_url FROM vod_items WHERE id = $1', [req.params.id]);
    if (rows.length > 0) {
      const videoPath = path.join(VOD_DIR, rows[0].video_filename);
      if (fs.existsSync(videoPath)) fs.unlinkSync(videoPath);
      if (rows[0].poster_url) {
        const posterPath = path.join(__dirname, rows[0].poster_url);
        if (fs.existsSync(posterPath)) fs.unlinkSync(posterPath);
      }
    }
    await pool.query('DELETE FROM vod_items WHERE id = $1', [req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Public VOD list (only active items, for clients with vod_enabled)
app.get('/api/vod/public', async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT id, title, description, category, poster_url, duration_minutes, sort_order FROM vod_items WHERE is_active = true ORDER BY sort_order, created_at DESC'
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Stream VOD video file
app.get('/api/vod/stream/:id', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT video_filename FROM vod_items WHERE id = $1 AND is_active = true', [req.params.id]);
    if (rows.length === 0) return res.status(404).send('Video not found');

    const videoPath = path.join(VOD_DIR, rows[0].video_filename);
    if (!fs.existsSync(videoPath)) return res.status(404).send('File not found');

    const stat = fs.statSync(videoPath);
    const fileSize = stat.size;
    const range = req.headers.range;

    if (range) {
      const parts = range.replace(/bytes=/, '').split('-');
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
      const chunkSize = (end - start) + 1;
      const file = fs.createReadStream(videoPath, { start, end });
      const head = {
        'Content-Range': `bytes ${start}-${end}/${fileSize}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': chunkSize,
        'Content-Type': 'video/mp4',
      };
      res.writeHead(206, head);
      file.pipe(res);
    } else {
      const head = {
        'Content-Length': fileSize,
        'Content-Type': 'video/mp4',
        'Accept-Ranges': 'bytes',
      };
      res.writeHead(200, head);
      fs.createReadStream(videoPath).pipe(res);
    }
  } catch (err) {
    res.status(500).send('Server error');
  }
});

console.log('🎬 VOD system habilitado: /api/vod, /api/vod/stream/:id');

// =============================================
// SERIES API (Temporadas y Episodios)
// =============================================

// List all series (admin)
app.get('/api/vod/series', authAdmin, async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM vod_series ORDER BY sort_order, created_at DESC');
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Public series list
app.get('/api/vod/series/public', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT id, title, description, category, poster_url FROM vod_series WHERE is_active = true ORDER BY sort_order, title');
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Get single series
app.get('/api/vod/series/:id', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM vod_series WHERE id = $1', [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ error: 'Serie no encontrada' });
    res.json(rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Create series
app.post('/api/vod/series', authAdmin, async (req, res) => {
  try {
    const { title, description, category, sort_order } = req.body;
    const { rows } = await pool.query(
      'INSERT INTO vod_series (title, description, category, sort_order) VALUES ($1, $2, $3, $4) RETURNING *',
      [title, description || null, category || 'Series', sort_order || 0]
    );
    res.json(rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Update series
app.put('/api/vod/series/:id', authAdmin, async (req, res) => {
  try {
    const fields = []; const vals = []; let i = 1;
    for (const key of ['title', 'description', 'category', 'sort_order', 'is_active', 'poster_url']) {
      if (req.body[key] !== undefined) { fields.push(`${key} = $${i}`); vals.push(req.body[key]); i++; }
    }
    if (fields.length === 0) return res.json({ ok: true });
    vals.push(req.params.id);
    const { rows } = await pool.query(`UPDATE vod_series SET ${fields.join(', ')} WHERE id = $${i} RETURNING *`, vals);
    res.json(rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Delete series
app.delete('/api/vod/series/:id', authAdmin, async (req, res) => {
  try {
    await pool.query('DELETE FROM vod_series WHERE id = $1', [req.params.id]);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// --- Seasons ---

app.get('/api/vod/series/:seriesId/seasons', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM vod_seasons WHERE series_id = $1 ORDER BY season_number', [req.params.seriesId]);
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/vod/series/:seriesId/seasons', authAdmin, async (req, res) => {
  try {
    const { season_number, title, sort_order } = req.body;
    const { rows } = await pool.query(
      'INSERT INTO vod_seasons (series_id, season_number, title, sort_order) VALUES ($1, $2, $3, $4) RETURNING *',
      [req.params.seriesId, season_number || 1, title || null, sort_order || season_number || 1]
    );
    res.json(rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/vod/seasons/:id', authAdmin, async (req, res) => {
  try {
    await pool.query('DELETE FROM vod_seasons WHERE id = $1', [req.params.id]);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// --- Episodes ---

app.get('/api/vod/seasons/:seasonId/episodes', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM vod_episodes WHERE season_id = $1 ORDER BY episode_number', [req.params.seasonId]);
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/vod/seasons/:seasonId/episodes', authAdmin, uploadVod.fields([
  { name: 'video', maxCount: 1 }, { name: 'poster', maxCount: 1 }
]), async (req, res) => {
  try {
    const videoFile = req.files?.video?.[0];
    if (!videoFile) return res.status(400).json({ error: 'Se requiere un archivo de video' });
    const posterUrl = req.files?.poster?.[0] ? `/uploads/vod/${req.files.poster[0].filename}` : null;
    const { episode_number, title, description, duration_minutes, sort_order } = req.body;
    const { rows } = await pool.query(
      'INSERT INTO vod_episodes (season_id, episode_number, title, description, video_filename, poster_url, duration_minutes, sort_order) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *',
      [req.params.seasonId, episode_number || 1, title, description || null, videoFile.filename, posterUrl, parseInt(duration_minutes) || null, parseInt(sort_order) || 0]
    );
    res.json(rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.put('/api/vod/episodes/:id', authAdmin, async (req, res) => {
  try {
    const fields = []; const vals = []; let i = 1;
    for (const key of ['episode_number', 'title', 'description', 'duration_minutes', 'sort_order', 'is_active']) {
      if (req.body[key] !== undefined) { fields.push(`${key} = $${i}`); vals.push(req.body[key]); i++; }
    }
    if (fields.length === 0) return res.json({ ok: true });
    vals.push(req.params.id);
    const { rows } = await pool.query(`UPDATE vod_episodes SET ${fields.join(', ')} WHERE id = $${i} RETURNING *`, vals);
    res.json(rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/vod/episodes/:id', authAdmin, async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT video_filename, poster_url FROM vod_episodes WHERE id = $1', [req.params.id]);
    if (rows.length > 0) {
      const ep = rows[0];
      const videoPath = path.join(VOD_DIR, ep.video_filename);
      if (fs.existsSync(videoPath)) fs.unlinkSync(videoPath);
      if (ep.poster_url) { const pp = path.join(__dirname, ep.poster_url.replace(/^\//, '')); if (fs.existsSync(pp)) fs.unlinkSync(pp); }
    }
    await pool.query('DELETE FROM vod_episodes WHERE id = $1', [req.params.id]);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Stream episode video
app.get('/api/vod/episodes/stream/:id', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT video_filename FROM vod_episodes WHERE id = $1 AND is_active = true', [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ error: 'Episodio no encontrado' });
    const filePath = path.join(VOD_DIR, rows[0].video_filename);
    if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'Archivo no encontrado' });
    const stat = fs.statSync(filePath);
    const range = req.headers.range;
    if (range) {
      const parts = range.replace(/bytes=/, '').split('-');
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : stat.size - 1;
      const chunksize = end - start + 1;
      const file = fs.createReadStream(filePath, { start, end });
      res.writeHead(206, { 'Content-Range': `bytes ${start}-${end}/${stat.size}`, 'Accept-Ranges': 'bytes', 'Content-Length': chunksize, 'Content-Type': 'video/mp4' });
      file.pipe(res);
    } else {
      res.writeHead(200, { 'Content-Length': stat.size, 'Content-Type': 'video/mp4' });
      fs.createReadStream(filePath).pipe(res);
    }
  } catch (err) { res.status(500).json({ error: err.message }); }
});

console.log('📺 Series system habilitado: /api/vod/series, /api/vod/seasons, /api/vod/episodes');

// =============================================
// ENDPOINT: System Info (sysctl, recursos, etc)
// =============================================
app.get('/api/admin/system-info', async (req, res) => {
  try {
    const { execSync } = require('child_process');
    const os = require('os');

    // Helper para ejecutar comandos seguros
    const run = (cmd) => { try { return execSync(cmd, { timeout: 5000 }).toString().trim(); } catch { return null; } };

    // --- Sysctl params ---
    const sysctlKeys = [
      'net.ipv4.tcp_congestion_control',
      'net.core.default_qdisc',
      'net.ipv4.tcp_rmem',
      'net.ipv4.tcp_wmem',
      'net.ipv4.udp_rmem_min',
      'net.ipv4.udp_wmem_min',
      'net.core.rmem_default',
      'net.core.rmem_max',
      'net.core.wmem_default',
      'net.core.wmem_max',
      'net.core.somaxconn',
      'net.core.netdev_max_backlog',
      'net.core.optmem_max',
      'net.ipv4.tcp_max_tw_buckets',
      'net.ipv4.tcp_tw_reuse',
      'net.ipv4.tcp_fin_timeout',
      'net.ipv4.tcp_keepalive_time',
      'net.ipv4.tcp_keepalive_intvl',
      'net.ipv4.tcp_keepalive_probes',
      'net.ipv4.tcp_max_syn_backlog',
      'net.ipv4.tcp_syncookies',
      'net.ipv4.tcp_slow_start_after_idle',
      'net.ipv4.tcp_mtu_probing',
      'net.ipv4.tcp_fastopen',
      'net.ipv4.tcp_window_scaling',
      'net.ipv4.tcp_timestamps',
      'net.ipv4.tcp_sack',
      'fs.file-max',
      'fs.inotify.max_user_watches',
      'fs.inotify.max_user_instances',
      'vm.swappiness',
      'vm.dirty_ratio',
      'vm.dirty_background_ratio',
      'vm.vfs_cache_pressure',
    ];

    const recommended = {
      'net.ipv4.tcp_congestion_control': 'bbr',
      'net.core.default_qdisc': 'fq',
      'net.ipv4.tcp_rmem': '8192\t87380\t134217728',
      'net.ipv4.tcp_wmem': '8192\t65536\t134217728',
      'net.ipv4.udp_rmem_min': '16384',
      'net.ipv4.udp_wmem_min': '16384',
      'net.core.rmem_default': '262144',
      'net.core.rmem_max': '268435456',
      'net.core.wmem_default': '262144',
      'net.core.wmem_max': '268435456',
      'net.core.somaxconn': '65535',
      'net.core.netdev_max_backlog': '250000',
      'net.core.optmem_max': '65535',
      'net.ipv4.tcp_max_tw_buckets': '1440000',
      'net.ipv4.tcp_tw_reuse': '1',
      'net.ipv4.tcp_fin_timeout': '15',
      'net.ipv4.tcp_keepalive_time': '300',
      'net.ipv4.tcp_keepalive_intvl': '30',
      'net.ipv4.tcp_keepalive_probes': '5',
      'net.ipv4.tcp_max_syn_backlog': '65535',
      'net.ipv4.tcp_syncookies': '1',
      'net.ipv4.tcp_slow_start_after_idle': '0',
      'net.ipv4.tcp_mtu_probing': '1',
      'net.ipv4.tcp_fastopen': '3',
      'net.ipv4.tcp_window_scaling': '1',
      'net.ipv4.tcp_timestamps': '1',
      'net.ipv4.tcp_sack': '1',
      'fs.file-max': '2097152',
      'fs.inotify.max_user_watches': '524288',
      'fs.inotify.max_user_instances': '8192',
      'vm.swappiness': '10',
      'vm.dirty_ratio': '15',
      'vm.dirty_background_ratio': '5',
      'vm.vfs_cache_pressure': '50',
    };

    const descriptions = {
      'net.ipv4.tcp_congestion_control': 'Algoritmo de control de congestión TCP',
      'net.core.default_qdisc': 'Disciplina de cola por defecto',
      'net.ipv4.tcp_rmem': 'Buffer de lectura TCP (min/default/max)',
      'net.ipv4.tcp_wmem': 'Buffer de escritura TCP (min/default/max)',
      'net.ipv4.udp_rmem_min': 'Buffer mínimo lectura UDP',
      'net.ipv4.udp_wmem_min': 'Buffer mínimo escritura UDP',
      'net.core.rmem_default': 'Buffer lectura socket por defecto',
      'net.core.rmem_max': 'Buffer lectura socket máximo',
      'net.core.wmem_default': 'Buffer escritura socket por defecto',
      'net.core.wmem_max': 'Buffer escritura socket máximo',
      'net.core.somaxconn': 'Máximo de conexiones pendientes',
      'net.core.netdev_max_backlog': 'Cola de paquetes entrantes',
      'net.core.optmem_max': 'Memoria auxiliar por socket',
      'net.ipv4.tcp_max_tw_buckets': 'Máx conexiones TIME_WAIT',
      'net.ipv4.tcp_tw_reuse': 'Reusar sockets TIME_WAIT',
      'net.ipv4.tcp_fin_timeout': 'Timeout cierre de conexión (seg)',
      'net.ipv4.tcp_keepalive_time': 'Tiempo antes de keepalive (seg)',
      'net.ipv4.tcp_keepalive_intvl': 'Intervalo entre keepalives (seg)',
      'net.ipv4.tcp_keepalive_probes': 'Intentos de keepalive antes de cerrar',
      'net.ipv4.tcp_max_syn_backlog': 'Cola máxima de SYN pendientes',
      'net.ipv4.tcp_syncookies': 'Protección contra SYN flood',
      'net.ipv4.tcp_slow_start_after_idle': 'Slow start después de idle',
      'net.ipv4.tcp_mtu_probing': 'Descubrimiento automático de MTU',
      'net.ipv4.tcp_fastopen': 'TCP Fast Open (cliente+servidor)',
      'net.ipv4.tcp_window_scaling': 'Escalado de ventana TCP',
      'net.ipv4.tcp_timestamps': 'Timestamps TCP (RTT preciso)',
      'net.ipv4.tcp_sack': 'Selective ACK',
      'fs.file-max': 'Máximo de archivos abiertos del sistema',
      'fs.inotify.max_user_watches': 'Máximo de watches inotify',
      'fs.inotify.max_user_instances': 'Máximo de instancias inotify',
      'vm.swappiness': 'Tendencia a usar swap (menor = menos swap)',
      'vm.dirty_ratio': '% de RAM con datos sucios antes de flush',
      'vm.dirty_background_ratio': '% de RAM para flush en background',
      'vm.vfs_cache_pressure': 'Presión de caché VFS',
    };

    const categories = {
      'TCP Congestion': ['net.ipv4.tcp_congestion_control', 'net.core.default_qdisc'],
      'Buffers de Red': ['net.ipv4.tcp_rmem', 'net.ipv4.tcp_wmem', 'net.ipv4.udp_rmem_min', 'net.ipv4.udp_wmem_min', 'net.core.rmem_default', 'net.core.rmem_max', 'net.core.wmem_default', 'net.core.wmem_max', 'net.core.optmem_max'],
      'Conexiones': ['net.core.somaxconn', 'net.core.netdev_max_backlog', 'net.ipv4.tcp_max_tw_buckets', 'net.ipv4.tcp_tw_reuse', 'net.ipv4.tcp_max_syn_backlog', 'net.ipv4.tcp_syncookies'],
      'TCP Keepalive': ['net.ipv4.tcp_keepalive_time', 'net.ipv4.tcp_keepalive_intvl', 'net.ipv4.tcp_keepalive_probes', 'net.ipv4.tcp_fin_timeout'],
      'TCP Avanzado': ['net.ipv4.tcp_slow_start_after_idle', 'net.ipv4.tcp_mtu_probing', 'net.ipv4.tcp_fastopen', 'net.ipv4.tcp_window_scaling', 'net.ipv4.tcp_timestamps', 'net.ipv4.tcp_sack'],
      'Sistema de Archivos': ['fs.file-max', 'fs.inotify.max_user_watches', 'fs.inotify.max_user_instances'],
      'Memoria Virtual': ['vm.swappiness', 'vm.dirty_ratio', 'vm.dirty_background_ratio', 'vm.vfs_cache_pressure'],
    };

    const sysctl = {};
    for (const key of sysctlKeys) {
      const val = run(`sysctl -n ${key}`);
      const rec = recommended[key] || null;
      const isOptimal = val && rec ? val.replace(/\s+/g, '\t') === rec.replace(/\s+/g, '\t') : null;
      sysctl[key] = {
        value: val || 'N/A',
        recommended: rec,
        optimal: isOptimal,
        description: descriptions[key] || key,
      };
    }

    // --- Hardware info ---
    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    const cpus = os.cpus();
    const uptime = os.uptime();
    const loadAvg = os.loadavg();

    // Disk info
    const diskInfo = run("df -B1 / | tail -1 | awk '{print $2,$3,$4,$5}'");
    const [diskTotal, diskUsed, diskAvail, diskPercent] = diskInfo ? diskInfo.split(' ') : [0, 0, 0, '0%'];

    // HLS cache disk
    const hlsDiskInfo = run("df -B1 /opt/streambox/hls-cache 2>/dev/null | tail -1 | awk '{print $2,$3,$4,$5}'");

    // Open files
    const openFiles = run("cat /proc/sys/fs/file-nr | awk '{print $1}'");
    const maxFiles = run("cat /proc/sys/fs/file-nr | awk '{print $3}'");

    // Ulimit
    const ulimitN = run("ulimit -n");

    // Kernel version
    const kernelVersion = run("uname -r");

    // BBR module loaded
    const bbrLoaded = run("lsmod | grep bbr") ? true : false;

    // Config file exists
    const configApplied = fs.existsSync('/etc/sysctl.d/99-streambox.conf');

    const optimizedCount = Object.values(sysctl).filter(v => v.optimal === true).length;
    const totalParams = Object.keys(sysctl).length;

    res.json({
      sysctl,
      categories,
      hardware: {
        cpu_model: cpus[0]?.model || 'Desconocido',
        cpu_cores: cpus.length,
        cpu_speed_mhz: cpus[0]?.speed || 0,
        ram_total_gb: (totalMem / 1073741824).toFixed(1),
        ram_free_gb: (freeMem / 1073741824).toFixed(1),
        ram_used_gb: ((totalMem - freeMem) / 1073741824).toFixed(1),
        ram_used_percent: ((1 - freeMem / totalMem) * 100).toFixed(0),
        uptime_hours: (uptime / 3600).toFixed(1),
        load_avg: loadAvg.map(l => l.toFixed(2)),
        kernel: kernelVersion,
      },
      disk: {
        total_gb: diskTotal ? (parseInt(diskTotal) / 1073741824).toFixed(1) : '?',
        used_gb: diskUsed ? (parseInt(diskUsed) / 1073741824).toFixed(1) : '?',
        avail_gb: diskAvail ? (parseInt(diskAvail) / 1073741824).toFixed(1) : '?',
        percent: diskPercent || '?',
      },
      hls_cache_disk: hlsDiskInfo ? {
        total_gb: (parseInt(hlsDiskInfo.split(' ')[0]) / 1073741824).toFixed(1),
        used_gb: (parseInt(hlsDiskInfo.split(' ')[1]) / 1073741824).toFixed(1),
        avail_gb: (parseInt(hlsDiskInfo.split(' ')[2]) / 1073741824).toFixed(1),
        percent: hlsDiskInfo.split(' ')[3],
      } : null,
      files: {
        open: openFiles || '?',
        max: maxFiles || '?',
        ulimit: ulimitN || '?',
      },
      status: {
        config_applied: configApplied,
        bbr_loaded: bbrLoaded,
        optimized_count: optimizedCount,
        total_params: totalParams,
        score_percent: Math.round((optimizedCount / totalParams) * 100),
      },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// =============================================
// ENDPOINT: Bandwidth Monitor (real-time)
// =============================================
let prevNetStats = null;
let prevNetTime = null;

app.get('/api/admin/bandwidth', async (req, res) => {
  try {
    const { execSync } = require('child_process');
    const run = (cmd) => { try { return execSync(cmd, { timeout: 3000 }).toString().trim(); } catch { return null; } };

    // Get primary network interface
    const iface = run("ip route | grep default | awk '{print $5}' | head -1") || 'eth0';

    // Read /proc/net/dev for the interface
    const netDev = run(`cat /proc/net/dev | grep '${iface}:'`);
    if (!netDev) {
      return res.json({ rx_mbps: 0, tx_mbps: 0, rx_total_gb: 0, tx_total_gb: 0, interface: iface });
    }

    const parts = netDev.trim().split(/\s+/);
    // Format: iface: rx_bytes rx_packets ... tx_bytes tx_packets ...
    const rxBytes = parseInt(parts[1]) || 0;
    const txBytes = parseInt(parts[9]) || 0;
    const now = Date.now();

    let rxMbps = 0;
    let txMbps = 0;

    if (prevNetStats && prevNetTime) {
      const dtSec = (now - prevNetTime) / 1000;
      if (dtSec > 0) {
        rxMbps = ((rxBytes - prevNetStats.rx) * 8) / (dtSec * 1000000); // bits to Mbps
        txMbps = ((txBytes - prevNetStats.tx) * 8) / (dtSec * 1000000);
        if (rxMbps < 0) rxMbps = 0;
        if (txMbps < 0) txMbps = 0;
      }
    }

    prevNetStats = { rx: rxBytes, tx: txBytes };
    prevNetTime = now;

    res.json({
      rx_mbps: parseFloat(rxMbps.toFixed(2)),
      tx_mbps: parseFloat(txMbps.toFixed(2)),
      rx_total_gb: parseFloat((rxBytes / 1073741824).toFixed(2)),
      tx_total_gb: parseFloat((txBytes / 1073741824).toFixed(2)),
      interface: iface,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// =============================================
// ENDPOINT: Real-time CPU/RAM/Disk resources
// =============================================
let prevCpuTimes = null;

app.get('/api/admin/resources', async (req, res) => {
  try {
    const os = require('os');
    const { execSync } = require('child_process');
    const run = (cmd) => { try { return execSync(cmd, { timeout: 3000 }).toString().trim(); } catch { return null; } };

    // CPU usage via /proc/stat delta
    const cpus = os.cpus();
    const totalIdle = cpus.reduce((a, c) => a + c.times.idle, 0);
    const totalTick = cpus.reduce((a, c) => a + c.times.user + c.times.nice + c.times.sys + c.times.idle + c.times.irq, 0);

    let cpuPercent = 0;
    if (prevCpuTimes) {
      const idleDiff = totalIdle - prevCpuTimes.idle;
      const totalDiff = totalTick - prevCpuTimes.total;
      cpuPercent = totalDiff > 0 ? Math.round((1 - idleDiff / totalDiff) * 100) : 0;
    }
    prevCpuTimes = { idle: totalIdle, total: totalTick };

    // RAM
    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    const usedMem = totalMem - freeMem;
    const ramPercent = Math.round((usedMem / totalMem) * 100);

    // Disk
    const diskLine = run("df -B1 / | tail -1");
    let diskTotal = 0, diskUsed = 0, diskPercent = 0;
    if (diskLine) {
      const dp = diskLine.split(/\s+/);
      diskTotal = parseInt(dp[1]) || 0;
      diskUsed = parseInt(dp[2]) || 0;
      diskPercent = diskTotal > 0 ? Math.round((diskUsed / diskTotal) * 100) : 0;
    }

    // Load average
    const loadAvg = os.loadavg();

    // Uptime
    const uptimeSec = os.uptime();

    res.json({
      cpu_percent: cpuPercent,
      cpu_cores: cpus.length,
      cpu_model: cpus[0]?.model || 'Unknown',
      ram_total_gb: parseFloat((totalMem / 1073741824).toFixed(2)),
      ram_used_gb: parseFloat((usedMem / 1073741824).toFixed(2)),
      ram_free_gb: parseFloat((freeMem / 1073741824).toFixed(2)),
      ram_percent: ramPercent,
      disk_total_gb: parseFloat((diskTotal / 1073741824).toFixed(1)),
      disk_used_gb: parseFloat((diskUsed / 1073741824).toFixed(1)),
      disk_percent: diskPercent,
      load_avg: loadAvg.map(l => parseFloat(l.toFixed(2))),
      uptime_hours: parseFloat((uptimeSec / 3600).toFixed(1)),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// =============================================
// APK FILE MANAGEMENT
// =============================================
const APK_DIR = path.join(__dirname, 'apk');
if (!fs.existsSync(APK_DIR)) fs.mkdirSync(APK_DIR, { recursive: true });

const apkStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, APK_DIR),
  filename: (req, file, cb) => cb(null, file.originalname),
});
const uploadApk = multer({ storage: apkStorage, limits: { fileSize: 500 * 1024 * 1024 }, fileFilter: (req, file, cb) => {
  if (file.originalname.endsWith('.apk')) cb(null, true);
  else cb(new Error('Solo se permiten archivos .apk'));
}});

// Servir APKs estáticos
app.use('/downloads/apk', express.static(APK_DIR));

// Listar APKs
app.get('/api/apk', authAdmin, (req, res) => {
  try {
    const files = fs.readdirSync(APK_DIR).filter(f => f.endsWith('.apk')).map(name => {
      const stats = fs.statSync(path.join(APK_DIR, name));
      return { name, size: stats.size, modified: stats.mtime.toISOString(), download_url: `/downloads/apk/${encodeURIComponent(name)}` };
    });
    res.json({ files });
  } catch (err) {
    res.json({ files: [] });
  }
});

// Subir APK
app.post('/api/apk/upload', authAdmin, uploadApk.single('apk'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No se recibió archivo' });
  res.json({ message: `APK ${req.file.originalname} subida correctamente`, name: req.file.originalname });
});

// Eliminar APK
app.post('/api/apk/delete', authAdmin, (req, res) => {
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: 'Nombre requerido' });
  const filePath = path.join(APK_DIR, path.basename(name));
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'Archivo no encontrado' });
  fs.unlinkSync(filePath);
  res.json({ message: `${name} eliminada` });
});

// =============================================
// APK MIDDLEWARE API - Capa sobre Xtream Codes
// =============================================
const XTREAM_BASE_URL = process.env.XTREAM_BASE_URL || `http://${require('os').hostname() === 'localhost' ? '127.0.0.1' : require('child_process').execSync("hostname -I | awk '{print $1}'").toString().trim()}:25461`;

// Sesiones activas en memoria: Map<userId, Set<{channelId, connectedAt}>>
const apkSessions = new Map();
// Info de conexión APK para monitoreo: Map<`userId:device_id`, {username, device_id, ip, country, city, connectedAt, lastHeartbeat, channelId}>
const apkConnectionInfo = new Map();

// Helper: fetch JSON desde Xtream
const fetchXtream = (urlPath) => {
  return new Promise((resolve, reject) => {
    const fullUrl = `${XTREAM_BASE_URL}${urlPath}`;
    const mod = fullUrl.startsWith('https') ? https : http;
    mod.get(fullUrl, { rejectUnauthorized: false }, (resp) => {
      let data = '';
      resp.on('data', chunk => data += chunk);
      resp.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch { reject(new Error('Respuesta Xtream no es JSON válido')); }
      });
    }).on('error', reject);
  });
};

// Middleware: verificar token APK
// Acepta JWT en header "Authorization: Bearer <token>" o en query "?token=<token>"
// El fallback a query permite que reproductores de video (ExoPlayer, WebView)
// autentiquen sin necesidad de inyectar headers personalizados.
const authApk = (req, res, next) => {
  const authHeader = req.headers.authorization;
  let tokenStr = null;

  if (authHeader && authHeader.startsWith('Bearer ')) {
    tokenStr = authHeader.split(' ')[1];
  } else if (req.query.token) {
    tokenStr = req.query.token;
  }

  if (!tokenStr) {
    return res.status(401).json({ error: 'Token requerido' });
  }
  try {
    const decoded = jwt.verify(tokenStr, JWT_SECRET);
    req.apkUser = decoded; // { id, username, xtreamUser, xtreamPass }
    next();
  } catch {
    return res.status(401).json({ error: 'Token inválido o expirado' });
  }
};

// POST /api/auth/login
app.post('/api/auth/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) {
      return res.status(400).json({ error: 'username y password son requeridos' });
    }

    // Validar contra Xtream Codes
    const xtreamData = await fetchXtream(`/player_api.php?username=${encodeURIComponent(username)}&password=${encodeURIComponent(password)}`);

    if (!xtreamData || !xtreamData.user_info || xtreamData.user_info.auth === 0) {
      return res.status(401).json({ error: 'Credenciales inválidas en Xtream' });
    }

    const userInfo = xtreamData.user_info;
    const device_id = req.body.device_id || `apk-${username}-${Date.now()}`;

    // Emitir JWT propio (incluir device_id)
    const token = jwt.sign(
      {
        id: userInfo.username,
        username: userInfo.username,
        xtreamUser: username,
        xtreamPass: password,
        maxConnections: parseInt(userInfo.max_connections) || 1,
        expDate: userInfo.exp_date,
        device_id,
      },
      JWT_SECRET,
      { expiresIn: '24h' }
    );

    // Registrar conexión APK en memoria para monitoreo del panel admin
    const clientIP = getClientIP(req);
    const geo = await geoLookup(clientIP);
    const connKey = `${userInfo.username}:${device_id}`;
    apkConnectionInfo.set(connKey, {
      username: userInfo.username,
      device_id,
      ip: clientIP,
      country: geo.country,
      city: geo.city,
      connectedAt: new Date().toISOString(),
      lastHeartbeat: new Date().toISOString(),
      channelId: null,
      source: 'apk',
    });

    // Obtener ads, VOD y series de la base de datos local
    const [adsRes, vodRes, seriesRes] = await Promise.all([
      pool.query('SELECT id, title, message, image_url FROM ads WHERE is_active = true ORDER BY created_at DESC'),
      pool.query('SELECT id, title, description, category, poster_url, duration_minutes FROM vod_items WHERE is_active = true ORDER BY sort_order, created_at DESC'),
      pool.query('SELECT id, title, description, category, poster_url FROM vod_series WHERE is_active = true ORDER BY sort_order, title'),
    ]);

    res.json({
      token,
      user: {
        id: userInfo.username,
        username: userInfo.username,
        status: userInfo.status,
        maxConnections: parseInt(userInfo.max_connections) || 1,
        expiryDate: userInfo.exp_date,
        isTrial: userInfo.is_trial === '1',
        activeCons: parseInt(userInfo.active_cons) || 0,
      },
      ads: adsRes.rows,
      vod: vodRes.rows,
      series: seriesRes.rows,
    });
  } catch (err) {
    console.error('APK login error:', err.message);
    res.status(500).json({ error: 'Error al conectar con Xtream' });
  }
});

// GET /api/channels
app.get('/api/channels', authApk, async (req, res) => {
  try {
    const { xtreamUser, xtreamPass } = req.apkUser;
    const streams = await fetchXtream(
      `/player_api.php?username=${encodeURIComponent(xtreamUser)}&password=${encodeURIComponent(xtreamPass)}&action=get_live_streams`
    );

    if (!Array.isArray(streams)) {
      return res.status(502).json({ error: 'Respuesta inesperada de Xtream' });
    }

    const channels = streams.map(s => ({
      id: String(s.stream_id),
      name: s.name,
      logo: s.stream_icon || null,
      group: s.category_name || 'Sin categoría',
      tvgId: s.epg_channel_id || null,
      num: s.num || null,
    }));

    res.json(channels);
  } catch (err) {
    console.error('APK channels error:', err.message);
    res.status(500).json({ error: 'Error al obtener canales' });
  }
});

// GET /api/channels/:id/stream
app.get('/api/channels/:id/stream', authApk, async (req, res) => {
  try {
    const { xtreamUser, xtreamPass, id: userId, maxConnections } = req.apkUser;
    const channelId = req.params.id;

    // Verificar límite de sesiones
    const userSessions = apkSessions.get(userId) || new Set();
    if (userSessions.size >= (maxConnections || 1)) {
      // Permitir si ya está viendo este canal
      const alreadyWatching = [...userSessions].some(s => s.channelId === channelId);
      if (!alreadyWatching) {
        return res.status(429).json({
          error: 'Límite de pantallas alcanzado',
          maxConnections,
          activeSessions: userSessions.size,
        });
      }
    }

    // Registrar sesión en memoria
    const sessionEntry = { channelId, connectedAt: new Date().toISOString() };
    const updatedSessions = new Set([...userSessions].filter(s => s.channelId !== channelId));
    updatedSessions.add(sessionEntry);
    apkSessions.set(userId, updatedSessions);

    // Actualizar monitoreo APK con el canal que está viendo
    const device_id = req.apkUser.device_id || `apk-${userId}`;
    const connKey = `${userId}:${device_id}`;
    const connInfo = apkConnectionInfo.get(connKey);
    if (connInfo) {
      connInfo.channelId = channelId;
      connInfo.lastHeartbeat = new Date().toISOString();
    }

    // Soporte múltiples calidades
    const quality = req.query.quality || 'auto';
    const baseStream = `${XTREAM_BASE_URL}/live/${encodeURIComponent(xtreamUser)}/${encodeURIComponent(xtreamPass)}/${channelId}`;
    let streamUrl;
    switch (quality) {
      case 'low':       streamUrl = `${baseStream}.m3u8?output=low`; break;      // SD ~480p
      case 'dataSaver': streamUrl = `${baseStream}.m3u8?output=low`; break;      // Alias de low
      case 'medium':    streamUrl = `${baseStream}.m3u8?output=medium`; break;   // HD 720p
      case 'high':      streamUrl = `${baseStream}.m3u8`; break;                 // FHD 1080p (original)
      case 'auto':
      default:          streamUrl = `${baseStream}.m3u8`; break;                 // Auto/ABR
    }

    // Obtener TODOS los anuncios activos (no solo 1)
    let ads = [];
    try {
      const adResult = await pool.query(
        'SELECT id, title, message, image_url FROM ads WHERE is_active = true ORDER BY created_at DESC'
      );
      ads = adResult.rows.map(a => ({
        id: a.id,
        title: a.title,
        message: a.message,
        imageUrl: a.image_url || null,
        durationSeconds: 10,
        type: a.image_url ? 'image' : 'text',
      }));
    } catch { /* sin anuncios */ }

    res.json({
      streamUrl,
      quality,
      availableQualities: ['auto', 'high', 'medium', 'low'],
      ads,
      // Mantener compatibilidad con campo "ad" (primer anuncio)
      ad: ads.length > 0 ? ads[0] : null,
    });
  } catch (err) {
    console.error('APK stream error:', err.message);
    res.status(500).json({ error: 'Error al obtener stream' });
  }
});

// POST /api/sessions/close
// Cierra sesión por token (userId) + device_id para no duplicar
app.post('/api/sessions/close', authApk, (req, res) => {
  try {
    const { id: userId, device_id: tokenDeviceId } = req.apkUser;
    const { channelId, device_id: bodyDeviceId } = req.body || {};
    const device_id = bodyDeviceId || tokenDeviceId || `apk-${userId}`;
    const connKey = `${userId}:${device_id}`;

    // Limpiar activity log activo para este dispositivo
    const logKey = `apk:${connKey}`;
    const currentLog = activeActivityLogs.get(logKey);
    if (currentLog && currentLog.logId) {
      pool.query(
        `UPDATE activity_logs SET ended_at = now(), duration_seconds = EXTRACT(EPOCH FROM (now() - started_at))::int WHERE id = $1`,
        [currentLog.logId]
      ).catch(() => {});
      activeActivityLogs.delete(logKey);
    }

    if (channelId) {
      // Solo limpiar el canal actual de la sesión (no cerrar conexión completa)
      const connInfo = apkConnectionInfo.get(connKey);
      if (connInfo) {
        connInfo.channelId = null;
      }
      // Limpiar de apkSessions también
      const userSessions = apkSessions.get(userId);
      if (userSessions) {
        const updated = new Set([...userSessions].filter(s => s.channelId !== channelId));
        apkSessions.set(userId, updated);
      }
      res.json({ message: 'Canal cerrado', channelId, device_id });
    } else {
      // Cerrar sesión completa de este dispositivo
      apkConnectionInfo.delete(connKey);
      // Limpiar apkSessions
      const userSessions = apkSessions.get(userId);
      if (userSessions) {
        const updated = new Set([...userSessions].filter(s => s.device_id !== device_id));
        if (updated.size === 0) apkSessions.delete(userId);
        else apkSessions.set(userId, updated);
      }
      res.json({ message: 'Sesión cerrada', device_id, activeSessions: 0 });
    }
  } catch (err) {
    console.error('APK session close error:', err.message);
    res.status(500).json({ error: 'Error al cerrar sesión' });
  }
});

// =============================================
// APK: Anuncios activos
// =============================================
app.get('/api/ads', authApk, async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT id, title, message, image_url FROM ads WHERE is_active = true ORDER BY created_at DESC'
    );
    res.json(rows);
  } catch (err) {
    console.error('APK ads error:', err.message);
    res.status(500).json({ error: 'Error al obtener anuncios' });
  }
});

// =============================================
// APK: VOD películas
// =============================================
app.get('/api/vod', authApk, async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT id, title, description, category, poster_url, duration_minutes FROM vod_items WHERE is_active = true ORDER BY sort_order, created_at DESC'
    );
    res.json(rows);
  } catch (err) {
    console.error('APK vod error:', err.message);
    res.status(500).json({ error: 'Error al obtener VOD' });
  }
});

// =============================================
// APK: Series
// =============================================
app.get('/api/series', authApk, async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT id, title, description, category, poster_url FROM vod_series WHERE is_active = true ORDER BY sort_order, title'
    );
    res.json(rows);
  } catch (err) {
    console.error('APK series error:', err.message);
    res.status(500).json({ error: 'Error al obtener series' });
  }
});

// APK: Temporadas de una serie
app.get('/api/series/:id/seasons', authApk, async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT id, season_number, title, poster_url FROM vod_seasons WHERE series_id = $1 ORDER BY sort_order, season_number',
      [req.params.id]
    );
    res.json(rows);
  } catch (err) {
    console.error('APK seasons error:', err.message);
    res.status(500).json({ error: 'Error al obtener temporadas' });
  }
});

// APK: Episodios de una temporada
app.get('/api/seasons/:id/episodes', authApk, async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT id, episode_number, title, description, video_filename, poster_url, duration_minutes FROM vod_episodes WHERE season_id = $1 AND is_active = true ORDER BY sort_order, episode_number',
      [req.params.id]
    );
    res.json(rows);
  } catch (err) {
    console.error('APK episodes error:', err.message);
    res.status(500).json({ error: 'Error al obtener episodios' });
  }
});

// APK: Stream VOD (película o episodio) con soporte Range
app.get('/api/vod/stream/:id', authApk, async (req, res) => {
  try {
    // Buscar en películas o episodios
    let { rows } = await pool.query('SELECT video_filename FROM vod_items WHERE id = $1 AND is_active = true', [req.params.id]);
    if (rows.length === 0) {
      ({ rows } = await pool.query('SELECT video_filename FROM vod_episodes WHERE id = $1 AND is_active = true', [req.params.id]));
    }
    if (rows.length === 0) return res.status(404).json({ error: 'Video no encontrado' });

    const videoPath = path.join(VOD_DIR, rows[0].video_filename);
    if (!fs.existsSync(videoPath)) return res.status(404).json({ error: 'Archivo no encontrado' });

    const stat = fs.statSync(videoPath);
    const fileSize = stat.size;
    const range = req.headers.range;

    if (range) {
      const parts = range.replace(/bytes=/, '').split('-');
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
      const chunkSize = (end - start) + 1;
      res.writeHead(206, {
        'Content-Range': `bytes ${start}-${end}/${fileSize}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': chunkSize,
        'Content-Type': 'video/mp4',
      });
      fs.createReadStream(videoPath, { start, end }).pipe(res);
    } else {
      res.writeHead(200, {
        'Content-Length': fileSize,
        'Content-Type': 'video/mp4',
        'Accept-Ranges': 'bytes',
      });
      fs.createReadStream(videoPath).pipe(res);
    }
  } catch (err) {
    console.error('APK vod stream error:', err.message);
    res.status(500).json({ error: 'Error al reproducir video' });
  }
});

// GET /api/sessions/active (admin/debug)
app.get('/api/sessions/active-apk', authApk, (req, res) => {
  const { id: userId } = req.apkUser;
  const userSessions = apkSessions.get(userId);
  res.json({
    userId,
    activeSessions: userSessions ? [...userSessions] : [],
    count: userSessions ? userSessions.size : 0,
  });
});

// =============================================
// APK: Heartbeat (mantener sesión activa)
// =============================================
app.post('/api/heartbeat', authApk, async (req, res) => {
  const { id: userId, device_id } = req.apkUser;
  const { channelId } = req.body || {};
  const connKey = `${userId}:${device_id || `apk-${userId}`}`;
  const connInfo = apkConnectionInfo.get(connKey);
  if (connInfo) {
    connInfo.lastHeartbeat = new Date().toISOString();
    if (channelId) connInfo.channelId = channelId;
  }

  // APK Activity logging
  const logKey = `apk:${connKey}`;
  const currentLog = activeActivityLogs.get(logKey);
  if (channelId && (!currentLog || currentLog.channelId !== channelId)) {
    if (currentLog && currentLog.logId) {
      try {
        await pool.query(`UPDATE activity_logs SET ended_at = now(), duration_seconds = EXTRACT(EPOCH FROM (now() - started_at))::int WHERE id = $1`, [currentLog.logId]);
      } catch {}
    }
    try {
      const { rows } = await pool.query(
        `INSERT INTO activity_logs (client_id, client_username, channel_name, ip_address, country, city, device_id, source)
         VALUES ((SELECT id FROM clients WHERE username = $1 LIMIT 1), $1, $2, $3, $4, $5, $6, 'apk') RETURNING id`,
        [userId, channelId, connInfo?.ip || null, connInfo?.country || null, connInfo?.city || null, device_id || null]
      );
      activeActivityLogs.set(logKey, { logId: rows[0].id, channelId });
    } catch (err) {
      console.error('APK activity log error:', err.message);
    }
  } else if (!channelId && currentLog) {
    try {
      await pool.query(`UPDATE activity_logs SET ended_at = now(), duration_seconds = EXTRACT(EPOCH FROM (now() - started_at))::int WHERE id = $1`, [currentLog.logId]);
    } catch {}
    activeActivityLogs.delete(logKey);
  }

  res.json({ ok: true });
});

// =============================================
// ADMIN: Monitoreo de conexiones APK
// Limpia conexiones sin heartbeat > 5 min
// =============================================
app.get('/api/admin/apk-connections', authAdmin, (req, res) => {
  const fiveMinAgo = Date.now() - 5 * 60 * 1000;
  const connections = [];
  for (const [key, info] of apkConnectionInfo.entries()) {
    if (new Date(info.lastHeartbeat).getTime() < fiveMinAgo) {
      apkConnectionInfo.delete(key);
      continue;
    }
    connections.push(info);
  }
  res.json(connections);
});

// ADMIN: Kick conexión APK
app.post('/api/admin/apk-connections/kick', authAdmin, (req, res) => {
  const { username, device_id } = req.body;
  if (!username) return res.status(400).json({ error: 'username requerido' });
  if (device_id) {
    apkConnectionInfo.delete(`${username}:${device_id}`);
    // También limpiar sesiones
    const userSessions = apkSessions.get(username);
    if (userSessions) apkSessions.delete(username);
  } else {
    // Kick todas las conexiones del usuario
    for (const key of apkConnectionInfo.keys()) {
      if (key.startsWith(`${username}:`)) apkConnectionInfo.delete(key);
    }
    apkSessions.delete(username);
  }
  res.json({ ok: true, message: `Conexión APK de ${username} cerrada` });
});

// =============================================
// ACTIVITY LOGS: Registrar qué ve cada cliente
// =============================================
app.post('/api/activity-log', async (req, res) => {
  try {
    const { client_id, client_username, channel_id, channel_name, ip_address, country, city, device_id, source } = req.body;
    if (!client_id || !client_username) return res.status(400).json({ error: 'client_id y client_username requeridos' });
    const { rows } = await pool.query(
      `INSERT INTO activity_logs (client_id, client_username, channel_id, channel_name, ip_address, country, city, device_id, source)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
      [client_id, client_username, channel_id || null, channel_name || null, ip_address || null, country || null, city || null, device_id || null, source || 'panel']
    );
    res.json({ id: rows[0].id });
  } catch (err) {
    console.error('Activity log error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Close activity log (set ended_at and duration)
app.put('/api/activity-log/:id/close', async (req, res) => {
  try {
    await pool.query(
      `UPDATE activity_logs SET ended_at = now(), duration_seconds = EXTRACT(EPOCH FROM (now() - started_at))::int WHERE id = $1`,
      [req.params.id]
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Admin: Get activity logs
app.get('/api/admin/activity-logs', authAdmin, async (req, res) => {
  try {
    const { client_id, days, limit: lim } = req.query;
    const limit = Math.min(500, Math.max(1, parseInt(String(lim), 10) || 100));
    const daysBack = Math.min(90, Math.max(1, parseInt(String(days), 10) || 7));

    let query = `SELECT * FROM activity_logs WHERE started_at >= now() - interval '${daysBack} days'`;
    const vals = [];
    if (client_id) {
      vals.push(client_id);
      query += ` AND client_id = $${vals.length}`;
    }
    query += ` ORDER BY started_at DESC LIMIT ${limit}`;

    const { rows } = await pool.query(query, vals);
    
    // Stats
    const statsQuery = `SELECT 
      COUNT(DISTINCT client_username) as unique_clients,
      COUNT(*) as total_views,
      COUNT(DISTINCT channel_name) as unique_channels,
      COALESCE(SUM(duration_seconds), 0) as total_watch_seconds
      FROM activity_logs WHERE started_at >= now() - interval '${daysBack} days'`;
    const { rows: statsRows } = await pool.query(statsQuery);
    
    res.json({ logs: rows, stats: statsRows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// =============================================
// RESELLER PANEL API
// =============================================
// Reseller login
app.post('/api/reseller/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ error: 'username y password requeridos' });
    
    const { rows } = await pool.query(
      'SELECT * FROM resellers WHERE username = $1 AND password = $2',
      [username, password]
    );
    if (rows.length === 0) return res.status(401).json({ error: 'Credenciales inválidas' });
    
    const reseller = rows[0];
    if (!reseller.is_active) return res.status(403).json({ error: 'Cuenta suspendida' });
    
    const token = jwt.sign(
      { id: reseller.id, username: reseller.username, role: 'reseller' },
      JWT_SECRET,
      { expiresIn: '24h' }
    );
    
    res.json({ 
      token, 
      reseller: { 
        id: reseller.id, name: reseller.name, username: reseller.username,
        max_clients: reseller.max_clients, email: reseller.email, phone: reseller.phone 
      } 
    });
  } catch (err) {
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// Reseller auth middleware
const authReseller = (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Token requerido' });
  }
  try {
    const decoded = jwt.verify(authHeader.split(' ')[1], JWT_SECRET);
    if (decoded.role !== 'reseller') return res.status(403).json({ error: 'Acceso denegado' });
    req.reseller = decoded;
    next();
  } catch {
    return res.status(401).json({ error: 'Token inválido o expirado' });
  }
};

// Reseller: Get own info
app.get('/api/reseller/me', authReseller, async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT id, name, username, email, phone, max_clients, commission_percent FROM resellers WHERE id = $1', [req.reseller.id]);
    if (rows.length === 0) return res.status(404).json({ error: 'Reseller no encontrado' });
    
    const { rows: clients } = await pool.query(
      'SELECT COUNT(*) as count FROM clients WHERE reseller_id = $1', [req.reseller.id]
    );
    
    res.json({ ...rows[0], client_count: parseInt(clients[0].count) || 0 });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Reseller: List own clients
app.get('/api/reseller/clients', authReseller, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT c.id, c.username, c.password, c.max_screens, c.expiry_date, c.is_active, c.notes, c.plan_id, c.playlist_token, c.created_at, c.vod_enabled,
              p.name as plan_name
       FROM clients c LEFT JOIN plans p ON c.plan_id = p.id
       WHERE c.reseller_id = $1 ORDER BY c.created_at DESC`,
      [req.reseller.id]
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Reseller: Create client
app.post('/api/reseller/clients', authReseller, async (req, res) => {
  try {
    // Check max_clients limit
    const { rows: reseller } = await pool.query('SELECT max_clients FROM resellers WHERE id = $1', [req.reseller.id]);
    const { rows: countRows } = await pool.query('SELECT COUNT(*) as count FROM clients WHERE reseller_id = $1', [req.reseller.id]);
    
    if (parseInt(countRows[0].count) >= reseller[0].max_clients) {
      return res.status(403).json({ error: `Límite de ${reseller[0].max_clients} clientes alcanzado` });
    }
    
    const { username, password, max_screens, expiry_date, notes, plan_id, vod_enabled } = req.body;
    if (!username || !password || !expiry_date) {
      return res.status(400).json({ error: 'username, password y expiry_date requeridos' });
    }
    
    const token = crypto.randomBytes(16).toString('hex');
    const { rows } = await pool.query(
      `INSERT INTO clients (username, password, max_screens, expiry_date, notes, plan_id, reseller_id, playlist_token, vod_enabled)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [username, password, max_screens || 1, expiry_date, notes || null, plan_id || null, req.reseller.id, token, vod_enabled || false]
    );
    res.json(rows[0]);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Reseller: Update own client
app.put('/api/reseller/clients/:id', authReseller, async (req, res) => {
  try {
    // Verify client belongs to this reseller
    const { rows: existing } = await pool.query(
      'SELECT * FROM clients WHERE id = $1 AND reseller_id = $2', [req.params.id, req.reseller.id]
    );
    if (existing.length === 0) return res.status(404).json({ error: 'Cliente no encontrado' });
    
    const c = existing[0];
    const username = req.body.username || c.username;
    const password = req.body.password || c.password;
    const max_screens = req.body.max_screens !== undefined ? req.body.max_screens : c.max_screens;
    const expiry_date = req.body.expiry_date || c.expiry_date;
    const is_active = req.body.is_active !== undefined ? req.body.is_active : c.is_active;
    const notes = req.body.notes !== undefined ? req.body.notes : c.notes;
    const plan_id = req.body.plan_id !== undefined ? req.body.plan_id : c.plan_id;
    const vod_enabled = req.body.vod_enabled !== undefined ? req.body.vod_enabled : c.vod_enabled;
    
    const { rows } = await pool.query(
      `UPDATE clients SET username=$1, password=$2, max_screens=$3, expiry_date=$4, is_active=$5, notes=$6, plan_id=$7, vod_enabled=$8
       WHERE id=$9 AND reseller_id=$10 RETURNING *`,
      [username, password, max_screens, expiry_date, is_active, notes, plan_id, vod_enabled, req.params.id, req.reseller.id]
    );
    res.json(rows[0]);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Reseller: Delete own client
app.delete('/api/reseller/clients/:id', authReseller, async (req, res) => {
  try {
    const { rowCount } = await pool.query(
      'DELETE FROM clients WHERE id = $1 AND reseller_id = $2', [req.params.id, req.reseller.id]
    );
    if (rowCount === 0) return res.status(404).json({ error: 'Cliente no encontrado' });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Reseller: Get available plans
app.get('/api/reseller/plans', authReseller, async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT id, name, categories FROM plans WHERE is_active = true ORDER BY sort_order, name');
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

//
// INICIAR SERVIDOR
// =============================================
app.listen(PORT, '0.0.0.0', () => {
  console.log(`\n🚀 StreamBox API corriendo en http://0.0.0.0:${PORT}`);
  console.log(`📺 Panel Admin: http://TU_IP:80`);
  console.log(`📱 APK API: http://TU_IP:${PORT}/api/auth/login`);
  console.log(`🔗 Xtream Base: ${XTREAM_BASE_URL}`);
  console.log(`🔐 Setup inicial: POST http://localhost:${PORT}/api/admin/setup\n`);
  
  // Iniciar canales keep-alive después de 3 segundos (esperar conexión DB)
  setTimeout(() => initKeepAliveChannels(), 3000);
});
