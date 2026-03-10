#!/bin/bash
# =============================================
# 🚀 Omnisync - Instalador Automático v2.0
# Sistema IPTV completo para Ubuntu Server
# Uso: sudo bash install.sh
# =============================================
# Características:
# • Detección y resolución automática de puertos ocupados
# • Verificación de salud post-instalación
# • Auto-corrección de errores comunes
# • Reintentos automáticos
# =============================================

# Colores
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

# =============================================
# FUNCIONES AUXILIARES
# =============================================

log_ok()    { echo -e "${GREEN}   ✅ $1${NC}"; }
log_warn()  { echo -e "${YELLOW}   ⚠️  $1${NC}"; }
log_err()   { echo -e "${RED}   ❌ $1${NC}"; }
log_info()  { echo -e "${CYAN}   ℹ️  $1${NC}"; }
log_step()  { echo -e "${YELLOW}$1${NC}"; }

# Encontrar un puerto libre a partir de uno dado
find_free_port() {
  local port=$1
  while lsof -i :$port &>/dev/null || ss -tlnp | grep -q ":$port "; do
    log_warn "Puerto $port está ocupado"
    port=$((port + 1))
  done
  echo $port
}

# Liberar un puerto matando el proceso que lo usa
kill_port() {
  local port=$1
  local pids=$(lsof -ti :$port 2>/dev/null)
  if [ -n "$pids" ]; then
    echo "$pids" | xargs kill -9 2>/dev/null || true
    sleep 1
    log_info "Puerto $port liberado"
  fi
}

# Esperar a que un servicio esté listo
wait_for_port() {
  local port=$1
  local name=$2
  local max_wait=${3:-15}
  local waited=0
  while ! nc -z localhost $port 2>/dev/null; do
    sleep 1
    waited=$((waited + 1))
    if [ $waited -ge $max_wait ]; then
      return 1
    fi
  done
  return 0
}

# Verificar salud de un endpoint HTTP
check_health() {
  local url=$1
  local expected=$2
  local response=$(curl -s -o /dev/null -w "%{http_code}" "$url" 2>/dev/null)
  [ "$response" = "$expected" ]
}

echo -e "${CYAN}"
echo "╔══════════════════════════════════════════╗"
echo "║       🚀 Omnisync Installer v2.0         ║"
echo "║     Sistema IPTV Local para Ubuntu        ║"
echo "╚══════════════════════════════════════════╝"
echo -e "${NC}"

# Verificar root
if [ "$EUID" -ne 0 ]; then
  log_err "Ejecuta este script como root: sudo bash install.sh"
  exit 1
fi

# Verificar Ubuntu/Debian
if ! command -v apt &> /dev/null; then
  log_err "Este script requiere un sistema basado en Debian/Ubuntu"
  exit 1
fi

# =============================================
# Compatibilidad de Ubuntu
# =============================================
echo -e "${CYAN}╔══════════════════════════════════════════╗"
echo "║  📋 Versiones de Ubuntu compatibles:      ║"
echo "║                                            ║"
echo "║   ✅ Ubuntu 20.04 LTS (Focal)             ║"
echo "║   ✅ Ubuntu 22.04 LTS (Jammy)  ← Recom.  ║"
echo "║   ✅ Ubuntu 24.04 LTS (Noble)             ║"
echo "║   ✅ Debian 11 (Bullseye)                 ║"
echo "║   ✅ Debian 12 (Bookworm)                 ║"
echo "║                                            ║"
echo "║   ⚠️  Ubuntu 18.04 o menor: NO soportado  ║"
echo "╚══════════════════════════════════════════╝"
echo -e "${NC}"

# Detectar versión del sistema
if [ -f /etc/os-release ]; then
  . /etc/os-release
  OS_NAME="${NAME} ${VERSION_ID}"
  log_info "Sistema detectado: ${OS_NAME}"

  # Advertir si es una versión muy vieja
  if [ -n "$VERSION_ID" ]; then
    MAJOR_VER=$(echo "$VERSION_ID" | cut -d'.' -f1)
    if [[ "$ID" == "ubuntu" && "$MAJOR_VER" -lt 20 ]]; then
      log_err "Ubuntu $VERSION_ID no es compatible. Se requiere 20.04 o superior."
      exit 1
    elif [[ "$ID" == "debian" && "$MAJOR_VER" -lt 11 ]]; then
      log_err "Debian $VERSION_ID no es compatible. Se requiere Debian 11 o superior."
      exit 1
    fi
  fi
else
  log_warn "No se pudo detectar la versión del sistema operativo"
fi

# =============================================
# Detectar instalación existente
# =============================================
ALREADY_INSTALLED=false
if [ -d "/opt/streambox" ] || [ -d "/var/www/streambox" ] || pm2 list 2>/dev/null | grep -q "streambox-api"; then
  ALREADY_INSTALLED=true
fi

if [ "$ALREADY_INSTALLED" = true ]; then
  echo ""
  echo -e "${YELLOW}╔══════════════════════════════════════════╗"
  echo "║  ⚠️  Omnisync ya está instalado           ║"
  echo "╚══════════════════════════════════════════╝${NC}"
  echo ""
  echo -e "  ${CYAN}1)${NC} Reinstalar (actualizar a última versión)"
  echo -e "  ${RED}2)${NC} Desinstalar completamente"
  echo -e "  ${YELLOW}3)${NC} Cancelar"
  echo ""
  read -p "  Elige una opción [1/2/3]: " INSTALL_CHOICE
  INSTALL_CHOICE=${INSTALL_CHOICE:-1}

  case "$INSTALL_CHOICE" in
    2)
      SCRIPT_DIR_CURRENT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
      if [ -f "${SCRIPT_DIR_CURRENT}/uninstall.sh" ]; then
        echo ""
        log_info "Ejecutando desinstalador..."
        bash "${SCRIPT_DIR_CURRENT}/uninstall.sh"
        exit $?
      else
        log_err "No se encontró uninstall.sh en ${SCRIPT_DIR_CURRENT}"
        echo -e "  Ejecuta manualmente: ${CYAN}sudo bash server/uninstall.sh${NC}"
        exit 1
      fi
      ;;
    3)
      echo ""
      log_info "Instalación cancelada."
      exit 0
      ;;
    1)
      echo ""
      log_info "Reinstalando Omnisync..."
      ;;
    *)
      log_err "Opción no válida"
      exit 1
      ;;
  esac
fi
echo ""

# Detectar directorio del script
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

# =============================================
# PASO 0: Auto-actualizar desde Git
# =============================================
log_step "🔄 Verificando actualizaciones del código..."

if [ -d "${PROJECT_DIR}/.git" ]; then
  cd "${PROJECT_DIR}"
  
  # Guardar cambios locales si los hay
  git stash > /dev/null 2>&1 || true
  
  # Intentar pull
  if git pull origin main > /dev/null 2>&1 || git pull origin master > /dev/null 2>&1; then
    log_ok "Código actualizado desde Git"
  else
    log_warn "No se pudo actualizar desde Git (sin conexión o sin remote)"
    log_info "Usando archivos locales"
  fi
else
  log_info "No es un repositorio Git, usando archivos locales"
fi

# Verificar que index.js existe
if [ ! -f "${SCRIPT_DIR}/index.js" ]; then
  log_err "No se encontró server/index.js"
  exit 1
fi
log_ok "Archivos del proyecto verificados"
echo ""

# =============================================
# PASO 1: Recopilar información
# =============================================
log_step "📋 Configuración inicial"
echo ""

read -p "📧 Email del administrador [admin@omnisync.local]: " ADMIN_EMAIL
ADMIN_EMAIL=${ADMIN_EMAIL:-admin@omnisync.local}

read -sp "🔐 Contraseña del administrador [admin123]: " ADMIN_PASS
ADMIN_PASS=${ADMIN_PASS:-admin123}
echo ""

read -sp "🗄️  Contraseña para PostgreSQL [streambox_db_pass]: " DB_PASS
DB_PASS=${DB_PASS:-streambox_db_pass}
echo ""

read -p "🌐 Puerto web (Nginx) [80]: " WEB_PORT
WEB_PORT=${WEB_PORT:-80}

# Detectar IP del servidor
SERVER_IP=$(hostname -I | awk '{print $1}')
echo ""
log_info "IP detectada del servidor: ${SERVER_IP}"

# Generar JWT secret aleatorio
JWT_SECRET=$(openssl rand -hex 32)

# =============================================
# PASO 2: Verificar y resolver conflictos de puertos
# =============================================
log_step "🔍 [1/8] Verificando puertos..."

# Puerto de la API (3001)
API_PORT=3001
if lsof -i :$API_PORT &>/dev/null; then
  log_warn "Puerto $API_PORT ocupado. Intentando liberar..."
  # Verificar si es una instalación anterior de streambox
  PROC_NAME=$(lsof -i :$API_PORT -t 2>/dev/null | head -1 | xargs ps -p 2>/dev/null | tail -1 | awk '{print $NF}' 2>/dev/null)
  
  read -p "   ¿Liberar puerto $API_PORT (matar proceso)? [S/n]: " KILL_API
  KILL_API=${KILL_API:-S}
  if [[ "$KILL_API" =~ ^[Ss]$ ]]; then
    kill_port $API_PORT
  else
    API_PORT=$(find_free_port $((API_PORT + 1)))
    log_info "Usando puerto alternativo para API: $API_PORT"
  fi
fi

# Puerto web (Nginx)
if [ "$WEB_PORT" != "80" ] || lsof -i :$WEB_PORT &>/dev/null; then
  if lsof -i :$WEB_PORT &>/dev/null; then
    # Verificar si es nginx (normal si estamos reinstalando)
    if lsof -i :$WEB_PORT 2>/dev/null | grep -q nginx; then
      log_info "Puerto $WEB_PORT usado por Nginx (se reconfigurará)"
    else
      log_warn "Puerto $WEB_PORT ocupado por otro servicio"
      read -p "   ¿Liberar puerto $WEB_PORT? [S/n]: " KILL_WEB
      KILL_WEB=${KILL_WEB:-S}
      if [[ "$KILL_WEB" =~ ^[Ss]$ ]]; then
        kill_port $WEB_PORT
      else
        WEB_PORT=$(find_free_port $((WEB_PORT + 1)))
        log_info "Usando puerto alternativo para web: $WEB_PORT"
      fi
    fi
  fi
fi

log_ok "API: puerto $API_PORT | Web: puerto $WEB_PORT"
echo ""

sleep 1

# =============================================
# PASO 3: Actualizar sistema e instalar dependencias
# =============================================
log_step "📦 [2/8] Actualizando sistema e instalando dependencias..."

log_info "Actualizando paquetes del sistema (esto puede tardar)..."
apt update -qq 2>/dev/null
apt upgrade -y -qq > /dev/null 2>&1
log_ok "Sistema actualizado"

apt install -y -qq postgresql postgresql-contrib nginx curl git build-essential netcat-openbsd lsof > /dev/null 2>&1

# Instalar FFmpeg con soporte H.265/HEVC
if ! command -v ffmpeg &> /dev/null; then
  log_info "Instalando FFmpeg con soporte H.265 (HEVC)..."
  apt install -y -qq ffmpeg > /dev/null 2>&1
fi

# Verificar que FFmpeg tiene libx265
if ffmpeg -encoders 2>/dev/null | grep -q "libx265"; then
  log_ok "FFmpeg con H.265/HEVC (libx265) ✓"
else
  log_warn "FFmpeg instalado pero sin libx265. Instalando codecs adicionales..."
  apt install -y -qq libx265-dev libx264-dev > /dev/null 2>&1
  # En Ubuntu/Debian, ffmpeg del repo oficial ya trae libx265
  # Si no, intentar desde ppa
  if ! ffmpeg -encoders 2>/dev/null | grep -q "libx265"; then
    log_warn "libx265 no disponible. El servidor usará H.264 (mayor consumo de datos)"
    log_info "Para habilitar H.265 manualmente: apt install ffmpeg libx265-dev"
  else
    log_ok "FFmpeg H.265 habilitado tras instalar codecs"
  fi
fi
log_ok "FFmpeg $(ffmpeg -version 2>/dev/null | head -1 | awk '{print $3}')"

# Instalar Node.js 20 si no está o es muy viejo
if ! command -v node &> /dev/null || [[ $(node -v | cut -d'.' -f1 | tr -d 'v') -lt 18 ]]; then
  log_info "Instalando Node.js 20..."
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash - > /dev/null 2>&1
  apt install -y -qq nodejs > /dev/null 2>&1
fi
log_ok "Node.js $(node -v)"

# Instalar PM2
npm install -g pm2 > /dev/null 2>&1
log_ok "PM2 instalado"

# =============================================
# PASO 4: Configurar PostgreSQL
# =============================================
log_step "🗄️  [3/8] Configurando PostgreSQL..."

# Asegurar que PostgreSQL está corriendo
systemctl start postgresql 2>/dev/null
systemctl enable postgresql > /dev/null 2>&1

if ! systemctl is-active --quiet postgresql; then
  log_err "No se pudo iniciar PostgreSQL"
  log_info "Intentando reparar..."
  apt install -y --fix-broken postgresql > /dev/null 2>&1
  systemctl start postgresql
  if ! systemctl is-active --quiet postgresql; then
    log_err "PostgreSQL no responde. Revisa: journalctl -u postgresql"
    exit 1
  fi
fi

# Limpiar instalación anterior
sudo -u postgres psql -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = 'streambox' AND pid <> pg_backend_pid();" 2>/dev/null || true
sudo -u postgres psql -c "DROP DATABASE IF EXISTS streambox;" 2>/dev/null || true
sudo -u postgres psql -c "DROP USER IF EXISTS streambox_user;" 2>/dev/null || true

# Crear usuario y base de datos
sudo -u postgres psql -c "CREATE USER streambox_user WITH PASSWORD '${DB_PASS}';" 2>/dev/null
if [ $? -ne 0 ]; then
  log_warn "Usuario ya existe, actualizando contraseña..."
  sudo -u postgres psql -c "ALTER USER streambox_user WITH PASSWORD '${DB_PASS}';" 2>/dev/null
fi

sudo -u postgres psql -c "CREATE DATABASE streambox OWNER streambox_user;" 2>/dev/null
if [ $? -ne 0 ]; then
  log_err "Error creando base de datos"
  exit 1
fi

# Importar schema
cp "${SCRIPT_DIR}/database/schema.sql" /tmp/streambox_schema.sql
chmod 644 /tmp/streambox_schema.sql
sudo -u postgres psql -d streambox -f /tmp/streambox_schema.sql > /dev/null 2>&1
rm -f /tmp/streambox_schema.sql

# Dar permisos
sudo -u postgres psql -d streambox -c "GRANT ALL ON ALL TABLES IN SCHEMA public TO streambox_user;" 2>/dev/null
sudo -u postgres psql -d streambox -c "GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO streambox_user;" 2>/dev/null
sudo -u postgres psql -d streambox -c "ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO streambox_user;" 2>/dev/null
sudo -u postgres psql -d streambox -c "ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO streambox_user;" 2>/dev/null

# Verificar conexión
if PGPASSWORD="${DB_PASS}" psql -h localhost -U streambox_user -d streambox -c "SELECT 1;" > /dev/null 2>&1; then
  log_ok "PostgreSQL configurado y verificado"
else
  log_err "No se puede conectar a PostgreSQL con las credenciales"
  log_info "Verifica pg_hba.conf y reinicia PostgreSQL"
  # Intentar fix automático de pg_hba.conf
  PG_HBA=$(find /etc/postgresql -name "pg_hba.conf" 2>/dev/null | head -1)
  if [ -n "$PG_HBA" ]; then
    if ! grep -q "streambox_user" "$PG_HBA"; then
      echo "local   streambox   streambox_user   md5" >> "$PG_HBA"
      echo "host    streambox   streambox_user   127.0.0.1/32   md5" >> "$PG_HBA"
      systemctl restart postgresql
      log_info "pg_hba.conf actualizado, reintentando..."
      if PGPASSWORD="${DB_PASS}" psql -h localhost -U streambox_user -d streambox -c "SELECT 1;" > /dev/null 2>&1; then
        log_ok "PostgreSQL conectado después de fix"
      else
        log_err "Aún no conecta. Revisa manualmente."
        exit 1
      fi
    fi
  fi
fi

# =============================================
# PASO 4.5: Configurar almacenamiento HLS
# SSD por defecto (soporta muchos más canales)
# =============================================
log_step "💾 [3.5/8] Configurando almacenamiento HLS..."

HLS_DIR="/opt/streambox/hls-cache"
HLS_CACHE_DIR="/opt/streambox/hls-proxy-cache"

# Detectar tipo de disco
DISK_TYPE="desconocido"
ROOT_DISK=$(df / | tail -1 | awk '{print $1}' | sed 's/[0-9]*$//' | sed 's/p$//')
ROOT_DISK_BASE=$(basename "$ROOT_DISK" 2>/dev/null)
if [ -n "$ROOT_DISK_BASE" ] && [ -f "/sys/block/${ROOT_DISK_BASE}/queue/rotational" ]; then
  ROTATIONAL=$(cat "/sys/block/${ROOT_DISK_BASE}/queue/rotational" 2>/dev/null)
  if [ "$ROTATIONAL" = "0" ]; then
    # Check if NVMe
    if echo "$ROOT_DISK_BASE" | grep -q "nvme"; then
      DISK_TYPE="NVMe SSD"
    else
      DISK_TYPE="SSD SATA"
    fi
  else
    DISK_TYPE="HDD"
  fi
fi

# Detectar espacio disponible
DISK_AVAIL_GB=$(df -BG /opt 2>/dev/null | tail -1 | awk '{print $4}' | tr -d 'G')
DISK_TOTAL_GB=$(df -BG /opt 2>/dev/null | tail -1 | awk '{print $2}' | tr -d 'G')
TOTAL_RAM_MB=$(free -m | awk '/^Mem:/{print $2}')

echo ""
echo -e "${CYAN}╔══════════════════════════════════════════════════╗"
echo "║  💾 Información del almacenamiento               ║"
echo "╠══════════════════════════════════════════════════╣"
echo -e "║  Tipo de disco:    ${DISK_TYPE}$(printf '%*s' $((25 - ${#DISK_TYPE})) '')║"
echo -e "║  Espacio total:    ${DISK_TOTAL_GB}GB$(printf '%*s' $((27 - ${#DISK_TOTAL_GB})) '')║"
echo -e "║  Espacio libre:    ${DISK_AVAIL_GB}GB$(printf '%*s' $((27 - ${#DISK_AVAIL_GB})) '')║"
echo -e "║  RAM total:        ${TOTAL_RAM_MB}MB$(printf '%*s' $((27 - ${#TOTAL_RAM_MB})) '')║"
echo "╠══════════════════════════════════════════════════╣"
echo "║  📊 Recomendación (ABR 5 calidades):      ║"
echo "║                                                  ║"
echo "║  Canales    Caché   Disco     RAM (FFmpeg)       ║"
echo "║  ────────   ─────   ────────  ──────────         ║"
echo "║  10 ch      30min   ~15 GB    ~8 GB              ║"
echo "║  25 ch      30min   ~35 GB    ~16 GB             ║"
echo "║  50 ch      30min   ~70 GB    ~25 GB             ║"
echo "║  100 ch     30min   ~140 GB   ~40 GB             ║"
echo "║  200 ch     30min   ~280 GB   ~70 GB             ║"
echo "║                                                  ║"
echo "║  💡 Tip: Solo canales keep-alive usan caché      ║"
echo "║     Los demás se conectan bajo demanda (0 disco) ║"
echo "╚══════════════════════════════════════════════════╝${NC}"
echo ""

if [ "$DISK_TYPE" = "HDD" ]; then
  log_warn "Disco HDD detectado. Se recomienda SSD para streaming."
  log_info "Un HDD puede manejar ~20-30 canales simultáneos."
  log_info "Para más canales, considere migrar a SSD."
fi

if [ "${DISK_AVAIL_GB:-0}" -lt 10 ]; then
  log_warn "¡Poco espacio en disco! (${DISK_AVAIL_GB}GB libres)"
  log_info "Se recomienda mínimo 20GB libres para streaming."
fi

# Desmontar tmpfs anterior si existe (migración desde versión anterior)
if mountpoint -q "/tmp/streambox-hls" 2>/dev/null; then
  log_info "Desmontando tmpfs anterior (migrando a SSD)..."
  umount "/tmp/streambox-hls" 2>/dev/null || true
fi
# Limpiar entrada tmpfs de fstab si existe
if grep -q "streambox-hls.*tmpfs" /etc/fstab 2>/dev/null; then
  sed -i '/streambox-hls.*tmpfs/d' /etc/fstab
  log_info "Entrada tmpfs removida de /etc/fstab"
fi

# Crear directorios en disco SSD
mkdir -p "$HLS_DIR" "$HLS_CACHE_DIR"
chmod 777 "$HLS_DIR" "$HLS_CACHE_DIR"

log_ok "Almacenamiento HLS en disco SSD: $HLS_DIR"
log_info "Capacidad estimada: ~$((DISK_AVAIL_GB * 10 / 14)) canales keep-alive (30min caché, ABR 5 calidades)"

# Instalar FFmpeg si no está
if ! command -v ffmpeg &> /dev/null; then
  log_info "Instalando FFmpeg..."
  apt install -y -qq ffmpeg > /dev/null 2>&1
fi
FFMPEG_VERSION=$(ffmpeg -version 2>/dev/null | head -1 | awk '{print $3}')
log_ok "FFmpeg ${FFMPEG_VERSION} listo"

log_ok "Almacenamiento configurado - streams HLS en SSD"

# =============================================
# PASO 5: Configurar la API
# =============================================
log_step "⚙️  [4/8] Configurando API Node.js..."

# Limpiar PM2 anterior
pm2 delete streambox-api > /dev/null 2>&1 || true
pm2 delete omnisync-api > /dev/null 2>&1 || true

# Liberar puerto API por si acaso
kill_port $API_PORT 2>/dev/null

# Crear directorio
mkdir -p /opt/streambox/server
cp -r "${SCRIPT_DIR}"/* /opt/streambox/server/

# Configurar index.js con los valores correctos
sed -i "s|cambia-este-secreto-por-uno-seguro-abc123|${JWT_SECRET}|g" /opt/streambox/server/index.js
sed -i "s|tu_password_seguro|${DB_PASS}|g" /opt/streambox/server/index.js
sed -i "s|const PORT = 3001;|const PORT = ${API_PORT};|g" /opt/streambox/server/index.js

# Instalar dependencias
cd /opt/streambox/server
npm install --production > /dev/null 2>&1

log_ok "API configurada en puerto $API_PORT"

# =============================================
# PASO 6: Compilar Frontend
# =============================================
log_step "🎨 [5/8] Compilando frontend React..."

cd "${PROJECT_DIR}"

# Determinar la URL de la API según el puerto web
if [ "$WEB_PORT" = "80" ]; then
  API_URL="http://${SERVER_IP}"
else
  API_URL="http://${SERVER_IP}:${WEB_PORT}"
fi

cat > .env.production << EOF
VITE_LOCAL_API_URL=${API_URL}
EOF

npm install --legacy-peer-deps > /dev/null 2>&1
if ! npm run build > /dev/null 2>&1; then
  log_warn "Error en build, reintentando con limpieza..."
  rm -rf node_modules/.vite
  npm run build > /dev/null 2>&1
  if [ $? -ne 0 ]; then
    log_err "Error compilando frontend. Revisa errores con: cd ${PROJECT_DIR} && npm run build"
    exit 1
  fi
fi

# Copiar build
mkdir -p /var/www/streambox
rm -rf /var/www/streambox/*
cp -r dist/* /var/www/streambox/

log_ok "Frontend compilado y desplegado"

# =============================================
# PASO 7: Configurar Nginx
# =============================================
log_step "🌐 [6/8] Configurando Nginx..."

cat > /etc/nginx/sites-available/streambox << NGINXEOF
server {
    listen ${WEB_PORT};
    server_name _;
    server_tokens off;

    # Sin límite para subida de VOD (videos grandes)
    client_max_body_size 0;

    root /var/www/streambox;
    index index.html;

    # Frontend SPA
    location / {
        try_files \$uri \$uri/ /index.html;
    }

    # API proxy
    location /api/ {
        proxy_pass http://127.0.0.1:${API_PORT};
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host \$host;
        proxy_set_header X-Forwarded-Host \$host;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_cache_bypass \$http_upgrade;
        proxy_set_header X-Real-IP \$remote_addr;

        # Timeout para restreaming
        proxy_connect_timeout 300;
        proxy_send_timeout 300;
        proxy_read_timeout 300;

        # Sin buffering para streams
        proxy_buffering off;
    }

    # Seguridad: ocultar headers del origen
    proxy_hide_header X-Powered-By;
    proxy_hide_header Server;
    proxy_hide_header Via;
    proxy_hide_header X-Real-IP;
    proxy_hide_header X-Forwarded-For;
    proxy_hide_header X-Forwarded-Host;

    # Headers de seguridad
    add_header X-Content-Type-Options nosniff always;
    add_header X-Frame-Options SAMEORIGIN always;
    add_header Referrer-Policy no-referrer always;

    location ~ /\. {
        deny all;
    }
}
NGINXEOF

# Habilitar sitio
rm -f /etc/nginx/sites-enabled/default
rm -f /etc/nginx/sites-enabled/streambox 2>/dev/null
ln -sf /etc/nginx/sites-available/streambox /etc/nginx/sites-enabled/streambox

# Verificar config de Nginx
if ! nginx -t > /dev/null 2>&1; then
  log_err "Error en configuración de Nginx"
  nginx -t
  exit 1
fi

systemctl restart nginx
systemctl enable nginx > /dev/null 2>&1

log_ok "Nginx configurado en puerto $WEB_PORT"

# =============================================
# PASO 7.5: Optimizar Kernel (sysctl) para streaming
# =============================================
log_step "⚡ Optimizando kernel para streaming masivo..."

cat > /etc/sysctl.d/99-streambox.conf << 'SYSCTLEOF'
# =============================================
# Omnisync - Optimización de kernel para streaming
# =============================================

# --- TCP Congestion Control ---
# BBR: algoritmo de Google, mejor throughput para streaming
net.core.default_qdisc = fq
net.ipv4.tcp_congestion_control = bbr

# --- Buffers de red (TCP) ---
# min / default / max en bytes
net.ipv4.tcp_rmem = 8192 87380 134217728
net.ipv4.tcp_wmem = 8192 65536 134217728

# --- Buffers de red (UDP) ---
net.ipv4.udp_rmem_min = 16384
net.ipv4.udp_wmem_min = 16384

# --- Buffers globales del socket ---
net.core.rmem_default = 262144
net.core.rmem_max = 268435456
net.core.wmem_default = 262144
net.core.wmem_max = 268435456

# --- Capacidad de conexiones ---
net.core.somaxconn = 65535
net.core.netdev_max_backlog = 250000
net.core.optmem_max = 65535

# --- TCP tuning avanzado ---
net.ipv4.tcp_max_tw_buckets = 1440000
net.ipv4.tcp_tw_reuse = 1
net.ipv4.tcp_fin_timeout = 15
net.ipv4.tcp_keepalive_time = 300
net.ipv4.tcp_keepalive_intvl = 30
net.ipv4.tcp_keepalive_probes = 5
net.ipv4.tcp_max_syn_backlog = 65535
net.ipv4.tcp_syncookies = 1
net.ipv4.tcp_slow_start_after_idle = 0
net.ipv4.tcp_mtu_probing = 1
net.ipv4.tcp_fastopen = 3
net.ipv4.tcp_window_scaling = 1
net.ipv4.tcp_timestamps = 1
net.ipv4.tcp_sack = 1

# --- Manejo de archivos (HLS segments) ---
fs.file-max = 2097152
fs.inotify.max_user_watches = 524288
fs.inotify.max_user_instances = 8192

# --- Memoria virtual ---
vm.swappiness = 10
vm.dirty_ratio = 15
vm.dirty_background_ratio = 5
vm.vfs_cache_pressure = 50

# --- Seguridad de red ---
net.ipv4.conf.all.rp_filter = 1
net.ipv4.conf.default.rp_filter = 1
net.ipv4.icmp_echo_ignore_broadcasts = 1
net.ipv4.conf.all.accept_redirects = 0
net.ipv4.conf.default.accept_redirects = 0

# --- IPv6 (desactivar si no se usa) ---
# net.ipv6.conf.all.disable_ipv6 = 1
# net.ipv6.conf.default.disable_ipv6 = 1
SYSCTLEOF

# Aplicar sysctl
sysctl -p /etc/sysctl.d/99-streambox.conf > /dev/null 2>&1

# Verificar BBR
if sysctl net.ipv4.tcp_congestion_control 2>/dev/null | grep -q bbr; then
  log_ok "TCP BBR activado"
else
  log_warn "BBR no disponible en este kernel (se usará cubic)"
fi

# Aumentar límites de archivos abiertos
cat > /etc/security/limits.d/streambox.conf << 'LIMITSEOF'
* soft nofile 1048576
* hard nofile 1048576
root soft nofile 1048576
root hard nofile 1048576
* soft nproc 65535
* hard nproc 65535
LIMITSEOF

# Para la sesión actual
ulimit -n 1048576 2>/dev/null || true

log_ok "Kernel optimizado para streaming (sysctl + limits)"

# =============================================
# PASO 8: Iniciar API con PM2
# =============================================
log_step "🚀 [7/8] Iniciando API..."

cd /opt/streambox/server

# Asegurar que el puerto está libre antes de iniciar
kill_port $API_PORT 2>/dev/null

pm2 start index.js --name streambox-api --max-restarts 10 --restart-delay 3000 > /dev/null 2>&1
pm2 startup systemd -u root --hp /root > /dev/null 2>&1 || true
pm2 save > /dev/null 2>&1

# Esperar a que la API esté lista (más tiempo porque FFmpeg puede tardar)
log_info "Esperando que la API responda..."
if wait_for_port $API_PORT "API" 30; then
  log_ok "API corriendo en puerto $API_PORT"
else
  log_warn "La API no respondió en 30 segundos"
  log_info "Revisando logs..."
  pm2 logs streambox-api --lines 10 --nostream
  echo ""
  log_warn "Intentando reiniciar (matando FFmpeg zombies)..."
  pkill -f ffmpeg > /dev/null 2>&1 || true
  pm2 restart streambox-api > /dev/null 2>&1
  sleep 5
  if wait_for_port $API_PORT "API" 30; then
    log_ok "API corriendo después de reinicio"
  else
    log_err "API no arranca. Revisa: pm2 logs streambox-api"
    log_info "Intenta manualmente:"
    echo "   pkill -f ffmpeg"
    echo "   pm2 delete streambox-api"
    echo "   cd /opt/streambox/server && pm2 start index.js --name streambox-api"
    exit 1
  fi
fi

# =============================================
# PASO 9: Crear administrador y verificar salud
# =============================================
log_step "👤 [8/8] Creando administrador y verificando..."

sleep 2

# Verificar health endpoint primero
HEALTH_RESPONSE=$(curl -s http://localhost:${API_PORT}/api/health 2>/dev/null)
if echo "$HEALTH_RESPONSE" | grep -q '"ok"'; then
  log_ok "API health check: OK"
else
  log_err "API health check falló: $HEALTH_RESPONSE"
  log_info "Revisando logs de PM2..."
  pm2 logs streambox-api --lines 10 --nostream
  echo ""
fi

SETUP_RESPONSE=$(curl -s -X POST http://localhost:${API_PORT}/api/admin/setup \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"${ADMIN_EMAIL}\",\"password\":\"${ADMIN_PASS}\"}")

if echo "$SETUP_RESPONSE" | grep -q "token"; then
  log_ok "Admin creado: ${ADMIN_EMAIL}"
else
  log_warn "Admin ya existía o error: $(echo $SETUP_RESPONSE | head -c 100)"
fi

# =============================================
# VERIFICACIÓN DE SALUD COMPLETA
# =============================================
echo ""
log_step "🏥 Verificación de salud del sistema..."

HEALTH_OK=true

# 1. PostgreSQL
if systemctl is-active --quiet postgresql; then
  log_ok "PostgreSQL: activo"
else
  log_err "PostgreSQL: inactivo"
  HEALTH_OK=false
fi

# 2. API
if wait_for_port $API_PORT "API" 3; then
  log_ok "API (puerto $API_PORT): respondiendo"
else
  log_err "API (puerto $API_PORT): no responde"
  HEALTH_OK=false
fi

# 3. Nginx
if systemctl is-active --quiet nginx; then
  log_ok "Nginx (puerto $WEB_PORT): activo"
else
  log_err "Nginx: inactivo"
  HEALTH_OK=false
fi

# 4. Test end-to-end: health endpoint
if check_health "http://localhost:${API_PORT}/api/health" "200"; then
  log_ok "Health endpoint: API + DB funcionando"
else
  log_err "Health endpoint: NO responde (posible error de DB)"
  log_info "Mostrando últimos logs de la API:"
  pm2 logs streambox-api --lines 15 --nostream
  HEALTH_OK=false
fi

# 5. Frontend
if [ -f "/var/www/streambox/index.html" ]; then
  log_ok "Frontend: desplegado"
else
  log_err "Frontend: no encontrado en /var/www/streambox/"
  HEALTH_OK=false
fi

# Configurar firewall
if command -v ufw &> /dev/null; then
  ufw allow ${WEB_PORT}/tcp > /dev/null 2>&1
  ufw allow 22/tcp > /dev/null 2>&1
fi

# =============================================
# RESULTADO FINAL
# =============================================
echo ""
if [ "$HEALTH_OK" = true ]; then
  echo -e "${GREEN}╔══════════════════════════════════════════╗"
  echo "║   ✅ ¡Omnisync instalado con éxito!       ║"
  echo "╚══════════════════════════════════════════╝${NC}"
else
  echo -e "${YELLOW}╔══════════════════════════════════════════╗"
  echo "║   ⚠️  Instalado con advertencias          ║"
  echo "║   Revisa los errores arriba               ║"
  echo "╚══════════════════════════════════════════╝${NC}"
fi

echo ""
if [ "$WEB_PORT" = "80" ]; then
  echo -e "${CYAN}🌐 Panel Admin:    http://${SERVER_IP}/admin${NC}"
  echo -e "${CYAN}📺 App Clientes:   http://${SERVER_IP}/login${NC}"
else
  echo -e "${CYAN}🌐 Panel Admin:    http://${SERVER_IP}:${WEB_PORT}/admin${NC}"
  echo -e "${CYAN}📺 App Clientes:   http://${SERVER_IP}:${WEB_PORT}/login${NC}"
fi
echo -e "${CYAN}🔑 Admin Email:    ${ADMIN_EMAIL}${NC}"
echo -e "${CYAN}⚙️  API Puerto:     ${API_PORT}${NC}"
echo -e "${CYAN}🌐 Web Puerto:     ${WEB_PORT}${NC}"
echo ""
echo -e "${YELLOW}📋 Comandos útiles:${NC}"
echo "   pm2 logs streambox-api     → Ver logs de la API"
echo "   pm2 restart streambox-api  → Reiniciar API"
echo "   pm2 status                 → Estado de servicios"
echo "   pm2 monit                  → Monitor en tiempo real"
echo ""
echo -e "${YELLOW}📁 Archivos instalados:${NC}"
echo "   /var/www/streambox/            → Frontend"
echo "   /opt/streambox/server/         → API Node.js"
echo "   /etc/nginx/sites-available/    → Nginx config"
echo ""
echo -e "${YELLOW}🔧 Si hay problemas:${NC}"
echo "   pm2 logs streambox-api --lines 50  → Ver errores"
echo "   nginx -t                           → Verificar Nginx"
echo "   systemctl status postgresql        → Estado de DB"
echo ""
