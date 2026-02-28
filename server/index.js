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

// SEGURIDAD: Endpoint público de canales NO expone URLs reales
app.get('/api/channels/public', async (req, res) => {
  const { rows } = await pool.query(
    'SELECT id, name, category, logo_url, sort_order FROM channels WHERE is_active = true ORDER BY sort_order'
  );
  // Solo devolver nombres, sin URLs
  res.json(rows);
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

    // RESTREAMING: Convertir URLs a rutas de proxy dinámico
    // El cliente accede a /api/restream/{channelId} y el servidor hace proxy al origen
    const safeChannels = channelsRes.rows.map(ch => ({
      ...ch,
      url: `/api/restream/${ch.id}`,
    }));

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
// SISTEMA DE CACHÉ DE STREAMS
// Una sola conexión al origen sirve a múltiples clientes
// Caché de segmentos TS y manifiestos M3U8
// Limpieza automática a medianoche
// =============================================
const streamCache = new Map(); // channelId -> { data, contentType, timestamp, clients, sourceReq }
const CACHE_DIR = '/tmp/streambox-cache';
const fs = require('fs');
const path = require('path');

// Crear directorio de caché si no existe
if (!fs.existsSync(CACHE_DIR)) {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
}

// Limpieza automática a medianoche
const scheduleCacheCleanup = () => {
  const now = new Date();
  const midnight = new Date(now);
  midnight.setDate(midnight.getDate() + 1);
  midnight.setHours(0, 0, 0, 0);
  const msUntilMidnight = midnight.getTime() - now.getTime();

  setTimeout(() => {
    console.log('🧹 Limpieza de caché de streams a medianoche...');
    // Limpiar caché en memoria
    streamCache.forEach((entry, key) => {
      if (entry.sourceReq) entry.sourceReq.destroy();
      streamCache.delete(key);
    });
    // Limpiar archivos de caché
    if (fs.existsSync(CACHE_DIR)) {
      const files = fs.readdirSync(CACHE_DIR);
      files.forEach(file => {
        try { fs.unlinkSync(path.join(CACHE_DIR, file)); } catch {}
      });
    }
    console.log(`✅ Caché limpiado: ${streamCache.size} entradas en memoria, ${fs.readdirSync(CACHE_DIR).length} archivos`);
    // Programar siguiente limpieza
    scheduleCacheCleanup();
  }, msUntilMidnight);

  console.log(`⏰ Próxima limpieza de caché: ${midnight.toLocaleString()} (en ${Math.round(msUntilMidnight / 60000)} min)`);
};
scheduleCacheCleanup();

// Limpiar entradas de caché sin clientes activos (cada 5 min)
setInterval(() => {
  const now = Date.now();
  streamCache.forEach((entry, key) => {
    // Si han pasado más de 5 min sin clientes, eliminar
    if (entry.clients === 0 && now - entry.timestamp > 5 * 60 * 1000) {
      if (entry.sourceReq) entry.sourceReq.destroy();
      streamCache.delete(key);
    }
  });
}, 5 * 60 * 1000);

// Función para obtener un m3u8 cacheado o descargarlo
const getCachedM3U8 = async (channelId, targetUrl) => {
  const cacheKey = `m3u8_${channelId}`;
  const cached = streamCache.get(cacheKey);
  
  // Cachear m3u8 por 5 segundos (se actualiza frecuentemente en live)
  if (cached && Date.now() - cached.timestamp < 5000) {
    return cached.data;
  }

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
        // Reescribir URLs relativas
        const baseUrl = targetUrl.substring(0, targetUrl.lastIndexOf('/') + 1);
        const rewritten = body.replace(/^(?!#)(.+\.ts.*)$/gm, (match) => {
          if (match.startsWith('http')) return match;
          return baseUrl + match;
        }).replace(/^(?!#)(.+\.m3u8.*)$/gm, (match) => {
          if (match.startsWith('http')) return match;
          return baseUrl + match;
        });
        
        streamCache.set(cacheKey, { data: rewritten, timestamp: Date.now(), clients: 0 });
        resolve(rewritten);
      });
    });
    req.on('error', reject);
    req.setTimeout(15000, () => { req.destroy(); reject(new Error('Timeout')); });
    req.end();
  });
};

// =============================================
// RUTA: RESTREAMING DINÁMICO CON CACHÉ COMPARTIDO
// Una conexión al origen → múltiples clientes
// =============================================
app.get('/api/restream/:channelId', async (req, res) => {
  try {
    // Validar cliente autenticado (por query params o header)
    const { user, pass } = req.query;
    if (user && pass) {
      const { rows } = await pool.query(
        'SELECT id, is_active, expiry_date FROM clients WHERE username = $1 AND password = $2',
        [user, pass]
      );
      if (rows.length === 0 || !rows[0].is_active || new Date(rows[0].expiry_date) < new Date()) {
        return res.status(403).send('Forbidden');
      }
    }

    // Obtener URL real del canal
    const { rows: channels } = await pool.query(
      'SELECT url FROM channels WHERE id = $1 AND is_active = true',
      [req.params.channelId]
    );

    if (channels.length === 0) {
      return res.status(404).json({ error: 'Canal no encontrado' });
    }

    const targetUrl = channels[0].url;
    const channelId = req.params.channelId;

    // Headers de seguridad
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('X-Powered-By', 'StreamBox');

    // Para HLS: cachear y servir manifiestos
    const isHLS = targetUrl.includes('.m3u8');
    if (isHLS) {
      try {
        const manifest = await getCachedM3U8(channelId, targetUrl);
        res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
        res.setHeader('Cache-Control', 'no-cache');
        res.send(manifest);
      } catch (err) {
        console.error('HLS cache error:', err.message);
        res.status(502).json({ error: 'No se pudo obtener el manifiesto HLS' });
      }
      return;
    }

    // Para TS/MP4: proxy directo con pipe compartido
    const parsedUrl = new URL(targetUrl);
    const httpClient = parsedUrl.protocol === 'https:' ? https : http;

    const proxyReq = httpClient.request(targetUrl, {
      method: 'GET',
      headers: { 'User-Agent': 'StreamBox/1.0' },
    }, (proxyRes) => {
      const contentType = proxyRes.headers['content-type'];
      if (contentType) res.setHeader('Content-Type', contentType);
      if (proxyRes.headers['content-length']) res.setHeader('Content-Length', proxyRes.headers['content-length']);
      
      // Pipe directo para streams continuos
      proxyRes.pipe(res);
    });

    proxyReq.on('error', (err) => {
      console.error('Restream error:', err.message);
      if (!res.headersSent) res.status(502).json({ error: 'No se pudo conectar al stream origen' });
    });

    proxyReq.setTimeout(30000, () => {
      proxyReq.destroy();
      if (!res.headersSent) res.status(504).json({ error: 'Timeout al conectar con el stream' });
    });

    proxyReq.end();

    // Limpiar si el cliente se desconecta
    req.on('close', () => {
      proxyReq.destroy();
    });
  } catch (err) {
    console.error('Restream error:', err);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// =============================================
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
// INICIAR SERVIDOR
// =============================================
app.listen(PORT, '0.0.0.0', () => {
  console.log(`\n🚀 StreamBox API corriendo en http://0.0.0.0:${PORT}`);
  console.log(`📺 Panel Admin: http://TU_IP:80`);
  console.log(`🔐 Setup inicial: POST http://localhost:${PORT}/api/admin/setup\n`);
});
