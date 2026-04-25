// ============================================================
// Omnisync - Rutas API VPN/Sectores/Multicast
// Se monta desde index.js:  app.use('/api/vpn', require('./vpn-routes')(pool, authAdmin))
// ============================================================

const express = require('express');
const vpnMgr = require('./vpn-manager');
const encoder = require('./multicast-encoder');

module.exports = (pool, authAdmin) => {
  const router = express.Router();

  // Arranca el loop de mantenimiento de encoders al cargar el módulo
  encoder.startMaintenanceLoop(pool);

  // ----------------------------------------------------------
  // STATUS GLOBAL
  // ----------------------------------------------------------
  router.get('/status', authAdmin, async (req, res) => {
    try {
      const status = vpnMgr.getTunnelStatus();
      res.json(status);
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // ----------------------------------------------------------
  // SECTORES (CRUD)
  // ----------------------------------------------------------
  router.get('/sectors', authAdmin, async (req, res) => {
    try {
      const r = await pool.query(`
        SELECT s.*, p.name AS plan_name,
               (SELECT COUNT(*) FROM sector_channel_map WHERE sector_id = s.id AND is_active) AS channels_count,
               t.status AS tunnel_status, t.connected_since, t.bytes_in, t.bytes_out
        FROM vpn_sectors s
        LEFT JOIN plans p ON p.id = s.plan_id
        LEFT JOIN vpn_tunnel_status t ON t.sector_id = s.id
        ORDER BY s.created_at DESC
      `);
      res.json(r.rows);
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // Helper: convierte "" o undefined a null (para campos inet/uuid opcionales)
  const nz = (v) => (v === '' || v === undefined ? null : v);

  router.post('/sectors', authAdmin, async (req, res) => {
    try {
      let { name, description, vpn_username, vpn_password, assigned_ip,
            mikrotik_public_ip, ipsec_psk, plan_id, delivery_mode, udpxy_url } = req.body;

      if (!name) return res.status(400).json({ error: 'name es requerido' });

      const mode = delivery_mode || 'multicast_direct';
      const isLan = mode === 'lan_direct';

      // Modo LAN: no requiere credenciales VPN. Autocompletamos placeholders
      // para satisfacer NOT NULL del schema sin afectar la VPN real.
      if (isLan) {
        vpn_username = vpn_username || `lan-${Date.now().toString(36)}`;
        vpn_password = vpn_password || 'n/a';
        assigned_ip  = assigned_ip  || '127.0.0.1';
      } else if (!vpn_username || !vpn_password || !assigned_ip) {
        return res.status(400).json({
          error: 'Faltan campos requeridos: name, vpn_username, vpn_password, assigned_ip',
          received: {
            name: !!name,
            vpn_username: !!vpn_username,
            vpn_password: !!vpn_password,
            assigned_ip: !!assigned_ip,
          }
        });
      }

      const r = await pool.query(`
        INSERT INTO vpn_sectors
          (name, description, vpn_username, vpn_password, assigned_ip,
           mikrotik_public_ip, ipsec_psk, plan_id, delivery_mode, udpxy_url)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
        RETURNING *
      `, [name, nz(description), vpn_username, vpn_password, assigned_ip,
          nz(mikrotik_public_ip), nz(ipsec_psk), nz(plan_id),
          mode, nz(udpxy_url)]);

      // Solo re-sincroniza configs del sistema VPN si el sector usa VPN real.
      if (!isLan) {
        try { await vpnMgr.syncAllFromDB(pool); } catch (e) { console.warn('[VPN] sync warning:', e.message); }
      }
      res.json(r.rows[0]);
    } catch (e) {
      console.error('[VPN] POST /sectors error:', e);
      res.status(500).json({ error: e.message });
    }
  });

  router.put('/sectors/:id', authAdmin, async (req, res) => {
    try {
      const { id } = req.params;
      const fields = ['name','description','vpn_username','vpn_password','assigned_ip',
                      'mikrotik_public_ip','ipsec_psk','plan_id','is_active','notes',
                      'delivery_mode','udpxy_url'];
      const nullableFields = new Set(['description','mikrotik_public_ip','plan_id','notes','udpxy_url']);
      const updates = [];
      const values = [];
      let i = 1;
      fields.forEach(f => {
        if (req.body[f] !== undefined) {
          updates.push(`${f} = $${i++}`);
          values.push(nullableFields.has(f) ? nz(req.body[f]) : req.body[f]);
        }
      });
      if (!updates.length) return res.status(400).json({ error: 'Sin cambios' });
      values.push(id);
      const r = await pool.query(
        `UPDATE vpn_sectors SET ${updates.join(',')}, updated_at = now() WHERE id = $${i} RETURNING *`,
        values
      );
      try { await vpnMgr.syncAllFromDB(pool); } catch (e) { console.warn('[VPN] sync warning:', e.message); }
      res.json(r.rows[0]);
    } catch (e) {
      console.error('[VPN] PUT /sectors error:', e);
      res.status(500).json({ error: e.message });
    }
  });

  router.delete('/sectors/:id', authAdmin, async (req, res) => {
    try {
      await pool.query(`DELETE FROM vpn_sectors WHERE id = $1`, [req.params.id]);
      try { await vpnMgr.syncAllFromDB(pool); } catch (e) { console.warn('[VPN] sync warning:', e.message); }
      res.json({ ok: true });
    } catch (e) {
      console.error('[VPN] DELETE /sectors error:', e);
      res.status(500).json({ error: e.message });
    }
  });

  // ----------------------------------------------------------
  // GENERADOR CONFIG MIKROTIK (.rsc descargable)
  // ----------------------------------------------------------
  router.get('/sectors/:id/mikrotik-config', authAdmin, async (req, res) => {
    try {
      const sectorRes = await pool.query(`SELECT * FROM vpn_sectors WHERE id = $1`, [req.params.id]);
      if (!sectorRes.rows[0]) return res.status(404).json({ error: 'Sector no encontrado' });
      const sector = sectorRes.rows[0];

      const channelsRes = await pool.query(`
        SELECT mg.multicast_ip, mg.port, c.name AS channel_name
        FROM sector_channel_map scm
        JOIN multicast_groups mg ON mg.id = scm.multicast_group_id
        LEFT JOIN channels c ON c.id = mg.channel_id
        WHERE scm.sector_id = $1 AND scm.is_active = true
        ORDER BY mg.multicast_ip
      `, [req.params.id]);

      const config = vpnMgr.generateMikrotikConfig(
        sector,
        channelsRes.rows,
        vpnMgr.getPublicIP(),
        vpnMgr.getPSK()
      );

      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      res.setHeader('Content-Disposition',
        `attachment; filename="omnisync-${sector.name.replace(/[^a-z0-9]/gi,'-')}.rsc"`);
      res.send(config);
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // ----------------------------------------------------------
  // GRUPOS MULTICAST
  // ----------------------------------------------------------
  router.get('/multicast', authAdmin, async (req, res) => {
    try {
      const r = await pool.query(`
        SELECT mg.*, c.name AS channel_name, c.category AS channel_category,
               (SELECT COUNT(*) FROM sector_channel_map WHERE multicast_group_id = mg.id AND is_active) AS sectors_count
        FROM multicast_groups mg
        LEFT JOIN channels c ON c.id = mg.channel_id
        ORDER BY mg.multicast_ip
      `);
      res.json(r.rows);
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  router.post('/multicast/assign', authAdmin, async (req, res) => {
    try {
      const { multicast_group_id, channel_id } = req.body;
      const groupId = typeof multicast_group_id === 'string' && multicast_group_id.length === 36 ? multicast_group_id : null;
      const channelId = typeof channel_id === 'string' && channel_id.length === 36 ? channel_id : null;

      if (!groupId) {
        return res.status(400).json({ error: 'multicast_group_id inválido' });
      }

      const r = await pool.query(`
        UPDATE multicast_groups
        SET channel_id = $1::uuid,
            is_assigned = ($1::uuid IS NOT NULL)
        WHERE id = $2::uuid
        RETURNING *
      `, [channelId, groupId]);

      res.json(r.rows[0]);
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // ----------------------------------------------------------
  // MAPEO sector ↔ canal multicast
  // ----------------------------------------------------------
  router.get('/sectors/:id/channels', authAdmin, async (req, res) => {
    try {
      const r = await pool.query(`
        SELECT scm.*, mg.multicast_ip, mg.port, c.name AS channel_name, c.category
        FROM sector_channel_map scm
        JOIN multicast_groups mg ON mg.id = scm.multicast_group_id
        LEFT JOIN channels c ON c.id = mg.channel_id
        WHERE scm.sector_id = $1
        ORDER BY mg.multicast_ip
      `, [req.params.id]);
      res.json(r.rows);
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  router.post('/sectors/:id/channels', authAdmin, async (req, res) => {
    try {
      const sectorId = req.params.id;
      const { multicast_group_ids } = req.body; // array de IDs
      if (!Array.isArray(multicast_group_ids)) {
        return res.status(400).json({ error: 'multicast_group_ids debe ser array' });
      }
      // Filtrar valores no-uuid / vacíos para evitar errores de tipo
      const ids = multicast_group_ids.filter(x => typeof x === 'string' && x.length === 36);

      // ---- Validación por plan: el sector solo puede recibir canales cuyas
      //      categorías estén incluidas en plan.categories.
      const sectorRes = await pool.query(
        `SELECT s.id, s.plan_id, p.name AS plan_name, p.categories
           FROM vpn_sectors s
           LEFT JOIN plans p ON p.id = s.plan_id
          WHERE s.id = $1::uuid`, [sectorId]);
      if (!sectorRes.rows[0]) return res.status(404).json({ error: 'Sector no encontrado' });
      const sector = sectorRes.rows[0];

      if (ids.length && sector.plan_id) {
        const allowed = Array.isArray(sector.categories) ? sector.categories : [];
        if (!allowed.length) {
          return res.status(400).json({
            error: `El plan "${sector.plan_name}" no tiene categorías asignadas. No se pueden asignar canales.`
          });
        }
        const chk = await pool.query(`
          SELECT mg.id, c.name AS channel_name, c.category
            FROM multicast_groups mg
            LEFT JOIN channels c ON c.id = mg.channel_id
           WHERE mg.id = ANY($1::uuid[])
        `, [ids]);

        const blocked = chk.rows.filter(r => !r.category || !allowed.includes(r.category));
        if (blocked.length) {
          const names = blocked.slice(0, 5).map(b => `${b.channel_name || '(sin canal)'} [${b.category || 'N/A'}]`).join(', ');
          return res.status(400).json({
            error: `${blocked.length} canal(es) no permitidos por el plan "${sector.plan_name}" (categorías: ${allowed.join(', ')}). Bloqueados: ${names}${blocked.length > 5 ? '…' : ''}`
          });
        }
      }

      // Reemplazo total (cast explícito a uuid para evitar "could not determine data type")
      await pool.query(`DELETE FROM sector_channel_map WHERE sector_id = $1::uuid`, [sectorId]);
      for (const mgId of ids) {
        await pool.query(`
          INSERT INTO sector_channel_map (sector_id, multicast_group_id, is_active)
          VALUES ($1::uuid, $2::uuid, true) ON CONFLICT DO NOTHING
        `, [sectorId, mgId]);
      }
      await vpnMgr.syncAllFromDB(pool);
      // Auto-arranque encoders FFmpeg para los canales recién asignados
      try { await encoder.syncEncodersFromDB(pool); } catch (e) { console.error('encoder sync:', e.message); }
      res.json({ ok: true, count: ids.length });
    } catch (e) {
      console.error('POST /sectors/:id/channels error:', e);
      res.status(500).json({ error: e.message });
    }
  });

  // ----------------------------------------------------------
  // ENCODERS FFmpeg (HTTP→UDP multicast on-demand)
  // ----------------------------------------------------------
  router.get('/encoders', authAdmin, async (req, res) => {
    try {
      const list = await encoder.listEncoders(pool);
      res.json({ ffmpeg_installed: encoder.ffmpegInstalled(), encoders: list });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  router.post('/encoders/:channelId/start', authAdmin, async (req, res) => {
    try {
      const r = await encoder.startEncoder(pool, req.params.channelId);
      res.json(r);
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  router.post('/encoders/:channelId/stop', authAdmin, async (req, res) => {
    try {
      const r = await encoder.stopEncoder(pool, req.params.channelId);
      res.json(r);
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  router.post('/encoders/sync', authAdmin, async (req, res) => {
    try {
      const r = await encoder.syncEncodersFromDB(pool);
      res.json(r);
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // Configurar mode (always_on / on_demand) e idle_timeout por canal
  router.put('/encoders/:channelId/config', authAdmin, async (req, res) => {
    try {
      const { mode, idle_timeout_seconds } = req.body || {};
      if (mode && !['always_on', 'on_demand'].includes(mode)) {
        return res.status(400).json({ error: 'mode debe ser always_on u on_demand' });
      }
      const idle = Number.isFinite(+idle_timeout_seconds) ? Math.max(30, Math.min(3600, +idle_timeout_seconds)) : null;

      // Buscar grupo multicast asignado al canal (necesario para upsert)
      const mg = await pool.query(
        `SELECT id FROM multicast_groups WHERE channel_id = $1 AND is_assigned = true LIMIT 1`,
        [req.params.channelId]
      );
      if (!mg.rows[0]) return res.status(404).json({ error: 'Canal no tiene grupo multicast asignado' });

      await pool.query(`
        INSERT INTO multicast_encoders (channel_id, multicast_group_id, mode, idle_timeout_seconds, status)
        VALUES ($1, $2, COALESCE($3, 'always_on'), COALESCE($4, 300), 'stopped')
        ON CONFLICT (channel_id) DO UPDATE
           SET mode = COALESCE($3, multicast_encoders.mode),
               idle_timeout_seconds = COALESCE($4, multicast_encoders.idle_timeout_seconds)
      `, [req.params.channelId, mg.rows[0].id, mode || null, idle]);

      // Re-sincroniza para aplicar el cambio inmediatamente
      const sync = await encoder.syncEncodersFromDB(pool);
      res.json({ ok: true, sync });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // ----------------------------------------------------------
  // RESYNC manual (re-escribe todos los archivos de sistema)
  // ----------------------------------------------------------
  router.post('/resync', authAdmin, async (req, res) => {
    try {
      const result = await vpnMgr.syncAllFromDB(pool);
      res.json(result);
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // ----------------------------------------------------------
  // RESOLVE: dado el req.ip detecta sector y devuelve URLs de canales
  // según delivery_mode. Usado por la APK al pedir su lista de canales.
  // No requiere authAdmin: cualquier endpoint público de canales puede
  // llamar a vpnMgr.resolveChannelUrlsForIp() internamente.
  // Este endpoint queda como debug/utilidad para el panel.
  // ----------------------------------------------------------
  router.get('/resolve/:ip', authAdmin, async (req, res) => {
    try {
      const out = await vpnMgr.resolveChannelUrlsForIp(pool, req.params.ip);
      res.json(out);
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // ----------------------------------------------------------
  // SETTINGS GLOBALES (toggle multicast)
  // ----------------------------------------------------------
  router.get('/settings', authAdmin, async (req, res) => {
    try {
      const r = await pool.query(`SELECT key, value FROM system_settings WHERE key = 'multicast_enabled'`);
      const enabled = r.rows[0]?.value?.enabled !== false;
      res.json({ multicast_enabled: enabled });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  router.put('/settings', authAdmin, async (req, res) => {
    try {
      const enabled = !!req.body.multicast_enabled;
      await pool.query(`
        INSERT INTO system_settings (key, value, updated_at)
        VALUES ('multicast_enabled', $1::jsonb, now())
        ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()
      `, [JSON.stringify({ enabled })]);
      res.json({ multicast_enabled: enabled });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // ----------------------------------------------------------
  // INTERFACES DE RED (para sectores LAN local)
  // GET /api/vpn/network-interfaces → lista interfaces con sus IPv4
  // GET /api/vpn/lan-config         → devuelve la interfaz/IP guardada
  // PUT /api/vpn/lan-config         → guarda interfaz/IP elegida
  // ----------------------------------------------------------
  router.get('/network-interfaces', authAdmin, (req, res) => {
    try {
      const os = require('os');
      const ifaces = os.networkInterfaces();
      const result = [];
      for (const [name, addrs] of Object.entries(ifaces)) {
        const ipv4 = (addrs || []).filter(a => a.family === 'IPv4' && !a.internal);
        if (ipv4.length === 0) continue;
        result.push({
          name,
          addresses: ipv4.map(a => ({ address: a.address, netmask: a.netmask, mac: a.mac })),
        });
      }
      res.json({ interfaces: result });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  router.get('/lan-config', authAdmin, async (req, res) => {
    try {
      const r = await pool.query(`SELECT value FROM system_settings WHERE key = 'lan_network_config'`);
      const cfg = r.rows[0]?.value || {};
      res.json({
        iface: cfg.iface || '',
        local_ip: cfg.local_ip || '',
      });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  router.put('/lan-config', authAdmin, async (req, res) => {
    try {
      const iface = String(req.body.iface || '').trim();
      const local_ip = String(req.body.local_ip || '').trim();
      if (!iface || !local_ip) {
        return res.status(400).json({ error: 'iface y local_ip son obligatorios' });
      }
      await pool.query(`
        INSERT INTO system_settings (key, value, updated_at)
        VALUES ('lan_network_config', $1::jsonb, now())
        ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()
      `, [JSON.stringify({ iface, local_ip })]);
      res.json({ iface, local_ip, restart_required: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  return router;
};
