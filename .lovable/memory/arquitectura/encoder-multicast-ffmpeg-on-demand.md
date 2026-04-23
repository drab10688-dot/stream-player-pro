---
name: Encoder Multicast FFmpeg On-Demand (sin GRE/smcroute)
description: Conversión HTTP/HLS/TS unicast → UDP multicast con FFmpeg en VPS, on-demand por canal. Multicast sale directo por ppp0 vía localaddr (sin GRE, sin smcroute). Auto-arranque al asignar canal a sector, auto-stop tras 60s sin uso. Excepción explícita a "no FFmpeg".
type: feature
---

Sistema de encoders FFmpeg que convierte streams HTTP/HLS/TS en UDP multicast para distribución por VPN a sectores MikroTik.

**EXCEPCIÓN a regla "no FFmpeg":** Aprobada explícitamente para multicast (no aplica a streaming directo a APK ni VOD, que siguen 100% nativos).

**Decisión clave (2026-04-23): SIN GRE, SIN smcroute.**
- GRE encapsulado dentro de PPP/L2TP causa drops masivos por loop de neighbor discovery cuando el peer GRE está dentro del mismo túnel L2TP.
- smcroute solo reenvía multicast que ENTRA por una interfaz física, no el generado localmente por FFmpeg.
- **Solución:** FFmpeg envía directamente por ppp0 usando `localaddr` en la URL UDP.

**Arquitectura:**
- `server/multicast-encoder.js`: gestor de procesos FFmpeg en memoria (Map por channel_id). Usa `VPN_LOCAL_IP` (default `172.16.50.1`) como `localaddr`.
- `server/vpn-routes.js`: endpoints `/api/vpn/encoders` (list/start/stop/sync).
- Auto-arranque al hacer POST `/api/vpn/sectors/:id/channels` (asignar canales).
- Loop de mantenimiento (5s): heartbeat + auto-stop si idle > 60s.

**Selección de codec (automática vía ffprobe, validado 2026-04-23):**
- Video válido para `copy`: `h264`, `hevc`, `mpeg2video` (todos soportados por mpegts).
- Audio válido para `copy`: `aac`, `mp2`, `mp3`, `ac3`.
- Si codec compatible → `-c copy` puro (CPU 1-2%).
- Bitstream filter `h264_mp4toannexb` se aplica **SOLO si video=h264**. Aplicarlo a mpeg2video/hevc rompe el encoder con "Codec not supported by the bitstream filter".
- Si probe falla o codec incompatible → transcode libx264+aac veryfast zerolatency (~15-25% CPU/canal SD).

**Comando FFmpeg validado en producción:**
```
ffmpeg -nostdin -hide_banner -loglevel warning \
       -user_agent "VLC/3.0.20 LibVLC/3.0.20" \
       -fflags +genpts \
       -reconnect 1 -reconnect_streamed 1 -reconnect_delay_max 5 \
       -i <source> \
       -c copy [-bsf:v h264_mp4toannexb si h264] \
       -f mpegts -mpegts_flags +resend_headers -mpegts_copyts 1 \
       -muxdelay 0 -muxpreload 0 \
       'udp://239.10.0.X:1234?pkt_size=1316&ttl=8&localaddr=172.16.50.1'
```
- `pkt_size=1316` (7×188 TS) cabe en MTU 1400 de ppp0 sin fragmentar.
- `localaddr=172.16.50.1` fuerza salida por ppp0 hacia MikroTik vía L2TP.
- `-nostdin` evita Stopped si se lanza con `&`.
- `-mpegts_copyts 1` preserva timestamps originales (mejor sync TS directo).
- Sin muxrate forzado (deja al origen marcar bitrate).

**Tabla BD `multicast_encoders`:**
- channel_id (UNIQUE), multicast_group_id, pid, status (stopped/running/error)
- codec_mode (copy/transcode), source_codec_video, source_codec_audio
- cpu_percent, bitrate_kbps, last_error, started_at, last_heartbeat

**UI:** Pestaña "Encoders FFmpeg" en `VpnSectorsManager.tsx` con stats live, start/stop manual y warning si FFmpeg no instalado.

**MikroTik:** debe tener `igmp-proxy` configurado escuchando en la interfaz L2TP (upstream) y reenviando hacia las interfaces LAN (downstream).

**Instalación:** `install-vpn.sh` instala ffmpeg vía apt + sysctl wmem/rmem 25MB anti-pixelado. Detección runtime via `ffmpeg -version`.
