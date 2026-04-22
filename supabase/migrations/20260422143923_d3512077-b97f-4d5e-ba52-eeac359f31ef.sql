-- ============================================
-- VPN L2TP/IPsec + Multicast por sectores
-- ============================================

-- Sectores remotos (cada MikroTik cliente)
CREATE TABLE public.vpn_sectors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  description text,
  vpn_username text NOT NULL UNIQUE,
  vpn_password text NOT NULL,
  assigned_ip inet NOT NULL UNIQUE, -- IP del túnel L2TP (172.16.50.X)
  gre_local_ip inet,                -- IP local del GRE tunnel
  gre_remote_ip inet,               -- IP remota del GRE tunnel
  gre_tunnel_name text,             -- gre1, gre2, etc.
  mikrotik_public_ip inet,          -- IP pública del MikroTik remoto (opcional)
  plan_id uuid REFERENCES public.plans(id) ON DELETE SET NULL,
  is_active boolean NOT NULL DEFAULT true,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Pool de grupos multicast (239.10.0.X)
CREATE TABLE public.multicast_groups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  multicast_ip inet NOT NULL UNIQUE, -- 239.10.0.1, 239.10.0.2...
  port integer NOT NULL DEFAULT 1234,
  channel_id uuid REFERENCES public.channels(id) ON DELETE SET NULL,
  is_assigned boolean NOT NULL DEFAULT false,
  bitrate_kbps integer,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Mapeo: qué canales se reenvían a qué sector (vía smcroute)
CREATE TABLE public.sector_channel_map (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sector_id uuid NOT NULL REFERENCES public.vpn_sectors(id) ON DELETE CASCADE,
  multicast_group_id uuid NOT NULL REFERENCES public.multicast_groups(id) ON DELETE CASCADE,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(sector_id, multicast_group_id)
);

-- Estado en tiempo real de los túneles (lo actualiza el backend al consultar ipsec status)
CREATE TABLE public.vpn_tunnel_status (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sector_id uuid NOT NULL UNIQUE REFERENCES public.vpn_sectors(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'disconnected', -- connected | disconnected | error
  remote_ip inet,
  bytes_in bigint DEFAULT 0,
  bytes_out bigint DEFAULT 0,
  connected_since timestamptz,
  last_check timestamptz NOT NULL DEFAULT now(),
  error_message text
);

-- Indices
CREATE INDEX idx_vpn_sectors_active ON public.vpn_sectors(is_active);
CREATE INDEX idx_multicast_groups_assigned ON public.multicast_groups(is_assigned);
CREATE INDEX idx_sector_channel_map_sector ON public.sector_channel_map(sector_id);
CREATE INDEX idx_sector_channel_map_mcast ON public.sector_channel_map(multicast_group_id);

-- Trigger updated_at
CREATE TRIGGER trg_vpn_sectors_updated
  BEFORE UPDATE ON public.vpn_sectors
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- RLS
ALTER TABLE public.vpn_sectors ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.multicast_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sector_channel_map ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vpn_tunnel_status ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins full access vpn_sectors" ON public.vpn_sectors
  FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Admins full access multicast_groups" ON public.multicast_groups
  FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Admins full access sector_channel_map" ON public.sector_channel_map
  FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Admins full access vpn_tunnel_status" ON public.vpn_tunnel_status
  FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

-- Pre-poblar pool multicast 239.10.0.1 - 239.10.0.100
INSERT INTO public.multicast_groups (multicast_ip, port)
SELECT ('239.10.0.' || g)::inet, 1234
FROM generate_series(1, 100) g;