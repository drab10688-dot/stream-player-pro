
-- Add unique constraint for connection upsert
ALTER TABLE public.active_connections ADD CONSTRAINT unique_client_device UNIQUE (client_id, device_id);
