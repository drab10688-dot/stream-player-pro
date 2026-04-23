---
name: Arquitectura Multicast L2TP validada en producción
description: Stack confirmado funcionando end-to-end VPS → L2TP → MikroTik → IGMP-Proxy → cliente VLC sin GRE ni smcroute
type: feature
---

# Arquitectura Multicast por L2TP (validada 2026-04)

## Flujo confirmado funcionando
```
[VPS FFmpeg] → ppp0 (172.16.50.1) → L2TP/IPsec → [MikroTik omnisync-l2tp]
   → IGMP-Proxy (upstream=omnisync-l2tp) → <l2tp-cliente> → [PC cliente] → VLC ✅
```

## Componentes clave

### En el VPS (xl2tpd cliente hacia MikroTik)
- Interfaz: `ppp0` con IP `172.16.50.1` (asignada por MikroTik)
- **NO usar GRE** (descartado, complejidad innecesaria)
- **NO usar smcroute** (no requerido si MikroTik hace IGMP-Proxy)
- FFmpeg envía multicast directamente a `udp://239.10.0.8:1234?localaddr=172.16.50.1`
- El parámetro `localaddr` es **OBLIGATORIO** para forzar salida por ppp0

### En MikroTik
- L2TP-out hacia VPS: `omnisync-l2tp` (1280 MTU)
- L2TP-in para clientes: `<l2tp-DUBER>` etc.
- IGMP-Proxy config:
  - `upstream=omnisync-l2tp` con `alternative-subnets=239.0.0.0/8`
  - Interfaces downstream: bridge clientes y túneles L2TP-in de clientes
  - `quick-leave=yes`
- **NO se levanta multicast manual**: el MikroTik hace join automático cuando llega IGMP del cliente

### En cliente final (VLC)
- URL: `udp://@239.10.0.8:1234`
- Funciona detrás de NAT y túneles encadenados

## Comando FFmpeg de referencia (TS directo, óptimo)
```bash
ffmpeg -nostdin -hide_banner -loglevel warning \
  -user_agent "VLC/3.0.20 LibVLC/3.0.20" \
  -rw_timeout 15000000 -reconnect 1 -reconnect_streamed 1 -reconnect_delay_max 5 \
  -i "http://ORIGEN.ts" \
  -c copy -f mpegts -muxrate 4000k -pcr_period 20 \
  "udp://239.10.0.8:1234?pkt_size=1316&ttl=8&buffer_size=2000000&localaddr=172.16.50.1"
```

## Tuning sysctl en VPS (anti-pixelado)
```bash
sysctl -w net.core.wmem_max=26214400
sysctl -w net.core.wmem_default=26214400
```
Persistir en `/etc/sysctl.conf`.

## Parámetros UDP críticos
- `pkt_size=1316`: encaja en MTU 1400 del L2TP (7×188 bytes TS)
- `buffer_size=2000000`: 2MB buffer salida
- `ttl=8`: suficiente para varios saltos
- `muxrate 3000k-4000k`: CBR estable evita picos
- `pcr_period 20`: PCR cada 20ms para sync A/V

## Preferencia origen
TS directo (`http://x/canal.ts`) > HLS (`.m3u8`):
- Menor latencia (<1s vs 6-30s)
- Menos CPU FFmpeg
- Menos reconexiones
- Menos pixelado por origen
