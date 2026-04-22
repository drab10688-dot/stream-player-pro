---
name: VPN L2TP/IPsec + Multicast Sectores
description: Concentrador L2TP/IPsec con GRE para distribución multicast a sectores MikroTik remotos. Tablas vpn_sectors, multicast_groups, sector_channel_map. Requiere install-vpn.sh en VPS.
type: feature
---

Sistema VPN para distribuir canales por multicast UDP a sectores MikroTik remotos.

**Componentes sistema (instalación manual via `server/install-vpn.sh`):**
- strongSwan (IPsec PSK), xl2tpd (L2TP), smcroute (multicast routing), iproute2 (GRE)
- Configura sysctl: ip_forward, mc_forwarding
- Sudoers: permite a Node controlar ipsec/xl2tpd/smcroute/ip/systemctl/tee
- PSK guardada en `/etc/omnisync-vpn-psk`

**Componentes panel:**
- `server/vpn-manager.js`: helpers que reescriben `/etc/ppp/chap-secrets`, `/etc/smcroute.conf`, gestionan túneles GRE, parsean `ipsec statusall`, generan config `.rsc` para MikroTik.
- `server/vpn-routes.js`: rutas REST `/api/vpn/*` (sectors CRUD, multicast assign, status, mikrotik-config download, resync).
- `src/components/admin/VpnSectorsManager.tsx`: tab "VPN/Multicast" con 3 sub-tabs (Sectores, Multicast, Monitor).

**Tablas BD:**
- `vpn_sectors`: sectores con vpn_username, vpn_password, assigned_ip, gre_*
- `multicast_groups`: pool 239.10.0.1-100, channel_id, port (1234)
- `sector_channel_map`: qué canales van a qué sector
- `vpn_tunnel_status`: cache estado túneles

**Configuración fija:**
- VPN net: 172.16.50.0/24 (server: .1, pool: .10-.250)
- Multicast: 239.10.0.0/24
- Auth: PSK + chap-secrets (PAP rechazado, MS-CHAPv2 requerido)

**Flujo trabajo:**
1. Sysadmin ejecuta `install-vpn.sh` una vez en VPS
2. Admin crea sector en panel → backend reescribe chap-secrets + crea GRE
3. Admin asigna canales → multicast groups → sectores → backend reescribe smcroute.conf
4. Admin descarga `.rsc` y lo importa en MikroTik remoto
