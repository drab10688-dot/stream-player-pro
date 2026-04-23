// =============================================
// Omnisync - Rutas Códigos APK (Activación por código)
// =============================================
// Endpoints admin para CRUD + endpoint público /activate para la APK.
// Cada código = 1 dispositivo (1 pantalla).
// El sector define qué canales UDP recibe la APK.
// =============================================

const express = require('express');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'streambox-secret-change-me';

// Genera código alfanumérico de 8 chars (sin caracteres confusos: 0/O, 1/I/l)
function generateCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let out = '';
  const bytes = crypto.randomBytes(8);
  for (let i = 0; i < 8; i++) out += alphabet[bytes[i] % alphabet.length];
  return out;
}

async function generateUniqueCode(pool) {
  for (let i = 0; i < 10; i++) {
    const code = generateCode();
    const { rows } = await pool.query('SELECT 1 FROM device_codes WHERE code = $1', [code]);
    if (rows.length === 0) return code;
  }
  throw new Error('No se pudo generar código único');
}

module.exports = (pool, authAdmin) => {
  const router = express.Router();

  // ============================================================
  // ADMIN: Listar códigos (con joins informativos)
  // ============================================================
  router.get('/', authAdmin, async (req, res) => {
    try {
      const { rows } = await pool.query(`
        SELECT dc.*,
               c.username AS client_username,
               s.name AS sector_name
        FROM device_codes dc
        LEFT JOIN clients c ON c.id = dc.client_id
        LEFT JOIN vpn_sectors s ON s.id = dc.sector_id
        ORDER BY dc.created_at DESC
      `);
      res.json(rows);
    } catch (err) {
      console.error('[device-codes] list error:', err.message);
      res.status(500).json({ error: err.message });
    }
  });

  // ============================================================
  // ADMIN: Crear código
  // body: { client_id?, sector_id, label?, expires_at?, notes? }
  // ============================================================
  router.post('/', authAdmin, async (req, res) => {
    try {
      const { client_id, sector_id, label, expires_at, notes } = req.body;
      if (!sector_id) return res.status(400).json({ error: 'sector_id requerido' });

      const code = await generateUniqueCode(pool);
      const expiry = expires_at
        ? new Date(expires_at)
        : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

      const { rows } = await pool.query(
        `INSERT INTO device_codes (code, label, client_id, sector_id, expires_at, notes)
         VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
        [code, label || null, client_id || null, sector_id, expiry, notes || null]
      );
      res.json(rows[0]);
    } catch (err) {
      console.error('[device-codes] create error:', err.message);
      res.status(500).json({ error: err.message });
    }
  });

  // ============================================================
  // ADMIN: Editar código (label, sector, client, expires_at, status, notes)
  // ============================================================
  router.put('/:id', authAdmin, async (req, res) => {
    try {
      const { label, client_id, sector_id, expires_at, status, notes } = req.body;
      const { rows: cur } = await pool.query('SELECT * FROM device_codes WHERE id = $1', [req.params.id]);
      if (!cur.length) return res.status(404).json({ error: 'Código no encontrado' });
      const c = cur[0];

      if (status && !['pending', 'active', 'revoked'].includes(status)) {
        return res.status(400).json({ error: 'status inválido' });
      }

      const { rows } = await pool.query(
        `UPDATE device_codes SET
           label = $1,
           client_id = $2,
           sector_id = $3,
           expires_at = $4,
           status = $5,
           notes = $6
         WHERE id = $7 RETURNING *`,
        [
          label !== undefined ? label : c.label,
          client_id !== undefined ? client_id : c.client_id,
          sector_id !== undefined ? sector_id : c.sector_id,
          expires_at !== undefined ? new Date(expires_at) : c.expires_at,
          status !== undefined ? status : c.status,
          notes !== undefined ? notes : c.notes,
          req.params.id,
        ]
      );
      res.json(rows[0]);
    } catch (err) {
      console.error('[device-codes] update error:', err.message);
      res.status(500).json({ error: err.message });
    }
  });

  // ============================================================
  // ADMIN: Reset device (libera dispositivo para reasignar código)
  // ============================================================
  router.post('/:id/reset-device', authAdmin, async (req, res) => {
    try {
      const { rows } = await pool.query(
        `UPDATE device_codes
           SET device_id = NULL, status = 'pending', activated_at = NULL
         WHERE id = $1 RETURNING *`,
        [req.params.id]
      );
      if (!rows.length) return res.status(404).json({ error: 'Código no encontrado' });
      res.json(rows[0]);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ============================================================
  // ADMIN: Eliminar código
  // ============================================================
  router.delete('/:id', authAdmin, async (req, res) => {
    try {
      await pool.query('DELETE FROM device_codes WHERE id = $1', [req.params.id]);
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ============================================================
  // PÚBLICO (APK): Activar dispositivo con código
  // body: { code, device_id }
  // Devuelve: { token, code_info, channels: [{id,name,logo_url,category,stream_url}] }
  // ============================================================
  router.post('/activate', async (req, res) => {
    try {
      const { code, device_id } = req.body || {};
      if (!code || !device_id) {
        return res.status(400).json({ error: 'code y device_id son requeridos' });
      }

      const { rows } = await pool.query(
        `SELECT dc.*, c.username AS client_username, c.is_active AS client_active,
                s.name AS sector_name, s.is_active AS sector_active
           FROM device_codes dc
           LEFT JOIN clients c ON c.id = dc.client_id
           LEFT JOIN vpn_sectors s ON s.id = dc.sector_id
          WHERE dc.code = $1`,
        [String(code).trim().toUpperCase()]
      );
      if (!rows.length) return res.status(404).json({ error: 'Código inválido' });
      const dc = rows[0];

      if (dc.status === 'revoked') return res.status(403).json({ error: 'Código revocado' });
      if (new Date(dc.expires_at) < new Date()) return res.status(403).json({ error: 'Código expirado' });
      if (dc.client_id && dc.client_active === false) return res.status(403).json({ error: 'Cliente suspendido' });
      if (dc.sector_active === false) return res.status(403).json({ error: 'Sector inactivo' });

      // Si ya está activado, solo permite el MISMO device_id
      if (dc.status === 'active' && dc.device_id && dc.device_id !== device_id) {
        return res.status(409).json({
          error: 'Código ya activado en otro dispositivo. Pedí al admin un reset.',
        });
      }

      // Activar (o re-confirmar mismo device)
      const { rows: upd } = await pool.query(
        `UPDATE device_codes
           SET device_id = $1,
               status = 'active',
               activated_at = COALESCE(activated_at, now()),
               last_seen_at = now()
         WHERE id = $2 RETURNING *`,
        [device_id, dc.id]
      );
      const active = upd[0];

      // Construir lista de canales UDP del sector
      const { rows: chRows } = await pool.query(
        `SELECT ch.id, ch.name, ch.logo_url, ch.category,
                mg.multicast_ip, mg.port
           FROM sector_channel_map scm
           JOIN multicast_groups mg ON mg.id = scm.multicast_group_id
           JOIN channels ch ON ch.id = mg.channel_id
          WHERE scm.sector_id = $1
            AND scm.is_active = true
            AND ch.is_active = true
          ORDER BY ch.sort_order NULLS LAST, ch.name`,
        [dc.sector_id]
      );

      const channels = chRows.map((r) => ({
        id: r.id,
        name: r.name,
        logo_url: r.logo_url,
        category: r.category,
        stream_url: `udp://@${r.multicast_ip}:${r.port}`,
      }));

      const token = jwt.sign(
        {
          id: active.id,
          code: active.code,
          device_id,
          sector_id: active.sector_id,
          client_id: active.client_id,
          kind: 'device-code',
        },
        JWT_SECRET,
        { expiresIn: '30d' }
      );

      res.json({
        token,
        code_info: {
          code: active.code,
          label: active.label,
          sector_name: dc.sector_name,
          client_username: dc.client_username,
          expires_at: active.expires_at,
        },
        channels,
      });
    } catch (err) {
      console.error('[device-codes] activate error:', err.message);
      res.status(500).json({ error: err.message });
    }
  });

  // ============================================================
  // APK: Refrescar lista de canales (autenticado con JWT del activate)
  // ============================================================
  router.get('/channels', async (req, res) => {
    try {
      const auth = req.headers.authorization || '';
      const tokenStr = auth.startsWith('Bearer ') ? auth.slice(7) : req.query.token;
      if (!tokenStr) return res.status(401).json({ error: 'Token requerido' });

      let payload;
      try {
        payload = jwt.verify(tokenStr, JWT_SECRET);
      } catch {
        return res.status(401).json({ error: 'Token inválido' });
      }
      if (payload.kind !== 'device-code') return res.status(403).json({ error: 'Token no válido para este endpoint' });

      // Verificar que el código siga activo
      const { rows: dcRows } = await pool.query(
        `SELECT status, expires_at FROM device_codes WHERE id = $1`,
        [payload.id]
      );
      if (!dcRows.length) return res.status(404).json({ error: 'Código no existe' });
      const dc = dcRows[0];
      if (dc.status !== 'active') return res.status(403).json({ error: 'Código no activo' });
      if (new Date(dc.expires_at) < new Date()) return res.status(403).json({ error: 'Código expirado' });

      // Touch last_seen
      await pool.query('UPDATE device_codes SET last_seen_at = now() WHERE id = $1', [payload.id]);

      const { rows: chRows } = await pool.query(
        `SELECT ch.id, ch.name, ch.logo_url, ch.category,
                mg.multicast_ip, mg.port
           FROM sector_channel_map scm
           JOIN multicast_groups mg ON mg.id = scm.multicast_group_id
           JOIN channels ch ON ch.id = mg.channel_id
          WHERE scm.sector_id = $1
            AND scm.is_active = true
            AND ch.is_active = true
          ORDER BY ch.sort_order NULLS LAST, ch.name`,
        [payload.sector_id]
      );

      const channels = chRows.map((r) => ({
        id: r.id,
        name: r.name,
        logo_url: r.logo_url,
        category: r.category,
        stream_url: `udp://@${r.multicast_ip}:${r.port}`,
      }));

      res.json({ channels });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  return router;
};
