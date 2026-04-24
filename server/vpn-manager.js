// ============================================================
// Omnisync - Módulo VPN L2TP/IPsec + Multicast
// Alineado con install-vpn.sh: el backend reescribe ipsec/xl2tpd/ppp
// ============================================================

const fs = require('fs');
const { execSync } = require('child_process');

const CHAP_SECRETS = '/etc/ppp/chap-secrets';
const SMCROUTE_CONF = '/etc/smcroute.conf';
const IPSEC_CONF = '/etc/ipsec.conf';
const IPSEC_SECRETS = '/etc/ipsec.secrets';
const XL2TPD_CONF = '/etc/xl2tpd/xl2tpd.conf';
const PSK_FILE = '/etc/omnisync-vpn-psk';

const PUB_IF = (() => {
  try {
    return execSync(`ip route get 1.1.1.1 | awk '{print $5; exit}'`, { encoding: 'utf8' }).trim();
  } catch {
    return 'eth0';
  }
})();

const isLinux = process.platform === 'linux';

const safeExec = (cmd) => {
  try {
    return {
      ok: true,
      output: execSync(cmd, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }),
    };
  } catch (e) {
    return {
      ok: false,
      output: e.stdout?.toString?.() || '',
      error: e.stderr?.toString?.() || e.message,
    };
  }
};

const writeRootFile = (target, content, mode = null) => {
  if (!isLinux) {
    console.log(`[VPN] (mock) Escribiría ${target}:\n${content}`);
    return { ok: true, mock: true };
  }

  try {
    const tmp = `/tmp/${target.split('/').pop()}.tmp`;
    fs.writeFileSync(tmp, content);
    execSync(`sudo cp ${tmp} ${target}`);
    if (mode) execSync(`sudo chmod ${mode} ${target}`);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
};

const slug = (value) => String(value || '')
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, '-')
  .replace(/^-+|-+$/g, '')
  .slice(0, 24) || 'sector';

const getConnName = (sector) => `omnisync-${slug(sector.name || sector.id).slice(0, 16)}-${String(sector.id).slice(0, 6)}`;

const getPSK = () => {
  try {
    const secrets = fs.readFileSync(IPSEC_SECRETS, 'utf8');
    const match = secrets.match(/PSK\s+"([^"]+)"/);
    if (match?.[1]) return match[1];
  } catch {}

  try {
    return fs.readFileSync(PSK_FILE, 'utf8').trim();
  } catch {
    return 'PSK no configurado';
  }
};

const getPublicIP = () => {
  try {
    return execSync(`curl -s -4 --max-time 3 ifconfig.me || hostname -I | awk '{print $1}'`, { encoding: 'utf8' }).trim();
  } catch {
    return '0.0.0.0';
  }
};

const getActiveConfiguredSectors = (sectors = []) => sectors.filter(
  (s) => s?.is_active && s?.mikrotik_public_ip && s?.vpn_username && s?.vpn_password
);

function renderChapSecrets(sectors) {
  const lines = [
    '# Omnisync L2TP users - autogenerado, no editar manualmente',
    '# user  server  password  ip',
  ];

  sectors.forEach((s) => {
    if (!s.is_active) return;
    const ip = s.assigned_ip ? String(s.assigned_ip).split('/')[0].trim() : '*';
    lines.push(`"${s.vpn_username}" * "${s.vpn_password}" ${ip || '*'}`);
  });

  return `${lines.join('\n')}\n`;
}

function rewriteChapSecrets(sectors) {
  const result = writeRootFile(CHAP_SECRETS, renderChapSecrets(sectors), '600');
  // Sincroniza credenciales EAP (IKEv2 para celulares) desde chap-secrets
  if (isLinux) {
    safeExec('sudo /usr/local/sbin/omnisync-sync-eap-secrets >/dev/null 2>&1 || true');
  }
  return result;
}

function renderIpsecConf(sectors) {
  const lines = [
    '# Omnisync L2TP/IPsec - autogenerado, no editar manualmente',
    'config setup',
    '  charondebug="ike 1, knl 1, cfg 0"',
    '  uniqueids=no',
    '',
  ];

  getActiveConfiguredSectors(sectors).forEach((s) => {
    const conn = getConnName(s);
    lines.push(`conn ${conn}`);
    lines.push('  keyexchange=ikev1');
    lines.push('  type=transport');
    lines.push('  authby=secret');
    lines.push('  left=%defaultroute');
    lines.push('  leftprotoport=17/1701');
    lines.push(`  right=${s.mikrotik_public_ip}`);
    lines.push('  rightprotoport=17/1701');
    lines.push('  ike=aes256-sha1-modp1024,aes128-sha1-modp1024,3des-sha1-modp1024!');
    lines.push('  esp=aes256-sha1,aes128-sha1,3des-sha1!');
    lines.push('  forceencaps=yes');
    lines.push('  dpddelay=30s');
    lines.push('  dpdtimeout=120s');
    lines.push('  dpdaction=clear');
    lines.push('  rekey=no');
    lines.push('  auto=add');
    lines.push('');
  });

  return `${lines.join('\n')}\n`;
}

function rewriteIpsecConf(sectors) {
  return writeRootFile(IPSEC_CONF, renderIpsecConf(sectors));
}

function renderIpsecSecrets(sectors) {
  const lines = [
    '# Omnisync IPsec PSK - autogenerado, no editar manualmente',
    '# Formato: %any <IP_MIKROTIK> : PSK "<PSK>"',
  ];

  getActiveConfiguredSectors(sectors).forEach((s) => {
    lines.push(`%any ${s.mikrotik_public_ip} : PSK "${s.ipsec_psk}"`);
  });

  return `${lines.join('\n')}\n`;
}

function rewriteIpsecSecrets(sectors) {
  return writeRootFile(IPSEC_SECRETS, renderIpsecSecrets(sectors), '600');
}

function renderXl2tpdConf(sectors) {
  const lines = [
    '[global]',
    'ipsec saref = yes',
    '',
  ];

  getActiveConfiguredSectors(sectors).forEach((s) => {
    const conn = getConnName(s);
    lines.push(`[lac ${conn}]`);
    lines.push(`lns = ${s.mikrotik_public_ip}`);
    lines.push(`name = ${s.vpn_username}`);
    lines.push('ppp debug = yes');
    lines.push('pppoptfile = /etc/ppp/options.omnisync');
    lines.push('length bit = yes');
    lines.push('autodial = yes');
    lines.push('redial = yes');
    lines.push('redial timeout = 15');
    lines.push('max redials = 0');
    lines.push('');
  });

  return `${lines.join('\n')}\n`;
}

function rewriteXl2tpdConf(sectors) {
  return writeRootFile(XL2TPD_CONF, renderXl2tpdConf(sectors));
}

function rewriteSmcrouteConf(routes) {
  if (!isLinux) {
    return { ok: true, mock: true };
  }

  const serviceExists = safeExec('systemctl cat smcroute >/dev/null 2>&1 && echo yes || true');
  const fileExists = fs.existsSync(SMCROUTE_CONF);
  if (!fileExists && (serviceExists.output || '').trim() !== 'yes') {
    return { ok: true, skipped: true };
  }

  const lines = [
    '# Omnisync multicast routing - autogenerado',
    `mgroup from ${PUB_IF} group 239.10.0.0/24`,
    '',
  ];

  (routes || []).forEach((r) => {
    if (!r.multicast_ip || !r.output_iface) return;
    lines.push(`mroute from ${PUB_IF} group ${r.multicast_ip} to ${r.output_iface}`);
  });

  return writeRootFile(SMCROUTE_CONF, `${lines.join('\n')}\n`);
}

function getTunnelStatus() {
  if (!isLinux) {
    return {
      ipsec_running: false,
      xl2tpd_running: false,
      smcroute_running: false,
      public_ip: '0.0.0.0',
      psk: getPSK(),
      tunnels: [],
      mock: true,
    };
  }

  const charon = safeExec('pgrep -x charon >/dev/null && echo active || true');
  const ipsec = safeExec('sudo ipsec statusall 2>/dev/null || true');
  const xl2tpd = safeExec('systemctl is-active xl2tpd 2>/dev/null || true');
  const smcroute = safeExec('systemctl is-active smcroute 2>/dev/null || true');
  const pppList = safeExec(`ip -o addr show | awk '/ ppp[0-9]* /{print $2,$4}'`);

  const tunnels = [];
  (pppList.output || '').split('\n').filter(Boolean).forEach((line) => {
    const [iface, ipcidr] = line.trim().split(/\s+/);
    if (!iface) return;
    tunnels.push({ interface: iface, ip: (ipcidr || '').split('/')[0] });
  });

  return {
    ipsec_running: (charon.output || '').trim() === 'active' || /Security Associations|INSTALLED|ESTABLISHED/i.test(ipsec.output || ''),
    xl2tpd_running: (xl2tpd.output || '').trim() === 'active',
    smcroute_running: (smcroute.output || '').trim() === 'active',
    public_ip: getPublicIP(),
    psk: getPSK(),
    tunnels,
    raw_ipsec: (ipsec.output || '').slice(0, 2000),
  };
}

function generateMikrotikConfig(sector, multicastChannels, serverPublicIP, psk) {
  const safe = (s) => String(s || '').replace(/"/g, '');
  const activePsk = safe(sector.ipsec_psk || psk);
  const lines = [
    '# ============================================================',
    `# Omnisync - Configuración MikroTik para sector "${safe(sector.name)}"`,
    `# Generado: ${new Date().toISOString()}`,
    '# Arquitectura: VPS -> L2TP/IPsec -> MikroTik -> IGMP Proxy -> Cliente',
    '# ============================================================',
    '',
    '/interface l2tp-client',
    `add name=omnisync-l2tp connect-to=${serverPublicIP} user="${safe(sector.vpn_username)}" password="${safe(sector.vpn_password)}" use-ipsec=yes ipsec-secret="${activePsk}" allow=mschap2 disabled=no add-default-route=no use-peer-dns=no max-mru=1400 max-mtu=1400`,
    '',
    '/routing igmp-proxy',
    'set quick-leave=yes',
    '',
    '/routing igmp-proxy interface',
    'add interface=omnisync-l2tp upstream=yes alternative-subnets=239.0.0.0/8',
    'add interface=bridge upstream=no',
    '',
    '# Canales asignados',
  ];

  (multicastChannels || []).forEach((ch) => {
    lines.push(`# ${ch.channel_name || 'Canal'} -> udp://@${ch.multicast_ip}:${ch.port}`);
  });

  lines.push('');
  lines.push('# ============================================================');
  return lines.join('\n');
}

async function syncAllFromDB(pool) {
  const sectorsRes = await pool.query(`
    SELECT id, name, vpn_username, vpn_password, assigned_ip,
           mikrotik_public_ip, ipsec_psk, is_active,
           gre_local_ip, gre_remote_ip, gre_tunnel_name
    FROM vpn_sectors
    ORDER BY created_at
  `);
  const sectors = sectorsRes.rows;

  const chapResult = rewriteChapSecrets(sectors);

  return {
    chap: chapResult,
    ipsec_conf: { ok: true, skipped: true, reason: 'vpn-central-fija' },
    ipsec_secrets: { ok: true, skipped: true, reason: 'vpn-central-fija' },
    xl2tpd: { ok: true, skipped: true, reason: 'vpn-central-fija' },
    smcroute: { ok: true, skipped: true, reason: 'no-usado-en-arquitectura-validada' },
    restart_ipsec: { ok: true, skipped: true, reason: 'vpn-central-fija' },
    restart_xl2tpd: { ok: true, skipped: true, reason: 'vpn-central-fija' },
    restart_smcroute: { ok: true, skipped: true, reason: 'no-usado-en-arquitectura-validada' },
    sectors_count: sectors.length,
    active_configured: sectors.filter(s => s.is_active).length,
  };
}

async function resolveChannelUrlsForIp(pool, clientIp) {
  const ip = (clientIp || '').replace(/^::ffff:/, '');

  if (!ip.startsWith('172.16.50.')) {
    return { sector: null, urls: {} };
  }

  try {
    const tRes = await pool.query(
      `SELECT value FROM system_settings WHERE key = 'multicast_enabled' LIMIT 1`
    );
    if (tRes.rows[0]?.value?.enabled === false) {
      return { sector: null, urls: {}, disabled: true };
    }
  } catch {}

  const sRes = await pool.query(
    `SELECT id, name, delivery_mode, udpxy_url, assigned_ip
       FROM vpn_sectors
      WHERE assigned_ip >>= $1::inet AND is_active = true
      LIMIT 1`,
    [ip]
  );
  if (!sRes.rows[0]) return { sector: null, urls: {} };
  const sector = sRes.rows[0];

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
        url = `udp://@${row.multicast_ip}:${row.port}`;
        break;
      case 'udpxy_rbldf':
      case 'udpxy_central': {
        const base = (sector.udpxy_url || '').replace(/\/+$/, '');
        if (!base) continue;
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
  rewriteIpsecConf,
  rewriteIpsecSecrets,
  rewriteXl2tpdConf,
  rewriteSmcrouteConf,
  getTunnelStatus,
  generateMikrotikConfig,
  syncAllFromDB,
  resolveChannelUrlsForIp,
  getPSK,
  getPublicIP,
};
