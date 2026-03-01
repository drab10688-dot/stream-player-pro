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
-- TABLAS
-- =============================================

-- Administradores del sistema
CREATE TABLE admins (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Canales IPTV
CREATE TABLE channels (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  url TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'General',
  logo_url TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  keep_alive BOOLEAN NOT NULL DEFAULT false,
  sort_order INTEGER DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Clientes/suscriptores
CREATE TABLE clients (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  username TEXT NOT NULL UNIQUE,
  password TEXT NOT NULL,
  max_screens INTEGER NOT NULL DEFAULT 1,
  expiry_date TIMESTAMP WITH TIME ZONE NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  notes TEXT,
  plan_id UUID REFERENCES plans(id) ON DELETE SET NULL,
  playlist_token TEXT UNIQUE,
  vod_enabled BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Planes de suscripción
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

-- Publicidad/avisos
CREATE TABLE ads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  image_url TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Resellers
CREATE TABLE resellers (
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

-- Agregar reseller_id a clients
ALTER TABLE clients ADD COLUMN IF NOT EXISTS reseller_id UUID REFERENCES resellers(id) ON DELETE SET NULL;

-- Conexiones activas (control de pantallas)
CREATE TABLE active_connections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  device_id TEXT NOT NULL,
  connected_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  last_heartbeat TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(client_id, device_id)
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

CREATE TRIGGER update_clients_updated_at
  BEFORE UPDATE ON clients
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_resellers_updated_at
  BEFORE UPDATE ON resellers
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- =============================================
-- DATOS INICIALES
-- =============================================
-- INSERT INTO admins (email, password_hash) VALUES ('admin@streambox.local', '$2b$10$...');
-- Nota: El primer admin se crea desde la API con /api/admin/setup

-- =============================================
-- VOD (Películas/Videos bajo demanda)
-- =============================================
CREATE TABLE vod_items (
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

CREATE TRIGGER update_vod_items_updated_at
  BEFORE UPDATE ON vod_items
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- =============================================
-- SERIES (Temporadas y Episodios)
-- =============================================
CREATE TABLE vod_series (
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

CREATE TABLE vod_seasons (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  series_id UUID NOT NULL REFERENCES vod_series(id) ON DELETE CASCADE,
  season_number INTEGER NOT NULL DEFAULT 1,
  title TEXT,
  poster_url TEXT,
  sort_order INTEGER DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(series_id, season_number)
);

CREATE TABLE vod_episodes (
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

CREATE TRIGGER update_vod_series_updated_at
  BEFORE UPDATE ON vod_series
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_vod_episodes_updated_at
  BEFORE UPDATE ON vod_episodes
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- =============================================
-- INDICES para rendimiento
-- =============================================
CREATE INDEX idx_clients_username ON clients(username);
CREATE INDEX idx_clients_active ON clients(is_active);
CREATE INDEX idx_clients_token ON clients(playlist_token);
CREATE INDEX idx_channels_active ON channels(is_active);
CREATE INDEX idx_connections_client ON active_connections(client_id);
CREATE INDEX idx_connections_heartbeat ON active_connections(last_heartbeat);
CREATE INDEX idx_resellers_username ON resellers(username);
CREATE INDEX idx_resellers_active ON resellers(is_active);
CREATE INDEX idx_clients_reseller ON clients(reseller_id);
CREATE INDEX idx_plans_active ON plans(is_active);
CREATE INDEX idx_vod_active ON vod_items(is_active);
CREATE INDEX idx_vod_series_active ON vod_series(is_active);
CREATE INDEX idx_vod_seasons_series ON vod_seasons(series_id);
CREATE INDEX idx_vod_episodes_season ON vod_episodes(season_id);
CREATE INDEX idx_vod_episodes_active ON vod_episodes(is_active);
