---
name: IPsec/L2TP MikroTik proposals criptográficos validados
description: Proposals IKE/ESP exactos que negocian con MikroTik 7.x sin NO_PROPOSAL_CHOSEN. Incluir -modp1024 en esp= es obligatorio para PFS.
type: feature
---

# IPsec/L2TP con MikroTik - Proposals validados (2026-04-24)

## Problema histórico
MikroTik 7.x envía `QUICK_MODE` con `KE` (Key Exchange) → exige PFS habilitado.
Si la línea `esp=` de strongSwan NO incluye un grupo DH (`-modp1024` o `-modp2048`),
strongSwan responde `NO_PROPOSAL_CHOSEN` y el túnel se queda en fase 1 sin
nunca cifrar el L2TP.

Síntoma en logs:
```
charon: parsed QUICK_MODE request ... [ HASH SA No KE ID ID NAT-OA NAT-OA ]
charon: no matching proposal found, sending NO_PROPOSAL_CHOSEN
```

## Negociación real validada con MikroTik
- **Fase 1 IKE**: `AES_CBC_128/HMAC_SHA1_96/PRF_HMAC_SHA1/MODP_1024`
- **Fase 2 ESP**: `AES_CBC_256/HMAC_SHA1_96/MODP_1024/NO_EXT_SEQ` (PFS DH2)
- NAT-T: `forceencaps=yes` (puerto 4500/UDP)

## Configuración `/etc/ipsec.conf` correcta
```
conn omnisync-l2tp
  authby=secret
  auto=add
  keyexchange=ikev1
  type=transport
  left=%defaultroute
  leftprotoport=17/1701
  right=%any
  rightprotoport=17/%any
  ike=aes256-sha1-modp1024,aes256-sha256-modp1024,aes128-sha1-modp1024,3des-sha1-modp1024,aes256-sha1-modp2048,aes128-sha1-modp2048!
  esp=aes256-sha1-modp1024,aes256-sha256-modp1024,aes128-sha1-modp1024,3des-sha1-modp1024,aes256-sha1,aes128-sha1,3des-sha1!
  forceencaps=yes
  dpddelay=30s
  dpdtimeout=120s
  dpdaction=clear
  rekey=no
```

**Clave**: la lista `esp=` debe incluir variantes CON `-modpXXXX` (PFS) Y SIN
(no-PFS) para soportar ambos modos de cliente.

## Firewall iptables obligatorio
```bash
iptables -I INPUT -p esp -j ACCEPT
iptables -I INPUT -p udp --dport 500 -j ACCEPT
iptables -I INPUT -p udp --dport 4500 -j ACCEPT
iptables -I INPUT -p udp --dport 1701 -j ACCEPT
netfilter-persistent save
```

## Servicios que deben estar enabled
```bash
systemctl enable strongswan-starter   # NO "ipsec" en Debian/Ubuntu modernos
systemctl enable xl2tpd
```

## Verificación de éxito (logs)
```
charon: CHILD_SA L2TP-PSK-Roadwarrior{1} established with SPIs ... 
xl2tpd: Connection established to <peer>
pppd: CHAP authentication succeeded
pppd: local IP address 172.16.50.1
pppd: remote IP address 172.16.50.99
pppd: rcvd [LCP EchoRep ...]   ← túnel vivo
```
