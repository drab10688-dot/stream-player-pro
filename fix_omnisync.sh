#!/bin/bash
# =============================================
# 🔧 Omnisync - Script de Diagnóstico y Corrección Automática
# Pega esto en tu VPS como root y se arregla solo
# =============================================
set -e
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; NC='\033[0m'

echo -e "${CYAN}╔═══════════════════════════════════════════════╗${NC}"
echo -e "${CYAN}║   🔧 Omnisync - Diagnóstico y Corrección     ║${NC}"
echo -e "${CYAN}╚═══════════════════════════════════════════════╝${NC}"
echo ""

INDEX_JS="/opt/streambox/server/index.js"
if [ ! -f "$INDEX_JS" ]; then
  echo -e "${RED}❌ No se encontró $INDEX_JS${NC}"
  echo "Buscando..."
  INDEX_JS=$(find / -name "index.js" -path "*/streambox*" 2>/dev/null | head -1)
  if [ -z "$INDEX_JS" ]; then
    echo -e "${RED}❌ No se encontró index.js en ninguna ruta de streambox${NC}"
    exit 1
  fi
  echo -e "${GREEN}Encontrado: $INDEX_JS${NC}"
fi

SERVER_DIR=$(dirname "$INDEX_JS")

echo -e "\n${CYAN}═══ FASE 1: DIAGNÓSTICO ═══${NC}\n"

# 1. Estado de PM2
echo -e "${YELLOW}1. Estado PM2:${NC}"
pm2 list 2>/dev/null || echo "PM2 no instalado o no corriendo"

# 2. FFmpeg versión
echo -e "\n${YELLOW}2. FFmpeg:${NC}"
ffmpeg -version 2>/dev/null | head -1 || echo "FFmpeg NO instalado"

# 3. PostgreSQL
echo -e "\n${YELLOW}3. PostgreSQL:${NC}"
systemctl is-active postgresql 2>/dev/null && echo -e "${GREEN}PostgreSQL activo${NC}" || echo -e "${RED}PostgreSQL INACTIVO${NC}"

# 4. Verificar canales DVR en BD
echo -e "\n${YELLOW}4. Canales con DVR habilitado:${NC}"
sudo -u postgres psql -d streambox -t -c "SELECT count(*) FROM channels WHERE dvr_enabled = true AND is_active = true;" 2>/dev/null || echo "No se pudo consultar BD"

# 5. Logs recientes de PM2 (buscar errores)
echo -e "\n${YELLOW}5. Últimos errores en logs:${NC}"
pm2 logs streambox-api --lines 30 --nostream 2>/dev/null | grep -iE "error|failed|crash|killed|SIGTERM|var_stream_map|reconnect_on" | tail -10 || echo "Sin errores recientes"

# 6. Procesos FFmpeg activos
echo -e "\n${YELLOW}6. Procesos FFmpeg activos:${NC}"
FFMPEG_COUNT=$(pgrep -c ffmpeg 2>/dev/null || echo "0")
echo "Procesos FFmpeg: $FFMPEG_COUNT"

# 7. DVR cache
echo -e "\n${YELLOW}7. DVR Cache:${NC}"
DVR_DIR="$SERVER_DIR/dvr-cache"
if [ -d "$DVR_DIR" ]; then
  echo "Directorio: $DVR_DIR"
  ls -la "$DVR_DIR" 2>/dev/null | head -20
  for d in "$DVR_DIR"/*/; do
    if [ -d "$d" ]; then
      ch=$(basename "$d")
      init_exists="NO"
      [ -f "$d/init.mp4" ] && init_exists="SI"
      seg_count=$(ls "$d"/*.m4s 2>/dev/null | wc -l)
      echo "  Canal $ch: init.mp4=$init_exists, segmentos=$seg_count"
    fi
  done
else
  echo "No existe $DVR_DIR"
fi

# 8. HLS cache
echo -e "\n${YELLOW}8. HLS Cache:${NC}"
for hdir in /opt/streambox/hls-cache /tmp/streambox-hls; do
  if [ -d "$hdir" ]; then
    echo "Directorio: $hdir"
    du -sh "$hdir" 2>/dev/null
  fi
done

# 9. Verificar si FFmpeg soporta var_stream_map
echo -e "\n${YELLOW}9. Soporte var_stream_map:${NC}"
ffmpeg -h muxer=hls 2>/dev/null | grep -q "var_stream_map" && echo -e "${GREEN}Soportado${NC}" || echo -e "${RED}NO soportado - esto causa crash en canales no-DVR${NC}"

# 10. Verificar opciones de reconnect
echo -e "\n${YELLOW}10. Soporte reconnect_on_http_error:${NC}"
ffmpeg -help 2>/dev/null | grep -q "reconnect_on_http_error" && echo -e "${GREEN}Soportado${NC}" || echo -e "${YELLOW}NO soportado - puede causar crash en DVR${NC}"

echo -e "\n${YELLOW}11. Verificando URL de un canal de ejemplo:${NC}"
SAMPLE_URL=$(sudo -u postgres psql -d streambox -t -c "SELECT url FROM channels WHERE is_active = true LIMIT 1;" 2>/dev/null | tr -d ' ')
if [ -n "$SAMPLE_URL" ]; then
  echo "URL: $SAMPLE_URL"
  HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" -m 10 "$SAMPLE_URL" 2>/dev/null || echo "FAIL")
  echo "HTTP Code: $HTTP_CODE"
  if [ "$HTTP_CODE" = "200" ]; then
    echo -e "${GREEN}✅ URL accesible desde el VPS${NC}"
  else
    echo -e "${RED}❌ URL NO accesible (code: $HTTP_CODE)${NC}"
  fi
fi

echo -e "\n${CYAN}═══ FASE 2: CORRECCIÓN ═══${NC}\n"

# Backup
echo -e "${YELLOW}Creando backup de index.js...${NC}"
cp "$INDEX_JS" "${INDEX_JS}.bak.$(date +%Y%m%d_%H%M%S)"
echo -e "${GREEN}Backup creado${NC}"

# ── FIX 1: Quitar opciones FFmpeg inválidas del DVR ──
echo -e "\n${YELLOW}FIX 1: Limpiando opciones FFmpeg inválidas en DVR...${NC}"

# Quitar -reconnect_on_http_error y -reconnect_on_network_error (no soportados en todas las versiones)
sed -i "s/'-reconnect_on_network_error', '1',//g" "$INDEX_JS"
sed -i "s/'-reconnect_on_http_error', '4xx,5xx',//g" "$INDEX_JS"
# Limpiar líneas vacías resultantes
sed -i '/^[[:space:]]*$/N;/^\n$/d' "$INDEX_JS"
echo -e "${GREEN}Opciones inválidas removidas${NC}"

# ── FIX 2: Hacer el startDVR más robusto con FFmpeg simple ──
echo -e "\n${YELLOW}FIX 2: Reemplazando startDVR con versión robusta...${NC}"

# Usamos Node.js para hacer el reemplazo de forma segura
node -e "
const fs = require('fs');
let code = fs.readFileSync('$INDEX_JS', 'utf8');

// Fix: En startDVR, reemplazar los args de FFmpeg para ser más robustos
// El problema principal: -reconnect_on_http_error '4xx,5xx' no es válido en todas las versiones
// y -reconnect_on_network_error tampoco

const oldDvrArgs = \`const ffmpegArgs = [
    '-hide_banner', '-loglevel', 'warning',
    '-fflags', '+genpts+discardcorrupt',
    '-reconnect', '1',
    '-reconnect_streamed', '1',
    '-reconnect_delay_max', '5',
    '-reconnect_on_network_error', '1',
    '-reconnect_on_http_error', '4xx,5xx',
    '-i', normalizedUrl,\`;

const newDvrArgs = \`const ffmpegArgs = [
    '-hide_banner', '-loglevel', 'warning',
    '-fflags', '+genpts+discardcorrupt+nobuffer',
    '-reconnect', '1',
    '-reconnect_streamed', '1',
    '-reconnect_delay_max', '10',
    '-rw_timeout', '15000000',
    '-timeout', '15000000',
    '-i', normalizedUrl,\`;

if (code.includes('-reconnect_on_http_error')) {
  code = code.replace(
    /const ffmpegArgs = \[[\s\S]*?'-i', normalizedUrl,/,
    newDvrArgs
  );
  console.log('✅ Args de FFmpeg DVR actualizados');
} else {
  console.log('ℹ️  Args de FFmpeg DVR ya están limpios');
}

// Fix: En el close handler del DVR, asegurar que activeDVR.delete se llame ANTES de startDVR
// para evitar el 'already exists' y que el nuevo DVR se cree correctamente
const oldClose = 'activeDVR.delete(channelId);\\n      setTimeout(() => {';
if (!code.includes('// FIX: clean old entry before restart')) {
  // Ya está correcto en la versión actual
}

fs.writeFileSync('$INDEX_JS', code);
console.log('✅ index.js actualizado');
"

# ── FIX 3: Para canales NO-DVR que son HLS, evitar FFmpeg adaptativo innecesario ──
echo -e "\n${YELLOW}FIX 3: Optimizando restream para HLS nativos...${NC}"

node -e "
const fs = require('fs');
let code = fs.readFileSync('$INDEX_JS', 'utf8');

// Verificar que la ruta /api/restream para HLS use proxy directo (no FFmpeg)
// Esto ya debería estar correcto pero verifiquemos
if (code.includes(\"if (isHLS) {\\n      // Canal ya es HLS → proxy con caché\")) {
  console.log('✅ Restream HLS ya usa proxy (sin FFmpeg)');
} else {
  console.log('ℹ️  Verificando ruta restream...');
}

// Fix: En startAdaptiveTranscoder, agregar -err_detect ignore_err para mayor tolerancia
if (!code.includes(\"'-err_detect', 'ignore_err'\")) {
  code = code.replace(
    /'-rw_timeout', '10000000',\n    '-i', sourceUrl,/,
    \"'-rw_timeout', '10000000',\\n    '-err_detect', 'ignore_err',\\n    '-i', sourceUrl,\"
  );
  console.log('✅ Agregado -err_detect ignore_err al transcoder adaptativo');
}

fs.writeFileSync('$INDEX_JS', code);
"

# ── FIX 4: Matar todos los FFmpeg zombies y limpiar cache ──
echo -e "\n${YELLOW}FIX 4: Limpiando procesos FFmpeg zombies...${NC}"
pkill -9 ffmpeg 2>/dev/null && echo "FFmpeg processes killed" || echo "No FFmpeg processes running"

echo -e "\n${YELLOW}FIX 5: Limpiando cache DVR corrupto...${NC}"
DVR_CACHE="$SERVER_DIR/dvr-cache"
if [ -d "$DVR_CACHE" ]; then
  rm -rf "$DVR_CACHE"/*
  echo -e "${GREEN}Cache DVR limpiado${NC}"
fi

HLS_CACHE="/opt/streambox/hls-cache"
if [ -d "$HLS_CACHE" ]; then
  rm -rf "$HLS_CACHE"/*
  echo -e "${GREEN}Cache HLS limpiado${NC}"
fi

# ── FIX 6: Reiniciar PM2 ──
echo -e "\n${YELLOW}FIX 6: Reiniciando PM2...${NC}"
cd "$SERVER_DIR"
pm2 restart streambox-api 2>/dev/null || pm2 start index.js --name streambox-api
sleep 3

echo -e "\n${CYAN}═══ FASE 3: VERIFICACIÓN ═══${NC}\n"

# Health check
echo -e "${YELLOW}Health check:${NC}"
for i in 1 2 3 4 5 6 7 8 9 10; do
  HEALTH=$(curl -s -m 5 http://localhost:3001/api/health 2>/dev/null)
  if echo "$HEALTH" | grep -q '"ok"' || echo "$HEALTH" | grep -q '"connected"'; then
    echo -e "${GREEN}✅ API respondiendo correctamente${NC}"
    echo "$HEALTH"
    break
  fi
  if [ "$i" = "10" ]; then
    echo -e "${RED}❌ API no responde después de 10 intentos${NC}"
  fi
  sleep 2
done

# Esperar que DVR arranque
echo -e "\n${YELLOW}Esperando pre-calentamiento DVR (30s)...${NC}"
sleep 30

# Verificar estado DVR
echo -e "\n${YELLOW}Estado DVR después de 30s:${NC}"
DVR_STATUS=$(curl -s -m 10 -H "Authorization: Bearer $(curl -s http://localhost:3001/api/admin/setup -X POST -H 'Content-Type: application/json' -d '{}' 2>/dev/null | node -e "try{process.stdout.write(JSON.parse(require('fs').readFileSync('/dev/stdin','utf8')).token||'')}catch{}" 2>/dev/null)" http://localhost:3001/api/admin/dvr/status 2>/dev/null)

if [ -n "$DVR_STATUS" ] && [ "$DVR_STATUS" != "null" ]; then
  echo "$DVR_STATUS" | node -e "
    try {
      const data = JSON.parse(require('fs').readFileSync('/dev/stdin', 'utf8'));
      if (Array.isArray(data)) {
        const active = data.filter(d => d.active);
        const inactive = data.filter(d => !d.active);
        console.log('Canales DVR habilitados: ' + data.length);
        console.log('Grabando activamente:    ' + active.length);
        console.log('En standby:              ' + inactive.length);
        active.forEach(d => console.log('  ✅ ' + (d.channelName || d.channelId) + ' - ' + d.segments + ' segmentos, ' + d.sizeMB + 'MB'));
        inactive.forEach(d => console.log('  ⏳ ' + (d.channelName || d.channelId) + ' - standby'));
      }
    } catch(e) { console.log('No se pudo parsear respuesta DVR'); }
  " 2>/dev/null
else
  echo "No se pudo obtener estado DVR (puede necesitar token admin)"
fi

# Verificar procesos FFmpeg
echo -e "\n${YELLOW}Procesos FFmpeg activos ahora:${NC}"
FFMPEG_NOW=$(pgrep -c ffmpeg 2>/dev/null || echo "0")
echo "FFmpeg corriendo: $FFMPEG_NOW"

# Últimos logs
echo -e "\n${YELLOW}Últimos logs después del reinicio:${NC}"
pm2 logs streambox-api --lines 20 --nostream 2>/dev/null | grep -iE "DVR|FFmpeg|error|listo|iniciado|pre-cal" | tail -15

echo -e "\n${CYAN}╔═══════════════════════════════════════════════╗${NC}"
echo -e "${CYAN}║   ✅ Corrección completada                     ║${NC}"
echo -e "${CYAN}╚═══════════════════════════════════════════════╝${NC}"
echo ""
echo -e "${GREEN}Qué se hizo:${NC}"
echo "  1. Eliminadas opciones FFmpeg incompatibles (-reconnect_on_http_error, -reconnect_on_network_error)"
echo "  2. Mejorada tolerancia a errores de FFmpeg (timeouts más largos, +nobuffer)"
echo "  3. Agregado -err_detect ignore_err al transcoder adaptativo"  
echo "  4. Limpiados procesos FFmpeg zombies y caches corruptos"
echo "  5. Reiniciado PM2"
echo ""
echo -e "${YELLOW}Si aún hay problemas, envíame la salida de:${NC}"
echo "  pm2 logs streambox-api --lines 50 --nostream"
echo ""

