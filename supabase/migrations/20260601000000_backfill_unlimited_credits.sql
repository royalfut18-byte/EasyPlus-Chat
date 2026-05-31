-- Backfill existing profiles to unlimited credits safely
-- Adds column if missing, then sets existing users to unlimited

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS unlimited_credits boolean;

-- Set existing accounts to unlimited if column missing or legacy finite default used
UPDATE public.profiles
SET unlimited_credits = true
WHERE unlimited_credits IS NULL OR credits = 1000;

-- Ensure default for new accounts is unlimited (non-destructive)
ALTER TABLE public.profiles
  ALTER COLUMN unlimited_credits SET DEFAULT true;

-- Ensure subscription_tier consistency for unlimited accounts
UPDATE public.profiles
SET subscription_tier = 'unlimited', credits = 0
WHERE unlimited_credits = true;
