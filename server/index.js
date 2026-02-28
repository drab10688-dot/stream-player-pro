const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

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

app.post('/api/channels', authAdmin, async (req, res) => {
  const { name, url, category, sort_order } = req.body;
  const { rows } = await pool.query(
    'INSERT INTO channels (name, url, category, sort_order) VALUES ($1, $2, $3, $4) RETURNING *',
    [name, url, category || 'General', sort_order || 0]
  );
  res.json(rows[0]);
});

app.put('/api/channels/:id', authAdmin, async (req, res) => {
  const { name, url, category, sort_order, is_active } = req.body;
  const { rows } = await pool.query(
    'UPDATE channels SET name=$1, url=$2, category=$3, sort_order=$4, is_active=$5 WHERE id=$6 RETURNING *',
    [name, url, category, sort_order, is_active, req.params.id]
  );
  res.json(rows[0]);
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
  const { username, password, max_screens, expiry_date, is_active, notes } = req.body;
  const { rows } = await pool.query(
    'UPDATE clients SET username=$1, password=$2, max_screens=$3, expiry_date=$4, is_active=$5, notes=$6 WHERE id=$7 RETURNING *',
    [username, password, max_screens, expiry_date, is_active, notes, req.params.id]
  );
  res.json(rows[0]);
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
  const { title, message, image_url, is_active } = req.body;
  const { rows } = await pool.query(
    'UPDATE ads SET title=$1, message=$2, image_url=$3, is_active=$4 WHERE id=$5 RETURNING *',
    [title, message, image_url, is_active, req.params.id]
  );
  res.json(rows[0]);
});

app.delete('/api/ads/:id', authAdmin, async (req, res) => {
  await pool.query('DELETE FROM ads WHERE id = $1', [req.params.id]);
  res.json({ ok: true });
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

    // SEGURIDAD: Nunca exponer la URL real del origen.
    // Convertir URLs a rutas de proxy local: /stream/{archivo}?user=X&pass=Y
    const safeChannels = channelsRes.rows.map(ch => {
      // Extraer solo el nombre del archivo/path (ej: "601.ts" de "http://1.2.3.4:8281/601.ts")
      let streamPath = ch.url;
      try {
        const urlObj = new URL(ch.url);
        streamPath = urlObj.pathname.replace(/^\//, '');
      } catch {
        // Si no es URL válida, asumir que ya es un path relativo
        streamPath = ch.url.replace(/^\//, '');
      }
      return {
        ...ch,
        url: `/stream/${streamPath}`,
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
// INICIAR SERVIDOR
// =============================================
app.listen(PORT, '0.0.0.0', () => {
  console.log(`\n🚀 StreamBox API corriendo en http://0.0.0.0:${PORT}`);
  console.log(`📺 Panel Admin: http://TU_IP:80`);
  console.log(`🔐 Setup inicial: POST http://localhost:${PORT}/api/admin/setup\n`);
});
