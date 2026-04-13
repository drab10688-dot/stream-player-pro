-- Remove DVR-related columns from channels table
ALTER TABLE public.channels DROP COLUMN IF EXISTS dvr_enabled;
ALTER TABLE public.channels DROP COLUMN IF EXISTS keep_alive;