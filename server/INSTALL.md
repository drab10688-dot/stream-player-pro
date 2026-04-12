# =============================================
# 🚀 Omnisync TV - Guía de Instalación
# Sistema IPTV profesional · 100% Node.js nativo
# =============================================

## ¿QUÉ ES OMNISYNC TV?

Omnisync TV es un sistema IPTV completo que permite:
- **Transmitir canales en vivo** (TV, deportes, noticias, etc.)
- **DVR / Timeshift** — buffer de 5 minutos para pausar/retroceder TV en vivo
- **Películas (VOD)** — streaming con seeking (avanzar/retroceder)
- **Series** — organización por temporadas y episodios
- **Gestión de clientes** — usuarios, planes, expiración, pantallas simultáneas
- **Resellers** — panel de revendedores con comisiones
- **APK Android** — app dedicada con LibVLC para Smart TVs y dispositivos Android

---

## ARQUITECTURA DEL SISTEMA

```
┌─────────────────────────────────────────────────────┐
│                    CLIENTES                          │
│         (APK Android / Navegador Web)                │
└──────────────────┬──────────────────────────────────┘
                   │
┌──────────────────▼──────────────────────────────────┐
│                 NGINX (Puerto 80)                    │
│  • Sirve frontend React compilado                    │
│  • Proxy reverso hacia API Node.js                   │
│  • Puerto 25461 para apps IPTV directas              │
└──────────────────┬──────────────────────────────────┘
                   │
┌──────────────────▼──────────────────────────────────┐
│            NODE.JS API (Puerto 3001)                 │
│                                                      │
│  📺 Streaming en Vivo                                │
│  • Proxy passthrough de canales HLS/TS               │
│  • Keep-alive con reconexión automática              │
│  • Segmentación TS nativa (sin FFmpeg)               │
│                                                      │
│  🎬 DVR / Timeshift (100% Node.js)                   │
│  • Descarga segmentos HLS del origen                 │
│  • Segmentación manual de streams MPEG-TS            │
│  • Buffer rotativo de 5 min en disco                 │
│  • Generación dinámica de playlists .m3u8            │
│  • Limpieza automática de segmentos antiguos         │
│                                                      │
│  🎥 VOD (Películas y Series)                         │
│  • Streaming con Range Headers (seeking)             │
│  • fs.createReadStream — sin cargar en RAM            │
│  • Soporte HEAD requests (LibVLC)                    │
│                                                      │
│  👥 Gestión                                          │
│  • Autenticación JWT                                 │
│  • Clientes, planes, resellers                       │
│  • Monitoreo y diagnósticos                          │
│  • Publicidad (ads)                                  │
└──────────────────┬──────────────────────────────────┘
                   │
┌──────────────────▼──────────────────────────────────┐
│              POSTGRESQL                              │
│  • Canales, clientes, planes, logs                   │
│  • Conexiones activas y heartbeats                   │
│  • Backups y configuración                           │
└─────────────────────────────────────────────────────┘
```

**⚡ Sin FFmpeg ni binarios externos** — Todo el procesamiento de video
(segmentación, DVR, restreaming) se hace con Node.js nativo usando
`http/https`, `fs.createReadStream` y gestión manual de buffers.

---

## REQUISITOS DEL SERVIDOR

| Recurso | Mínimo | Recomendado |
|---------|--------|-------------|
| SO | Ubuntu 20.04/22.04/24.04 | Ubuntu 24.04 LTS |
| RAM | 2 GB | 4+ GB |
| Disco | 20 GB | 50+ GB (SSD recomendado) |
| CPU | 1 core | 2+ cores |
| Red | LAN | LAN + acceso a internet |

---

## INSTALACIÓN AUTOMÁTICA (Recomendado)

El script `install.sh` automatiza todo el proceso:

```bash
# Clonar el repositorio
git clone https://github.com/TU_REPO/omnisync-tv.git
cd omnisync-tv/server

# Ejecutar instalador como root
sudo bash install.sh
```

### ¿Qué hace el instalador?

1. **Detecta el sistema** — Verifica Ubuntu/Debian, versión, y hardware (SSD/HDD)
2. **Instala dependencias**:
   - Node.js 20 (runtime principal)
   - PM2 (gestor de procesos)
   - PostgreSQL (base de datos)
   - Nginx (proxy reverso y servidor web)
3. **Configura PostgreSQL** — Crea usuario, base de datos e importa schema
4. **Genera credenciales** — JWT secret aleatorio, contraseña de BD
5. **Compila el frontend** — Build de React y copia a `/var/www/streambox/`
6. **Configura Nginx** — Proxy reverso + puerto IPTV (25461)
7. **Crea directorio DVR** — `/data/dvr/` para almacenamiento de segmentos
8. **Optimiza el kernel** — `sysctl` para conexiones de red y límites de archivos
9. **Inicia la API** — Via PM2 con auto-restart y arranque al boot
10. **Crea administrador** — Primer usuario admin
11. **Verifica salud** — Health check automático al finalizar

### Reinstalación / Actualización

Si ya tienes una instalación previa, el script:
- Detecta la instalación existente
- Preserva credenciales (BD, JWT, admin)
- Actualiza código y dependencias
- Reinicia servicios

---

## INSTALACIÓN MANUAL

### Paso 1: Dependencias del sistema

```bash
sudo apt update && sudo apt upgrade -y
sudo apt install -y postgresql postgresql-contrib nginx git

# Node.js 20
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs

# PM2
sudo npm install -g pm2
```

### Paso 2: PostgreSQL

```bash
sudo -u postgres psql <<EOF
CREATE USER streambox_user WITH PASSWORD 'tu_password_seguro';
CREATE DATABASE streambox OWNER streambox_user;
GRANT ALL PRIVILEGES ON DATABASE streambox TO streambox_user;
EOF

sudo -u postgres psql -d streambox -f server/database/schema.sql
sudo -u postgres psql -d streambox -c "GRANT ALL ON ALL TABLES IN SCHEMA public TO streambox_user;"
sudo -u postgres psql -d streambox -c "GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO streambox_user;"
```

### Paso 3: API Node.js

```bash
cd server
npm install

# Editar index.js: configurar JWT_SECRET y password del Pool
node index.js  # Verificar que arranca

# Iniciar con PM2
pm2 start index.js --name streambox-api
pm2 startup && pm2 save
```

### Paso 4: Frontend

```bash
# Desde la raíz del proyecto
npm install && npm run build
sudo mkdir -p /var/www/streambox
sudo cp -r dist/* /var/www/streambox/
```

### Paso 5: Nginx

```bash
sudo cp server/nginx/streambox.conf /etc/nginx/sites-available/streambox
sudo ln -s /etc/nginx/sites-available/streambox /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl restart nginx && sudo systemctl enable nginx
```

### Paso 6: Crear administrador

```bash
curl -X POST http://localhost:3001/api/admin/setup \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@local.com","password":"tu_password_admin"}'
```

### Paso 7: Crear directorio DVR

```bash
sudo mkdir -p /data/dvr
sudo chown $(whoami):$(whoami) /data/dvr
```

---

## CÓMO FUNCIONA EL STREAMING

### Canales en Vivo (sin DVR)
1. Cliente solicita `/api/stream/:channelId`
2. Node.js valida JWT y permisos del plan
3. Devuelve la URL original del proveedor
4. La APK conecta directamente al origen

### Canales con DVR activado
1. Cliente solicita `/api/stream/:channelId`
2. Node.js detecta `dvr_enabled: true`
3. Inicia descarga de segmentos del origen (Node.js nativo)
4. **Fuentes HLS (.m3u8)**: descarga segmentos `.ts` directamente
5. **Fuentes MPEG-TS**: segmenta el stream en archivos `.ts` de 4s
6. Genera playlist `.m3u8` dinámica con los últimos 5 minutos
7. Devuelve URL local: `/api/dvr/playlist/:channelId`
8. La APK reproduce la playlist local (HLS estándar)

### VOD (Películas/Series)
1. Cliente solicita `/api/vod/stream/:filename` o `/api/series/stream/:filename`
2. Node.js lee el archivo con `fs.createReadStream`
3. Soporta Range Headers para seeking sin cargar todo en RAM
4. La APK puede avanzar/retroceder libremente

---

## ESTRUCTURA DE ARCHIVOS

```
/var/www/streambox/              ← Frontend React compilado
/opt/streambox/server/           ← API Node.js
  ├── index.js                   ← Servidor principal (todo en uno)
  ├── package.json
  └── database/
      └── schema.sql             ← Schema de PostgreSQL
/data/dvr/                       ← Almacenamiento DVR
  └── {channelId}/               ← Segmentos por canal
      ├── seg_000.ts
      ├── seg_001.ts
      └── playlist.m3u8
/etc/nginx/sites-available/
  └── streambox                  ← Config Nginx
```

---

## ACCESO AL SISTEMA

```bash
# Obtener IP del servidor
hostname -I
```

| Recurso | URL |
|---------|-----|
| Panel Admin | `http://IP_SERVIDOR/admin` |
| Login Cliente | `http://IP_SERVIDOR/login` |
| API Health | `http://IP_SERVIDOR/api/health` |

---

## COMANDOS ÚTILES

```bash
# Estado de la API
pm2 status

# Logs en tiempo real
pm2 logs streambox-api

# Reiniciar API
pm2 restart streambox-api

# Logs de Nginx
sudo tail -f /var/log/nginx/error.log

# Estado de PostgreSQL
sudo systemctl status postgresql

# Ver espacio DVR
du -sh /data/dvr/

# Limpiar DVR manualmente
rm -rf /data/dvr/*
```

---

## SOLUCIÓN DE PROBLEMAS

| Problema | Solución |
|----------|----------|
| API no conecta a PostgreSQL | Verificar `sudo systemctl status postgresql` y credenciales en `index.js` |
| Nginx error 502 | Verificar API: `pm2 status` y `pm2 logs streambox-api` |
| Streams no cargan | Verificar acceso al origen desde el servidor: `curl -I URL_ORIGEN` |
| DVR no graba | Verificar que `/data/dvr/` existe y tiene permisos de escritura |
| Clientes no acceden | Firewall: `sudo ufw allow 80` · Verificar misma red LAN |
| APK no conecta | Verificar que la IP del servidor está configurada en `build.gradle.kts` |

---

## DESINSTALACIÓN

```bash
cd server
sudo bash uninstall.sh
```
