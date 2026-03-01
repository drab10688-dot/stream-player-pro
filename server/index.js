const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const http = require('http');
const https = require('https');
const { URL } = require('url');

const app = express();
app.use(cors());
app.use(express.json());

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

// Ping de canales (requiere admin)
app.post('/api/channels/ping', authAdmin, async (req, res) => {
  try {
    const { rows: channels } = await pool.query(
      'SELECT id, name, url, category, logo_url FROM channels WHERE is_active = true'
    );

    const results = await Promise.all(channels.map(async (ch) => {
      const start = Date.now();
      try {
        const isYouTube = /youtube\.com|youtu\.be/.test(ch.url);
        if (isYouTube) {
          return { id: ch.id, name: ch.name, category: ch.category, logo_url: ch.logo_url, status: 'online', response_time: 0, status_code: 200, error: null };
        }

        const parsedUrl = new URL(ch.url);
        const httpClient = parsedUrl.protocol === 'https:' ? https : http;

        const result = await new Promise((resolve) => {
          const req = httpClient.request(ch.url, { method: 'GET', headers: { 'User-Agent': 'StreamBox-HealthCheck/1.0', 'Range': 'bytes=0-1024' } }, (response) => {
            response.destroy(); // No necesitamos el body completo
            const responseTime = Date.now() - start;
            const isOk = response.statusCode >= 200 && response.statusCode < 400;
            resolve({ id: ch.id, name: ch.name, category: ch.category, logo_url: ch.logo_url, status: isOk ? 'online' : 'offline', response_time: responseTime, status_code: response.statusCode, error: isOk ? null : `HTTP ${response.statusCode}` });
          });
          req.on('error', (err) => {
            resolve({ id: ch.id, name: ch.name, category: ch.category, logo_url: ch.logo_url, status: 'offline', response_time: Date.now() - start, status_code: 0, error: err.message });
          });
          req.setTimeout(10000, () => { req.destroy(); resolve({ id: ch.id, name: ch.name, category: ch.category, logo_url: ch.logo_url, status: 'offline', response_time: 10000, status_code: 0, error: 'Timeout' }); });
          req.end();
        });

        return result;
      } catch (err) {
        return { id: ch.id, name: ch.name, category: ch.category, logo_url: ch.logo_url, status: 'offline', response_time: Date.now() - start, status_code: 0, error: err.message };
      }
    }));

    // Log offline channels
    const offlineChannels = results.filter(r => r.status === 'offline');
    if (offlineChannels.length > 0) {
      for (const ch of offlineChannels) {
        await pool.query(
          'INSERT INTO channel_health_logs (channel_id, status, response_code, error_message, checked_by) VALUES ($1, $2, $3, $4, $5)',
          [ch.id, 'error', ch.status_code, ch.error || 'Canal no responde', 'system:ping']
        );
      }
    }

    const online = results.filter(r => r.status === 'online').length;
    const offline = offlineChannels.length;
    res.json({ results, summary: { total: results.length, online, offline } });
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

app.post('/api/channels', authAdmin, async (req, res) => {
  const { name, url, category, sort_order } = req.body;
  const { rows } = await pool.query(
    'INSERT INTO channels (name, url, category, sort_order) VALUES ($1, $2, $3, $4) RETURNING *',
    [name, url, category || 'General', sort_order || 0]
  );
  res.json(rows[0]);
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

    const { rows } = await pool.query(
      'UPDATE channels SET name=$1, url=$2, category=$3, sort_order=$4, is_active=$5 WHERE id=$6 RETURNING *',
      [name, url, category, sort_order, is_active, req.params.id]
    );
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
  const { username, password, max_screens, expiry_date, notes } = req.body;
  try {
    const { rows } = await pool.query(
      'INSERT INTO clients (username, password, max_screens, expiry_date, notes) VALUES ($1, $2, $3, $4, $5) RETURNING *',
      [username, password, max_screens || 1, expiry_date, notes]
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

    const { rows } = await pool.query(
      'UPDATE clients SET username=$1, password=$2, max_screens=$3, expiry_date=$4, is_active=$5, notes=$6 WHERE id=$7 RETURNING *',
      [username, password, max_screens, expiry_date, is_active, notes, req.params.id]
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

      // Registrar conexión
      await pool.query(
        `INSERT INTO active_connections (client_id, device_id, last_heartbeat) 
         VALUES ($1, $2, now()) 
         ON CONFLICT (client_id, device_id) DO UPDATE SET last_heartbeat = now()`,
        [client.id, device_id]
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

    res.json({
      client: { id: client.id, username: client.username, max_screens: client.max_screens, expiry_date: client.expiry_date },
      channels: safeChannels,
      ads: adsRes.rows,
    });
  } catch (err) {
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// Heartbeat (mantener conexión activa)
app.post('/api/client/heartbeat', async (req, res) => {
  const { client_id, device_id } = req.body;
  if (client_id && device_id) {
    await pool.query(
      'UPDATE active_connections SET last_heartbeat = now() WHERE client_id = $1 AND device_id = $2',
      [client_id, device_id]
    );
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
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const HLS_DIR = '/tmp/streambox-hls';
const HLS_CACHE_DIR = '/tmp/streambox-cache';
const activeTranscoders = new Map(); // channelId -> { ffmpeg, clients, lastAccess, type }

// Crear directorios base
[HLS_DIR, HLS_CACHE_DIR].forEach(dir => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

// Verificar si estamos corriendo en tmpfs (RAM)
const isTmpfs = (() => {
  try {
    const { execSync } = require('child_process');
    const output = execSync(`df -T ${HLS_DIR} 2>/dev/null`).toString();
    const onTmpfs = output.includes('tmpfs');
    if (onTmpfs) {
      const parts = output.split('\n')[1]?.split(/\s+/) || [];
      const sizeKB = parseInt(parts[2]) || 0;
      const usedKB = parseInt(parts[3]) || 0;
      const sizeMB = Math.round(sizeKB / 1024);
      const usedMB = Math.round(usedKB / 1024);
      console.log(`⚡ HLS en tmpfs (RAM): ${usedMB}MB / ${sizeMB}MB usado`);
    } else {
      console.log(`💾 HLS en disco normal: ${HLS_DIR} (recomendado: montar tmpfs para mejor rendimiento)`);
    }
    return onTmpfs;
  } catch { return false; }
})();

// Monitor de uso de RAM para tmpfs (cada 60s)
setInterval(() => {
  try {
    const { execSync } = require('child_process');
    const output = execSync(`df -h ${HLS_DIR} 2>/dev/null`).toString();
    const parts = output.split('\n')[1]?.split(/\s+/) || [];
    const used = parts[2] || '?';
    const total = parts[1] || '?';
    const pct = parts[4] || '?';
    if (parseInt(pct) > 80) {
      console.warn(`⚠️ tmpfs casi lleno: ${used}/${total} (${pct})`);
      // Limpieza agresiva: borrar canales sin clientes activos
      const dirs = fs.readdirSync(HLS_DIR);
      dirs.forEach(dir => {
        if (!activeTranscoders.has(dir)) {
          cleanChannelDir(dir);
          console.log(`🧹 Canal ${dir} limpiado por presión de memoria`);
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

function startFFmpegTranscoder(channelId, sourceUrl) {
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

  // Check if adaptive mode is requested via query param or default
  const useAdaptive = true; // Always use adaptive for Netflix-like experience

  if (useAdaptive) {
    return startAdaptiveTranscoder(channelId, sourceUrl, channelDir);
  }
}

// Adaptive multi-bitrate transcoder (Netflix-style)
function startAdaptiveTranscoder(channelId, sourceUrl, channelDir) {
  const masterPlaylistPath = path.join(channelDir, 'master.m3u8');
  const copyManifestPath = path.join(channelDir, 'high', 'stream.m3u8');

  // Create subdirectories for each quality
  ['low', 'med', 'high'].forEach(q => {
    const qDir = path.join(channelDir, q);
    if (!fs.existsSync(qDir)) fs.mkdirSync(qDir, { recursive: true });
  });

  console.log(`🎬 [${channelId}] Iniciando FFmpeg adaptativo (3 calidades): ${sourceUrl}`);

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

    // --- HLS output for LOW ---
    '-f', 'hls',
    '-hls_time', '2',
    '-hls_list_size', '6',
    '-hls_flags', 'delete_segments+append_list+temp_file',
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
      startSingleQualityTranscoder(channelId, sourceUrl, channelDir);
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

    // If it crashed immediately and no fallback, try single quality
    if (!fallbackTriggered && code !== 0 && entry.retryCount === 0) {
      fallbackTriggered = true;
      console.log(`🔄 [${channelId}] Fallback a calidad única optimizada`);
      activeTranscoders.delete(channelId);
      const fallbackEntry = startSingleQualityTranscoder(channelId, sourceUrl, channelDir);
      if (fallbackEntry) fallbackEntry.clients = entry.clients;
      return;
    }

    activeTranscoders.delete(channelId);
    if (entry.clients > 0 && entry.retryCount < entry.maxRetries) {
      entry.retryCount++;
      const delay = Math.min(2000 * entry.retryCount, 15000);
      console.log(`🔄 [${channelId}] Reiniciando en ${delay}ms (intento ${entry.retryCount}/${entry.maxRetries})`);
      setTimeout(() => {
        cleanChannelDir(channelId);
        startFFmpegTranscoder(channelId, sourceUrl);
        const newEntry = activeTranscoders.get(channelId);
        if (newEntry) newEntry.clients = entry.clients;
      }, delay);
    } else {
      cleanChannelDir(channelId);
    }
  });

  return entry;
}

// Fallback: single quality optimized for 2-3 Mbps
function startSingleQualityTranscoder(channelId, sourceUrl, channelDir) {
  const manifestPath = path.join(channelDir, 'stream.m3u8');

  console.log(`🎬 [${channelId}] FFmpeg calidad única (optimizado 2-3 Mbps): ${sourceUrl}`);

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
    '-hls_time', '2',
    '-hls_list_size', '6',
    '-hls_flags', 'delete_segments+append_list+temp_file',
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
    activeTranscoders.delete(channelId);

    // Reconectar si hay clientes
    if (entry.clients > 0 && entry.retryCount < entry.maxRetries) {
      entry.retryCount++;
      const delay = Math.min(2000 * entry.retryCount, 15000);
      console.log(`🔄 [${channelId}] Reiniciando FFmpeg en ${delay}ms (intento ${entry.retryCount}/${entry.maxRetries})`);
      setTimeout(() => {
        cleanChannelDir(channelId);
        startFFmpegTranscoder(channelId, sourceUrl);
        // Restaurar count de clientes
        const newEntry = activeTranscoders.get(channelId);
        if (newEntry) newEntry.clients = entry.clients;
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
    // Esperar 30 segundos antes de matar, por si alguien vuelve
    setTimeout(() => {
      const current = activeTranscoders.get(channelId);
      if (current && current.clients <= 0) {
        console.log(`🔴 [${channelId}] Sin clientes, deteniendo FFmpeg`);
        if (current.type === 'ffmpeg' && current.ffmpeg) {
          current.ffmpeg.kill('SIGTERM');
        }
        activeTranscoders.delete(channelId);
        cleanChannelDir(channelId);
      }
    }, 30000);
  }
}

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
    type: 'hls-proxy',
    sourceUrl,
    ready: true,
  };
  activeTranscoders.set(channelId, entry);
  console.log(`📡 [${channelId}] Proxy HLS iniciado: ${sourceUrl}`);
  return entry;
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
    // Matar todos los FFmpeg sin clientes
    activeTranscoders.forEach((entry, key) => {
      if (entry.clients <= 0) {
        if (entry.type === 'ffmpeg' && entry.ffmpeg) entry.ffmpeg.kill('SIGTERM');
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

// RUTA: IMPORTAR CANALES DESDE M3U
// Parsea listas M3U/M3U8 y las agrega como canales
// =============================================
app.post('/api/channels/import-m3u', authAdmin, async (req, res) => {
  try {
    const { m3u_content, m3u_url } = req.body;
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
        channels.push({
          name: currentName || `Canal ${channels.length + 1}`,
          url: line,
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
          'INSERT INTO channels (name, url, category, logo_url, sort_order, is_active) VALUES ($1, $2, $3, $4, $5, $6)',
          [ch.name, ch.url, ch.category, ch.logo_url, ch.sort_order, ch.is_active]
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
// RUTA: CLIENTES POR EXPIRAR
// =============================================
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

// Check if cloudflared is installed
const isCloudflaredInstalled = () => {
  try {
    execSync('which cloudflared', { stdio: 'ignore' });
    return true;
  } catch { return false; }
};

// Get tunnel status
app.get('/api/tunnel/status', authAdmin, (req, res) => {
  res.json({
    installed: isCloudflaredInstalled(),
    status: tunnelStatus,
    url: tunnelUrl,
    error: tunnelError,
    https: tunnelUrl ? tunnelUrl.startsWith('https://') : false,
  });
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
// INICIAR SERVIDOR
// =============================================
app.listen(PORT, '0.0.0.0', () => {
  console.log(`\n🚀 StreamBox API corriendo en http://0.0.0.0:${PORT}`);
  console.log(`📺 Panel Admin: http://TU_IP:80`);
  console.log(`🔐 Setup inicial: POST http://localhost:${PORT}/api/admin/setup\n`);
});
