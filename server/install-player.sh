#!/bin/bash
# =============================================
# 🎬 Omnisync Player + Cloudflare Tunnel
# Instalador para servidores con Xtream UI
# NO toca nada de Xtream UI
# =============================================

set -e

# Colores
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

log_info() { echo -e "${CYAN}[INFO]${NC} $1"; }
log_ok() { echo -e "${GREEN}[OK]${NC} $1"; }
log_warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; }

# Verificar root
if [ "$EUID" -ne 0 ]; then
  log_error "Ejecuta como root: sudo bash install-player.sh"
  exit 1
fi

echo ""
echo -e "${CYAN}╔═══════════════════════════════════════════╗${NC}"
echo -e "${CYAN}║  🎬 Omnisync Player + Cloudflare Tunnel   ║${NC}"
echo -e "${CYAN}║  Para servidores con Xtream UI            ║${NC}"
echo -e "${CYAN}╚═══════════════════════════════════════════╝${NC}"
echo ""

# =============================================
# VERIFICAR QUE XTREAM UI ESTÁ INSTALADO
# =============================================
log_info "Verificando Xtream UI..."
if curl -s -o /dev/null -w "%{http_code}" http://localhost/player_api.php 2>/dev/null | grep -q "200\|403\|401"; then
  log_ok "Xtream UI detectado en puerto 80"
else
  log_warn "No se detectó Xtream UI en puerto 80"
  read -p "¿Continuar de todos modos? (s/n): " CONTINUE
  if [ "$CONTINUE" != "s" ]; then
    exit 1
  fi
fi

# =============================================
# CONFIGURACIÓN
# =============================================
BRIDGE_PORT=3002
NGINX_PORT=8080
INSTALL_DIR="/opt/omnisync-player"
WEB_DIR="/var/www/omnisync-player"
PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"

log_info "Puerto del reproductor: ${NGINX_PORT}"
log_info "Puerto del bridge API: ${BRIDGE_PORT}"
log_info "Directorio del proyecto: ${PROJECT_DIR}"

# =============================================
# INSTALAR NODE.JS SI NO EXISTE
# =============================================
if ! command -v node &> /dev/null; then
  log_info "Instalando Node.js 20..."
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt install -y nodejs
  log_ok "Node.js $(node -v) instalado"
else
  log_ok "Node.js $(node -v) ya instalado"
fi

# Instalar PM2 si no existe
if ! command -v pm2 &> /dev/null; then
  log_info "Instalando PM2..."
  npm install -g pm2
  log_ok "PM2 instalado"
else
  log_ok "PM2 ya instalado"
fi

# =============================================
# INSTALAR CLOUDFLARED SI NO EXISTE
# =============================================
if ! command -v cloudflared &> /dev/null; then
  log_info "Instalando Cloudflare Tunnel..."
  
  # Detectar arquitectura
  ARCH=$(dpkg --print-architecture)
  if [ "$ARCH" = "amd64" ]; then
    CFURL="https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64.deb"
  elif [ "$ARCH" = "arm64" ]; then
    CFURL="https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-arm64.deb"
  else
    log_error "Arquitectura $ARCH no soportada para cloudflared"
    exit 1
  fi
  
  wget -q "$CFURL" -O /tmp/cloudflared.deb
  dpkg -i /tmp/cloudflared.deb
  rm /tmp/cloudflared.deb
  log_ok "Cloudflared $(cloudflared --version 2>&1 | head -1) instalado"
else
  log_ok "Cloudflared ya instalado"
fi

# =============================================
# COMPILAR FRONTEND
# =============================================
log_info "Compilando reproductor web..."
cd "$PROJECT_DIR"

# Instalar dependencias si no existen
if [ ! -d "node_modules" ]; then
  log_info "Instalando dependencias npm..."
  npm install
fi

# Compilar
if npm run build 2>&1; then
  log_ok "Frontend compilado"
elif npx vite build 2>&1; then
  log_ok "Frontend compilado con vite"
else
  log_error "Error compilando frontend. Revisa los errores arriba."
  exit 1
fi

# Verificar que dist existe
if [ ! -f "dist/index.html" ]; then
  log_error "No se generó dist/index.html"
  exit 1
fi

# Copiar al directorio web
mkdir -p "$WEB_DIR"
cp -r dist/* "$WEB_DIR/"
chown -R www-data:www-data "$WEB_DIR"
chmod -R 755 "$WEB_DIR"
log_ok "Frontend copiado a $WEB_DIR"

# =============================================
# INSTALAR BRIDGE API
# =============================================
log_info "Configurando bridge API..."
mkdir -p "$INSTALL_DIR"
cp "$PROJECT_DIR/server/xtream-bridge.js" "$INSTALL_DIR/bridge.js"
cp "$PROJECT_DIR/server/package.json" "$INSTALL_DIR/package.json"

cd "$INSTALL_DIR"
npm install express cors 2>&1
log_ok "Bridge API configurado en $INSTALL_DIR"

# =============================================
# CONFIGURAR NGINX
# =============================================
log_info "Configurando Nginx en puerto $NGINX_PORT..."

# Crear config con el puerto correcto
cat > /etc/nginx/sites-available/omnisync-player << NGINX_EOF
server {
    listen ${NGINX_PORT};
    server_name _;
    server_tokens off;

    root ${WEB_DIR};
    index index.html;

    location / {
        try_files \$uri \$uri/ /index.html;
    }

    location /api/ {
        proxy_pass http://127.0.0.1:${BRIDGE_PORT};
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host \$host;
        proxy_set_header X-Forwarded-Host \$host;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_cache_bypass \$http_upgrade;
        proxy_connect_timeout 1800;
        proxy_send_timeout 1800;
        proxy_read_timeout 1800;
        proxy_buffering off;
    }

    proxy_hide_header X-Powered-By;
    proxy_hide_header Server;
    add_header X-Content-Type-Options nosniff always;
    add_header X-Frame-Options SAMEORIGIN always;

    location ~ /\. { deny all; }
}
NGINX_EOF

# Habilitar sitio sin desactivar los de Xtream UI
ln -sf /etc/nginx/sites-available/omnisync-player /etc/nginx/sites-enabled/

# Verificar config de Nginx
if nginx -t 2>&1; then
  systemctl reload nginx
  log_ok "Nginx configurado en puerto $NGINX_PORT"
else
  log_error "Error en configuración de Nginx"
  exit 1
fi

# Abrir puerto en firewall
if command -v ufw &> /dev/null; then
  ufw allow $NGINX_PORT/tcp 2>/dev/null || true
  log_ok "Puerto $NGINX_PORT abierto en firewall"
fi

# =============================================
# INICIAR BRIDGE CON PM2
# =============================================
log_info "Iniciando bridge API..."

# Detener si ya existía
pm2 delete omnisync-bridge 2>/dev/null || true

# Iniciar con variables de entorno
BRIDGE_PORT=$BRIDGE_PORT XTREAM_HOST=http://localhost XTREAM_PORT=80 \
  pm2 start "$INSTALL_DIR/bridge.js" --name omnisync-bridge \
  --env BRIDGE_PORT=$BRIDGE_PORT \
  --env XTREAM_HOST=http://localhost \
  --env XTREAM_PORT=80

pm2 save
pm2 startup 2>/dev/null || true
log_ok "Bridge API corriendo en puerto $BRIDGE_PORT"

# =============================================
# VERIFICAR QUE TODO FUNCIONA
# =============================================
log_info "Verificando instalación..."
sleep 3

# Verificar bridge
if curl -s http://localhost:$BRIDGE_PORT/api/health | grep -q '"status":"ok"'; then
  log_ok "Bridge API respondiendo"
else
  log_warn "Bridge API no responde aún, puede tardar unos segundos"
fi

# Verificar Nginx
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:$NGINX_PORT/ 2>/dev/null)
if [ "$HTTP_CODE" = "200" ]; then
  log_ok "Reproductor web accesible"
else
  log_warn "Reproductor devuelve HTTP $HTTP_CODE"
fi

# =============================================
# OBTENER IP DEL SERVIDOR
# =============================================
SERVER_IP=$(hostname -I | awk '{print $1}')

echo ""
echo -e "${GREEN}╔═══════════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║         🎉 INSTALACIÓN COMPLETADA                ║${NC}"
echo -e "${GREEN}╠═══════════════════════════════════════════════════╣${NC}"
echo -e "${GREEN}║                                                   ║${NC}"
echo -e "${GREEN}║  📺 Reproductor: http://${SERVER_IP}:${NGINX_PORT}         ${NC}"
echo -e "${GREEN}║  🔧 Xtream UI:   http://${SERVER_IP}:25500        ${NC}"
echo -e "${GREEN}║                                                   ║${NC}"
echo -e "${GREEN}╠═══════════════════════════════════════════════════╣${NC}"
echo -e "${GREEN}║  🌐 CLOUDFLARE TUNNEL (gratis):                  ║${NC}"
echo -e "${GREEN}║                                                   ║${NC}"
echo -e "${GREEN}║  Ejecuta este comando para crear un túnel:       ║${NC}"
echo -e "${GREEN}║                                                   ║${NC}"
echo -e "${GREEN}║  cloudflared tunnel --url http://localhost:${NGINX_PORT}   ${NC}"
echo -e "${GREEN}║                                                   ║${NC}"
echo -e "${GREEN}║  Te dará una URL como:                            ║${NC}"
echo -e "${GREEN}║  https://xxxxx.trycloudflare.com                  ║${NC}"
echo -e "${GREEN}║                                                   ║${NC}"
echo -e "${GREEN}║  ¡Comparte esa URL con tus clientes!             ║${NC}"
echo -e "${GREEN}║                                                   ║${NC}"
echo -e "${GREEN}╠═══════════════════════════════════════════════════╣${NC}"
echo -e "${GREEN}║  📋 COMANDOS ÚTILES:                             ║${NC}"
echo -e "${GREEN}║  pm2 logs omnisync-bridge  — Ver logs            ║${NC}"
echo -e "${GREEN}║  pm2 restart omnisync-bridge — Reiniciar         ║${NC}"
echo -e "${GREEN}╚═══════════════════════════════════════════════════╝${NC}"
echo ""
