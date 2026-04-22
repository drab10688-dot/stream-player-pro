#!/bin/bash
# ============================================================
# Omnisync - Deploy / actualización rápida del VPS
# Uso: sudo bash /opt/streambox/server/deploy.sh
#
# Hace en orden:
#   1) git pull (baja cambios de Lovable/GitHub)
#   2) npm install --production (si package.json cambió)
#   3) Instala VPN si no estaba (idempotente)
#   4) pm2 restart streambox-api
#   5) Verifica health endpoint
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

# 2) npm install si hace falta
cd "$SCRIPT_DIR"
if [ -f package.json ]; then
  log "📦 Verificando dependencias npm..."
  npm install --production --silent 2>&1 | tail -3 || true
  ok "Dependencias OK"
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
if [ -f "$VPN_SCHEMA" ] && [ -f "$DB_PASS_FILE" ]; then
  log "🗄️  Aplicando schema VPN (idempotente)..."
  DB_PASS=$(cat "$DB_PASS_FILE")
  if PGPASSWORD="$DB_PASS" psql -h localhost -U streambox_user -d streambox_db -f "$VPN_SCHEMA" >/dev/null 2>&1; then
    ok "Schema VPN aplicado"
  else
    warn "No se pudo aplicar vpn-schema.sql automáticamente"
  fi
fi

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
