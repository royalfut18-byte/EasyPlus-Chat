-- Normalize account entitlements and add scoped sub-admin ownership.
-- profiles is the application source of truth for access and credits.

ALTER TABLE public.profiles
  DROP CONSTRAINT IF EXISTS profiles_role_check;

ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_role_check
  CHECK (role IN ('user', 'sub_admin', 'admin'));

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS unlimited_credits boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS account_status text NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS account_expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS owner_sub_admin_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE public.profiles
  DROP CONSTRAINT IF EXISTS profiles_account_status_check;

ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_account_status_check
  CHECK (account_status IN ('active', 'disabled'));

CREATE INDEX IF NOT EXISTS idx_profiles_owner_sub_admin_id
  ON public.profiles(owner_sub_admin_id);

CREATE INDEX IF NOT EXISTS idx_profiles_account_expires_at
  ON public.profiles(account_expires_at);

-- Unlimited accounts do not carry a fake finite balance.
UPDATE public.profiles
SET
  credits = 0,
  subscription_tier = 'unlimited'
WHERE unlimited_credits = true OR subscription_tier = 'unlimited';

CREATE OR REPLACE FUNCTION public.current_profile_role()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT role
  FROM public.profiles
  WHERE user_id = auth.uid()
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.can_manage_profile(target_user_id uuid, target_owner_sub_admin_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    public.current_profile_role() = 'admin'
    OR (
      public.current_profile_role() = 'sub_admin'
      AND target_owner_sub_admin_id = auth.uid()
      AND target_user_id <> auth.uid()
    );
$$;

DROP POLICY IF EXISTS "Users can update own profile" ON public.profiles;
DROP POLICY IF EXISTS "Admins can view all profiles" ON public.profiles;
DROP POLICY IF EXISTS "Admins can update all profiles" ON public.profiles;
DROP POLICY IF EXISTS "Admins can insert profiles" ON public.profiles;
DROP POLICY IF EXISTS "Sub admins can view assigned profiles" ON public.profiles;
DROP POLICY IF EXISTS "Sub admins can update assigned profiles" ON public.profiles;
DROP POLICY IF EXISTS "Allow profile creation during signup" ON public.profiles;
DROP POLICY IF EXISTS "Users can update own subscription" ON public.subscriptions;

CREATE POLICY "Admins can view all profiles"
  ON public.profiles FOR SELECT
  USING (public.current_profile_role() = 'admin');

CREATE POLICY "Admins can update all profiles"
  ON public.profiles FOR UPDATE
  USING (public.current_profile_role() = 'admin')
  WITH CHECK (public.current_profile_role() = 'admin');

CREATE POLICY "Admins can insert profiles"
  ON public.profiles FOR INSERT
  WITH CHECK (public.current_profile_role() = 'admin');

CREATE POLICY "Sub admins can view assigned profiles"
  ON public.profiles FOR SELECT
  USING (
    public.current_profile_role() = 'sub_admin'
    AND (user_id = auth.uid() OR owner_sub_admin_id = auth.uid())
  );

CREATE POLICY "Sub admins can update assigned profiles"
  ON public.profiles FOR UPDATE
  USING (public.can_manage_profile(user_id, owner_sub_admin_id))
  WITH CHECK (public.can_manage_profile(user_id, owner_sub_admin_id));

CREATE POLICY "Allow default profile creation during signup"
  ON public.profiles FOR INSERT
  WITH CHECK (
    auth.uid() = user_id
    AND role = 'user'
    AND credits = 1000
    AND unlimited_credits = false
    AND subscription_tier = 'free'
    AND account_status = 'active'
    AND account_expires_at IS NULL
    AND owner_sub_admin_id IS NULL
    AND created_by IS NULL
  );

COMMENT ON COLUMN public.profiles.account_status IS 'Administrative account state. Expiry is derived from account_expires_at.';
COMMENT ON COLUMN public.profiles.account_expires_at IS 'When set, premium API access ends at this timestamp.';
COMMENT ON COLUMN public.profiles.owner_sub_admin_id IS 'Optional sub-admin responsible for this user.';
COMMENT ON COLUMN public.profiles.created_by IS 'Admin or sub-admin that created this profile.';
