---
name: Multicast PIM-SM + IGMP-Proxy SOTOMAYOR ↔ TAMBO (L2TP) - VALIDADO END-TO-END
description: Arquitectura validada en producción para distribuir multicast entre MikroTiks vía L2TP usando PIM-SM en origen e IGMP-Proxy en remoto, con clientes L2TP-in dinámicos convertidos a binding estático. Reemplaza EoIP que enviaba todo el bouquet (96 Mbps) por solo el canal pedido.
type: feature
---

# Arquitectura Multicast PIM-SM + IGMP-Proxy (validada end-to-end 2026-04)

## Problema resuelto
EoIP entre routers transportaba TODO el bouquet (~96 Mbps) por el WAN sin importar qué canal pidiera el cliente final, porque EoIP es Layer 2 puro (bridge broadcast).

## Solución validada end-to-end
Sustituir EoIP por **L2TP + PIM-SM (origen) + IGMP-Proxy (remoto) + L2TP-server-binding estático para clientes finales** = solo el canal pedido cruza el WAN.

## Topología
```
Encoder (192.168.22.253) → multicast 224.2.2.x:400x
        │
SOTOMAYOR (CCR2116) — PIM-SM activo (RP)
   bridge TV (ether9 + ether12 + encoder)
   L2TP-server con cliente "tambo"
        │
        ▼  L2TP/IPsec WAN — solo canal pedido
        │
TAMBO (RB1100) — IGMP-Proxy
   l2tp-out1 → upstream (alternative-subnets=224.0.0.0/4)
   br-iptv   → downstream (clientes LAN)
   l2tp-<cliente> (binding ESTÁTICO) → downstream (cliente remoto vía L2TP)
        │
        ▼
   PC/Portátil cliente → VLC udp://@224.2.2.x:400x ✅
```

## Configuración TAMBO (cliente remoto)

```routeros
/routing igmp-proxy
set quick-leave=yes

/routing igmp-proxy interface
add interface=l2tp-out1 upstream=yes alternative-subnets=224.0.0.0/4 threshold=1
add interface=br-iptv upstream=no threshold=1
add interface=l2tp-<cliente> upstream=no threshold=1
```

## ⚠️ FIX CRÍTICO: L2TP-server bindings estáticos para clientes finales

**Problema observado:** Las interfaces L2TP-in dinámicas (mostradas como `<l2tp-NOMBRE>`) NO son matcheadas correctamente por el IGMP-Proxy. El `mfc print detail` muestra `downstream-interfaces=""` vacío y el multicast nunca se reenvía al cliente.

**Solución:** Crear binding estático ANTES de que el cliente conecte:

```routeros
/interface l2tp-server add name=l2tp-duber user=DUBER
/routing igmp-proxy interface remove [find interface=<l2tp-DUBER>]
/routing igmp-proxy interface add interface=l2tp-duber upstream=no threshold=1
```

Después el cliente reconecta y aparece como `l2tp-duber` (nombre fijo, sin `<>`). El IGMP-Proxy ya puede matchearlo y reenviar el grupo.

## Firewall (permitir multicast en forward)

```routeros
/ip firewall filter add chain=forward action=accept protocol=udp dst-address=224.0.0.0/4 place-before=0 comment="Multicast IPTV"
/ip firewall filter add chain=forward action=accept protocol=igmp place-before=0 comment="IGMP"
```

## MSS clamping para túneles L2TP cliente

```routeros
/ip firewall mangle add chain=forward out-interface=l2tp-<cliente> protocol=tcp tcp-flags=syn action=change-mss new-mss=1320 passthrough=yes
```

## Verificación end-to-end

Con cliente reproduciendo `udp://@224.2.2.202:4002`:

```routeros
/routing igmp-proxy mfc print detail
# AD group=224.2.2.202 source=192.168.22.253 
#    upstream-interface=l2tp-out1
#    downstream-interfaces="l2tp-duber"          ← debe aparecer el binding
#    active-downstream-interfaces="l2tp-duber"
#    bytes>0 packets>0

/interface monitor-traffic l2tp-out1 once
# RX ~3-20 Mbps según canal

/interface monitor-traffic l2tp-duber once
# TX ~3-4 Mbps mientras VLC esté abierto
# TX = 0 cuando VLC cierra (IGMP leave automático) ✅
```

## Comportamiento esperado validado

| Acción cliente | Tráfico túnel cliente | Tráfico l2tp-out1 |
|---|---|---|
| Abre VLC con grupo | TX sube a ~3-4 Mbps | RX sube por canal |
| Cierra VLC | TX cae a 0 | RX cae si nadie más mira ese grupo |
| Cambia canal | TX se mantiene, group cambia en mfc | l2tp-out1 hace nuevo join |

## Lecciones clave

1. **EoIP NO sirve para multicast escalable**: es bridge L2, transporta todo el broadcast/multicast del segmento.
2. **PIM-SM en origen + IGMP-Proxy en remoto** es el patrón estándar MikroTik para multicast over-WAN.
3. **L2TP es Layer 3** → soporta routing multicast nativo (a diferencia de EoIP).
4. **`alternative-subnets=224.0.0.0/4`** en el upstream es obligatorio.
5. 🔥 **CRÍTICO: clientes L2TP-in dinámicos (`<l2tp-X>`) deben convertirse en binding estático (`l2tp-x`)** o el IGMP-Proxy NO los matchea como downstream.
6. **`quick-leave=yes`** corta el multicast inmediatamente cuando el cliente cierra el reproductor (validado: TX cae a 0 al cerrar VLC).
