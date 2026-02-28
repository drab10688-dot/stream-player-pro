-- Drop the restrictive policy
DROP POLICY IF EXISTS "Admins read roles" ON public.user_roles;

-- Allow authenticated users to read their own role
CREATE POLICY "Users can read own role"
ON public.user_roles
FOR SELECT
TO authenticated
USING (auth.uid() = user_id);
