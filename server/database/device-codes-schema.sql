-- =============================================
-- Omnisync - Schema device_codes (idempotente)
-- =============================================
-- Códigos de activación pre-generados desde el panel.
-- Cada código = 1 dispositivo (1 pantalla).
-- Asociado a un cliente y a un sector VPN (define qué canales UDP recibe).
-- =============================================

CREATE TABLE IF NOT EXISTS device_codes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT NOT NULL UNIQUE,
  label TEXT,
  client_id UUID REFERENCES clients(id) ON DELETE SET NULL,
  sector_id UUID NOT NULL REFERENCES vpn_sectors(id) ON DELETE RESTRICT,
  device_id TEXT,
  status TEXT NOT NULL DEFAULT 'pending', -- pending | active | revoked
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + INTERVAL '30 days'),
  activated_at TIMESTAMPTZ,
  last_seen_at TIMESTAMPTZ,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_device_codes_code ON device_codes(code);
CREATE INDEX IF NOT EXISTS idx_device_codes_client ON device_codes(client_id);
CREATE INDEX IF NOT EXISTS idx_device_codes_sector ON device_codes(sector_id);
CREATE INDEX IF NOT EXISTS idx_device_codes_status ON device_codes(status);
CREATE INDEX IF NOT EXISTS idx_device_codes_device ON device_codes(device_id);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'update_device_codes_updated_at') THEN
    CREATE TRIGGER update_device_codes_updated_at BEFORE UPDATE ON device_codes
      FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
  END IF;
END $$;
