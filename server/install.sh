#!/bin/bash
# =============================================
# 🚀 StreamBox - Instalador Automático
# Sistema IPTV completo para Ubuntu Server
# Uso: sudo bash install.sh
# =============================================

set -e

# Colores
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

echo -e "${CYAN}"
echo "╔══════════════════════════════════════════╗"
echo "║       🚀 StreamBox Installer v1.0        ║"
echo "║     Sistema IPTV Local para Ubuntu        ║"
echo "╚══════════════════════════════════════════╝"
echo -e "${NC}"

# Verificar root
if [ "$EUID" -ne 0 ]; then
  echo -e "${RED}❌ Ejecuta este script como root: sudo bash install.sh${NC}"
  exit 1
fi

# Detectar directorio del script
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

# =============================================
# PASO 1: Recopilar información
# =============================================
echo -e "${YELLOW}📋 Configuración inicial${NC}"
echo ""

read -p "📧 Email del administrador [admin@streambox.local]: " ADMIN_EMAIL
ADMIN_EMAIL=${ADMIN_EMAIL:-admin@streambox.local}

read -sp "🔐 Contraseña del administrador [admin123]: " ADMIN_PASS
ADMIN_PASS=${ADMIN_PASS:-admin123}
echo ""

read -sp "🗄️  Contraseña para PostgreSQL [streambox_db_pass]: " DB_PASS
DB_PASS=${DB_PASS:-streambox_db_pass}
echo ""

read -p "📺 IP origen de streams [201.182.249.222:8281]: " STREAM_ORIGIN
STREAM_ORIGIN=${STREAM_ORIGIN:-201.182.249.222:8281}

read -p "🌐 Puerto web [80]: " WEB_PORT
WEB_PORT=${WEB_PORT:-80}

# Detectar IP del servidor
SERVER_IP=$(hostname -I | awk '{print $1}')
echo ""
echo -e "${CYAN}🔍 IP detectada del servidor: ${SERVER_IP}${NC}"
echo ""

# Generar JWT secret aleatorio
JWT_SECRET=$(openssl rand -hex 32)

echo -e "${GREEN}✅ Configuración lista. Iniciando instalación...${NC}"
echo ""
sleep 2

# =============================================
# PASO 2: Instalar dependencias del sistema
# =============================================
echo -e "${YELLOW}📦 [1/7] Instalando dependencias del sistema...${NC}"

apt update -qq
apt install -y -qq postgresql postgresql-contrib nginx curl git build-essential > /dev/null 2>&1

# Instalar Node.js 20 si no está instalado
if ! command -v node &> /dev/null || [[ $(node -v | cut -d'.' -f1 | tr -d 'v') -lt 18 ]]; then
  echo -e "${CYAN}   Instalando Node.js 20...${NC}"
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash - > /dev/null 2>&1
  apt install -y -qq nodejs > /dev/null 2>&1
fi

echo -e "${GREEN}   ✅ Node.js $(node -v) instalado${NC}"

# Instalar PM2
npm install -g pm2 > /dev/null 2>&1
echo -e "${GREEN}   ✅ PM2 instalado${NC}"

# =============================================
# PASO 3: Configurar PostgreSQL
# =============================================
echo -e "${YELLOW}🗄️  [2/7] Configurando PostgreSQL...${NC}"

systemctl start postgresql
systemctl enable postgresql > /dev/null 2>&1

# Crear usuario y base de datos
sudo -u postgres psql -c "DROP DATABASE IF EXISTS streambox;" > /dev/null 2>&1 || true
sudo -u postgres psql -c "DROP USER IF EXISTS streambox_user;" > /dev/null 2>&1 || true
sudo -u postgres psql -c "CREATE USER streambox_user WITH PASSWORD '${DB_PASS}';" > /dev/null 2>&1
sudo -u postgres psql -c "CREATE DATABASE streambox OWNER streambox_user;" > /dev/null 2>&1

# Importar schema
sudo -u postgres psql -d streambox -f "${SCRIPT_DIR}/database/schema.sql" > /dev/null 2>&1

# Dar permisos
sudo -u postgres psql -d streambox -c "GRANT ALL ON ALL TABLES IN SCHEMA public TO streambox_user;" > /dev/null 2>&1
sudo -u postgres psql -d streambox -c "GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO streambox_user;" > /dev/null 2>&1

echo -e "${GREEN}   ✅ PostgreSQL configurado${NC}"

# =============================================
# PASO 4: Configurar la API
# =============================================
echo -e "${YELLOW}⚙️  [3/7] Configurando API Node.js...${NC}"

# Crear directorio de instalación
mkdir -p /opt/streambox/server
cp -r "${SCRIPT_DIR}"/* /opt/streambox/server/

# Reemplazar configuración en index.js
sed -i "s|cambia-este-secreto-por-uno-seguro-abc123|${JWT_SECRET}|g" /opt/streambox/server/index.js
sed -i "s|tu_password_seguro|${DB_PASS}|g" /opt/streambox/server/index.js

# Instalar dependencias
cd /opt/streambox/server
npm install --production > /dev/null 2>&1

echo -e "${GREEN}   ✅ API configurada${NC}"

# =============================================
# PASO 5: Compilar Frontend
# =============================================
echo -e "${YELLOW}🎨 [4/7] Compilando frontend React...${NC}"

cd "${PROJECT_DIR}"

# Crear .env para modo local
cat > .env.production << EOF
VITE_LOCAL_API_URL=http://${SERVER_IP}
EOF

npm install --legacy-peer-deps > /dev/null 2>&1
npm run build > /dev/null 2>&1

# Copiar build
mkdir -p /var/www/streambox
cp -r dist/* /var/www/streambox/

echo -e "${GREEN}   ✅ Frontend compilado y desplegado${NC}"

# =============================================
# PASO 6: Configurar Nginx
# =============================================
echo -e "${YELLOW}🌐 [5/7] Configurando Nginx...${NC}"

# Generar config de Nginx con protecciones de IP
cat > /etc/nginx/sites-available/streambox << NGINXEOF
server {
    listen ${WEB_PORT};
    server_name _;
    server_tokens off;

    root /var/www/streambox;
    index index.html;

    location / {
        try_files \$uri \$uri/ /index.html;
    }

    location /api/ {
        proxy_pass http://127.0.0.1:3001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host \$host;
        proxy_cache_bypass \$http_upgrade;
        proxy_set_header X-Real-IP \$remote_addr;
    }

    # Proxy de Streams - IP origen OCULTA
    location /stream/ {
        auth_request /auth-stream;
        proxy_pass http://${STREAM_ORIGIN}/;
        proxy_http_version 1.1;
        proxy_set_header Connection "";
        proxy_buffering off;
        proxy_cache off;
        proxy_connect_timeout 300;
        proxy_send_timeout 300;
        proxy_read_timeout 300;

        # SEGURIDAD: Ocultar todo sobre el origen
        proxy_hide_header X-Powered-By;
        proxy_hide_header Server;
        proxy_hide_header Via;
        proxy_hide_header X-Real-IP;
        proxy_hide_header X-Forwarded-For;
        proxy_hide_header X-Forwarded-Host;
        proxy_hide_header X-Upstream;
        proxy_hide_header X-Backend;
        proxy_hide_header X-Request-Id;
        proxy_set_header Host \$host;
        proxy_set_header Referer "";
        proxy_set_header Origin "";
        proxy_redirect off;
    }

    location = /auth-stream {
        internal;
        proxy_pass http://127.0.0.1:3001/api/validate-stream?username=\$arg_user&password=\$arg_pass;
        proxy_pass_request_body off;
        proxy_set_header Content-Length "";
        proxy_set_header X-Original-URI \$request_uri;
    }

    location ~ /\. {
        deny all;
    }
}
NGINXEOF

# Habilitar sitio
rm -f /etc/nginx/sites-enabled/default
ln -sf /etc/nginx/sites-available/streambox /etc/nginx/sites-enabled/

nginx -t > /dev/null 2>&1
systemctl restart nginx
systemctl enable nginx > /dev/null 2>&1

echo -e "${GREEN}   ✅ Nginx configurado en puerto ${WEB_PORT}${NC}"

# =============================================
# PASO 7: Iniciar API con PM2
# =============================================
echo -e "${YELLOW}🚀 [6/7] Iniciando API...${NC}"

cd /opt/streambox/server
pm2 delete streambox-api > /dev/null 2>&1 || true
pm2 start index.js --name streambox-api > /dev/null 2>&1
pm2 startup systemd -u root --hp /root > /dev/null 2>&1 || true
pm2 save > /dev/null 2>&1

echo -e "${GREEN}   ✅ API corriendo con PM2${NC}"

# =============================================
# PASO 8: Crear administrador
# =============================================
echo -e "${YELLOW}👤 [7/7] Creando administrador...${NC}"

sleep 2  # Esperar a que la API esté lista

SETUP_RESPONSE=$(curl -s -X POST http://localhost:3001/api/admin/setup \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"${ADMIN_EMAIL}\",\"password\":\"${ADMIN_PASS}\"}")

if echo "$SETUP_RESPONSE" | grep -q "token"; then
  echo -e "${GREEN}   ✅ Admin creado: ${ADMIN_EMAIL}${NC}"
else
  echo -e "${YELLOW}   ⚠️  Admin ya existía o hubo un error: ${SETUP_RESPONSE}${NC}"
fi

# =============================================
# Configurar firewall
# =============================================
if command -v ufw &> /dev/null; then
  ufw allow ${WEB_PORT}/tcp > /dev/null 2>&1
  ufw allow 22/tcp > /dev/null 2>&1
fi

# =============================================
# ¡LISTO!
# =============================================
echo ""
echo -e "${GREEN}╔══════════════════════════════════════════╗"
echo "║      ✅ ¡StreamBox instalado con éxito!    ║"
echo "╚══════════════════════════════════════════╝${NC}"
echo ""
echo -e "${CYAN}🌐 Panel Admin:    http://${SERVER_IP}/admin${NC}"
echo -e "${CYAN}📺 App Clientes:   http://${SERVER_IP}/login${NC}"
echo -e "${CYAN}🔑 Admin Email:    ${ADMIN_EMAIL}${NC}"
echo ""
echo -e "${YELLOW}📋 Comandos útiles:${NC}"
echo "   pm2 logs streambox-api    → Ver logs de la API"
echo "   pm2 restart streambox-api → Reiniciar API"
echo "   pm2 status                → Estado de servicios"
echo ""
echo -e "${YELLOW}📁 Archivos instalados:${NC}"
echo "   /var/www/streambox/       → Frontend"
echo "   /opt/streambox/server/    → API Node.js"
echo "   /etc/nginx/sites-available/streambox → Nginx"
echo ""
