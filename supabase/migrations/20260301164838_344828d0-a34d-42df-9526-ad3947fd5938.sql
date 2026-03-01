
-- Series table
CREATE TABLE public.vod_series (
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

-- Seasons table
CREATE TABLE public.vod_seasons (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  series_id UUID NOT NULL REFERENCES public.vod_series(id) ON DELETE CASCADE,
  season_number INTEGER NOT NULL DEFAULT 1,
  title TEXT,
  poster_url TEXT,
  sort_order INTEGER DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(series_id, season_number)
);

-- Episodes table
CREATE TABLE public.vod_episodes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  season_id UUID NOT NULL REFERENCES public.vod_seasons(id) ON DELETE CASCADE,
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

-- Enable RLS
ALTER TABLE public.vod_series ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vod_seasons ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vod_episodes ENABLE ROW LEVEL SECURITY;

-- Admin policies
CREATE POLICY "Admins full access vod_series" ON public.vod_series FOR ALL
  USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Admins full access vod_seasons" ON public.vod_seasons FOR ALL
  USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Admins full access vod_episodes" ON public.vod_episodes FOR ALL
  USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

-- Anon read policies
CREATE POLICY "Anon read active vod_series" ON public.vod_series FOR SELECT
  USING (is_active = true);

CREATE POLICY "Anon read vod_seasons" ON public.vod_seasons FOR SELECT
  USING (true);

CREATE POLICY "Anon read active vod_episodes" ON public.vod_episodes FOR SELECT
  USING (is_active = true);

-- Triggers for updated_at
CREATE TRIGGER update_vod_series_updated_at
  BEFORE UPDATE ON public.vod_series
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_vod_episodes_updated_at
  BEFORE UPDATE ON public.vod_episodes
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Indexes
CREATE INDEX idx_vod_series_active ON public.vod_series(is_active);
CREATE INDEX idx_vod_seasons_series ON public.vod_seasons(series_id);
CREATE INDEX idx_vod_episodes_season ON public.vod_episodes(season_id);
CREATE INDEX idx_vod_episodes_active ON public.vod_episodes(is_active);
