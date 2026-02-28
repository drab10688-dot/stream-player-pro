-- Add unique constraint on client_id + device_id for upsert deduplication
ALTER TABLE public.active_connections 
ADD CONSTRAINT active_connections_client_device_unique 
UNIQUE (client_id, device_id);