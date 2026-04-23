# Memory: index.md
Updated: now

# Project Memory

## Core
- 100% Native Node.js streaming para APK/VOD/HLS. NO FFmpeg para esos flujos. NO DVR.
- EXCEPCIÓN: FFmpeg permitido SOLO para encoder multicast (HTTP→UDP) on-demand vía `multicast-encoder.js`.
- Strict 1-to-N proxy strategy: maintain exactly one connection to origin per active channel.
- Web UI restricted to Admin/Resellers (`/` redirects to `/admin`). No client web player.
- Design: Turquoise/Cyan (#00C9A7), Purple, Outfit font, glassmorphism, light bg.
- File paths: Backend at `/opt/streambox/server`, Frontend at `/var/www/streambox`.
- Port mappings: Nginx 25461 -> Node 3001 (APK), 80/443 (Admin).
- Session constraint: `userId:device_id` per device. Do not close session on channel change.
- Provider requests use User-Agent: `VLC/3.0.20 LibVLC/3.0.20`.
- VPN L2TP cliente: VPS xl2tpd → MikroTik. ppp0 con IP 172.16.50.1. NO GRE, NO smcroute.
- FFmpeg multicast: usar `localaddr=172.16.50.1` para forzar salida por ppp0. MikroTik hace IGMP-Proxy (upstream=l2tp-out, alternative-subnets=239.0.0.0/8).
- FFmpeg params óptimos: pkt_size=1316, buffer_size=2000000, muxrate 3000-4000k, pcr_period 20, ttl=8.
- Origen preferido: TS directo (.ts) > HLS (.m3u8) por menor latencia y menos pixelado.

## Memories
- [Multicast L2TP validado](mem://arquitectura/multicast-l2tp-validado-produccion) — Stack confirmado funcionando: VPS→L2TP→MikroTik IGMP-Proxy→VLC sin GRE
- [VPN L2TP+Multicast](mem://arquitectura/vpn-l2tp-ipsec-multicast-sectores) — strongSwan+xl2tpd+smcroute+GRE para sectores MikroTik
- [Encoder multicast FFmpeg](mem://arquitectura/encoder-multicast-ffmpeg-on-demand) — HTTP→UDP on-demand, auto copy/transcode, auto-stop 60s
- [Port mappings](mem://arquitectura/mapping-puertos-apk) — Nginx 25461 -> 3001 for APK, 80/443 for Admin
- [System paths](mem://gestion/rutas-sistema-vps) — Backend in /opt/streambox/server, frontend in /var/www/streambox
- [APK ads logic](mem://funcionalidades/logica-rotacion-anuncios-apk) — 32x32px overlay, 30s rotation, `imageUrl` and `type`
- [APK realtime tracking](mem://funcionalidades/monitoreo-espectadores-apk-realtime) — `touchApkPresence` with composite key, 5m timeout
- [Reseller portal](mem://funcionalidades/portal-gestion-revendedores) — Portal at /reseller with quota management
- [Plan categories](mem://funcionalidades/control-acceso-planes-categorias) — Dynamic channel restriction by plan categories
- [Cloudflare Tunnel IP hiding](mem://seguridad/integracion-cloudflare-tunnel-ip-oculta) — M3U URLs use `window.location.origin` for tunnel proxy
- [Admin-only web access](mem://interfaz/politica-acceso-web-solo-admin) — Redirection to /admin, no web player
- [Glassmorphism design](mem://estilo/estetica-moderna-glassmorphism) — Outfit font, Turquoise #00C9A7, light background
- [APK sync strategy](mem://arquitectura/estrategia-sincronizacion-apk-backend) — Sync via API, auto-disable failing channels
- [Client playlist formats](mem://funcionalidades/formatos-playlist-cliente-compatibilidad) — M3U, M3U8, Xtream Codes, TS, EPG
- [Deployment flow](mem://gestion/flujo-verificacion-despliegue) — Lovable to /var/www/streambox/, Backend to /opt/streambox/server/
- [TS conditional CORS](mem://tecnico/manejo-cors-reproduccion-ts-condicional) — Omit crossOrigin for .ts video tags
- [Admin registration restricted](mem://seguridad/restriccion-registro-admin-interfaz) — No public admin registration 
- [Nginx unlimited VOD payload](mem://seguridad/configuracion-nginx-vod-payload-ilimitado) — client_max_body_size 0 for VOD uploads
- [Device UUID persistence](mem://movil/identidad-dispositivo-uuid-persistencia) — APK device_id persistence for login
- [Optimized APK login API](mem://arquitectura/api-optimizada-apk-login-centralizado) — Port 3001 login returns JWT, ads, VOD, series
- [Android Gradle setup](mem://movil/entorno-compilacion-android-gradle-config) — com.omnisync.tv, requires JDK 17
- [JWT query parameter auth](mem://tecnico/autenticacion-stream-jwt-query-parameter) — Auth via ?token=... for video players
- [Native APK architecture](mem://movil/arquitectura-apk-nativa-kotlin-android-vlc) — Kotlin, LibVLC, Retrofit, Foreground Service heartbeat
- [Simplified APK UI](mem://movil/arquitectura-interfaz-apk-simplificada) — Hardcoded API_BASE_URL, AuthInterceptor for JWT
- [Unified API routes](mem://arquitectura/unificacion-rutas-api-admin-apk) — Unified routes, legacy stream endpoint maintained
- [Unified streaming episodes](mem://arquitectura/gestion-streaming-unificado-vod-episodios) — /api/vod/stream/:id for movies and series
- [Admin series hierarchy](mem://funcionalidades/gestion-series-jerarquia-admin) — Series -> Season -> Episode
- [Stream type detection](mem://tecnico/deteccion-tipo-stream-proxy-web-player) — Detect HLS/TS via query params in proxy
- [APK session single device](mem://arquitectura/gestion-sesiones-apk-dispositivo-unico) — Replace session on channel change
- [APK session lifecycle](mem://movil/gestion-ciclo-vida-sesion-apk) — Only close session on manual logout
- [VOD range headers](mem://tecnico/streaming-vod-soporte-range-headers-seeking) — Support HEAD and Accept-Ranges: bytes
- [Local channels priority](mem://arquitectura/prioridad-deduplicacion-canales-locales) — Deduplicate by prioritizing local DB
- [Heartbeat autostart](mem://movil/persistencia-sesion-heartbeat-autostart) — Persist session for auto heartbeat
- [Unified ads format](mem://tecnico/unificacion-formato-anuncios-apk) — imageUrl, type, durationSeconds
- [External IPTV endpoints](mem://tecnico/endpoint-compatibilidad-iptv-externo-detalles) — 1-to-N proxy, HLS and TS pipelines
- [Playlist memory cache](mem://arquitectura/cache-memoria-playlist-canales) — channelListCache invalidated on CRUD
- [Tunnel URL selector](mem://interfaz/selector-url-tunel-clientes) — Toggle Cloudflare tunnel/IP links
- [Xtream API cache](mem://tecnico/optimizacion-rendimiento-api-xtream-cache) — authCache 30s, planCache 2m
- [Git credentials restore](mem://despliegue/gestion-credenciales-actualizacion-git) — Restore streambox_db_pass after pull
- [Native VOD readstream](mem://tecnico/optimizacion-vod-readstream-range-headers-nativo) — fs.createReadStream with Range
- [Simplified native deploy](mem://despliegue/flujo-instalacion-nativo-nodejs-simplificado) — Node 20, PM2, no FFmpeg/DVR
- [Native sockets latency](mem://tecnico/optimizacion-latencia-sockets-streaming-nativo-v2) — setNoDelay(true) and X-Accel-Buffering: no
- [HLS native strategy](mem://arquitectura/estrategia-streaming-nativo-pipe-proxy-hls-v2) — Persistent agents for HLS, Pipe for TS
- [Source shielding](mem://arquitectura/aislamiento-total-fuente-vps-shielding-nativo-v2) — Hide original URLs, strict 1-to-N
- [Provider user-agent](mem://tecnico/spoofing-user-agent-vlc-proveedor) — VLC/3.0.20 LibVLC/3.0.20 user agent
- [Removed DVR architecture](mem://proyecto/limpieza-total-arquitectura-dvr) — DVR removed for efficiency
- [Native ABR](mem://arquitectura/abr-buffer-adaptativo-netflix-nativo) — Adjust chunk size dynamically
- [Pipe proxy reconnect](mem://tecnico/resiliencia-reconexion-pipe-proxy) — Auto-reconnect with 2s-15s backoff
- [VPN L2TP multicast sectors](mem://arquitectura/vpn-l2tp-ipsec-multicast-sectores) — L2TP/IPsec + GRE for multicast distribution to remote MikroTik sectors
