CREATE TABLE IF NOT EXISTS public.system_settings (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.system_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins full access system_settings" ON public.system_settings;
CREATE POLICY "Admins full access system_settings"
  ON public.system_settings
  FOR ALL
  TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

INSERT INTO public.system_settings (key, value)
VALUES ('multicast_enabled', '{"enabled": true}'::jsonb)
ON CONFLICT (key) DO NOTHING;

COMMENT ON TABLE public.system_settings IS 'Global system feature flags (e.g., multicast_enabled toggle)';