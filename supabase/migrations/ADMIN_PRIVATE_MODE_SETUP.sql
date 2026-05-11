-- Ensure all required columns exist for admin user creation
-- This migration is idempotent and safe to run multiple times

-- Add unlimited_credits column if not exists
ALTER TABLE public.profiles
ADD COLUMN IF NOT EXISTS unlimited_credits boolean NOT NULL DEFAULT false;

-- Add display_name column if not exists
ALTER TABLE public.profiles
ADD COLUMN IF NOT EXISTS display_name TEXT;

-- Create index for unlimited_credits if not exists
CREATE INDEX IF NOT EXISTS idx_profiles_unlimited_credits ON public.profiles(unlimited_credits);

-- Ensure RLS policies allow service role to bypass restrictions
-- Service role already bypasses RLS, but we can add explicit admin policies

-- Policy for admins to insert profiles (for admin-created users)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
    AND tablename = 'profiles'
    AND policyname = 'Admins can insert profiles'
  ) THEN
    CREATE POLICY "Admins can insert profiles"
      ON profiles FOR INSERT
      WITH CHECK (
        EXISTS (
          SELECT 1 FROM profiles
          WHERE user_id = auth.uid() AND role = 'admin'
        )
      );
  END IF;
END $$;

-- Policy for service role to insert credit transactions
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
    AND tablename = 'credit_transactions'
    AND policyname = 'Service can insert credit transactions'
  ) THEN
    CREATE POLICY "Service can insert credit transactions"
      ON credit_transactions FOR INSERT
      WITH CHECK (true);
  END IF;
END $$;

-- Add comment for documentation
COMMENT ON COLUMN public.profiles.unlimited_credits IS 'When true, user has unlimited credits and credit checks are bypassed';
COMMENT ON COLUMN public.profiles.display_name IS 'User display name, defaults to email prefix if not provided';
