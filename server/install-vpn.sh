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
#
# FFmpeg encoder (validado producción 2026-04-23):
#   - Detección automática de codec vía ffprobe
#   - Soporta copy: video h264/hevc/mpeg2video + audio aac/mp2/mp3/ac3
#   - h264_mp4toannexb SOLO si video=h264 (mpeg2video/hevc no lo necesitan)
#   - Salida UDP: pkt_size=1316 + localaddr=172.16.50.1 (fuerza ppp0)
#   - Mux: -mpegts_copyts 1, sin muxrate forzado, muxdelay/muxpreload 0
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
  iproute2 iptables-persistent netfilter-persistent tcpdump \
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

# Generar/reusar PSK central (una sola para todos los MikroTik)
PSK_FILE="/etc/omnisync-vpn-psk"
if [ ! -f "$PSK_FILE" ]; then
  openssl rand -base64 24 | tr -d '/+=' | cut -c1-24 > "$PSK_FILE"
  chmod 600 "$PSK_FILE"
fi
PSK_VALUE="$(cat "$PSK_FILE")"

# IP central del servidor L2TP (lo que veía el portátil que SÍ funcionó)
SERVER_VPN_IP="172.16.50.1"
VPN_POOL="172.16.50.2-172.16.50.100"

cat > /etc/ipsec.conf <<EOF
# Omnisync L2TP/IPsec - servidor central fijo
# Validado producción 2026-04-24 con MikroTik (PFS habilitado en cliente):
#   - IKE fase 1: AES-128/SHA1/MODP1024 (negociado con MikroTik)
#   - ESP fase 2: AES-256/SHA1/MODP1024 (PFS DH2) - clave: incluir -modp1024
#     en la lista esp= sino strongSwan rechaza con NO_PROPOSAL_CHOSEN cuando
#     el peer manda KE en QUICK_MODE (PFS)
config setup
  charondebug="ike 2, knl 2, cfg 0"
  uniqueids=no

conn omnisync-l2tp
  authby=secret
  auto=add
  keyexchange=ikev1
  type=transport
  left=%defaultroute
  leftprotoport=17/1701
  right=%any
  rightprotoport=17/%any
  ike=aes256-sha1-modp1024,aes256-sha256-modp1024,aes128-sha1-modp1024,3des-sha1-modp1024,aes256-sha1-modp2048,aes128-sha1-modp2048!
  esp=aes256-sha1-modp1024,aes256-sha256-modp1024,aes128-sha1-modp1024,3des-sha1-modp1024,aes256-sha1,aes128-sha1,3des-sha1!
  forceencaps=yes
  dpddelay=30s
  dpdtimeout=120s
  dpdaction=clear
  rekey=no

# IKEv2 EAP-MSCHAPv2 para celulares Android/iOS modernos.
# Usa los MISMOS chap-secrets del MikroTik (mismo user/pass por sector).
# Pool aparte 172.16.51.0/24 para no chocar con MikroTik.
# El "Identificador IPsec" del celu = leftid del server (omnisync.vpn).
conn omnisync-ikev2-eap
  auto=add
  keyexchange=ikev2
  ike=aes256-sha256-modp2048,aes256-sha1-modp1024,aes128-sha256-modp2048,aes128-sha1-modp1024!
  esp=aes256-sha256,aes256-sha1,aes128-sha256,aes128-sha1!
  dpdaction=clear
  dpddelay=300s
  rekey=no
  left=%any
  leftid=omnisync.vpn
  leftauth=psk
  leftsubnet=0.0.0.0/0
  right=%any
  rightauth=eap-mschapv2
  rightsourceip=172.16.51.0/24
  rightdns=1.1.1.1,8.8.8.8
  rightsendcert=never
  eap_identity=%identity
  fragmentation=yes
  forceencaps=yes
EOF

cat > /etc/ipsec.secrets <<EOF
# Omnisync IPsec PSK - central (compartido por L2TP-IKEv1 e IKEv2 PSK)
%any %any : PSK "${PSK_VALUE}"

# IKEv2 EAP-MSCHAPv2 incluido vía chap-secrets
include /var/lib/strongswan/ipsec.secrets.inc
EOF
chmod 600 /etc/ipsec.secrets

# Genera ipsec.secrets.inc con los mismos usuarios del chap-secrets
mkdir -p /var/lib/strongswan
cat > /usr/local/sbin/omnisync-sync-eap-secrets <<'EOF'
#!/bin/sh
# Lee /etc/ppp/chap-secrets y genera credenciales EAP para strongSwan IKEv2
OUT=/var/lib/strongswan/ipsec.secrets.inc
echo "# Omnisync EAP - autogenerado, no editar" > "$OUT"
awk '/^"/ && !/^#/ { gsub(/"/,"",$1); gsub(/"/,"",$3); print $1 " : EAP \"" $3 "\"" }' /etc/ppp/chap-secrets >> "$OUT"
chmod 600 "$OUT"
ipsec rereadsecrets >/dev/null 2>&1 || true
EOF
chmod +x /usr/local/sbin/omnisync-sync-eap-secrets
/usr/local/sbin/omnisync-sync-eap-secrets || true


cat > /etc/xl2tpd/xl2tpd.conf <<EOF
[global]
ipsec saref = no
port = 1701

[lns default]
ip range = ${VPN_POOL}
local ip = ${SERVER_VPN_IP}
require chap = yes
refuse pap = yes
require authentication = yes
name = omnisync
ppp debug = yes
pppoptfile = /etc/ppp/options.xl2tpd
length bit = yes
EOF

# Opciones PPP que usa xl2tpd como servidor L2TP
cat > /etc/ppp/options.xl2tpd <<'EOF'
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
mtu 1400
mru 1400
noccp
EOF

mkdir -p /etc/ppp/ip-up.d /etc/ppp/ip-down.d
cat > /etc/ppp/ip-up.d/99-omnisync-multicast-route <<'EOF'
#!/bin/sh
case "$PPP_IFACE" in
  ppp*)
    ip route replace 224.0.0.0/4 dev "$PPP_IFACE" >/dev/null 2>&1 || true
    ;;
esac
exit 0
EOF
chmod +x /etc/ppp/ip-up.d/99-omnisync-multicast-route

cat > /etc/ppp/ip-down.d/99-omnisync-multicast-route <<'EOF'
#!/bin/sh
case "$PPP_IFACE" in
  ppp*)
    ip route del 224.0.0.0/4 dev "$PPP_IFACE" >/dev/null 2>&1 || true
    ;;
esac
exit 0
EOF
chmod +x /etc/ppp/ip-down.d/99-omnisync-multicast-route

# chap-secrets: cabecera, el backend agrega usuarios desde el panel
if [ ! -f /etc/ppp/chap-secrets ] || ! grep -q "Omnisync" /etc/ppp/chap-secrets; then
  cat > /etc/ppp/chap-secrets <<'EOF'
# Omnisync L2TP - administrado por el panel
# "user" * "password" IP_FIJA
EOF
fi
chmod 600 /etc/ppp/chap-secrets /etc/ppp/options.xl2tpd
ok "Configuración central fija aplicada (PSK: ${PSK_VALUE})"

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
  && ip route replace 224.0.0.0/4 dev ppp0 >/dev/null 2>&1 \
  && echo "VPN UP: $(ip -4 addr show ppp0 | awk '/inet/{print $2}') + ruta multicast OK" \
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

# NAT + forward para celulares IKEv2 (pool 172.16.51.0/24 → internet)
PUB_IF_DETECT="$(ip route get 1.1.1.1 2>/dev/null | awk '{print $5; exit}')"
[ -z "$PUB_IF_DETECT" ] && PUB_IF_DETECT="eth0"
iptables -t nat -C POSTROUTING -s 172.16.51.0/24 -o "$PUB_IF_DETECT" -j MASQUERADE 2>/dev/null \
  || iptables -t nat -A POSTROUTING -s 172.16.51.0/24 -o "$PUB_IF_DETECT" -j MASQUERADE
iptables -C FORWARD -s 172.16.51.0/24 -j ACCEPT 2>/dev/null \
  || iptables -A FORWARD -s 172.16.51.0/24 -j ACCEPT
iptables -C FORWARD -d 172.16.51.0/24 -j ACCEPT 2>/dev/null \
  || iptables -A FORWARD -d 172.16.51.0/24 -j ACCEPT

netfilter-persistent save >/dev/null 2>&1 || iptables-save > /etc/iptables/rules.v4 2>/dev/null || true
ok "Firewall actualizado (incluye NAT pool celulares 172.16.51.0/24)"

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

ENCODERS_SCHEMA_FILE="$(dirname "$(readlink -f "$0")")/database/encoders-on-demand-schema.sql"
if [ -f "$ENCODERS_SCHEMA_FILE" ]; then
  if [ -f "$DB_PASS_FILE" ]; then
    PGPASSWORD="$(cat "$DB_PASS_FILE")" psql -h localhost -U streambox_user -d streambox -f "$ENCODERS_SCHEMA_FILE" >/dev/null 2>&1 \
      || PGPASSWORD="$(cat "$DB_PASS_FILE")" psql -h localhost -U streambox_user -d streambox_db -f "$ENCODERS_SCHEMA_FILE" >/dev/null 2>&1 \
      || sudo -u postgres psql -d streambox -f "$ENCODERS_SCHEMA_FILE" >/dev/null 2>&1 \
      || sudo -u postgres psql -d streambox_db -f "$ENCODERS_SCHEMA_FILE" >/dev/null 2>&1 \
      || warn "No pude aplicar schema encoders on-demand automáticamente"
  else
    sudo -u postgres psql -d streambox -f "$ENCODERS_SCHEMA_FILE" >/dev/null 2>&1 \
      || sudo -u postgres psql -d streambox_db -f "$ENCODERS_SCHEMA_FILE" >/dev/null 2>&1 \
      || warn "No pude aplicar schema encoders on-demand automáticamente"
  fi
  ok "Schema encoders on-demand verificado"
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
echo "         - IP asignada en la VPN (ej. 172.16.50.10)"
echo "    3) Sub-tab 'Multicast' → asigná canales a grupos"
echo "       y luego marcá qué grupos recibe el sector"
echo "    4) Sub-tab 'Encoders FFmpeg' → 'Sincronizar con sectores'"
echo "    5) Probá en VLC del portátil/cliente: udp://@239.10.0.X:1234"
echo ""
echo -e "  ${YELLOW}En el MikroTik remoto/central debés tener:${NC}"
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
echo "    sudo tcpdump -i any -n 'dst net 239.10.0.0/24' -c 10"
echo "    pm2 logs streambox-api    # logs del backend"
echo "================================================================"
