-- Tabla para trackear encoders FFmpeg activos (HTTP→UDP multicast on-demand)
CREATE TABLE IF NOT EXISTS public.multicast_encoders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  channel_id uuid NOT NULL REFERENCES public.channels(id) ON DELETE CASCADE,
  multicast_group_id uuid NOT NULL REFERENCES public.multicast_groups(id) ON DELETE CASCADE,
  pid integer,
  status text NOT NULL DEFAULT 'stopped', -- stopped | starting | running | error
  codec_mode text DEFAULT 'copy',          -- copy | transcode
  source_codec_video text,
  source_codec_audio text,
  cpu_percent numeric DEFAULT 0,
  bitrate_kbps integer DEFAULT 0,
  active_sectors integer DEFAULT 0,
  last_error text,
  started_at timestamptz,
  last_heartbeat timestamptz DEFAULT now(),
  auto_started boolean DEFAULT true,
  CONSTRAINT multicast_encoders_unique_channel UNIQUE (channel_id)
);

ALTER TABLE public.multicast_encoders ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins full access multicast_encoders"
  ON public.multicast_encoders FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE INDEX IF NOT EXISTS idx_multicast_encoders_status ON public.multicast_encoders(status);
CREATE INDEX IF NOT EXISTS idx_multicast_encoders_channel ON public.multicast_encoders(channel_id);