-- ============================================================
-- ADMIN PRIVATE MODE SETUP
-- ============================================================
-- This script configures EasyPlus for private admin-controlled mode
-- Run this in your Supabase SQL Editor after deploying the app

-- STEP 1: Add unlimited_credits column (if not already added via migration)
-- ----------------------------------------------------------------
ALTER TABLE public.profiles
ADD COLUMN IF NOT EXISTS unlimited_credits boolean NOT NULL DEFAULT false;

-- Create index for faster queries
CREATE INDEX IF NOT EXISTS idx_profiles_unlimited_credits ON public.profiles(unlimited_credits);

-- Add comment for documentation
COMMENT ON COLUMN public.profiles.unlimited_credits IS 'When true, user has unlimited credits and credit checks are bypassed';


-- STEP 2: Make your account the main admin
-- ----------------------------------------------------------------
-- IMPORTANT: Replace 'YOUR_EMAIL_HERE' with your actual email address
-- Example: WHERE email='admin@example.com'

UPDATE public.profiles
SET
  role = 'admin',
  unlimited_credits = true,
  credits = 999999999
WHERE user_id = (
  SELECT id
  FROM auth.users
  WHERE email = 'YOUR_EMAIL_HERE'  -- ⚠️ CHANGE THIS TO YOUR EMAIL
);


-- STEP 3: Verify the update
-- ----------------------------------------------------------------
-- Check that your admin account was updated successfully
-- This should return 1 row with your admin account details

SELECT
  p.user_id,
  u.email,
  p.display_name,
  p.role,
  p.credits,
  p.unlimited_credits,
  p.created_at
FROM public.profiles p
JOIN auth.users u ON p.user_id = u.id
WHERE p.role = 'admin' AND p.unlimited_credits = true;


-- STEP 4: Optional - Disable existing non-admin users (if needed)
-- ----------------------------------------------------------------
-- Uncomment the following lines if you want to reset all non-admin users to 0 credits
-- This effectively disables them until you manually grant credits

-- UPDATE public.profiles
-- SET credits = 0
-- WHERE role != 'admin' AND unlimited_credits = false;


-- ============================================================
-- VERIFICATION QUERIES
-- ============================================================

-- Count total users
SELECT COUNT(*) as total_users FROM public.profiles;

-- Count admins
SELECT COUNT(*) as admin_count FROM public.profiles WHERE role = 'admin';

-- Count users with unlimited credits
SELECT COUNT(*) as unlimited_users FROM public.profiles WHERE unlimited_credits = true;

-- List all admin accounts
SELECT
  p.display_name,
  u.email,
  p.role,
  p.unlimited_credits,
  p.credits
FROM public.profiles p
JOIN auth.users u ON p.user_id = u.id
WHERE p.role = 'admin';


-- ============================================================
-- NOTES
-- ============================================================
-- After running this script:
-- 1. Your account will be admin with unlimited credits
-- 2. You can create new users from /admin dashboard
-- 3. Public signup is disabled in the app
-- 4. Only admins can create new accounts
-- 5. Users with role='admin' OR unlimited_credits=true bypass credit checks
-- ============================================================
