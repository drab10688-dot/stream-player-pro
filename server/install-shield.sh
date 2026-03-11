#!/bin/bash
# =============================================
# OMNISYNC SHIELD - Instalador para Xtream UI
# Instala un proxy con Cloudflare Tunnel junto a Xtream UI
# NO modifica Xtream UI — es un servicio independiente
# =============================================

set -e

# Colors
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; NC='\033[0m'
log_info() { echo -e "${CYAN}[INFO]${NC} $1"; }
log_ok() { echo -e "${GREEN}[OK]${NC} $1"; }
log_warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; }

echo ""
echo -e "${CYAN}╔══════════════════════════════════════════════╗${NC}"
echo -e "${CYAN}║      OMNISYNC SHIELD - Proxy Xtream UI       ║${NC}"
echo -e "${CYAN}║   Oculta tu IP con Cloudflare Tunnel          ║${NC}"
echo -e "${CYAN}╚══════════════════════════════════════════════╝${NC}"
echo ""

# Must be root
if [ "$EUID" -ne 0 ]; then
  log_error "Ejecuta como root: sudo bash install-shield.sh"
  exit 1
fi

# =============================================
# CONFIGURATION
# =============================================
SHIELD_PORT=${SHIELD_PORT:-3002}
NGINX_PORT=${NGINX_PORT:-8880}
INSTALL_DIR="/opt/omnisync-shield"
WEB_DIR="/var/www/omnisync-shield"
PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"

# Detect Xtream UI
XTREAM_HOST="http://localhost"
XTREAM_PORT="25461"

log_info "Detectando Xtream UI..."
if curl -s "http://localhost:25461/player_api.php" -o /dev/null 2>/dev/null; then
  log_ok "Xtream UI detectado en localhost:25461"
elif curl -s "http://localhost:80/player_api.php" -o /dev/null 2>/dev/null; then
  XTREAM_PORT="80"
  log_ok "Xtream UI detectado en localhost:80"
else
  log_warn "Xtream UI no detectado automáticamente"
  read -p "Puerto de Xtream UI [25461]: " custom_port
  XTREAM_PORT=${custom_port:-25461}
fi

# =============================================
# ADMIN CREDENTIALS
# =============================================
echo ""
read -p "Email admin: " ADMIN_EMAIL
read -sp "Contraseña admin: " ADMIN_PASS
echo ""

if [ -z "$ADMIN_EMAIL" ] || [ -z "$ADMIN_PASS" ]; then
  log_error "Email y contraseña son requeridos"
  exit 1
fi

JWT_SECRET=$(openssl rand -hex 32)

# =============================================
# INSTALL DEPENDENCIES
# =============================================
log_info "Instalando dependencias del sistema..."
apt-get update -qq
apt-get install -y -qq nginx curl git > /dev/null 2>&1

# Node.js 20
if ! command -v node &> /dev/null || [ $(node -v | cut -d. -f1 | tr -d 'v') -lt 20 ]; then
  log_info "Instalando Node.js 20..."
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash - > /dev/null 2>&1
  apt-get install -y -qq nodejs > /dev/null 2>&1
fi
log_ok "Node.js $(node -v)"

# PM2
if ! command -v pm2 &> /dev/null; then
  npm install -g pm2 > /dev/null 2>&1
fi
log_ok "PM2 instalado"

# Cloudflared
if ! command -v cloudflared &> /dev/null; then
  log_info "Instalando cloudflared..."
  ARCH=$(dpkg --print-architecture)
  if [ "$ARCH" = "amd64" ]; then
    curl -fsSL -o /tmp/cloudflared.deb https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64.deb
  elif [ "$ARCH" = "arm64" ]; then
    curl -fsSL -o /tmp/cloudflared.deb https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-arm64.deb
  else
    log_error "Arquitectura no soportada: $ARCH"
    exit 1
  fi
  dpkg -i /tmp/cloudflared.deb > /dev/null 2>&1
  rm -f /tmp/cloudflared.deb
fi
log_ok "cloudflared $(cloudflared --version 2>&1 | head -1)"

# =============================================
# BUILD FRONTEND
# =============================================
log_info "Construyendo frontend..."
cd "$PROJECT_DIR"
npm install --legacy-peer-deps > /dev/null 2>&1

if npm run build > /dev/null 2>&1; then
  log_ok "Frontend compilado"
elif npx vite build > /dev/null 2>&1; then
  log_ok "Frontend compilado (vite directo)"
else
  log_error "Error compilando frontend"
  exit 1
fi

mkdir -p "$WEB_DIR"
cp -r dist/* "$WEB_DIR/"
log_ok "Frontend desplegado en $WEB_DIR"

# =============================================
# SETUP PROXY SERVER
# =============================================
log_info "Configurando proxy server..."
mkdir -p "$INSTALL_DIR"
cp "$PROJECT_DIR/server/shield-proxy.js" "$INSTALL_DIR/proxy.js"
cp "$PROJECT_DIR/server/package.json" "$INSTALL_DIR/package.json" 2>/dev/null || true

cd "$INSTALL_DIR"
npm install express cors > /dev/null 2>&1

# =============================================
# NGINX CONFIG
# =============================================
log_info "Configurando Nginx..."
cat > /etc/nginx/sites-available/omnisync-shield << NGINX_EOF
server {
    listen ${NGINX_PORT};
    server_name _;
    root ${WEB_DIR};
    index index.html;

    # Frontend SPA
    location / {
        try_files \$uri \$uri/ /index.html;
    }

    # API proxy
    location /api/ {
        proxy_pass http://127.0.0.1:${SHIELD_PORT};
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Host \$host;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_connect_timeout 300;
        proxy_send_timeout 300;
        proxy_read_timeout 300;
        proxy_buffering off;
    }

    # Xtream Codes endpoints (proxy transparente)
    location = /player_api.php {
        proxy_pass http://127.0.0.1:${SHIELD_PORT};
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-Host \$host;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }

    location = /get.php {
        proxy_pass http://127.0.0.1:${SHIELD_PORT};
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-Host \$host;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }

    location = /xmltv.php {
        proxy_pass http://127.0.0.1:${SHIELD_PORT};
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-Host \$host;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }

    location /live/ {
        proxy_pass http://127.0.0.1:${SHIELD_PORT};
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-Host \$host;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_connect_timeout 300;
        proxy_send_timeout 300;
        proxy_read_timeout 300;
        proxy_buffering off;
    }

    # Security headers
    proxy_hide_header X-Powered-By;
    proxy_hide_header Server;
    add_header X-Content-Type-Options nosniff always;
    add_header X-Frame-Options SAMEORIGIN always;
    add_header Referrer-Policy strict-origin-when-cross-origin always;
}
NGINX_EOF

ln -sf /etc/nginx/sites-available/omnisync-shield /etc/nginx/sites-enabled/
nginx -t > /dev/null 2>&1 && systemctl reload nginx
log_ok "Nginx configurado en puerto $NGINX_PORT"

# =============================================
# START PROXY
# =============================================
log_info "Iniciando proxy..."
pm2 delete omnisync-shield 2>/dev/null || true
cd "$INSTALL_DIR"
PORT=$SHIELD_PORT \
JWT_SECRET=$JWT_SECRET \
ADMIN_EMAIL=$ADMIN_EMAIL \
ADMIN_PASS=$ADMIN_PASS \
XTREAM_HOST=$XTREAM_HOST \
XTREAM_PORT=$XTREAM_PORT \
NGINX_PORT=$NGINX_PORT \
pm2 start proxy.js --name omnisync-shield --update-env

pm2 save > /dev/null 2>&1
pm2 startup > /dev/null 2>&1 || true

# Wait and check health
sleep 3
if curl -s "http://localhost:${SHIELD_PORT}/api/health" | grep -q "ok"; then
  log_ok "Proxy activo y saludable"
else
  log_warn "El proxy podría tardar unos segundos en iniciar"
fi

# UFW
if command -v ufw &> /dev/null; then
  ufw allow $NGINX_PORT/tcp > /dev/null 2>&1
fi

# =============================================
# SERVER IP
# =============================================
SERVER_IP=$(curl -s -4 ifconfig.me 2>/dev/null || hostname -I | awk '{print $1}')

echo ""
echo -e "${GREEN}╔══════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║     ✅ OMNISYNC SHIELD INSTALADO              ║${NC}"
echo -e "${GREEN}╚══════════════════════════════════════════════╝${NC}"
echo ""
echo -e "  Panel Admin:  ${CYAN}http://${SERVER_IP}:${NGINX_PORT}/admin${NC}"
echo -e "  Email:        ${CYAN}${ADMIN_EMAIL}${NC}"
echo ""
echo -e "  ${YELLOW}Siguiente paso:${NC} Inicia el túnel Cloudflare desde el panel"
echo -e "  para generar una URL pública con HTTPS y IP oculta."
echo ""
echo -e "  Xtream UI:    ${CYAN}${XTREAM_HOST}:${XTREAM_PORT}${NC}"
echo -e "  Proxy Port:   ${CYAN}${SHIELD_PORT}${NC}"
echo -e "  Nginx Port:   ${CYAN}${NGINX_PORT}${NC}"
echo ""
echo -e "  ${YELLOW}Comandos útiles:${NC}"
echo -e "  pm2 logs omnisync-shield   # Ver logs"
echo -e "  pm2 restart omnisync-shield # Reiniciar"
echo ""
