---
name: Encoder Multicast FFmpeg On-Demand
description: Conversión HTTP/HLS/TS unicast → UDP multicast con FFmpeg en VPS, on-demand por canal. Auto-arranque al asignar canal a sector, auto-stop tras 60s sin uso. Excepción explícita a "no FFmpeg".
type: feature
---

Sistema de encoders FFmpeg que convierte streams HTTP/HLS/TS en UDP multicast para distribución por VPN a sectores MikroTik.

**EXCEPCIÓN a regla "no FFmpeg":** Aprobada explícitamente para multicast (no aplica a streaming directo a APK ni VOD, que siguen 100% nativos).

**Arquitectura:**
- `server/multicast-encoder.js`: gestor de procesos FFmpeg en memoria (Map por channel_id).
- `server/vpn-routes.js`: endpoints `/api/vpn/encoders` (list/start/stop/sync).
- Auto-arranque al hacer POST `/api/vpn/sectors/:id/channels` (asignar canales).
- Loop de mantenimiento (5s): heartbeat + auto-stop si idle > 60s.

**Selección de codec (automática vía ffprobe):**
- Origen H.264+AAC → `copy` (sin transcoding, ~1-2% CPU)
- Otro codec → `transcode` libx264+aac veryfast zerolatency (~15-25% CPU/canal SD)

**Comando FFmpeg base:**
```
ffmpeg -fflags +genpts+nobuffer -user_agent "VLC/3.0.20 LibVLC/3.0.20" \
       -reconnect 1 -reconnect_streamed 1 -reconnect_delay_max 5 \
       -i <source> -c copy -bsf:v h264_mp4toannexb -f mpegts \
       udp://239.10.0.X:1234?pkt_size=1316&ttl=4
```

**Tabla BD `multicast_encoders`:**
- channel_id (UNIQUE), multicast_group_id, pid, status (stopped/running/error)
- codec_mode (copy/transcode), source_codec_video, source_codec_audio
- cpu_percent, bitrate_kbps, last_error, started_at, last_heartbeat

**UI:** Pestaña "Encoders FFmpeg" en `VpnSectorsManager.tsx` con stats live, start/stop manual y warning si FFmpeg no instalado.

**Instalación:** `install-vpn.sh` instala ffmpeg vía apt. Detección runtime via `ffmpeg -version`.
