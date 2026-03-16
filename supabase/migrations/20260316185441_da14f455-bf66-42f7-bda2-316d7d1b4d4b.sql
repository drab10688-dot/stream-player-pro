-- Activity logs table: track what each client watched
CREATE TABLE public.activity_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  client_username text NOT NULL,
  channel_id uuid REFERENCES public.channels(id) ON DELETE SET NULL,
  channel_name text,
  action text NOT NULL DEFAULT 'watch',
  ip_address text,
  country text,
  city text,
  device_id text,
  started_at timestamptz NOT NULL DEFAULT now(),
  ended_at timestamptz,
  duration_seconds integer,
  source text DEFAULT 'panel'
);

CREATE INDEX idx_activity_logs_client_id ON public.activity_logs(client_id);
CREATE INDEX idx_activity_logs_started_at ON public.activity_logs(started_at DESC);

ALTER TABLE public.activity_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins full access activity_logs"
  ON public.activity_logs FOR ALL
  TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Server can insert activity_logs"
  ON public.activity_logs FOR INSERT
  TO public
  WITH CHECK (true);