# Database Setup Instructions

## Quick Setup (Required)

Your Supabase database needs the initial schema and auto-profile creation. Follow these steps:

### 1. Access Supabase SQL Editor

1. Go to https://supabase.com/dashboard
2. Select your project: `aidvozedwqxvtqrvrdrw`
3. Click on "SQL Editor" in the left sidebar

### 2. Run the Initial Schema

Copy and paste the content from `supabase/migrations/20260507000000_initial_schema.sql` into the SQL editor and click "Run".

This creates:
- `profiles` table (user data, credits)
- `conversations` table (chat history)
- `messages` table (individual messages)
- `subscriptions` table (billing)
- `credit_transactions` table (payment history)
- All necessary indexes and Row Level Security policies

### 3. Run the Auto-Profile Creation Script

Copy and paste the content from `supabase/migrations/20260507000001_auto_create_profile.sql` into the SQL editor and click "Run".

This creates:
- A trigger that automatically creates a profile when a new user signs up
- A policy allowing profile creation during signup

### 4. Verify Setup

Run this query in the SQL editor to check if everything is set up:

```sql
SELECT tablename FROM pg_tables 
WHERE schemaname = 'public' 
AND tablename IN ('profiles', 'conversations', 'messages', 'subscriptions', 'credit_transactions');
```

You should see all 5 tables listed.

## Troubleshooting

### If login is slow or chat page hangs:

1. **Check if tables exist**: Run the verification query above
2. **Check browser console**: Open DevTools (F12) and look for errors
3. **Check server logs**: Look at the terminal where `npm run dev` is running
4. **Clear auth state**: 
   - Open DevTools → Application → Storage → Clear site data
   - Try logging in again

### If profile doesn't get created:

1. Make sure both SQL migrations were run successfully
2. Check Supabase logs in the dashboard under "Logs" → "Postgres Logs"
3. Manually create a profile for your user:

```sql
-- Replace YOUR_USER_ID with your actual user ID from auth.users table
INSERT INTO profiles (user_id, credits, subscription_tier, role)
VALUES ('YOUR_USER_ID', 1000, 'free', 'user');
```

To find your user ID:
```sql
SELECT id, email FROM auth.users;
```

## Environment Variables

Make sure your `.env.local` has:
```bash
NEXT_PUBLIC_SUPABASE_URL=https://aidvozedwqxvtqrvrdrw.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_anon_key
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
```

The service role key is needed for server-side operations like creating profiles during signup.
