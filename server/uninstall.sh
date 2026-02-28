#!/bin/bash
# =============================================
# Omnisync - Desinstalación Completa
# Ejecutar con: sudo bash uninstall.sh
# =============================================

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

echo -e "${RED}"
echo "╔══════════════════════════════════════════╗"
echo "║   DESINSTALACIÓN DE OMNISYNC             ║"
echo "║   ⚠️  ESTO ELIMINARÁ TODO               ║"
echo "╚══════════════════════════════════════════╝"
echo -e "${NC}"

read -p "¿Estás seguro que deseas desinstalar TODO? (escribe 'SI' para confirmar): " CONFIRM
if [ "$CONFIRM" != "SI" ]; then
  echo -e "${YELLOW}Cancelado.${NC}"
  exit 0
fi

echo ""

# =============================================
# 1. Detener y eliminar PM2
# =============================================
echo -e "${YELLOW}[1/6] Deteniendo servicios PM2...${NC}"
if command -v pm2 &> /dev/null; then
  pm2 delete streambox-api 2>/dev/null || true
  pm2 delete omnisync-api 2>/dev/null || true
  pm2 save --force 2>/dev/null || true
  echo -e "${GREEN}  ✓ Servicios PM2 eliminados${NC}"
else
  echo "  - PM2 no encontrado, saltando..."
fi

# =============================================
# 2. Liberar puertos ocupados por la app
# =============================================
echo -e "${YELLOW}[2/6] Liberando puertos...${NC}"
# Matar cualquier proceso en el puerto 3001 (API)
PID_3001=$(lsof -ti :3001 2>/dev/null)
if [ -n "$PID_3001" ]; then
  kill -9 $PID_3001 2>/dev/null || true
  echo -e "${GREEN}  ✓ Puerto 3001 liberado (PID: $PID_3001)${NC}"
else
  echo "  - Puerto 3001 ya libre"
fi

# =============================================
# 3. Base de datos PostgreSQL
# =============================================
echo -e "${YELLOW}[3/6] Eliminando base de datos PostgreSQL...${NC}"
if command -v psql &> /dev/null; then
  # Forzar desconexión de sesiones activas
  sudo -u postgres psql -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = 'streambox' AND pid <> pg_backend_pid();" 2>/dev/null || true
  sudo -u postgres psql -c "DROP DATABASE IF EXISTS streambox;" 2>/dev/null || true
  sudo -u postgres psql -c "DROP USER IF EXISTS streambox_user;" 2>/dev/null || true
  echo -e "${GREEN}  ✓ Base de datos y usuario eliminados${NC}"
else
  echo "  - PostgreSQL no encontrado, saltando..."
fi

# =============================================
# 4. Archivos de la aplicación
# =============================================
echo -e "${YELLOW}[4/6] Eliminando archivos de la aplicación...${NC}"
for DIR in /opt/streambox /var/www/streambox; do
  if [ -d "$DIR" ]; then
    rm -rf "$DIR"
    echo -e "${GREEN}  ✓ $DIR eliminado${NC}"
  fi
done

# =============================================
# 5. Nginx
# =============================================
echo -e "${YELLOW}[5/6] Eliminando configuración de Nginx...${NC}"
rm -f /etc/nginx/sites-enabled/streambox 2>/dev/null || true
rm -f /etc/nginx/sites-enabled/streambox.conf 2>/dev/null || true
rm -f /etc/nginx/sites-available/streambox 2>/dev/null || true
rm -f /etc/nginx/sites-available/streambox.conf 2>/dev/null || true

# Restaurar default si existe
if [ -f /etc/nginx/sites-available/default ] && [ ! -f /etc/nginx/sites-enabled/default ]; then
  ln -sf /etc/nginx/sites-available/default /etc/nginx/sites-enabled/default
fi

if systemctl is-active --quiet nginx 2>/dev/null; then
  nginx -t 2>/dev/null && systemctl reload nginx
  echo -e "${GREEN}  ✓ Nginx restaurado${NC}"
fi

# =============================================
# 6. Limpieza
# =============================================
echo -e "${YELLOW}[6/6] Limpieza final...${NC}"
rm -f /var/log/streambox*.log 2>/dev/null || true
rm -f /var/log/omnisync*.log 2>/dev/null || true
echo -e "${GREEN}  ✓ Logs eliminados${NC}"

echo ""
echo -e "${GREEN}╔══════════════════════════════════════════╗"
echo "║   ✅ DESINSTALACIÓN COMPLETADA            ║"
echo "║                                            ║"
echo "║   Se eliminaron:                           ║"
echo "║   • Servicios PM2                          ║"
echo "║   • Puertos liberados                      ║"
echo "║   • Base de datos PostgreSQL               ║"
echo "║   • Archivos en /opt/streambox             ║"
echo "║   • Frontend en /var/www/streambox         ║"
echo "║   • Configuración de Nginx                 ║"
echo "║                                            ║"
echo "║   Node.js, PM2, Nginx y PostgreSQL         ║"
echo "║   NO fueron desinstalados (uso compartido) ║"
echo "╚══════════════════════════════════════════╝"
echo -e "${NC}"
echo -e "${CYAN}Puedes reinstalar con: sudo bash install.sh${NC}"
echo ""
