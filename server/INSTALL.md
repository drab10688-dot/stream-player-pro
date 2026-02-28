# =============================================
# 🚀 StreamBox - Guía de Instalación en Ubuntu
# Sistema IPTV completo sin internet
# =============================================

## REQUISITOS
- Ubuntu 20.04/22.04/24.04 (Server o Desktop)
- Mínimo 2GB RAM, 20GB disco
- Red local (LAN) para que los clientes se conecten

---

## PASO 1: Instalar dependencias

```bash
# Actualizar sistema
sudo apt update && sudo apt upgrade -y

# Instalar PostgreSQL
sudo apt install -y postgresql postgresql-contrib

# Instalar Nginx
sudo apt install -y nginx

# Instalar Node.js 20
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs

# Instalar Git
sudo apt install -y git
```

---

## PASO 2: Configurar PostgreSQL

```bash
# Entrar a PostgreSQL
sudo -u postgres psql

# Dentro de psql, ejecutar:
CREATE USER streambox_user WITH PASSWORD 'tu_password_seguro';
CREATE DATABASE streambox OWNER streambox_user;
GRANT ALL PRIVILEGES ON DATABASE streambox TO streambox_user;
\q

# Importar el schema
sudo -u postgres psql -d streambox -f /ruta/a/server/database/schema.sql

# Dar permisos al usuario sobre las tablas
sudo -u postgres psql -d streambox -c "GRANT ALL ON ALL TABLES IN SCHEMA public TO streambox_user;"
sudo -u postgres psql -d streambox -c "GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO streambox_user;"
```

---

## PASO 3: Configurar la API (Node.js)

```bash
# Ir a la carpeta del servidor
cd /ruta/a/server

# Instalar dependencias
npm install

# IMPORTANTE: Editar index.js y cambiar:
# - JWT_SECRET: pon un string largo y aleatorio
# - password en la config de Pool: 'tu_password_seguro' (el que pusiste en paso 2)

# Probar que funciona
node index.js
# Deberías ver: 🚀 StreamBox API corriendo en http://0.0.0.0:3001

# Para que corra como servicio permanente:
sudo npm install -g pm2
pm2 start index.js --name streambox-api
pm2 startup
pm2 save
```

---

## PASO 4: Compilar el Frontend

```bash
# Desde la raíz del proyecto Lovable (el que exportaste de GitHub)
npm install
npm run build

# Copiar el build a Nginx
sudo mkdir -p /var/www/streambox
sudo cp -r dist/* /var/www/streambox/
```

---

## PASO 5: Configurar Nginx

```bash
# Copiar la configuración
sudo cp server/nginx/streambox.conf /etc/nginx/sites-available/streambox

# Habilitar el sitio
sudo ln -s /etc/nginx/sites-available/streambox /etc/nginx/sites-enabled/
sudo rm /etc/nginx/sites-enabled/default

# IMPORTANTE: Editar el archivo y cambiar la IP del stream origen
sudo nano /etc/nginx/sites-available/streambox
# Cambiar: proxy_pass http://201.182.249.222:8281/;
# Por tu IP real de origen de streams

# Verificar configuración
sudo nginx -t

# Reiniciar Nginx
sudo systemctl restart nginx
sudo systemctl enable nginx
```

---

## PASO 6: Crear el primer administrador

```bash
# Desde cualquier terminal en el servidor:
curl -X POST http://localhost:3001/api/admin/setup \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@local.com","password":"tu_password_admin"}'
```

---

## PASO 7: Acceder al sistema

Averigua la IP de tu servidor:
```bash
ip addr show | grep "inet " | grep -v 127.0.0.1
# Ejemplo: 192.168.1.100
```

- **Panel Admin**: http://192.168.1.100/admin
- **App Cliente**: http://192.168.1.100/login
- **Streams**: http://192.168.1.100/stream/601.ts?user=USUARIO&pass=CONTRASEÑA

---

## PASO 8: Configurar el Frontend para API local

IMPORTANTE: Antes de compilar (paso 4), necesitas cambiar la app para que 
use la API local en vez de Lovable Cloud. Ver archivo:
`src/contexts/AuthContext.tsx` - cambiar para que llame a `/api/client/login`

---

## ESTRUCTURA DE ARCHIVOS EN EL SERVIDOR

```
/var/www/streambox/          ← Frontend compilado
/opt/streambox/server/       ← API Node.js
  ├── index.js
  ├── package.json
  └── database/
      └── schema.sql
/etc/nginx/sites-available/
  └── streambox              ← Config de Nginx
```

---

## COMANDOS ÚTILES

```bash
# Ver logs de la API
pm2 logs streambox-api

# Reiniciar API
pm2 restart streambox-api

# Ver logs de Nginx
sudo tail -f /var/log/nginx/error.log

# Verificar PostgreSQL
sudo systemctl status postgresql

# Ver IP del servidor
hostname -I
```

---

## SOLUCIÓN DE PROBLEMAS

**API no conecta a PostgreSQL:**
- Verificar que PostgreSQL esté corriendo: `sudo systemctl status postgresql`
- Verificar credenciales en index.js

**Nginx da error 502:**
- Verificar que la API esté corriendo: `pm2 status`
- Ver logs: `pm2 logs streambox-api`

**Streams no cargan:**
- Verificar que la IP origen sea accesible desde el servidor
- Verificar la config de proxy en streambox.conf

**Clientes no pueden acceder:**
- Verificar que el firewall permita puerto 80: `sudo ufw allow 80`
- Verificar que estén en la misma red LAN
