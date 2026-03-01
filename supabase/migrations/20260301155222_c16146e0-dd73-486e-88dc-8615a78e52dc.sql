
-- Tabla de planes (parrillas)
CREATE TABLE public.plans (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  categories TEXT[] NOT NULL DEFAULT '{}',
  price NUMERIC DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT true,
  sort_order INTEGER DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Agregar plan_id a clients
ALTER TABLE public.clients ADD COLUMN plan_id UUID REFERENCES public.plans(id) ON DELETE SET NULL;

-- Enable RLS
ALTER TABLE public.plans ENABLE ROW LEVEL SECURITY;

-- Admin full access
CREATE POLICY "Admins full access plans"
ON public.plans
FOR ALL
TO authenticated
USING (has_role(auth.uid(), 'admin'::app_role))
WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

-- Anon puede leer planes activos (para mostrar en login/registro)
CREATE POLICY "Anon read active plans"
ON public.plans
FOR SELECT
TO anon
USING (is_active = true);

-- Trigger para updated_at
CREATE TRIGGER update_plans_updated_at
BEFORE UPDATE ON public.plans
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

-- Tabla de backups (registro de backups realizados)
CREATE TABLE public.system_backups (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'full',
  file_path TEXT,
  file_size BIGINT,
  status TEXT NOT NULL DEFAULT 'pending',
  includes_db BOOLEAN NOT NULL DEFAULT true,
  includes_config BOOLEAN NOT NULL DEFAULT true,
  notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  created_by UUID
);

ALTER TABLE public.system_backups ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins full access backups"
ON public.system_backups
FOR ALL
TO authenticated
USING (has_role(auth.uid(), 'admin'::app_role))
WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

-- Bucket para almacenar archivos de backup
INSERT INTO storage.buckets (id, name, public) VALUES ('backups', 'backups', false);

CREATE POLICY "Admins can manage backups"
ON storage.objects
FOR ALL
TO authenticated
USING (bucket_id = 'backups' AND public.has_role(auth.uid(), 'admin'::app_role))
WITH CHECK (bucket_id = 'backups' AND public.has_role(auth.uid(), 'admin'::app_role));
