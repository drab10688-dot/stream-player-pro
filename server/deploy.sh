#!/bin/bash
# ============================================================
# Omnisync - Deploy / actualización rápida del VPS
# Uso: sudo bash /opt/streambox/server/deploy.sh
#
# Hace en orden:
#   1) git pull (baja cambios de Lovable/GitHub)
#   2) npm install backend
#   3) npm install + build frontend y copia a /var/www/streambox
#   4) Instala VPN si no estaba (idempotente)
#   5) pm2 restart streambox-api
#   6) Verifica health endpoint
# ============================================================

set -e

CYAN='\033[0;36m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; NC='\033[0m'
log()  { echo -e "${CYAN}[DEPLOY]${NC} $1"; }
ok()   { echo -e "${GREEN}[OK]${NC} $1"; }
warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
err()  { echo -e "${RED}[ERROR]${NC} $1"; }

if [ "$EUID" -ne 0 ]; then
  err "Ejecuta como root: sudo bash deploy.sh"
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
DB_PASS_FILE="/etc/omnisync-db-pass"

cd "$PROJECT_DIR"

# 1) git pull
log "🔄 Bajando últimos cambios desde Git..."
if [ -d "$PROJECT_DIR/.git" ]; then
  git stash > /dev/null 2>&1 || true
  if git pull origin main > /dev/null 2>&1 || git pull origin master > /dev/null 2>&1; then
    ok "Código actualizado"
  else
    warn "git pull falló (sin red o sin remote). Continuando con código local."
  fi
else
  warn "No es repo Git. Saltando pull."
fi

# 2) npm install backend
cd "$SCRIPT_DIR"
if [ -f package.json ]; then
  log "📦 Verificando dependencias npm..."
  npm install --production --silent 2>&1 | tail -3 || true
  ok "Dependencias OK"
fi

# 2.5) Recompilar y publicar frontend del panel
if [ -f "$PROJECT_DIR/package.json" ]; then
  FRONT_NPM_LOG="/tmp/omnisync-frontend-npm.log"
  FRONT_BUILD_LOG="/tmp/omnisync-frontend-build.log"

  log "🧱 Actualizando dependencias del panel..."
  if npm --prefix "$PROJECT_DIR" install --legacy-peer-deps --silent > "$FRONT_NPM_LOG" 2>&1; then
    ok "Dependencias del panel OK"
  else
    tail -20 "$FRONT_NPM_LOG" 2>/dev/null || true
    err "Falló npm install del panel"
    exit 1
  fi

  log "🎛️ Compilando y publicando panel web..."
  if npm --prefix "$PROJECT_DIR" run build > "$FRONT_BUILD_LOG" 2>&1; then
    mkdir -p /var/www/streambox
    rm -rf /var/www/streambox/*
    cp -r "$PROJECT_DIR"/dist/* /var/www/streambox/
    ok "Panel actualizado en /var/www/streambox"
  else
    tail -20 "$FRONT_BUILD_LOG" 2>/dev/null || true
    err "Falló la compilación del panel"
    exit 1
  fi
fi

# 3) Instalar VPN si no estaba
if [ ! -f /etc/omnisync-vpn-psk ] || ! systemctl is-active --quiet xl2tpd 2>/dev/null; then
  log "🔐 VPN no detectada. Instalando módulo L2TP/IPsec..."
  if [ -f "$SCRIPT_DIR/install-vpn.sh" ]; then
    bash "$SCRIPT_DIR/install-vpn.sh" || warn "install-vpn.sh tuvo errores"
  else
    warn "install-vpn.sh no existe en $SCRIPT_DIR"
  fi
else
  ok "VPN ya está activa"
fi

# 4) Restaurar password DB si está cacheada (workaround git pull pisa .env)
if [ -f "$DB_PASS_FILE" ] && [ -f "$SCRIPT_DIR/.env" ]; then
  DB_PASS=$(cat "$DB_PASS_FILE")
  sed -i "s|^DB_PASSWORD=.*|DB_PASSWORD=${DB_PASS}|" "$SCRIPT_DIR/.env" 2>/dev/null || true
fi

# 4.5) Aplicar schema VPN (idempotente, crea tablas nuevas si faltan)
VPN_SCHEMA="$SCRIPT_DIR/database/vpn-schema.sql"
if [ -f "$VPN_SCHEMA" ]; then
  log "🗄️  Aplicando schema VPN (idempotente)..."
  APPLIED=false
  if [ -f "$DB_PASS_FILE" ]; then
    DB_PASS=$(cat "$DB_PASS_FILE")
    for DBNAME in streambox streambox_db; do
      if PGPASSWORD="$DB_PASS" psql -h localhost -U streambox_user -d "$DBNAME" -f "$VPN_SCHEMA" >/dev/null 2>&1; then
        ok "Schema VPN aplicado en $DBNAME"
        APPLIED=true
        break
      fi
    done
  fi
  if [ "$APPLIED" = false ]; then
    for DBNAME in streambox streambox_db; do
      if sudo -u postgres psql -d "$DBNAME" -f "$VPN_SCHEMA" >/dev/null 2>&1; then
        ok "Schema VPN aplicado en $DBNAME (vía postgres)"
        APPLIED=true
        break
      fi
    done
  fi
  [ "$APPLIED" = false ] && warn "No se pudo aplicar vpn-schema.sql automáticamente"
fi

# 4.7) Tuning sysctl multicast (anti-pixelado, validado producción)
log "⚙️  Aplicando tuning sysctl multicast..."
sysctl -w net.core.wmem_max=26214400 >/dev/null 2>&1 || true
sysctl -w net.core.wmem_default=26214400 >/dev/null 2>&1 || true
if ! grep -q "wmem_max=26214400" /etc/sysctl.conf 2>/dev/null; then
  echo "net.core.wmem_max=26214400"     >> /etc/sysctl.conf
  echo "net.core.wmem_default=26214400" >> /etc/sysctl.conf
fi
ok "Tuning sysctl aplicado"

# 4.8) Matar encoders FFmpeg viejos para que tomen los nuevos parámetros
log "🔪 Reiniciando encoders FFmpeg activos (tomarán nuevos parámetros)..."
pkill -f "ffmpeg.*udp://239" 2>/dev/null || true
sleep 1
ok "Encoders reiniciados (se relanzarán automáticamente bajo demanda)"

# 5) Restart PM2
log "♻️  Reiniciando streambox-api..."
pm2 restart streambox-api > /dev/null 2>&1 || pm2 start "$SCRIPT_DIR/index.js" --name streambox-api
sleep 2

# 6) Health check
log "🏥 Verificando health endpoint..."
PORT=$(grep -E "^PORT=" "$SCRIPT_DIR/.env" 2>/dev/null | cut -d= -f2 || echo "3001")
if curl -sf "http://localhost:${PORT}/api/health" > /dev/null; then
  ok "API respondiendo en puerto $PORT"
else
  err "API no responde. Revisa: pm2 logs streambox-api"
  exit 1
fi

echo ""
echo -e "${GREEN}╔══════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║   ✅ Deploy completo                       ║${NC}"
echo -e "${GREEN}╚══════════════════════════════════════════╝${NC}"
echo ""
echo "Comandos útiles:"
echo "  pm2 logs streambox-api      → Ver logs"
echo "  curl http://localhost:${PORT}/api/health"
echo "  sudo ipsec statusall         → Ver túneles VPN"
