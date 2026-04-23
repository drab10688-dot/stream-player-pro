#!/bin/bash
# ============================================================
# Omnisync - Instalación módulo VPN/Multicast (sin credenciales)
# ============================================================
# Uso: sudo bash install-vpn.sh
#
# Este script SOLO instala y prepara el sistema:
#   - Paquetes (strongswan, xl2tpd, ppp, ffmpeg, iptables)
#   - Kernel (forwarding + buffer UDP 25MB anti-pixelado)
#   - Plantillas de configuración (sin credenciales)
#   - Helpers omnisync-vpn-up / omnisync-vpn-down
#   - Sudoers para que Node controle ipsec/xl2tpd
#   - Watchdog systemd
#   - Tablas VPN en PostgreSQL
#
# Las credenciales (IP MikroTik, usuario, pass, PSK) se cargan
# DESPUÉS desde el panel admin → tab "VPN/Multicast" → Sectores.
# El backend reescribe ipsec.conf, ipsec.secrets, xl2tpd.conf y
# chap-secrets cuando creás un sector.
#
# Arquitectura validada (mem://arquitectura/multicast-l2tp-validado-produccion):
#   [VPS FFmpeg] → ppp0 (172.16.50.1) → L2TP/IPsec → [MikroTik] → IGMP-Proxy → cliente
# ============================================================

set -e

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; NC='\033[0m'
log()  { echo -e "${CYAN}[VPN-INSTALL]${NC} $1"; }
ok()   { echo -e "${GREEN}[OK]${NC} $1"; }
warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
err()  { echo -e "${RED}[ERROR]${NC} $1"; }

if [ "$EUID" -ne 0 ]; then
  err "Debes ejecutar como root: sudo bash install-vpn.sh"
  exit 1
fi

echo ""
echo "================================================================"
echo "  Instalación módulo VPN/Multicast - Omnisync"
echo "  (sin credenciales: se configuran luego desde el panel)"
echo "================================================================"
echo ""

# ----------------------------------------------------------
# 1) Paquetes
# ----------------------------------------------------------
log "Instalando paquetes (strongswan, xl2tpd, ppp, ffmpeg)..."
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq \
  strongswan strongswan-pki libcharon-extra-plugins \
  xl2tpd ppp \
  iproute2 iptables-persistent netfilter-persistent \
  ffmpeg \
  curl openssl
ok "Paquetes instalados"

if ! command -v ffmpeg >/dev/null 2>&1; then
  err "FFmpeg no se instaló. El encoder multicast no funcionará."
else
  ok "FFmpeg OK: $(ffmpeg -version 2>/dev/null | head -1 | cut -c1-80)"
fi

# ----------------------------------------------------------
# 2) Sysctl: forwarding + buffer UDP (validado en producción)
# ----------------------------------------------------------
log "Configurando kernel (forwarding + buffer UDP 25MB anti-pixelado)..."
cat > /etc/sysctl.d/99-omnisync-vpn.conf <<EOF
# Omnisync VPN cliente + Multicast — validado producción
net.ipv4.ip_forward=1
net.ipv4.conf.all.rp_filter=0
net.ipv4.conf.default.rp_filter=0
net.ipv4.conf.all.accept_redirects=0
net.ipv4.conf.all.send_redirects=0
# Buffer UDP grande → evita pixelado en multicast por L2TP
net.core.wmem_max=26214400
net.core.wmem_default=26214400
net.core.rmem_max=26214400
net.core.rmem_default=26214400
EOF
sysctl --system >/dev/null
ok "Kernel configurado (wmem_max=25MB)"

# ----------------------------------------------------------
# 3) Plantilla strongSwan vacía (la rellena el backend)
# ----------------------------------------------------------
log "Creando plantillas de strongSwan/xl2tpd (sin credenciales)..."
if [ ! -f /etc/ipsec.conf.omnisync-bak ] && [ -f /etc/ipsec.conf ]; then
  cp /etc/ipsec.conf /etc/ipsec.conf.omnisync-bak 2>/dev/null || true
fi

cat > /etc/ipsec.conf <<'EOF'
# Omnisync L2TP/IPsec - se completa desde el panel admin
config setup
  charondebug="ike 1, knl 1, cfg 0"
  uniqueids=no

# Las conexiones "conn omnisync-*" las agrega el backend cuando
# creás un sector en el panel.
EOF

# ipsec.secrets: solo cabecera, el backend agrega líneas
if [ ! -f /etc/ipsec.secrets ] || ! grep -q "Omnisync" /etc/ipsec.secrets; then
  cat > /etc/ipsec.secrets <<'EOF'
# Omnisync IPsec PSK - administrado por el panel
# Formato: %any <IP_MIKROTIK> : PSK "<PSK>"
EOF
fi
chmod 600 /etc/ipsec.secrets

# xl2tpd: estructura base, el backend agrega [lac ...] por sector
cat > /etc/xl2tpd/xl2tpd.conf <<'EOF'
[global]
ipsec saref = yes

# Las secciones [lac omnisync-*] las agrega el backend.
EOF

# Plantilla de opciones PPP base
cat > /etc/ppp/options.omnisync <<'EOF'
ipcp-accept-local
ipcp-accept-remote
refuse-eap
require-mschap-v2
noccp
noauth
mtu 1400
mru 1400
noipdefault
defaultroute-metric 9999
usepeerdns
debug
connect-delay 5000
EOF

# chap-secrets: cabecera, el backend agrega usuarios
if [ ! -f /etc/ppp/chap-secrets ] || ! grep -q "Omnisync" /etc/ppp/chap-secrets; then
  cat > /etc/ppp/chap-secrets <<'EOF'
# Omnisync L2TP - administrado por el panel
# user * password *
EOF
fi
chmod 600 /etc/ppp/chap-secrets /etc/ppp/options.omnisync
ok "Plantillas creadas (sin credenciales)"

# ----------------------------------------------------------
# 4) Scripts helper: levantar/bajar túnel
# ----------------------------------------------------------
cat > /usr/local/sbin/omnisync-vpn-up <<'EOF'
#!/bin/bash
# Levanta todas las conexiones IPsec definidas + xl2tpd
ipsec restart >/dev/null 2>&1
sleep 2
# Levanta cada conn que empiece por "omnisync"
for c in $(ipsec status 2>/dev/null | awk -F'[ :]' '/omnisync/{print $1}' | sort -u); do
  ipsec up "$c" >/dev/null 2>&1 || true
done
sleep 1
systemctl restart xl2tpd 2>/dev/null || true
sleep 4
ip -4 addr show ppp0 2>/dev/null | grep -q "inet" \
  && echo "VPN UP: $(ip -4 addr show ppp0 | awk '/inet/{print $2}')" \
  || echo "VPN DOWN o sin sectores configurados todavía"
EOF
chmod +x /usr/local/sbin/omnisync-vpn-up

cat > /usr/local/sbin/omnisync-vpn-down <<'EOF'
#!/bin/bash
for c in $(ipsec status 2>/dev/null | awk -F'[ :]' '/omnisync/{print $1}' | sort -u); do
  ipsec down "$c" >/dev/null 2>&1 || true
done
echo "VPN DOWN"
EOF
chmod +x /usr/local/sbin/omnisync-vpn-down

# ----------------------------------------------------------
# 5) Firewall
# ----------------------------------------------------------
log "Reglas iptables (IPsec + multicast)..."
iptables -I INPUT -p udp --dport 500  -j ACCEPT 2>/dev/null || true
iptables -I INPUT -p udp --dport 1701 -j ACCEPT 2>/dev/null || true
iptables -I INPUT -p udp --dport 4500 -j ACCEPT 2>/dev/null || true
iptables -I INPUT -p esp -j ACCEPT 2>/dev/null || true
iptables -A FORWARD -d 239.0.0.0/8 -j ACCEPT 2>/dev/null || true
netfilter-persistent save >/dev/null 2>&1 || iptables-save > /etc/iptables/rules.v4 2>/dev/null || true
ok "Firewall actualizado"

# ----------------------------------------------------------
# 6) Sudoers para que Node controle todo sin password
# ----------------------------------------------------------
cat > /etc/sudoers.d/omnisync-vpn <<'EOF'
# Omnisync - permite al backend Node.js gestionar VPN sin password
root ALL=(ALL) NOPASSWD: /usr/sbin/ipsec, /usr/sbin/xl2tpd, /usr/sbin/ip, /bin/systemctl, /usr/local/sbin/omnisync-vpn-up, /usr/local/sbin/omnisync-vpn-down, /usr/bin/tee /etc/ppp/chap-secrets, /usr/bin/tee /etc/ipsec.conf, /usr/bin/tee /etc/ipsec.secrets, /usr/bin/tee /etc/xl2tpd/xl2tpd.conf
EOF
chmod 440 /etc/sudoers.d/omnisync-vpn
ok "Sudoers configurado"

# ----------------------------------------------------------
# 7) Watchdog systemd (re-up si ppp0 cae)
# ----------------------------------------------------------
cat > /etc/systemd/system/omnisync-vpn.service <<'EOF'
[Unit]
Description=Omnisync L2TP/IPsec client (auto-reconnect)
After=network-online.target strongswan-starter.service xl2tpd.service
Wants=network-online.target

[Service]
Type=oneshot
RemainAfterExit=yes
ExecStartPre=/bin/sleep 5
ExecStart=/usr/local/sbin/omnisync-vpn-up
ExecStop=/usr/local/sbin/omnisync-vpn-down

[Install]
WantedBy=multi-user.target
EOF

cat > /etc/systemd/system/omnisync-vpn-watch.service <<'EOF'
[Unit]
Description=Omnisync VPN watchdog (re-up if ppp0 dies)

[Service]
Type=oneshot
ExecStart=/bin/bash -c 'ip -4 addr show ppp0 2>/dev/null | grep -q inet || /usr/local/sbin/omnisync-vpn-up'
EOF

cat > /etc/systemd/system/omnisync-vpn-watch.timer <<'EOF'
[Unit]
Description=Run Omnisync VPN watchdog every minute

[Timer]
OnBootSec=60
OnUnitActiveSec=60

[Install]
WantedBy=timers.target
EOF

systemctl daemon-reload
systemctl enable omnisync-vpn.service omnisync-vpn-watch.timer >/dev/null 2>&1 || true

# ----------------------------------------------------------
# 8) Habilitar servicios (sin levantar túnel todavía)
# ----------------------------------------------------------
log "Habilitando servicios..."
systemctl enable strongswan-starter >/dev/null 2>&1 || systemctl enable ipsec >/dev/null 2>&1 || true
systemctl enable xl2tpd >/dev/null 2>&1
systemctl restart strongswan-starter 2>/dev/null || systemctl restart ipsec 2>/dev/null || true
systemctl restart xl2tpd 2>/dev/null || true
systemctl start omnisync-vpn-watch.timer 2>/dev/null || true
ok "Servicios habilitados (esperando configuración del panel)"

# ----------------------------------------------------------
# 9) Crear tablas VPN en PostgreSQL
# ----------------------------------------------------------
log "Creando tablas VPN en la base de datos..."
SCHEMA_FILE="$(dirname "$(readlink -f "$0")")/database/vpn-schema.sql"
DB_PASS_FILE="/etc/omnisync-db-pass"

apply_schema() {
  local DBNAME="$1"
  if [ -f "$DB_PASS_FILE" ]; then
    PGPASSWORD="$(cat "$DB_PASS_FILE")" psql -h localhost -U streambox_user -d "$DBNAME" -f "$SCHEMA_FILE" >/dev/null 2>&1 && return 0
  fi
  sudo -u postgres psql -d "$DBNAME" -f "$SCHEMA_FILE" >/dev/null 2>&1
}

if [ -f "$SCHEMA_FILE" ]; then
  if apply_schema streambox || apply_schema streambox_db; then
    ok "Tablas VPN aplicadas"
  else
    warn "No pude crear tablas VPN automáticamente."
    warn "Ejecuta manualmente: sudo -u postgres psql -d streambox -f $SCHEMA_FILE"
  fi
else
  warn "vpn-schema.sql no encontrado en $SCHEMA_FILE"
fi

# ----------------------------------------------------------
# 10) Resumen final
# ----------------------------------------------------------
echo ""
echo "================================================================"
echo -e "${GREEN}  ✅ Módulo VPN/Multicast instalado${NC}"
echo "================================================================"
echo ""
echo -e "  ${CYAN}Sistema listo. Las credenciales se cargan desde el panel:${NC}"
echo ""
echo "    1) Abrí el panel admin → tab 'VPN/Multicast'"
echo "    2) Sub-tab 'Sectores' → Crear sector con:"
echo "         - IP pública del MikroTik"
echo "         - Usuario y contraseña L2TP"
echo "         - PSK IPsec"
echo "         - IP asignada en el túnel (ej. 172.16.50.1)"
echo "    3) Sub-tab 'Multicast' → asigná canales a grupos"
echo "    4) Probá en VLC del cliente: udp://@239.10.0.X:1234"
echo ""
echo -e "  ${YELLOW}En el MikroTik central debés tener:${NC}"
echo "    /routing igmp-proxy set quick-leave=yes"
echo "    /routing igmp-proxy interface"
echo "      add interface=omnisync-l2tp upstream=yes alternative-subnets=239.0.0.0/8"
echo "      add interface=<bridge-clientes> upstream=no"
echo ""
echo "  Comandos útiles:"
echo "    sudo omnisync-vpn-up      # levantar túneles"
echo "    sudo omnisync-vpn-down    # bajar túneles"
echo "    ip -4 addr show ppp0      # ver IP del túnel"
echo "    ipsec statusall           # estado IPsec"
echo "    pm2 logs streambox-api    # logs del backend"
echo "================================================================"
