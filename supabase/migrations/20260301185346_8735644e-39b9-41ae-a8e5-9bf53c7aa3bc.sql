
-- Add failure tracking to channels
ALTER TABLE public.channels ADD COLUMN IF NOT EXISTS consecutive_failures INTEGER NOT NULL DEFAULT 0;
ALTER TABLE public.channels ADD COLUMN IF NOT EXISTS auto_disabled BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE public.channels ADD COLUMN IF NOT EXISTS last_checked_at TIMESTAMP WITH TIME ZONE;

-- Add keep_alive column if not exists
ALTER TABLE public.channels ADD COLUMN IF NOT EXISTS keep_alive BOOLEAN NOT NULL DEFAULT false;
