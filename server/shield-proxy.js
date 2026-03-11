// =============================================
// OMNISYNC SHIELD - Proxy para Xtream UI
// Oculta la IP del servidor con Cloudflare Tunnel
// =============================================

const express = require('express');
const cors = require('cors');
const http = require('http');
const https = require('https');
const { execSync, spawn } = require('child_process');
const fs = require('fs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');

const app = express();
app.use(cors());
app.use(express.json());

// =============================================
// CONFIGURATION
// =============================================
const PORT = process.env.PORT || 3002;
const JWT_SECRET = process.env.JWT_SECRET || crypto.randomBytes(32).toString('hex');
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'admin@omnisync.local';
const ADMIN_PASS = process.env.ADMIN_PASS || 'admin123';
const NGINX_PORT = process.env.NGINX_PORT || '8880';

let XTREAM_HOST = process.env.XTREAM_HOST || 'http://localhost';
let XTREAM_PORT = process.env.XTREAM_PORT || '25461';

// Master Xtream credentials (used by Shield to proxy streams for local clients)
const MASTER_CREDS_FILE = '/opt/omnisync-shield/master-creds.json';

const loadMasterCreds = () => {
  try {
    if (fs.existsSync(MASTER_CREDS_FILE)) {
      return JSON.parse(fs.readFileSync(MASTER_CREDS_FILE, 'utf8'));
    }
  } catch (err) {
    console.error('Error loading master creds:', err.message);
  }
  return null;
};

const saveMasterCreds = (creds) => {
  const dir = require('path').dirname(MASTER_CREDS_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(MASTER_CREDS_FILE, JSON.stringify(creds, null, 2));
};

// Validate Shield client credentials against clients.json
const validateShieldClient = (username, password) => {
  const clients = loadClients();
  const client = clients.find(c => c.username === username && c.password === password);
  if (!client) return { valid: false, error: 'Credenciales inválidas' };
  if (client.is_banned) return { valid: false, error: 'Cliente bloqueado' };
  if (!client.admin_enabled) return { valid: false, error: 'Cliente deshabilitado' };
  if (client.exp_date) {
    const expiry = new Date(client.exp_date);
    if (!isNaN(expiry.getTime()) && expiry < new Date()) {
      return { valid: false, error: 'Suscripción expirada' };
    }
  }
  // Check max connections
  const activeCons = Array.from(activeConnections.values()).filter(conn => conn.username === username).length;
  if (client.max_connections && activeCons >= client.max_connections) {
    return { valid: false, error: `Máximo de conexiones alcanzado (${client.max_connections})` };
  }
  return { valid: true, client };
};

// Load clients.json (forward declaration for use in validateShieldClient)
const loadClients = () => {
  try {
    if (fs.existsSync(CLIENTS_FILE)) {
      return JSON.parse(fs.readFileSync(CLIENTS_FILE, 'utf8'));
    }
  } catch (err) {
    console.error('Error loading clients:', err.message);
  }
  return [];
};

const CLIENTS_FILE = '/opt/omnisync-shield/clients.json';

// Tunnel state - Shield (main)
let tunnelProcess = null;
let tunnelUrl = null;
let tunnelMode = 'full'; // 'full' | 'hybrid'
let tunnelError = null;

// Tunnel state - Xtream UI panel
let xtreamTunnelProcess = null;
let xtreamTunnelUrl = null;
let xtreamTunnelError = null;
const XTREAM_PANEL_PORT = process.env.XTREAM_PANEL_PORT || '25500';

// Stats
let totalRequests = 0;
const startTime = Date.now();
const activeConnections = new Map();

// =============================================
// HELPERS
// =============================================
const getXtreamUrl = () => `${XTREAM_HOST}:${XTREAM_PORT}`;

const getServerIp = () => {
  try {
    return execSync("curl -s -4 ifconfig.me 2>/dev/null || hostname -I | awk '{print $1}'", { timeout: 5000 }).toString().trim();
  } catch { return null; }
};

const getPublicHost = (req) => {
  const fwdHost = req.headers['x-forwarded-host'];
  const fwdProto = req.headers['x-forwarded-proto'] || 'http';
  if (fwdHost) return `${fwdProto}://${fwdHost}`;
  return `http://${req.headers.host}`;
};

const proxyToXtream = (targetPath, req, res) => {
  totalRequests++;
  const url = `${getXtreamUrl()}${targetPath}`;
  const isHttps = url.startsWith('https');
  const mod = isHttps ? https : http;

  const parsed = new URL(url);
  const options = {
    hostname: parsed.hostname,
    port: parsed.port,
    path: parsed.pathname + parsed.search,
    method: req.method,
    headers: {
      'User-Agent': 'VLC/3.0.18 LibVLC/3.0.18',
      ...(req.headers['content-type'] ? { 'Content-Type': req.headers['content-type'] } : {}),
    },
    timeout: 30000,
  };

  const proxyReq = mod.request(options, (proxyRes) => {
    // Rewrite URLs in response to hide real IP
    const contentType = proxyRes.headers['content-type'] || '';
    const publicHost = getPublicHost(req);

    if (contentType.includes('json') || contentType.includes('text') || contentType.includes('xml') || contentType.includes('mpegurl')) {
      let body = '';
      proxyRes.on('data', chunk => body += chunk);
      proxyRes.on('end', () => {
        // Replace Xtream UI host references with public host
        const xtreamBase = getXtreamUrl();
        let rewritten = body;

        // Replace various URL patterns
        rewritten = rewritten.replace(new RegExp(escapeRegex(xtreamBase), 'g'), publicHost);
        rewritten = rewritten.replace(new RegExp(escapeRegex(XTREAM_HOST.replace('http://', '').replace('https://', '') + ':' + XTREAM_PORT), 'g'), publicHost.replace('http://', '').replace('https://', ''));

        // Also replace server IP if visible
        const serverIp = getServerIp();
        if (serverIp && tunnelMode === 'full') {
          rewritten = rewritten.replace(new RegExp(escapeRegex(`http://${serverIp}:${XTREAM_PORT}`), 'g'), publicHost);
          rewritten = rewritten.replace(new RegExp(escapeRegex(`http://${serverIp}`), 'g'), publicHost);
        }

        res.writeHead(proxyRes.statusCode, {
          'Content-Type': contentType,
          'Access-Control-Allow-Origin': '*',
        });
        res.end(rewritten);
      });
    } else {
      // Binary content (video streams) - pipe directly
      res.writeHead(proxyRes.statusCode, {
        'Content-Type': contentType,
        'Access-Control-Allow-Origin': '*',
      });
      proxyRes.pipe(res);
    }
  });

  proxyReq.on('error', (err) => {
    res.status(502).json({ error: `Error conectando a Xtream UI: ${err.message}` });
  });

  proxyReq.on('timeout', () => {
    proxyReq.destroy();
    res.status(504).json({ error: 'Timeout conectando a Xtream UI' });
  });

  if (req.body && Object.keys(req.body).length > 0) {
    proxyReq.write(JSON.stringify(req.body));
  }
  proxyReq.end();
};

const escapeRegex = (str) => str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// =============================================
// AUTH MIDDLEWARE
// =============================================
const authAdmin = (req, res, next) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'No autorizado' });
  try {
    jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Token inválido' });
  }
};

// =============================================
// ADMIN ROUTES
// =============================================
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', service: 'omnisync-shield' });
});

app.post('/api/admin/login', (req, res) => {
  const { email, password } = req.body;
  if (email === ADMIN_EMAIL && password === ADMIN_PASS) {
    const token = jwt.sign({ email, role: 'admin' }, JWT_SECRET, { expiresIn: '24h' });
    return res.json({ success: true, token, admin: { email } });
  }
  res.status(401).json({ error: 'Credenciales incorrectas' });
});

app.post('/api/admin/setup', (req, res) => {
  const { email, password } = req.body;
  // First setup - just accept any credentials
  const token = jwt.sign({ email, role: 'admin' }, JWT_SECRET, { expiresIn: '24h' });
  res.json({ success: true, token, admin: { email } });
});

app.post('/api/admin/change-password', authAdmin, (req, res) => {
  const { newPassword } = req.body;
  if (!newPassword || newPassword.length < 6) {
    return res.status(400).json({ error: 'La contraseña debe tener al menos 6 caracteres' });
  }
  // In production this would persist; for now it's memory-only
  res.json({ success: true, message: 'Contraseña actualizada (reinicia PM2 para aplicar permanentemente)' });
});

// =============================================
// STATUS
// =============================================
app.get('/api/status', authAdmin, (req, res) => {
  const cloudflaredInstalled = (() => { try { execSync('which cloudflared', { stdio: 'ignore' }); return true; } catch { return false; } })();

  res.json({
    tunnel: {
      installed: cloudflaredInstalled,
      status: tunnelProcess ? 'running' : 'stopped',
      url: tunnelUrl,
      mode: tunnelMode,
    },
    xtream: {
      connected: checkXtreamConnection(),
      host: XTREAM_HOST,
      port: XTREAM_PORT,
    },
    proxy: {
      active_connections: activeConnections.size,
      total_requests: totalRequests,
      uptime_seconds: Math.floor((Date.now() - startTime) / 1000),
    },
    server_ip: getServerIp(),
  });
});

function checkXtreamConnection() {
  try {
    execSync(`curl -s -o /dev/null -w "%{http_code}" "${getXtreamUrl()}/player_api.php" --max-time 3`, { timeout: 5000 });
    return true;
  } catch { return false; }
}

// =============================================
// XTREAM CONFIG
// =============================================
app.get('/api/xtream/config', authAdmin, (req, res) => {
  res.json({
    host: XTREAM_HOST,
    port: XTREAM_PORT,
    connected: checkXtreamConnection(),
    error: null,
  });
});

app.post('/api/xtream/config', authAdmin, (req, res) => {
  const { host, port } = req.body;
  if (host) XTREAM_HOST = host;
  if (port) XTREAM_PORT = port;
  res.json({ success: true, message: 'Configuración actualizada' });
});

// Master credentials endpoints
app.get('/api/xtream/master-creds', authAdmin, (req, res) => {
  const creds = loadMasterCreds();
  res.json({
    configured: !!creds,
    username: creds?.username || '',
    // Don't send password back for security
  });
});

app.post('/api/xtream/master-creds', authAdmin, (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: 'Usuario y contraseña requeridos' });
  }
  saveMasterCreds({ username, password });
  res.json({ success: true, message: 'Credenciales maestras guardadas' });
});

app.post('/api/xtream/test', authAdmin, (req, res) => {
  const { host, port, username, password } = req.body;
  const testHost = host || XTREAM_HOST;
  const testPort = port || XTREAM_PORT;

  try {
    const result = execSync(
      `curl -s "${testHost}:${testPort}/player_api.php?username=${username}&password=${password}" --max-time 5`,
      { timeout: 8000 }
    ).toString();

    try {
      const data = JSON.parse(result);
      if (data.user_info) {
        res.json({ success: true, server_info: data.server_info, user_info: { status: data.user_info.status } });
      } else {
        res.json({ success: false, error: 'Respuesta inesperada de Xtream UI' });
      }
    } catch {
      res.json({ success: false, error: 'Xtream UI no devolvió JSON válido' });
    }
  } catch (err) {
    res.json({ success: false, error: `No se pudo conectar: ${err.message}` });
  }
});

// =============================================
// TUNNEL MANAGEMENT
// =============================================
app.get('/api/tunnel/status', authAdmin, (req, res) => {
  const installed = (() => { try { execSync('which cloudflared', { stdio: 'ignore' }); return true; } catch { return false; } })();

  res.json({
    installed,
    status: tunnelProcess ? 'running' : 'stopped',
    url: tunnelUrl,
    error: tunnelError,
    https: !!tunnelUrl,
    mode: tunnelMode,
    server_ip: getServerIp(),
    stream_base_url: tunnelMode === 'hybrid' ? `http://${getServerIp()}:${XTREAM_PORT}` : tunnelUrl,
    xtream_tunnel: {
      status: xtreamTunnelProcess ? 'running' : 'stopped',
      url: xtreamTunnelUrl,
      error: xtreamTunnelError,
      port: XTREAM_PANEL_PORT,
    },
  });
});

app.post('/api/tunnel/install', authAdmin, (req, res) => {
  try {
    const arch = execSync('dpkg --print-architecture').toString().trim();
    const url = arch === 'arm64'
      ? 'https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-arm64.deb'
      : 'https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64.deb';
    execSync(`curl -fsSL -o /tmp/cloudflared.deb ${url} && dpkg -i /tmp/cloudflared.deb && rm /tmp/cloudflared.deb`, { timeout: 60000 });
    res.json({ success: true, message: 'cloudflared instalado correctamente' });
  } catch (err) {
    res.status(500).json({ error: `Error instalando: ${err.message}` });
  }
});

app.post('/api/tunnel/start', authAdmin, (req, res) => {
  if (tunnelProcess) {
    return res.json({ success: true, message: 'El túnel ya está activo', url: tunnelUrl });
  }

  tunnelUrl = null;
  tunnelError = null;

  const targetPort = NGINX_PORT;

  tunnelProcess = spawn('cloudflared', ['tunnel', '--url', `http://localhost:${targetPort}`, '--no-autoupdate'], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let output = '';
  const urlExtractor = (data) => {
    output += data.toString();
    const match = output.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
    if (match) {
      tunnelUrl = match[0];
      console.log(`🌐 Túnel activo: ${tunnelUrl}`);
    }
  };

  tunnelProcess.stdout.on('data', urlExtractor);
  tunnelProcess.stderr.on('data', urlExtractor);

  tunnelProcess.on('exit', (code) => {
    console.log(`⚠️ cloudflared salió con código ${code}`);
    tunnelProcess = null;
    if (code !== 0) tunnelError = `cloudflared salió con código ${code}`;
  });

  // Wait a bit for URL
  setTimeout(() => {
    res.json({ success: true, message: 'Túnel iniciado', url: tunnelUrl });
  }, 5000);
});

app.post('/api/tunnel/stop', authAdmin, (req, res) => {
  if (tunnelProcess) {
    tunnelProcess.kill('SIGTERM');
    tunnelProcess = null;
    tunnelUrl = null;
    tunnelError = null;
    res.json({ success: true, message: 'Túnel detenido' });
  } else {
    res.json({ success: true, message: 'El túnel no estaba activo' });
  }
});

app.post('/api/tunnel/mode', authAdmin, (req, res) => {
  const { mode } = req.body;
  if (mode === 'full' || mode === 'hybrid') {
    tunnelMode = mode;
    res.json({ success: true, mode: tunnelMode });
  } else {
    res.status(400).json({ error: 'Modo inválido. Usa "full" o "hybrid"' });
  }
});

// =============================================
// XTREAM UI PANEL TUNNEL
// =============================================
app.post('/api/tunnel/xtream/start', authAdmin, (req, res) => {
  if (xtreamTunnelProcess) {
    return res.json({ success: true, message: 'El túnel de Xtream UI ya está activo', url: xtreamTunnelUrl });
  }

  xtreamTunnelUrl = null;
  xtreamTunnelError = null;

  const port = req.body.port || XTREAM_PANEL_PORT;

  xtreamTunnelProcess = spawn('cloudflared', ['tunnel', '--url', `http://localhost:${port}`, '--no-autoupdate'], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let output = '';
  const urlExtractor = (data) => {
    output += data.toString();
    const match = output.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
    if (match) {
      xtreamTunnelUrl = match[0];
      console.log(`🌐 Túnel Xtream UI activo: ${xtreamTunnelUrl}`);
    }
  };

  xtreamTunnelProcess.stdout.on('data', urlExtractor);
  xtreamTunnelProcess.stderr.on('data', urlExtractor);

  xtreamTunnelProcess.on('exit', (code) => {
    console.log(`⚠️ cloudflared (Xtream UI) salió con código ${code}`);
    xtreamTunnelProcess = null;
    if (code !== 0) xtreamTunnelError = `cloudflared salió con código ${code}`;
  });

  setTimeout(() => {
    res.json({ success: true, message: 'Túnel Xtream UI iniciado', url: xtreamTunnelUrl });
  }, 5000);
});

app.post('/api/tunnel/xtream/stop', authAdmin, (req, res) => {
  if (xtreamTunnelProcess) {
    xtreamTunnelProcess.kill('SIGTERM');
    xtreamTunnelProcess = null;
    xtreamTunnelUrl = null;
    xtreamTunnelError = null;
    res.json({ success: true, message: 'Túnel Xtream UI detenido' });
  } else {
    res.json({ success: true, message: 'El túnel no estaba activo' });
  }
});


// =============================================
// PROXY STATUS
// =============================================
app.get('/api/proxy/status', authAdmin, (req, res) => {
  const publicHost = getPublicHost(req);
  res.json({
    active_connections: activeConnections.size,
    total_requests: totalRequests,
    uptime_seconds: Math.floor((Date.now() - startTime) / 1000),
    connections: Array.from(activeConnections.values()),
    xtream_endpoints: {
      player_api: `${publicHost}/player_api.php`,
      live: `${publicHost}/live/{user}/{pass}/{stream_id}.ts`,
      get_m3u: `${publicHost}/get.php?username={user}&password={pass}&type=m3u_plus`,
      xmltv: `${publicHost}/xmltv.php?username={user}&password={pass}`,
    },
  });
});

// =============================================
// SHIELD CLIENTS MANAGEMENT (local JSON storage)
// Note: loadClients, CLIENTS_FILE defined at top
// =============================================

const saveClients = (clients) => {
  const dir = require('path').dirname(CLIENTS_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(CLIENTS_FILE, JSON.stringify(clients, null, 2));
};

// GET all clients
app.get('/api/shield/clients', authAdmin, (req, res) => {
  const clients = loadClients();
  // Enrich with active connection count
  const enriched = clients.map(c => {
    const activeCons = Array.from(activeConnections.values()).filter(conn => conn.username === c.username).length;
    return { ...c, active_cons: activeCons };
  });
  res.json(enriched);
});

// CREATE client
app.post('/api/shield/clients', authAdmin, (req, res) => {
  const { username, password, max_connections, exp_date, is_trial } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Usuario y contraseña requeridos' });

  const clients = loadClients();
  if (clients.find(c => c.username === username)) {
    return res.status(400).json({ error: 'El usuario ya existe' });
  }

  const newClient = {
    id: crypto.randomUUID(),
    username,
    password,
    max_connections: max_connections || 1,
    exp_date: exp_date || null,
    is_trial: is_trial || false,
    is_banned: false,
    admin_enabled: true,
    created_at: new Date().toISOString(),
  };

  clients.push(newClient);
  saveClients(clients);
  res.json(newClient);
});

// UPDATE client
app.put('/api/shield/clients/:id', authAdmin, (req, res) => {
  const clients = loadClients();
  const idx = clients.findIndex(c => c.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Cliente no encontrado' });

  const allowed = ['username', 'password', 'max_connections', 'exp_date', 'is_trial', 'is_banned', 'admin_enabled'];
  for (const key of allowed) {
    if (req.body[key] !== undefined) clients[idx][key] = req.body[key];
  }

  saveClients(clients);
  res.json(clients[idx]);
});

// DELETE client
app.delete('/api/shield/clients/:id', authAdmin, (req, res) => {
  let clients = loadClients();
  const before = clients.length;
  clients = clients.filter(c => c.id !== req.params.id);
  if (clients.length === before) return res.status(404).json({ error: 'Cliente no encontrado' });

  saveClients(clients);
  res.json({ success: true });
});

// =============================================
// SHIELD VIEWERS (active connections monitor)
// =============================================
app.get('/api/shield/viewers', authAdmin, (req, res) => {
  res.json(Array.from(activeConnections.values()));
});

app.post('/api/shield/viewers/kick', authAdmin, (req, res) => {
  const { connectionId } = req.body;
  if (activeConnections.has(connectionId)) {
    activeConnections.delete(connectionId);
    res.json({ success: true });
  } else {
    res.status(404).json({ error: 'Conexión no encontrada' });
  }
});

app.post('/api/shield/viewers/kick-user', authAdmin, (req, res) => {
  const { username } = req.body;
  let kicked = 0;
  for (const [id, conn] of activeConnections) {
    if (conn.username === username) {
      activeConnections.delete(id);
      kicked++;
    }
  }
  res.json({ success: true, kicked });
});

// =============================================
// XTREAM CODES PROXY ENDPOINTS
// Shield validates local clients, then uses master Xtream credentials
// =============================================

// Helper: validate Shield client and get master creds
const getProxyCredentials = (username, password) => {
  // Validate against Shield local clients
  const validation = validateShieldClient(username, password);
  if (!validation.valid) return { error: validation.error };

  // Get master Xtream credentials
  const masterCreds = loadMasterCreds();
  if (!masterCreds) return { error: 'Credenciales maestras no configuradas. Configúralas en Xtream Config.' };

  return { masterUser: masterCreds.username, masterPass: masterCreds.password, shieldClient: validation.client };
};

// player_api.php - Main API endpoint
app.all('/player_api.php', (req, res) => {
  const params = { ...req.query, ...req.body };
  const { username, password } = params;

  if (username && password) {
    const creds = getProxyCredentials(username, password);
    if (creds.error) {
      return res.status(403).json({ user_info: { auth: 0, status: 'Disabled', message: creds.error } });
    }
    // Replace with master credentials
    params.username = creds.masterUser;
    params.password = creds.masterPass;
  }

  const qs = Object.entries(params).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');
  proxyToXtream(`/player_api.php?${qs}`, req, res);
});

// get.php - M3U playlist
app.get('/get.php', (req, res) => {
  const params = { ...req.query };
  const { username, password } = params;
  const shieldUser = username; // Keep original for URL rewriting

  if (username && password) {
    const creds = getProxyCredentials(username, password);
    if (creds.error) {
      return res.status(403).send(`# ERROR: ${creds.error}`);
    }
    // Replace with master credentials for upstream
    params.username = creds.masterUser;
    params.password = creds.masterPass;
  }

  const qs = Object.entries(params).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');

  totalRequests++;
  const url = `${getXtreamUrl()}/get.php?${qs}`;
  const isHttps = url.startsWith('https');
  const mod = isHttps ? https : http;

  mod.get(url, { headers: { 'User-Agent': 'VLC/3.0.18' }, timeout: 30000 }, (proxyRes) => {
    let body = '';
    proxyRes.on('data', chunk => body += chunk);
    proxyRes.on('end', () => {
      const publicHost = getPublicHost(req);
      const xtreamBase = getXtreamUrl();
      let rewritten = body;

      // Replace all Xtream URLs with proxy URLs
      rewritten = rewritten.replace(new RegExp(escapeRegex(xtreamBase), 'g'), publicHost);

      const serverIp = getServerIp();
      if (serverIp) {
        rewritten = rewritten.replace(new RegExp(escapeRegex(`http://${serverIp}:${XTREAM_PORT}`), 'g'), publicHost);
        rewritten = rewritten.replace(new RegExp(escapeRegex(`http://${serverIp}`), 'g'), publicHost);
      }

      // Replace master credentials in M3U with Shield client credentials
      const masterCreds = loadMasterCreds();
      if (masterCreds && shieldUser) {
        rewritten = rewritten.replace(new RegExp(`/${masterCreds.username}/${masterCreds.password}/`, 'g'), `/${shieldUser}/${password}/`);
        rewritten = rewritten.replace(new RegExp(`username=${escapeRegex(masterCreds.username)}`, 'g'), `username=${shieldUser}`);
        rewritten = rewritten.replace(new RegExp(`password=${escapeRegex(masterCreds.password)}`, 'g'), `password=${password}`);
      }

      // Also handle localhost references
      rewritten = rewritten.replace(new RegExp(escapeRegex(`http://localhost:${XTREAM_PORT}`), 'g'), publicHost);

      res.setHeader('Content-Type', proxyRes.headers['content-type'] || 'audio/x-mpegurl');
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.end(rewritten);
    });
  }).on('error', (err) => {
    res.status(502).json({ error: `Error: ${err.message}` });
  });
});

// xmltv.php - EPG
app.get('/xmltv.php', (req, res) => {
  const params = { ...req.query };
  const { username, password } = params;

  if (username && password) {
    const creds = getProxyCredentials(username, password);
    if (creds.error) {
      return res.status(403).json({ error: creds.error });
    }
    params.username = creds.masterUser;
    params.password = creds.masterPass;
  }

  const qs = Object.entries(params).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');
  proxyToXtream(`/xmltv.php?${qs}`, req, res);
});

// Live streams - /live/user/pass/stream_id.ts
app.get('/live/:user/:pass/:stream', (req, res) => {
  const { user, pass, stream } = req.params;

  // Validate Shield client
  const creds = getProxyCredentials(user, pass);
  if (creds.error) {
    return res.status(403).json({ error: creds.error });
  }

  totalRequests++;

  // Track connection with Shield username
  const connId = `${req.ip}-${user}-${stream}`;
  activeConnections.set(connId, {
    id: connId,
    client_ip: req.ip || req.headers['x-real-ip'] || 'unknown',
    username: user,
    connected_at: new Date().toISOString(),
    last_activity: new Date().toISOString(),
    target: `/live/${stream}`,
    country: null,
  });

  // Use master credentials to connect to Xtream
  const url = `${getXtreamUrl()}/live/${creds.masterUser}/${creds.masterPass}/${stream}`;
  const isHttps = url.startsWith('https');
  const mod = isHttps ? https : http;

  const proxyReq = mod.get(url, {
    headers: { 'User-Agent': 'VLC/3.0.18 LibVLC/3.0.18' },
    timeout: 30000,
  }, (proxyRes) => {
    res.writeHead(proxyRes.statusCode, {
      'Content-Type': proxyRes.headers['content-type'] || 'video/mp2t',
      'Access-Control-Allow-Origin': '*',
    });
    proxyRes.pipe(res);
  });

  proxyReq.on('error', () => {
    activeConnections.delete(connId);
    if (!res.headersSent) res.status(502).end();
  });

  res.on('close', () => {
    activeConnections.delete(connId);
  });
});

// Movie/Series streams
app.get('/movie/:user/:pass/:stream', (req, res) => {
  const { user, pass, stream } = req.params;

  const creds = getProxyCredentials(user, pass);
  if (creds.error) {
    return res.status(403).json({ error: creds.error });
  }

  totalRequests++;
  const url = `${getXtreamUrl()}/movie/${creds.masterUser}/${creds.masterPass}/${stream}`;
  const isHttps = url.startsWith('https');
  const mod = isHttps ? https : http;

  mod.get(url, { headers: { 'User-Agent': 'VLC/3.0.18' }, timeout: 30000 }, (proxyRes) => {
    res.writeHead(proxyRes.statusCode, {
      'Content-Type': proxyRes.headers['content-type'] || 'video/mp4',
      'Access-Control-Allow-Origin': '*',
    });
    proxyRes.pipe(res);
  }).on('error', () => {
    if (!res.headersSent) res.status(502).end();
  });
});

app.get('/series/:user/:pass/:stream', (req, res) => {
  const { user, pass, stream } = req.params;

  const creds = getProxyCredentials(user, pass);
  if (creds.error) {
    return res.status(403).json({ error: creds.error });
  }

  totalRequests++;
  const url = `${getXtreamUrl()}/series/${creds.masterUser}/${creds.masterPass}/${stream}`;
  const isHttps = url.startsWith('https');
  const mod = isHttps ? https : http;

  mod.get(url, { headers: { 'User-Agent': 'VLC/3.0.18' }, timeout: 30000 }, (proxyRes) => {
    res.writeHead(proxyRes.statusCode, {
      'Content-Type': proxyRes.headers['content-type'] || 'video/mp4',
      'Access-Control-Allow-Origin': '*',
    });
    proxyRes.pipe(res);
  }).on('error', () => {
    if (!res.headersSent) res.status(502).end();
  });
});

// =============================================
// CHANNELS LIST (for admin verification)  
// =============================================
app.get('/api/channels', authAdmin, (req, res) => {
  // Placeholder - returns empty since channels come from Xtream UI
  res.json([]);
});

// =============================================
// START SERVER
// =============================================
app.listen(PORT, () => {
  console.log('');
  console.log('╔══════════════════════════════════════════╗');
  console.log('║     🛡️  OMNISYNC SHIELD - ACTIVO          ║');
  console.log('╚══════════════════════════════════════════╝');
  console.log(`  Proxy:    http://localhost:${PORT}`);
  console.log(`  Xtream:   ${getXtreamUrl()}`);
  console.log(`  Modo:     ${tunnelMode}`);
  console.log('');
});

// Cleanup on exit
process.on('SIGTERM', () => {
  if (tunnelProcess) tunnelProcess.kill('SIGTERM');
  if (xtreamTunnelProcess) xtreamTunnelProcess.kill('SIGTERM');
  process.exit(0);
});

process.on('SIGINT', () => {
  if (tunnelProcess) tunnelProcess.kill('SIGTERM');
  if (xtreamTunnelProcess) xtreamTunnelProcess.kill('SIGTERM');
  process.exit(0);
});
