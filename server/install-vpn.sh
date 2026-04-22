#!/bin/bash
# ============================================================
# Omnisync - Instalación VPN L2TP/IPsec + Multicast (smcroute)
# ============================================================
# Uso: sudo bash install-vpn.sh
#
# Instala y configura:
#   - strongSwan (IPsec)
#   - xl2tpd (L2TP)
#   - smcroute (multicast routing daemon)
#   - iproute2 (GRE tunnels)
#   - sysctl (IP forwarding + multicast forwarding)
#   - ufw rules (UDP 500/1701/4500 + GRE protocol 47)
#
# Rango VPN:        172.16.50.0/24 (server: 172.16.50.1)
# Rango Multicast:  239.10.0.0/24 (un grupo por canal)
# ============================================================

set -e

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; NC='\033[0m'
log() { echo -e "${CYAN}[VPN-INSTALL]${NC} $1"; }
ok()  { echo -e "${GREEN}[OK]${NC} $1"; }
warn(){ echo -e "${YELLOW}[WARN]${NC} $1"; }
err() { echo -e "${RED}[ERROR]${NC} $1"; }

if [ "$EUID" -ne 0 ]; then
  err "Debes ejecutar como root: sudo bash install-vpn.sh"
  exit 1
fi

# ----------------------------------------------------------
# 1) Variables editables
# ----------------------------------------------------------
VPN_NETWORK="172.16.50.0/24"
VPN_SERVER_IP="172.16.50.1"
VPN_POOL_START="172.16.50.10"
VPN_POOL_END="172.16.50.250"
MCAST_NETWORK="239.10.0.0/24"

read -p "Clave PSK compartida IPsec (mínimo 16 chars, déjalo vacío para autogenerar): " IPSEC_PSK
if [ -z "$IPSEC_PSK" ]; then
  IPSEC_PSK=$(openssl rand -base64 24 | tr -d '=+/' | cut -c1-24)
  warn "PSK autogenerada: $IPSEC_PSK  (guárdala bien)"
fi

# Detectar interfaz pública
PUB_IF=$(ip route get 1.1.1.1 | awk '{print $5; exit}')
PUB_IP=$(curl -s -4 ifconfig.me || hostname -I | awk '{print $1}')
log "Interfaz pública detectada: $PUB_IF  ($PUB_IP)"

# ----------------------------------------------------------
# 2) Instalar paquetes
# ----------------------------------------------------------
log "Instalando paquetes (strongswan, xl2tpd, smcroute, iproute2)..."
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq \
  strongswan strongswan-pki libcharon-extra-plugins \
  xl2tpd ppp \
  smcroute \
  iproute2 iptables-persistent netfilter-persistent \
  curl openssl
ok "Paquetes instalados"

# ----------------------------------------------------------
# 3) Sysctl: IP forwarding + multicast forwarding
# ----------------------------------------------------------
log "Configurando kernel (IP/multicast forwarding)..."
cat > /etc/sysctl.d/99-omnisync-vpn.conf <<EOF
# Omnisync VPN + Multicast
net.ipv4.ip_forward=1
net.ipv4.conf.all.send_redirects=0
net.ipv4.conf.all.accept_redirects=0
net.ipv4.conf.all.rp_filter=0
net.ipv4.conf.default.rp_filter=0
net.ipv4.conf.all.mc_forwarding=1
net.ipv4.conf.default.mc_forwarding=1
net.ipv4.conf.${PUB_IF}.mc_forwarding=1
net.ipv4.conf.all.proxy_arp=1
EOF
sysctl --system >/dev/null
ok "Kernel configurado"

# ----------------------------------------------------------
# 4) strongSwan (IPsec) con PSK
# ----------------------------------------------------------
log "Configurando strongSwan (IPsec PSK)..."
cat > /etc/ipsec.conf <<EOF
# Omnisync L2TP/IPsec - autogenerado
config setup
  charondebug="ike 1, knl 1, cfg 0"
  uniqueids=no

conn L2TP-PSK
  authby=secret
  pfs=no
  rekey=no
  keyingtries=3
  type=transport
  left=%defaultroute
  leftid=${PUB_IP}
  leftprotoport=17/1701
  right=%any
  rightprotoport=17/%any
  ike=aes256-sha1-modp1024,aes128-sha1-modp1024,3des-sha1-modp1024!
  esp=aes256-sha1,aes128-sha1,3des-sha1!
  auto=add
EOF

cat > /etc/ipsec.secrets <<EOF
${PUB_IP} %any : PSK "${IPSEC_PSK}"
EOF
chmod 600 /etc/ipsec.secrets
ok "strongSwan configurado"

# ----------------------------------------------------------
# 5) xl2tpd (L2TP)
# ----------------------------------------------------------
log "Configurando xl2tpd..."
cat > /etc/xl2tpd/xl2tpd.conf <<EOF
[global]
ipsec saref = yes
saref refinfo = 30
listen-addr = ${PUB_IP}

[lns default]
ip range = ${VPN_POOL_START}-${VPN_POOL_END}
local ip = ${VPN_SERVER_IP}
require chap = yes
refuse pap = yes
require authentication = yes
name = OmnisyncVPN
ppp debug = no
pppoptfile = /etc/ppp/options.xl2tpd
length bit = yes
EOF

cat > /etc/ppp/options.xl2tpd <<EOF
require-mschap-v2
ms-dns 1.1.1.1
ms-dns 8.8.8.8
asyncmap 0
auth
crtscts
lock
hide-password
modem
debug
proxyarp
lcp-echo-interval 30
lcp-echo-failure 4
connect-delay 5000
mtu 1400
mru 1400
EOF

# chap-secrets vacío inicial - el panel lo escribe
cat > /etc/ppp/chap-secrets <<EOF
# Omnisync L2TP users - gestionado por el panel
# user  server  password  ip
EOF
chmod 600 /etc/ppp/chap-secrets
ok "xl2tpd configurado"

# ----------------------------------------------------------
# 6) smcroute (multicast routing daemon)
# ----------------------------------------------------------
log "Configurando smcroute..."
cat > /etc/smcroute.conf <<EOF
# Omnisync multicast routing - autogenerado por el panel
# El panel reescribirá este archivo y recargará smcroute
mgroup from ${PUB_IF} group 239.10.0.0/24
EOF

systemctl enable smcroute >/dev/null 2>&1 || true
ok "smcroute configurado"

# ----------------------------------------------------------
# 7) Firewall (iptables)
# ----------------------------------------------------------
log "Abriendo puertos firewall..."
iptables -I INPUT -p udp --dport 500 -j ACCEPT
iptables -I INPUT -p udp --dport 1701 -j ACCEPT
iptables -I INPUT -p udp --dport 4500 -j ACCEPT
iptables -I INPUT -p esp -j ACCEPT
iptables -I INPUT -p gre -j ACCEPT
iptables -t nat -A POSTROUTING -s ${VPN_NETWORK} -o ${PUB_IF} -j MASQUERADE
iptables -A FORWARD -s ${VPN_NETWORK} -j ACCEPT
iptables -A FORWARD -d ${VPN_NETWORK} -j ACCEPT
# Permitir multicast forwarding
iptables -A FORWARD -d 239.0.0.0/8 -j ACCEPT
netfilter-persistent save >/dev/null 2>&1 || iptables-save > /etc/iptables/rules.v4
ok "Firewall configurado"

# ----------------------------------------------------------
# 8) Permitir al usuario node controlar servicios (sudoers)
# ----------------------------------------------------------
log "Configurando sudoers para que el panel pueda gestionar VPN..."
cat > /etc/sudoers.d/omnisync-vpn <<EOF
# Permite al backend Node.js gestionar VPN sin password
root ALL=(ALL) NOPASSWD: /usr/sbin/ipsec, /usr/sbin/xl2tpd, /usr/bin/smcroute, /usr/sbin/ip, /bin/systemctl, /usr/bin/tee /etc/ppp/chap-secrets, /usr/bin/tee /etc/smcroute.conf
EOF
chmod 440 /etc/sudoers.d/omnisync-vpn
ok "Sudoers configurado"

# ----------------------------------------------------------
# 9) Iniciar servicios
# ----------------------------------------------------------
log "Iniciando servicios..."
systemctl enable strongswan-starter >/dev/null 2>&1 || systemctl enable ipsec >/dev/null 2>&1 || true
systemctl restart strongswan-starter 2>/dev/null || systemctl restart ipsec 2>/dev/null || true
systemctl enable xl2tpd >/dev/null 2>&1
systemctl restart xl2tpd
systemctl restart smcroute 2>/dev/null || true
ok "Servicios activos"

# ----------------------------------------------------------
# 10) Resumen final
# ----------------------------------------------------------
echo ""
echo "================================================================"
echo -e "${GREEN}  ✅ Instalación VPN completada${NC}"
echo "================================================================"
echo ""
echo -e "  IP pública del servidor:   ${CYAN}${PUB_IP}${NC}"
echo -e "  Interfaz pública:          ${CYAN}${PUB_IF}${NC}"
echo -e "  Red interna VPN:           ${CYAN}${VPN_NETWORK}${NC}"
echo -e "  IP servidor en VPN:        ${CYAN}${VPN_SERVER_IP}${NC}"
echo -e "  Pool clientes:             ${CYAN}${VPN_POOL_START} - ${VPN_POOL_END}${NC}"
echo -e "  Red multicast:             ${CYAN}${MCAST_NETWORK}${NC}"
echo ""
echo -e "  ${YELLOW}PSK IPsec (guárdala):${NC}"
echo -e "  ${GREEN}${IPSEC_PSK}${NC}"
echo ""
echo "================================================================"
echo "  Próximos pasos:"
echo "  1) Reinicia el backend Node.js:  pm2 restart streambox"
echo "  2) Entra al panel admin → tab 'VPN Sectores'"
echo "  3) Crea sectores y descarga config .rsc para tus MikroTik"
echo "================================================================"

# Guardar PSK en un archivo que el panel pueda leer
echo "${IPSEC_PSK}" > /etc/omnisync-vpn-psk
chmod 640 /etc/omnisync-vpn-psk
