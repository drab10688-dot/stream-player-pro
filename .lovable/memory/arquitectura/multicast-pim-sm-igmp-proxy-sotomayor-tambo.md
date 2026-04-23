---
name: Multicast PIM-SM + IGMP-Proxy SOTOMAYOR ↔ TAMBO (L2TP)
description: Arquitectura validada para distribuir multicast entre routers MikroTik vía L2TP usando PIM-SM en origen e IGMP-Proxy en remoto. Reemplaza EoIP que enviaba todo el bouquet (96 Mbps) por solo el canal pedido (3.9 Mbps).
type: feature
---

# Arquitectura Multicast PIM-SM + IGMP-Proxy (validada 2026-04)

## Problema resuelto
EoIP entre routers transportaba TODO el bouquet (~96 Mbps) por el WAN sin importar qué canal pidiera el cliente final, porque EoIP es Layer 2 puro (bridge broadcast).

## Solución validada
Sustituir EoIP por **L2TP + PIM-SM (origen) + IGMP-Proxy (remoto)** = solo el canal pedido cruza el WAN (~3.9 Mbps por canal).

## Topología

```
Encoder (192.168.22.253) → multicast 224.2.2.201:4001
        │
        ▼
SOTOMAYOR (CCR2116) — PIM-SM activo (RP)
   bridge TV (ether9 + ether12 + encoder)
   L2TP-server con cliente "tambo"
        │
        ▼  L2TP/IPsec WAN — solo canal pedido
        │
TAMBO (RB1100) — IGMP-Proxy
   l2tp-out1 → upstream (alternative-subnets=224.0.0.0/4)
   br-iptv   → downstream (clientes LAN)
   <l2tp-DUBER> → downstream (cliente remoto vía L2TP)
```

## Configuración TAMBO (cliente remoto)

```routeros
/routing igmp-proxy
set quick-leave=yes

/routing igmp-proxy interface
add interface=l2tp-out1 upstream=yes alternative-subnets=224.0.0.0/4 threshold=1
add interface=br-iptv upstream=no threshold=1
add interface=<l2tp-cliente> upstream=no threshold=1
```

## Configuración SOTOMAYOR (origen)

PIM-SM con bridge TV como interfaz de origen y la L2TP del cliente "tambo" como interfaz adicional para que pueda recibir joins remotos.

## Verificación end-to-end

Con cliente reproduciendo `udp://@224.2.2.201:4001`:

```
/routing igmp-proxy mfc print
# Debe mostrar: AD 224.2.2.201 192.168.22.253 ACTIVE

/interface monitor-traffic l2tp-out1 once
# RX ~3-4 Mbps por canal activo (NO 96 Mbps del bouquet completo)
```

## Métricas validadas

| Métrica | EoIP (antes) | PIM+IGMP-Proxy (ahora) |
|---|---|---|
| WAN por canal | 96 Mbps (todo bouquet) | 3.9 Mbps (solo canal pedido) |
| Escalabilidad | Fija | Lineal con canales activos |
| Capa OSI | L2 (bridge) | L3 (multicast routing) |

## Lecciones clave

1. **EoIP NO sirve para multicast escalable**: es bridge L2, transporta todo el broadcast/multicast del segmento sin filtrar.
2. **PIM-SM en origen + IGMP-Proxy en remoto** es el patrón estándar para multicast over-WAN en MikroTik.
3. **L2TP es Layer 3** → soporta routing multicast nativo (a diferencia de EoIP).
4. **`alternative-subnets=224.0.0.0/4`** en el upstream es obligatorio para que IGMP-Proxy acepte el rango multicast completo.
5. Mismo patrón que cliente VPS→MikroTik (validado previamente en `multicast-l2tp-validado-produccion.md`).
