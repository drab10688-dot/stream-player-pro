-- Agregar columnas de tracking a active_connections
ALTER TABLE public.active_connections ADD COLUMN IF NOT EXISTS ip_address TEXT;
ALTER TABLE public.active_connections ADD COLUMN IF NOT EXISTS country TEXT;
ALTER TABLE public.active_connections ADD COLUMN IF NOT EXISTS city TEXT;
ALTER TABLE public.active_connections ADD COLUMN IF NOT EXISTS watching_channel_id UUID REFERENCES public.channels(id) ON DELETE SET NULL;

-- Índice para consultas de espectadores
CREATE INDEX IF NOT EXISTS idx_connections_channel ON public.active_connections(watching_channel_id);