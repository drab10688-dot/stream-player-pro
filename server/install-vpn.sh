#!/bin/bash
# ============================================================
# Omnisync - Cliente L2TP/IPsec → MikroTik central + Multicast UDP
# ============================================================
# Uso: sudo bash install-vpn.sh
#
# Instala y configura el VPS como CLIENTE L2TP/IPsec hacia el
# MikroTik central del WISP. El VPS recibe una IP en la red interna
# (típicamente 172.16.50.1) y desde allí emite multicast UDP que
# el MikroTik reenvía a sus clientes vía IGMP-Proxy.
#
# Arquitectura validada en producción (mem://arquitectura/multicast-l2tp-validado-produccion):
#   [VPS FFmpeg]  →  ppp0 (172.16.50.1)
#         │  L2TP/IPsec
#         ▼
#   [MikroTik central]  →  IGMP-Proxy  →  clientes (LAN/WiFi/L2TP)
#
# - NO usa GRE ni smcroute (descartados, innecesarios)
# - FFmpeg fuerza salida por ppp0 con localaddr=172.16.50.1
# - MikroTik hace IGMP-Proxy hacia todos los clientes
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

# ----------------------------------------------------------
# 1) Datos del MikroTik central (lo único que cambia entre instalaciones)
# ----------------------------------------------------------
echo ""
echo "================================================================"
echo "  Configuración del cliente L2TP hacia MikroTik central"
echo "================================================================"
echo ""

# Permitir reusar configuración previa si ya existe
CFG_FILE="/etc/omnisync-vpn.conf"
if [ -f "$CFG_FILE" ]; then
  log "Detecté configuración previa en $CFG_FILE"
  # shellcheck disable=SC1090
  source "$CFG_FILE"
  read -p "¿Reusar configuración previa? (s/N): " REUSE
  if [[ ! "$REUSE" =~ ^[sSyY]$ ]]; then
    MIKROTIK_PUBLIC_IP=""; VPN_USER=""; VPN_PASS=""; IPSEC_PSK=""
  fi
fi

while [ -z "$MIKROTIK_PUBLIC_IP" ]; do
  read -p "IP pública del MikroTik central (ej: 179.189.222.234): " MIKROTIK_PUBLIC_IP
done

while [ -z "$VPN_USER" ]; do
  read -p "Usuario L2TP (definido en el MikroTik): " VPN_USER
done

while [ -z "$VPN_PASS" ]; do
  read -s -p "Contraseña L2TP: " VPN_PASS
  echo ""
done

while [ -z "$IPSEC_PSK" ]; do
  read -s -p "PSK IPsec compartida con el MikroTik: " IPSEC_PSK
  echo ""
done

# IP fija que esperamos recibir dentro del L2TP (debe coincidir con la del MikroTik)
VPN_LOCAL_IP="${VPN_LOCAL_IP:-172.16.50.1}"
read -p "IP que el MikroTik te asignará en el túnel [${VPN_LOCAL_IP}]: " IN
[ -n "$IN" ] && VPN_LOCAL_IP="$IN"

# Detectar interfaz/IP pública (informativo)
PUB_IF=$(ip route get 1.1.1.1 2>/dev/null | awk '{print $5; exit}')
PUB_IP=$(curl -s -4 --max-time 4 ifconfig.me || hostname -I | awk '{print $1}')
log "Interfaz pública detectada:  $PUB_IF  ($PUB_IP)"
log "MikroTik destino:            $MIKROTIK_PUBLIC_IP"
log "IP esperada en el túnel:     $VPN_LOCAL_IP"

# Persistir para futuros re-run / deploy.sh
cat > "$CFG_FILE" <<EOF
# Omnisync VPN client config - autogenerado
MIKROTIK_PUBLIC_IP="${MIKROTIK_PUBLIC_IP}"
VPN_USER="${VPN_USER}"
VPN_PASS="${VPN_PASS}"
IPSEC_PSK="${IPSEC_PSK}"
VPN_LOCAL_IP="${VPN_LOCAL_IP}"
EOF
chmod 600 "$CFG_FILE"

# ----------------------------------------------------------
# 2) Instalar paquetes (cliente L2TP + IPsec + FFmpeg)
# ----------------------------------------------------------
log "Instalando paquetes (strongswan, xl2tpd, ffmpeg)..."
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
# 3) Sysctl: forwarding + buffer UDP (validado en producción)
# ----------------------------------------------------------
log "Configurando kernel (forwarding + buffer UDP 25MB)..."
cat > /etc/sysctl.d/99-omnisync-vpn.conf <<EOF
# Omnisync VPN cliente + Multicast — validado producción
net.ipv4.ip_forward=1
net.ipv4.conf.all.rp_filter=0
net.ipv4.conf.default.rp_filter=0
net.ipv4.conf.all.accept_redirects=0
net.ipv4.conf.all.send_redirects=0
# Buffer UDP grande → evita pixelado en multicast por L2TP (mem)
net.core.wmem_max=26214400
net.core.wmem_default=26214400
net.core.rmem_max=26214400
net.core.rmem_default=26214400
EOF
sysctl --system >/dev/null
ok "Kernel configurado (wmem_max=25MB)"

# ----------------------------------------------------------
# 4) strongSwan (IPsec PSK) — modo cliente transport
# ----------------------------------------------------------
log "Configurando strongSwan (IPsec PSK cliente)..."
cat > /etc/ipsec.conf <<EOF
# Omnisync L2TP/IPsec cliente - autogenerado
config setup
  charondebug="ike 1, knl 1, cfg 0"
  uniqueids=no

conn omnisync
  authby=secret
  pfs=no
  rekey=no
  keyingtries=3
  type=transport
  keyexchange=ikev1
  left=%defaultroute
  leftprotoport=17/1701
  right=${MIKROTIK_PUBLIC_IP}
  rightprotoport=17/1701
  ike=aes256-sha1-modp1024,aes128-sha1-modp1024,3des-sha1-modp1024!
  esp=aes256-sha1,aes128-sha1,3des-sha1!
  auto=start
EOF

cat > /etc/ipsec.secrets <<EOF
%any ${MIKROTIK_PUBLIC_IP} : PSK "${IPSEC_PSK}"
EOF
chmod 600 /etc/ipsec.secrets
ok "strongSwan configurado (cliente → ${MIKROTIK_PUBLIC_IP})"

# ----------------------------------------------------------
# 5) xl2tpd cliente
# ----------------------------------------------------------
log "Configurando xl2tpd (cliente)..."
cat > /etc/xl2tpd/xl2tpd.conf <<EOF
[global]
ipsec saref = yes

[lac omnisync]
lns = ${MIKROTIK_PUBLIC_IP}
ppp debug = no
pppoptfile = /etc/ppp/options.omnisync
length bit = yes
require chap = no
refuse pap = no
require authentication = yes
EOF

cat > /etc/ppp/options.omnisync <<EOF
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
name ${VPN_USER}
EOF

cat > /etc/ppp/chap-secrets <<EOF
# Omnisync L2TP cliente - autogenerado
${VPN_USER} * ${VPN_PASS} *
EOF
chmod 600 /etc/ppp/chap-secrets /etc/ppp/options.omnisync
ok "xl2tpd configurado"

# ----------------------------------------------------------
# 6) Script helper: levantar/bajar túnel L2TP
# ----------------------------------------------------------
cat > /usr/local/sbin/omnisync-vpn-up <<'EOF'
#!/bin/bash
ipsec restart >/dev/null 2>&1
sleep 2
ipsec up omnisync >/dev/null 2>&1 || true
sleep 1
echo "c omnisync" > /var/run/xl2tpd/l2tp-control 2>/dev/null || \
  systemctl restart xl2tpd
sleep 4
ip -4 addr show ppp0 2>/dev/null | grep -q "inet" \
  && echo "VPN UP: $(ip -4 addr show ppp0 | awk '/inet/{print $2}')" \
  || echo "VPN DOWN: revisa /var/log/syslog | grep -E 'pppd|xl2tpd|charon'"
EOF
chmod +x /usr/local/sbin/omnisync-vpn-up

cat > /usr/local/sbin/omnisync-vpn-down <<'EOF'
#!/bin/bash
echo "d omnisync" > /var/run/xl2tpd/l2tp-control 2>/dev/null || true
sleep 1
ipsec down omnisync >/dev/null 2>&1 || true
echo "VPN DOWN"
EOF
chmod +x /usr/local/sbin/omnisync-vpn-down

# ----------------------------------------------------------
# 7) Firewall (cliente solo necesita salida; abrir 500/4500/1701 igual)
# ----------------------------------------------------------
log "Reglas iptables..."
iptables -I INPUT -p udp --dport 500  -j ACCEPT 2>/dev/null || true
iptables -I INPUT -p udp --dport 1701 -j ACCEPT 2>/dev/null || true
iptables -I INPUT -p udp --dport 4500 -j ACCEPT 2>/dev/null || true
iptables -I INPUT -p esp -j ACCEPT 2>/dev/null || true
iptables -A FORWARD -d 239.0.0.0/8 -j ACCEPT 2>/dev/null || true
netfilter-persistent save >/dev/null 2>&1 || iptables-save > /etc/iptables/rules.v4 2>/dev/null || true
ok "Firewall actualizado"

# ----------------------------------------------------------
# 8) Sudoers para que Node controle ipsec/xl2tpd/ip sin password
# ----------------------------------------------------------
cat > /etc/sudoers.d/omnisync-vpn <<EOF
# Omnisync - permite al backend Node.js gestionar VPN sin password
root ALL=(ALL) NOPASSWD: /usr/sbin/ipsec, /usr/sbin/xl2tpd, /usr/sbin/ip, /bin/systemctl, /usr/local/sbin/omnisync-vpn-up, /usr/local/sbin/omnisync-vpn-down, /usr/bin/tee /etc/ppp/chap-secrets
EOF
chmod 440 /etc/sudoers.d/omnisync-vpn
ok "Sudoers configurado"

# ----------------------------------------------------------
# 9) Auto-reconexión: systemd unit que mantiene la VPN viva
# ----------------------------------------------------------
cat > /etc/systemd/system/omnisync-vpn.service <<EOF
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

# Watchdog: si ppp0 se cae, reconectar
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
# 10) Iniciar servicios y levantar túnel
# ----------------------------------------------------------
log "Iniciando servicios..."
systemctl enable strongswan-starter >/dev/null 2>&1 || systemctl enable ipsec >/dev/null 2>&1 || true
systemctl restart strongswan-starter 2>/dev/null || systemctl restart ipsec 2>/dev/null || true
systemctl enable xl2tpd >/dev/null 2>&1
systemctl restart xl2tpd
sleep 2
/usr/local/sbin/omnisync-vpn-up || true
systemctl start omnisync-vpn-watch.timer 2>/dev/null || true
ok "Servicios activos (xl2tpd + strongswan + watchdog)"

# ----------------------------------------------------------
# 11) Crear tablas VPN en PostgreSQL
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
# 12) Guardar PSK + exportar VPN_LOCAL_IP para multicast-encoder
# ----------------------------------------------------------
echo "${IPSEC_PSK}" > /etc/omnisync-vpn-psk
chmod 640 /etc/omnisync-vpn-psk

# Asegurar que el backend (PM2) reciba VPN_LOCAL_IP
if [ -f /opt/streambox/server/.env ]; then
  grep -q '^VPN_LOCAL_IP=' /opt/streambox/server/.env \
    && sed -i "s|^VPN_LOCAL_IP=.*|VPN_LOCAL_IP=${VPN_LOCAL_IP}|" /opt/streambox/server/.env \
    || echo "VPN_LOCAL_IP=${VPN_LOCAL_IP}" >> /opt/streambox/server/.env
  ok "VPN_LOCAL_IP=${VPN_LOCAL_IP} agregado a /opt/streambox/server/.env"
fi

# ----------------------------------------------------------
# 13) Resumen final
# ----------------------------------------------------------
PPP_IP=$(ip -4 addr show ppp0 2>/dev/null | awk '/inet/{print $2}' | head -1)

echo ""
echo "================================================================"
echo -e "${GREEN}  ✅ Cliente VPN Omnisync instalado${NC}"
echo "================================================================"
echo ""
echo -e "  MikroTik central:     ${CYAN}${MIKROTIK_PUBLIC_IP}${NC}"
echo -e "  Usuario L2TP:         ${CYAN}${VPN_USER}${NC}"
echo -e "  IP esperada (ppp0):   ${CYAN}${VPN_LOCAL_IP}${NC}"
echo -e "  IP actual ppp0:       ${CYAN}${PPP_IP:-no conectada todavía}${NC}"
echo -e "  PSK guardada en:      ${CYAN}/etc/omnisync-vpn-psk${NC}"
echo ""
echo -e "  ${YELLOW}En el MikroTik debes tener:${NC}"
echo "    /routing igmp-proxy set quick-leave=yes"
echo "    /routing igmp-proxy interface"
echo "      add interface=omnisync-l2tp upstream=yes alternative-subnets=239.0.0.0/8"
echo "      add interface=<bridge-clientes> upstream=no"
echo "      add interface=<l2tp-tu-cliente> upstream=no   # opcional"
echo ""
echo "  Comandos útiles:"
echo "    sudo omnisync-vpn-up      # levantar túnel"
echo "    sudo omnisync-vpn-down    # bajar túnel"
echo "    ip -4 addr show ppp0      # ver IP en el túnel"
echo "    ipsec statusall           # estado IPsec"
echo ""
echo "  Próximos pasos:"
echo "    1) pm2 restart streambox-api"
echo "    2) Panel admin → tab 'VPN Sectores' → asigna canales a multicast"
echo "    3) Prueba en VLC del cliente:  udp://@239.10.0.X:1234"
echo "================================================================"
