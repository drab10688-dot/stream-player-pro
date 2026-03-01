-- Add playlist_token column to clients table
ALTER TABLE public.clients ADD COLUMN IF NOT EXISTS playlist_token TEXT UNIQUE;

-- Create index for fast token lookups
CREATE INDEX IF NOT EXISTS idx_clients_playlist_token ON public.clients(playlist_token);