#!/bin/bash
# =============================================
# StreamBox - Script de Desinstalación Completa
# Ejecutar con: sudo bash server/uninstall.sh
# =============================================

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo -e "${RED}"
echo "╔══════════════════════════════════════════╗"
echo "║   DESINSTALACIÓN DE STREAMBOX            ║"
echo "║   ⚠️  ESTO ELIMINARÁ TODO               ║"
echo "╚══════════════════════════════════════════╝"
echo -e "${NC}"

read -p "¿Estás seguro que deseas desinstalar TODO? (escribe 'SI' para confirmar): " CONFIRM
if [ "$CONFIRM" != "SI" ]; then
  echo -e "${YELLOW}Cancelado.${NC}"
  exit 0
fi

echo ""
echo -e "${YELLOW}[1/5] Deteniendo servicio PM2...${NC}"
if command -v pm2 &> /dev/null; then
  pm2 delete streambox-api 2>/dev/null || true
  pm2 save --force 2>/dev/null || true
  echo -e "${GREEN}  ✓ Servicio PM2 eliminado${NC}"
else
  echo "  - PM2 no encontrado, saltando..."
fi

echo -e "${YELLOW}[2/5] Eliminando base de datos PostgreSQL...${NC}"
if command -v psql &> /dev/null; then
  sudo -u postgres psql -c "DROP DATABASE IF EXISTS streambox;" 2>/dev/null || true
  sudo -u postgres psql -c "DROP USER IF EXISTS streambox_user;" 2>/dev/null || true
  echo -e "${GREEN}  ✓ Base de datos y usuario eliminados${NC}"
else
  echo "  - PostgreSQL no encontrado, saltando..."
fi

echo -e "${YELLOW}[3/5] Eliminando archivos de la aplicación...${NC}"
if [ -d "/opt/streambox" ]; then
  rm -rf /opt/streambox
  echo -e "${GREEN}  ✓ /opt/streambox eliminado${NC}"
else
  echo "  - /opt/streambox no existe"
fi

if [ -d "/var/www/streambox" ]; then
  rm -rf /var/www/streambox
  echo -e "${GREEN}  ✓ /var/www/streambox eliminado${NC}"
else
  echo "  - /var/www/streambox no existe"
fi

echo -e "${YELLOW}[4/5] Eliminando configuración de Nginx...${NC}"
if [ -f "/etc/nginx/sites-enabled/streambox.conf" ]; then
  rm -f /etc/nginx/sites-enabled/streambox.conf
  echo -e "${GREEN}  ✓ Symlink de Nginx eliminado${NC}"
fi
if [ -f "/etc/nginx/sites-available/streambox.conf" ]; then
  rm -f /etc/nginx/sites-available/streambox.conf
  echo -e "${GREEN}  ✓ Configuración de Nginx eliminada${NC}"
fi
# Recargar Nginx si está activo
if systemctl is-active --quiet nginx 2>/dev/null; then
  nginx -t 2>/dev/null && systemctl reload nginx
  echo -e "${GREEN}  ✓ Nginx recargado${NC}"
fi

echo -e "${YELLOW}[5/5] Limpieza final...${NC}"
# Eliminar logs si existen
rm -f /var/log/streambox*.log 2>/dev/null || true
echo -e "${GREEN}  ✓ Logs eliminados${NC}"

echo ""
echo -e "${GREEN}╔══════════════════════════════════════════╗"
echo "║   ✅ DESINSTALACIÓN COMPLETADA            ║"
echo "║                                            ║"
echo "║   Se eliminaron:                           ║"
echo "║   • Servicio PM2 (streambox-api)           ║"
echo "║   • Base de datos PostgreSQL (streambox)   ║"
echo "║   • Archivos en /opt/streambox             ║"
echo "║   • Frontend en /var/www/streambox         ║"
echo "║   • Configuración de Nginx                 ║"
echo "║                                            ║"
echo "║   Node.js, PM2, Nginx y PostgreSQL         ║"
echo "║   NO fueron desinstalados (uso compartido) ║"
echo "╚══════════════════════════════════════════╝"
echo -e "${NC}"
