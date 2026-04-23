-- =============================================
-- Omnisync - Encoders on-demand (idempotente)
-- =============================================
-- Permite que cada encoder multicast se controle individualmente:
--   • mode='always_on'  → siempre corriendo si hay sectores asignados
--   • mode='on_demand'  → solo corre si hay viewers reales en active_connections
-- idle_timeout_seconds: cuánto esperar sin viewers antes de apagar (default 300s = 5min)
-- last_viewer_at: timestamp del último viewer detectado
-- =============================================

ALTER TABLE multicast_encoders
  ADD COLUMN IF NOT EXISTS mode TEXT NOT NULL DEFAULT 'always_on',
  ADD COLUMN IF NOT EXISTS idle_timeout_seconds INT NOT NULL DEFAULT 300,
  ADD COLUMN IF NOT EXISTS last_viewer_at TIMESTAMPTZ;

-- Validar valores permitidos en mode
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'multicast_encoders_mode_check'
  ) THEN
    ALTER TABLE multicast_encoders
      ADD CONSTRAINT multicast_encoders_mode_check
      CHECK (mode IN ('always_on', 'on_demand'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_multicast_encoders_mode ON multicast_encoders(mode);
