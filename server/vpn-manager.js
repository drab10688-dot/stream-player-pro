// ============================================================
// Omnisync - Módulo VPN L2TP/IPsec + Multicast Routing
// ============================================================
// Gestiona:
//   - Usuarios L2TP (chap-secrets)
//   - Sectores remotos (MikroTik)
//   - Túneles GRE
//   - Rutas multicast (smcroute.conf)
//   - Estado en tiempo real (ipsec status)
//   - Generador de configuración .rsc para MikroTik
// ============================================================

const fs = require('fs');
const { execSync, exec } = require('child_process');
const path = require('path');

const CHAP_SECRETS = '/etc/ppp/chap-secrets';
const SMCROUTE_CONF = '/etc/smcroute.conf';
const PSK_FILE = '/etc/omnisync-vpn-psk';
const PUB_IF = (() => {
  try { return execSync(`ip route get 1.1.1.1 | awk '{print $5; exit}'`).toString().trim(); }
  catch { return 'eth0'; }
})();

// ----------------------------------------------------------
// Helpers de sistema
// ----------------------------------------------------------
const isLinux = process.platform === 'linux';
const safeExec = (cmd) => {
  try { return { ok: true, output: execSync(cmd, { encoding: 'utf8' }) }; }
  catch (e) { return { ok: false, error: e.message }; }
};

const getPSK = () => {
  try { return fs.readFileSync(PSK_FILE, 'utf8').trim(); }
  catch { return 'PSK_NO_DISPONIBLE_EJECUTA_install-vpn.sh'; }
};

const getPublicIP = () => {
  try {
    return execSync(`curl -s -4 --max-time 3 ifconfig.me || hostname -I | awk '{print $1}'`)
      .toString().trim();
  } catch { return '0.0.0.0'; }
};

// ----------------------------------------------------------
// chap-secrets: leer/escribir usuarios L2TP
// ----------------------------------------------------------
function rewriteChapSecrets(sectors) {
  const lines = [
    '# Omnisync L2TP users - autogenerado, no editar manualmente',
    '# user  server  password  ip',
  ];
  sectors.forEach(s => {
    if (!s.is_active) return;
    // formato: "username" * "password" "ip"  -> ip * permite cualquiera
    const ip = s.assigned_ip || '*';
    lines.push(`"${s.vpn_username}" * "${s.vpn_password}" ${ip}`);
  });
  const content = lines.join('\n') + '\n';
  if (!isLinux) {
    console.log('[VPN] (mock) Escribiría chap-secrets:\n' + content);
    return { ok: true, mock: true };
  }
  try {
    fs.writeFileSync('/tmp/chap-secrets.tmp', content);
    execSync(`sudo cp /tmp/chap-secrets.tmp ${CHAP_SECRETS} && sudo chmod 600 ${CHAP_SECRETS}`);
    // Recargar xl2tpd para que tome los cambios
    safeExec('sudo systemctl reload xl2tpd 2>/dev/null || sudo systemctl restart xl2tpd');
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

// ----------------------------------------------------------
// smcroute.conf: rutas multicast por sector
// ----------------------------------------------------------
function rewriteSmcrouteConf(routes) {
  // routes: [{ multicast_ip, sector_ppp_iface }]
  const lines = [
    '# Omnisync multicast routing - autogenerado',
    `mgroup from ${PUB_IF} group 239.10.0.0/24`,
    '',
  ];
  routes.forEach(r => {
    // mroute from <input_iface> group <mcast_ip> to <output_iface>
    lines.push(`mroute from ${PUB_IF} group ${r.multicast_ip} to ${r.output_iface}`);
  });
  const content = lines.join('\n') + '\n';
  if (!isLinux) {
    console.log('[VPN] (mock) Escribiría smcroute.conf:\n' + content);
    return { ok: true, mock: true };
  }
  try {
    fs.writeFileSync('/tmp/smcroute.tmp', content);
    execSync(`sudo cp /tmp/smcroute.tmp ${SMCROUTE_CONF}`);
    safeExec('sudo systemctl restart smcroute');
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

// ----------------------------------------------------------
// GRE tunnels: crear/eliminar
// ----------------------------------------------------------
function createGreTunnel(name, localIP, remoteIP, sectorIP) {
  if (!isLinux) {
    console.log(`[VPN] (mock) GRE tunnel ${name}: ${localIP} -> ${remoteIP}`);
    return { ok: true, mock: true };
  }
  // Borrar si existe
  safeExec(`sudo ip tunnel del ${name} 2>/dev/null`);
  const r1 = safeExec(`sudo ip tunnel add ${name} mode gre local ${localIP} remote ${remoteIP} ttl 64`);
  if (!r1.ok) return r1;
  safeExec(`sudo ip link set ${name} up multicast on`);
  safeExec(`sudo ip addr add ${sectorIP}/30 dev ${name}`);
  return { ok: true };
}

function deleteGreTunnel(name) {
  if (!isLinux) return { ok: true, mock: true };
  return safeExec(`sudo ip tunnel del ${name} 2>/dev/null`);
}

// ----------------------------------------------------------
// Estado túneles: parsear ipsec statusall + ip -s tunnel show
// ----------------------------------------------------------
function getTunnelStatus() {
  if (!isLinux) {
    return {
      ipsec_running: false,
      xl2tpd_running: false,
      mock: true,
      tunnels: [],
    };
  }
  const ipsec = safeExec('sudo ipsec statusall 2>/dev/null || sudo strongswan statusall 2>/dev/null');
  const xl2tpd = safeExec('systemctl is-active xl2tpd 2>/dev/null');
  const smcroute = safeExec('systemctl is-active smcroute 2>/dev/null');
  const pppList = safeExec(`ip -o addr show | grep ppp | awk '{print $2,$4}'`);

  const tunnels = [];
  if (pppList.ok) {
    pppList.output.split('\n').filter(Boolean).forEach(line => {
      const [iface, ipcidr] = line.split(' ');
      tunnels.push({ interface: iface, ip: (ipcidr || '').split('/')[0] });
    });
  }

  return {
    ipsec_running: ipsec.ok && /Security Associations/i.test(ipsec.output || ''),
    xl2tpd_running: (xl2tpd.output || '').trim() === 'active',
    smcroute_running: (smcroute.output || '').trim() === 'active',
    public_ip: getPublicIP(),
    psk: getPSK(),
    tunnels,
    raw_ipsec: (ipsec.output || '').slice(0, 2000),
  };
}

// ----------------------------------------------------------
// Generador de config .rsc para MikroTik
// ----------------------------------------------------------
function generateMikrotikConfig(sector, multicastChannels, serverPublicIP, psk) {
  const safe = (s) => String(s || '').replace(/"/g, '');
  const lines = [
    `# ============================================================`,
    `# Omnisync - Configuración MikroTik para sector "${safe(sector.name)}"`,
    `# Generado: ${new Date().toISOString()}`,
    `# Importar con: /import file-name=omnisync-${safe(sector.name)}.rsc`,
    `# ============================================================`,
    ``,
    `# 1) IPsec PSK`,
    `/ip ipsec peer add name=omnisync address=${serverPublicIP}/32 \\`,
    `    exchange-mode=main-l2tp send-initial-contact=no`,
    ``,
    `/ip ipsec identity add peer=omnisync auth-method=pre-shared-key \\`,
    `    secret="${safe(psk)}"`,
    ``,
    `/ip ipsec proposal add name=omnisync auth-algorithms=sha1 \\`,
    `    enc-algorithms=aes-256-cbc,aes-128-cbc,3des pfs-group=none`,
    ``,
    `/ip ipsec policy add peer=omnisync src-address=0.0.0.0/0 dst-address=${serverPublicIP}/32 \\`,
    `    protocol=udp src-port=any dst-port=1701 proposal=omnisync \\`,
    `    tunnel=no level=require`,
    ``,
    `# 2) Cliente L2TP`,
    `/interface l2tp-client add name=omnisync-l2tp connect-to=${serverPublicIP} \\`,
    `    user="${safe(sector.vpn_username)}" password="${safe(sector.vpn_password)}" \\`,
    `    use-ipsec=no add-default-route=no disabled=no`,
    ``,
    `# 3) Túnel GRE para multicast (sobre L2TP)`,
    `/interface gre add name=omnisync-gre local-address=${sector.assigned_ip} \\`,
    `    remote-address=172.16.50.1 keepalive=10s,3 disabled=no`,
    ``,
    `/ip address add address=${sector.gre_remote_ip || '10.99.99.2'}/30 \\`,
    `    interface=omnisync-gre`,
    ``,
    `# 4) IGMP proxy (para que los decos LAN reciban multicast)`,
    `/routing igmp-proxy interface add interface=omnisync-gre upstream=yes`,
    `/routing igmp-proxy interface add interface=bridge upstream=no alternative-subnets=0.0.0.0/0`,
    `/routing igmp-proxy set quick-leave=yes`,
    ``,
    `# 5) Rutas multicast`,
    `/ip route add dst-address=239.10.0.0/24 gateway=omnisync-gre`,
    ``,
    `# 6) Lista de canales asignados a este sector:`,
  ];

  multicastChannels.forEach(ch => {
    lines.push(`#   ${ch.channel_name || 'Canal'} → udp://@${ch.multicast_ip}:${ch.port}`);
  });

  lines.push('');
  lines.push('# ============================================================');
  lines.push('# Fin de configuración. Reinicia interfaces si es necesario.');
  lines.push('# ============================================================');

  return lines.join('\n');
}

// ----------------------------------------------------------
// Sincronización completa: re-genera todos los archivos del sistema
// ----------------------------------------------------------
async function syncAllFromDB(pool) {
  const sectorsRes = await pool.query(`
    SELECT id, name, vpn_username, vpn_password, assigned_ip,
           gre_local_ip, gre_remote_ip, gre_tunnel_name, is_active
    FROM vpn_sectors
    ORDER BY created_at
  `);
  const sectors = sectorsRes.rows;

  // 1) Reescribir chap-secrets
  const chapResult = rewriteChapSecrets(sectors);

  // 2) Recrear túneles GRE
  const greResults = [];
  for (const s of sectors) {
    if (!s.is_active) {
      deleteGreTunnel(s.gre_tunnel_name || `gre-${s.id.slice(0,8)}`);
      continue;
    }
    if (s.gre_local_ip && s.gre_remote_ip && s.gre_tunnel_name) {
      const r = createGreTunnel(s.gre_tunnel_name, s.gre_local_ip, s.assigned_ip, s.gre_remote_ip);
      greResults.push({ sector: s.name, ...r });
    }
  }

  // 3) Reescribir smcroute.conf
  const routesRes = await pool.query(`
    SELECT scm.is_active, mg.multicast_ip, vs.gre_tunnel_name AS output_iface
    FROM sector_channel_map scm
    JOIN multicast_groups mg ON mg.id = scm.multicast_group_id
    JOIN vpn_sectors vs ON vs.id = scm.sector_id
    WHERE scm.is_active = true AND vs.is_active = true
  `);
  const smcResult = rewriteSmcrouteConf(routesRes.rows);

  return {
    chap: chapResult,
    gre: greResults,
    smcroute: smcResult,
    sectors_count: sectors.length,
  };
}

// ----------------------------------------------------------
// RESOLVE: dado el IP del cliente (req.ip), detecta a qué sector
// pertenece y devuelve un mapa { channel_id -> stream_url } según
// el delivery_mode del sector. Si no pertenece a ningún sector
// activo, devuelve { sector: null, urls: {} } y el caller debe
// usar las URLs HTTPS del VPS por defecto.
// ----------------------------------------------------------
async function resolveChannelUrlsForIp(pool, clientIp) {
  // Normaliza IPv6-mapped (::ffff:172.16.50.x)
  const ip = (clientIp || '').replace(/^::ffff:/, '');

  // Solo IPs del rango VPN entran al lookup
  if (!ip.startsWith('172.16.50.')) {
    return { sector: null, urls: {} };
  }

  const sRes = await pool.query(
    `SELECT id, name, delivery_mode, udpxy_url, gre_remote_ip, assigned_ip
       FROM vpn_sectors
      WHERE assigned_ip = $1 AND is_active = true
      LIMIT 1`,
    [ip]
  );
  if (!sRes.rows[0]) return { sector: null, urls: {} };
  const sector = sRes.rows[0];

  // Canales asignados a este sector via multicast_groups
  const cRes = await pool.query(
    `SELECT mg.channel_id, mg.multicast_ip::text AS multicast_ip, mg.port
       FROM sector_channel_map scm
       JOIN multicast_groups mg ON mg.id = scm.multicast_group_id
      WHERE scm.sector_id = $1 AND scm.is_active = true AND mg.channel_id IS NOT NULL`,
    [sector.id]
  );

  const urls = {};
  for (const row of cRes.rows) {
    let url;
    switch (sector.delivery_mode) {
      case 'multicast_direct':
        // LibVLC nativo: udp://@239.x.x.x:1234
        url = `udp://@${row.multicast_ip}:${row.port}`;
        break;
      case 'udpxy_rbldf':
      case 'udpxy_central': {
        const base = (sector.udpxy_url || '').replace(/\/+$/, '');
        if (!base) continue; // sin URL configurada -> deja fallback
        url = `${base}/udp/${row.multicast_ip}:${row.port}`;
        break;
      }
      default:
        continue;
    }
    urls[row.channel_id] = url;
  }

  return {
    sector: { id: sector.id, name: sector.name, delivery_mode: sector.delivery_mode },
    urls,
  };
}

module.exports = {
  rewriteChapSecrets,
  rewriteSmcrouteConf,
  createGreTunnel,
  deleteGreTunnel,
  getTunnelStatus,
  generateMikrotikConfig,
  syncAllFromDB,
  resolveChannelUrlsForIp,
  getPSK,
  getPublicIP,
};
