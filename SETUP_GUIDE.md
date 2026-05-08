# EasyPlus AI - Complete Setup Guide

## Issues You're Experiencing

1. **Chat page shows infinite loading spinner** - Database tables not set up
2. **Login takes too long** - Profile not auto-created after authentication
3. **Chat doesn't work** - AWS Bedrock credentials not configured

## Fix Steps

### 1. Set Up Supabase Database (REQUIRED)

Your database is empty and needs the schema. Follow `DATABASE_SETUP.md` to run the SQL migrations.

**Quick steps:**
1. Go to https://supabase.com/dashboard/project/aidvozedwqxvtqrvrdrw/sql
2. Copy and run `supabase/migrations/20260507000000_initial_schema.sql`
3. Copy and run `supabase/migrations/20260507000001_auto_create_profile.sql`

### 2. Configure AWS Bedrock (REQUIRED for chat to work)

The app uses AWS Bedrock for AI model inference. You need AWS credentials.

**Get AWS credentials:**
1. Go to https://console.aws.amazon.com/
2. Click your name → Security credentials
3. Create access key → Choose "Application running outside AWS"
4. Copy the Access Key ID and Secret Access Key

**Add to `.env.local`:**
```bash
AWS_ACCESS_KEY_ID=your_access_key_here
AWS_SECRET_ACCESS_KEY=your_secret_key_here
AWS_REGION=us-east-1
```

**Enable Bedrock models:**
1. Go to AWS Bedrock console: https://console.aws.amazon.com/bedrock/
2. Navigate to "Model access" in the left sidebar
3. Click "Manage model access"
4. Enable these models:
   - Claude 3.5 Sonnet
   - Claude 3 Opus
   - Claude 3 Haiku
   - Meta Llama 3.1 models
   - Mistral models
5. Click "Save changes" (approval is usually instant)

### 3. Optional: Stripe Configuration (for payments)

If you want billing/payments to work:

```bash
STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_test_...
```

Get these from https://dashboard.stripe.com/

### 4. Restart Dev Server

After updating `.env.local`:

```bash
# Stop the current server (Ctrl+C)
npm run dev
```

## Testing the Fixes

### 1. Test Database Setup
```sql
-- Run in Supabase SQL editor
SELECT count(*) FROM profiles;
```
Should not error.

### 2. Test Login
1. Clear browser data (F12 → Application → Clear site data)
2. Go to http://localhost:3000
3. Sign up/login
4. Should redirect to `/chat` quickly (1-2 seconds)

### 3. Test Chat
1. Select a model from the dropdown
2. Type a message
3. Should get a response streaming back

## Still Having Issues?

### Chat page stuck loading:
- Check browser console (F12) for errors
- Check that tables exist in Supabase
- Try logging out and back in

### "Insufficient credits" error:
```sql
-- Give yourself more credits
UPDATE profiles 
SET credits = 10000 
WHERE user_id = 'YOUR_USER_ID';
```

### AWS Bedrock errors:
- Verify credentials are correct
- Check you enabled model access
- Ensure you have permissions: `bedrock:InvokeModel`

### Authentication loops:
```bash
# Clear Next.js cache
rm -rf .next
npm run dev
```

## Architecture Overview

```
User → Next.js Frontend
  ↓
  ├→ Supabase Auth (login/signup)
  ├→ Supabase Database (profiles, conversations, messages)
  └→ AWS Bedrock (AI model inference)
```

- **Frontend**: React + Next.js 15 + Tailwind
- **Auth**: Supabase Auth (email/password)
- **Database**: PostgreSQL via Supabase
- **AI**: AWS Bedrock (Claude, Llama, Mistral models)
- **Payments**: Stripe (optional)
