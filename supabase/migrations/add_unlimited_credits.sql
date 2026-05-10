-- Add unlimited_credits column to profiles table
-- This allows admins and specific users to have unlimited credits

ALTER TABLE public.profiles
ADD COLUMN IF NOT EXISTS unlimited_credits boolean NOT NULL DEFAULT false;

-- Create index for faster queries
CREATE INDEX IF NOT EXISTS idx_profiles_unlimited_credits ON public.profiles(unlimited_credits);

-- Add comment for documentation
COMMENT ON COLUMN public.profiles.unlimited_credits IS 'When true, user has unlimited credits and credit checks are bypassed';
