-- Create public bucket for channel logos
INSERT INTO storage.buckets (id, name, public) VALUES ('channel-logos', 'channel-logos', true);

-- Allow anyone to read logos (public)
CREATE POLICY "Public read channel logos"
ON storage.objects FOR SELECT
USING (bucket_id = 'channel-logos');

-- Allow authenticated admins to upload logos
CREATE POLICY "Admins upload channel logos"
ON storage.objects FOR INSERT
WITH CHECK (bucket_id = 'channel-logos' AND has_role(auth.uid(), 'admin'::app_role));

-- Allow admins to delete logos
CREATE POLICY "Admins delete channel logos"
ON storage.objects FOR DELETE
USING (bucket_id = 'channel-logos' AND has_role(auth.uid(), 'admin'::app_role));

-- Allow admins to update logos
CREATE POLICY "Admins update channel logos"
ON storage.objects FOR UPDATE
USING (bucket_id = 'channel-logos' AND has_role(auth.uid(), 'admin'::app_role));