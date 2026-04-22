ALTER TABLE public.vpn_sectors
  ADD COLUMN IF NOT EXISTS delivery_mode TEXT NOT NULL DEFAULT 'multicast_direct',
  ADD COLUMN IF NOT EXISTS udpxy_url TEXT;

ALTER TABLE public.vpn_sectors
  DROP CONSTRAINT IF EXISTS vpn_sectors_delivery_mode_check;

ALTER TABLE public.vpn_sectors
  ADD CONSTRAINT vpn_sectors_delivery_mode_check
  CHECK (delivery_mode IN ('multicast_direct','udpxy_rbldf','udpxy_central'));

COMMENT ON COLUMN public.vpn_sectors.delivery_mode IS 'How clients in this sector receive video: multicast_direct (udp:// to TV Box), udpxy_rbldf (HTTP via udpxy in RB LDF), udpxy_central (HTTP via udpxy in central MikroTik)';
COMMENT ON COLUMN public.vpn_sectors.udpxy_url IS 'Base URL for udpxy when delivery_mode is udpxy_rbldf or udpxy_central, e.g. http://192.168.1.1:4022';