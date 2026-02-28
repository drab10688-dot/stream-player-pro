
-- Table for channel health monitoring / error reports
CREATE TABLE public.channel_health_logs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  channel_id UUID NOT NULL REFERENCES public.channels(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'error', -- 'ok', 'error', 'timeout'
  error_message TEXT,
  response_code INTEGER,
  checked_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  checked_by TEXT -- 'system', 'client:username', etc.
);

-- Enable RLS
ALTER TABLE public.channel_health_logs ENABLE ROW LEVEL SECURITY;

-- Admins can do everything
CREATE POLICY "Admins full access channel_health_logs"
ON public.channel_health_logs
FOR ALL
USING (public.has_role(auth.uid(), 'admin'::app_role))
WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));

-- Allow anonymous inserts for client error reporting
CREATE POLICY "Anyone can report channel errors"
ON public.channel_health_logs
FOR INSERT
WITH CHECK (true);

-- Enable realtime for monitoring
ALTER PUBLICATION supabase_realtime ADD TABLE public.channel_health_logs;

-- Index for quick lookups
CREATE INDEX idx_channel_health_channel_id ON public.channel_health_logs(channel_id);
CREATE INDEX idx_channel_health_checked_at ON public.channel_health_logs(checked_at DESC);
