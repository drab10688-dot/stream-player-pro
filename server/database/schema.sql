-- =============================================
-- StreamBox - Schema completo para PostgreSQL local
-- Ejecutar en tu servidor Ubuntu
-- =============================================

-- Crear base de datos
-- CREATE DATABASE streambox;
-- \c streambox

-- Extension para UUIDs
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- =============================================
-- TABLAS (orden correcto de dependencias)
-- =============================================

-- Administradores del sistema
CREATE TABLE IF NOT EXISTS admins (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Planes de suscripción (ANTES de clients porque clients referencia plans)
CREATE TABLE IF NOT EXISTS plans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  description TEXT,
  categories TEXT[] NOT NULL DEFAULT '{}',
  price NUMERIC(10,2) DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT true,
  sort_order INTEGER DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Resellers (ANTES de clients porque clients referencia resellers)
CREATE TABLE IF NOT EXISTS resellers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  email TEXT,
  phone TEXT,
  username TEXT NOT NULL UNIQUE,
  password TEXT NOT NULL,
  max_clients INTEGER NOT NULL DEFAULT 10,
  is_active BOOLEAN NOT NULL DEFAULT true,
  commission_percent NUMERIC(5,2) DEFAULT 0,
  notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Canales IPTV
CREATE TABLE IF NOT EXISTS channels (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  url TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'General',
  logo_url TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  keep_alive BOOLEAN NOT NULL DEFAULT false,
  stream_mode TEXT NOT NULL DEFAULT 'proxy',
  sort_order INTEGER DEFAULT 0,
  consecutive_failures INTEGER NOT NULL DEFAULT 0,
  auto_disabled BOOLEAN NOT NULL DEFAULT false,
  last_checked_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Clientes/suscriptores
CREATE TABLE IF NOT EXISTS clients (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  username TEXT NOT NULL UNIQUE,
  password TEXT NOT NULL,
  max_screens INTEGER NOT NULL DEFAULT 1,
  expiry_date TIMESTAMP WITH TIME ZONE NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  notes TEXT,
  plan_id UUID REFERENCES plans(id) ON DELETE SET NULL,
  reseller_id UUID REFERENCES resellers(id) ON DELETE SET NULL,
  playlist_token TEXT UNIQUE,
  vod_enabled BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Publicidad/avisos
CREATE TABLE IF NOT EXISTS ads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  image_url TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Conexiones activas (control de pantallas)
CREATE TABLE IF NOT EXISTS active_connections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  device_id TEXT NOT NULL,
  ip_address TEXT,
  country TEXT,
  city TEXT,
  watching_channel_id UUID REFERENCES channels(id) ON DELETE SET NULL,
  connected_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  last_heartbeat TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(client_id, device_id)
);

-- Logs de salud de canales
CREATE TABLE IF NOT EXISTS channel_health_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  channel_id UUID NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'error',
  error_message TEXT,
  response_code INTEGER,
  checked_by TEXT,
  checked_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Backups del sistema
CREATE TABLE IF NOT EXISTS system_backups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'full',
  status TEXT NOT NULL DEFAULT 'pending',
  file_path TEXT,
  file_size BIGINT,
  includes_db BOOLEAN NOT NULL DEFAULT true,
  includes_config BOOLEAN NOT NULL DEFAULT true,
  notes TEXT,
  created_by UUID,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- =============================================
-- VOD (Películas/Videos bajo demanda)
-- =============================================
CREATE TABLE IF NOT EXISTS vod_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  description TEXT,
  category TEXT NOT NULL DEFAULT 'Películas',
  poster_url TEXT,
  video_filename TEXT NOT NULL,
  duration_minutes INTEGER,
  is_active BOOLEAN NOT NULL DEFAULT true,
  sort_order INTEGER DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- =============================================
-- SERIES (Temporadas y Episodios)
-- =============================================
CREATE TABLE IF NOT EXISTS vod_series (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  description TEXT,
  category TEXT NOT NULL DEFAULT 'Series',
  poster_url TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  sort_order INTEGER DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS vod_seasons (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  series_id UUID NOT NULL REFERENCES vod_series(id) ON DELETE CASCADE,
  season_number INTEGER NOT NULL DEFAULT 1,
  title TEXT,
  poster_url TEXT,
  sort_order INTEGER DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(series_id, season_number)
);

CREATE TABLE IF NOT EXISTS vod_episodes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  season_id UUID NOT NULL REFERENCES vod_seasons(id) ON DELETE CASCADE,
  episode_number INTEGER NOT NULL DEFAULT 1,
  title TEXT NOT NULL,
  description TEXT,
  video_filename TEXT NOT NULL,
  poster_url TEXT,
  duration_minutes INTEGER,
  is_active BOOLEAN NOT NULL DEFAULT true,
  sort_order INTEGER DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(season_id, episode_number)
);

-- =============================================
-- TRIGGER: auto-update updated_at
-- =============================================
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'update_clients_updated_at') THEN
    CREATE TRIGGER update_clients_updated_at BEFORE UPDATE ON clients FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'update_resellers_updated_at') THEN
    CREATE TRIGGER update_resellers_updated_at BEFORE UPDATE ON resellers FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'update_vod_items_updated_at') THEN
    CREATE TRIGGER update_vod_items_updated_at BEFORE UPDATE ON vod_items FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'update_vod_series_updated_at') THEN
    CREATE TRIGGER update_vod_series_updated_at BEFORE UPDATE ON vod_series FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'update_vod_episodes_updated_at') THEN
    CREATE TRIGGER update_vod_episodes_updated_at BEFORE UPDATE ON vod_episodes FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'update_plans_updated_at') THEN
    CREATE TRIGGER update_plans_updated_at BEFORE UPDATE ON plans FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
  END IF;
END $$;

-- =============================================
-- INDICES para rendimiento
-- =============================================
CREATE INDEX IF NOT EXISTS idx_clients_username ON clients(username);
CREATE INDEX IF NOT EXISTS idx_clients_active ON clients(is_active);
CREATE INDEX IF NOT EXISTS idx_clients_token ON clients(playlist_token);
CREATE INDEX IF NOT EXISTS idx_clients_reseller ON clients(reseller_id);
CREATE INDEX IF NOT EXISTS idx_channels_active ON channels(is_active);
CREATE INDEX IF NOT EXISTS idx_connections_client ON active_connections(client_id);
CREATE INDEX IF NOT EXISTS idx_connections_heartbeat ON active_connections(last_heartbeat);
CREATE INDEX IF NOT EXISTS idx_connections_channel ON active_connections(watching_channel_id);
CREATE INDEX IF NOT EXISTS idx_resellers_username ON resellers(username);
CREATE INDEX IF NOT EXISTS idx_resellers_active ON resellers(is_active);
CREATE INDEX IF NOT EXISTS idx_plans_active ON plans(is_active);
CREATE INDEX IF NOT EXISTS idx_vod_active ON vod_items(is_active);
CREATE INDEX IF NOT EXISTS idx_vod_series_active ON vod_series(is_active);
CREATE INDEX IF NOT EXISTS idx_vod_seasons_series ON vod_seasons(series_id);
CREATE INDEX IF NOT EXISTS idx_vod_episodes_season ON vod_episodes(season_id);
CREATE INDEX IF NOT EXISTS idx_vod_episodes_active ON vod_episodes(is_active);
CREATE INDEX IF NOT EXISTS idx_channel_health_channel ON channel_health_logs(channel_id);
