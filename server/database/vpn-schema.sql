-- =============================================
-- Omnisync - Schema VPN/Multicast (idempotente)
-- =============================================
-- Crea las tablas necesarias para sectores VPN, grupos multicast,
-- mapeo sector→canal, estado de túneles y encoders multicast.
-- Se ejecuta automáticamente desde install-vpn.sh y deploy.sh
-- =============================================

-- 1) Sectores VPN (cada MikroTik remoto)
CREATE TABLE IF NOT EXISTS vpn_sectors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  description TEXT,
  vpn_username TEXT NOT NULL UNIQUE,
  vpn_password TEXT NOT NULL,
  assigned_ip INET NOT NULL UNIQUE,
  mikrotik_public_ip INET,
  ipsec_psk TEXT,
  gre_local_ip INET,
  gre_remote_ip INET,
  gre_tunnel_name TEXT,
  delivery_mode TEXT NOT NULL DEFAULT 'multicast_direct',
  udpxy_url TEXT,
  plan_id UUID REFERENCES plans(id) ON DELETE SET NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE vpn_sectors
  ADD COLUMN IF NOT EXISTS ipsec_psk TEXT,
  ADD COLUMN IF NOT EXISTS delivery_mode TEXT NOT NULL DEFAULT 'multicast_direct',
  ADD COLUMN IF NOT EXISTS udpxy_url TEXT,
  ADD COLUMN IF NOT EXISTS mikrotik_public_ip INET,
  ADD COLUMN IF NOT EXISTS gre_local_ip INET,
  ADD COLUMN IF NOT EXISTS gre_remote_ip INET,
  ADD COLUMN IF NOT EXISTS gre_tunnel_name TEXT;

-- Permitir credenciales vacías para modo lan_direct
ALTER TABLE vpn_sectors ALTER COLUMN vpn_username DROP NOT NULL;
ALTER TABLE vpn_sectors ALTER COLUMN vpn_password DROP NOT NULL;

-- 2) Grupos multicast (pool 239.10.0.1-100)
CREATE TABLE IF NOT EXISTS multicast_groups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  multicast_ip INET NOT NULL UNIQUE,
  port INTEGER NOT NULL DEFAULT 1234,
  channel_id UUID REFERENCES channels(id) ON DELETE SET NULL,
  is_assigned BOOLEAN NOT NULL DEFAULT false,
  bitrate_kbps INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 3) Mapeo sector ↔ canal multicast
CREATE TABLE IF NOT EXISTS sector_channel_map (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sector_id UUID NOT NULL REFERENCES vpn_sectors(id) ON DELETE CASCADE,
  multicast_group_id UUID NOT NULL REFERENCES multicast_groups(id) ON DELETE CASCADE,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(sector_id, multicast_group_id)
);

-- 4) Estado de túneles (cache para monitor)
CREATE TABLE IF NOT EXISTS vpn_tunnel_status (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sector_id UUID NOT NULL UNIQUE REFERENCES vpn_sectors(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'unknown',
  remote_ip INET,
  connected_since TIMESTAMPTZ,
  bytes_in BIGINT DEFAULT 0,
  bytes_out BIGINT DEFAULT 0,
  error_message TEXT,
  last_check TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 5) Encoders multicast (FFmpeg on-demand HLS→UDP)
CREATE TABLE IF NOT EXISTS multicast_encoders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  channel_id UUID NOT NULL UNIQUE REFERENCES channels(id) ON DELETE CASCADE,
  multicast_group_id UUID NOT NULL REFERENCES multicast_groups(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'stopped',
  pid INTEGER,
  codec_mode TEXT,
  source_codec_video TEXT,
  source_codec_audio TEXT,
  bitrate_kbps INTEGER,
  cpu_percent NUMERIC,
  active_sectors INTEGER DEFAULT 0,
  auto_started BOOLEAN DEFAULT false,
  last_error TEXT,
  last_heartbeat TIMESTAMPTZ,
  started_at TIMESTAMPTZ
);

-- 6) Settings globales (toggle multicast on/off)
CREATE TABLE IF NOT EXISTS system_settings (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO system_settings (key, value)
VALUES ('multicast_enabled', '{"enabled": true}'::jsonb)
ON CONFLICT (key) DO NOTHING;

-- 7) Triggers updated_at
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'update_vpn_sectors_updated_at') THEN
    CREATE TRIGGER update_vpn_sectors_updated_at BEFORE UPDATE ON vpn_sectors
      FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
  END IF;
END $$;

-- 8) Índices
CREATE INDEX IF NOT EXISTS idx_vpn_sectors_active ON vpn_sectors(is_active);
CREATE INDEX IF NOT EXISTS idx_vpn_sectors_ip ON vpn_sectors(assigned_ip);
CREATE INDEX IF NOT EXISTS idx_multicast_groups_channel ON multicast_groups(channel_id);
CREATE INDEX IF NOT EXISTS idx_sector_channel_map_sector ON sector_channel_map(sector_id);
CREATE INDEX IF NOT EXISTS idx_sector_channel_map_active ON sector_channel_map(is_active);
CREATE INDEX IF NOT EXISTS idx_multicast_encoders_status ON multicast_encoders(status);

-- 9) Pre-cargar pool de 100 grupos multicast (239.10.0.1-100:1234)
INSERT INTO multicast_groups (multicast_ip, port, is_assigned)
SELECT ('239.10.0.' || g)::inet, 1234, false
FROM generate_series(1, 100) AS g
ON CONFLICT (multicast_ip) DO NOTHING;
