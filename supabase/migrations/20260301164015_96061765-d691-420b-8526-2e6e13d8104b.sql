
-- VOD items table
CREATE TABLE public.vod_items (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
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

-- Enable RLS
ALTER TABLE public.vod_items ENABLE ROW LEVEL SECURITY;

-- Admin full access
CREATE POLICY "Admins full access vod_items"
ON public.vod_items
FOR ALL
USING (public.has_role(auth.uid(), 'admin'::app_role))
WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));

-- Anon can read active items
CREATE POLICY "Anon read active vod_items"
ON public.vod_items
FOR SELECT
USING (is_active = true);

-- Add vod_enabled to clients
ALTER TABLE public.clients ADD COLUMN IF NOT EXISTS vod_enabled BOOLEAN NOT NULL DEFAULT false;

-- Trigger for updated_at
CREATE TRIGGER update_vod_items_updated_at
BEFORE UPDATE ON public.vod_items
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();
