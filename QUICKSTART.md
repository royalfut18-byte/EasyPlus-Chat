# Quick Start Guide

Get Easy Plus AI running in 5 minutes!

## Step 1: Install Dependencies

```bash
npm install
```

## Step 2: Set Up Environment Variables

1. Copy `.env.example` to `.env.local`:
```bash
cp .env.example .env.local
```

2. Fill in your credentials in `.env.local`:

**Required immediately:**
- `AWS_ACCESS_KEY_ID` - Your AWS access key
- `AWS_SECRET_ACCESS_KEY` - Your AWS secret key
- `AWS_REGION` - AWS region (e.g., us-east-1)

**Supabase (already configured):**
- These are pre-filled in `.env.local`
- URL: `https://aidvozedwqxvtqrvrdrw.supabase.co`

**Optional (for payments):**
- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`
- `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`

## Step 3: Set Up Database

### Option A: Supabase Dashboard (Easiest)

1. Go to https://supabase.com/dashboard/project/aidvozedwqxvtqrvrdrw/editor
2. Click "SQL Editor"
3. Copy and paste the contents of `supabase/migrations/20260507000000_initial_schema.sql`
4. Click "Run"

### Option B: Supabase CLI

```bash
supabase db push
```

## Step 4: Enable AWS Bedrock Models

1. Log into AWS Console
2. Navigate to AWS Bedrock
3. Go to "Model access"
4. Request access to:
   - Anthropic Claude Opus 4.6
   - Anthropic Claude Sonnet 4.5
   - Google Gemini 3.1 (if available)
   - OpenAI ChatGPT 5.4 (if available)
   - OpenAI ChatGPT 5.5 (if available)

**Note:** Model availability varies by region. If some models aren't available, you can modify `types/models.ts` to use only the models you have access to.

## Step 5: Run the App

```bash
npm run dev
```

Open http://localhost:3000 in your browser!

## First Steps

1. **Sign Up**: Create an account (you'll get 1,000 free credits)
2. **Select a Model**: Choose from the available AI models
3. **Start Chatting**: Send your first message!

## Making Your First Admin

To access the admin panel at `/admin`, you need to set your user role to admin:

1. Sign up and note your user ID from the Supabase auth.users table
2. Run this SQL in Supabase SQL Editor:

```sql
UPDATE profiles 
SET role = 'admin' 
WHERE user_id = 'your-user-id-here';
```

## Troubleshooting

### "Insufficient credits" error
- Check that your profile was created with 1,000 credits
- Query: `SELECT * FROM profiles WHERE user_id = 'your-user-id'`

### AWS Bedrock errors
- Verify your AWS credentials are correct
- Ensure you have Bedrock model access approved
- Check that the model IDs in `types/models.ts` match your AWS region

### Supabase connection issues
- Verify the Supabase URL and anon key in `.env.local`
- Check that Row Level Security policies are enabled

### Streaming not working
- Ensure you're using a compatible runtime (Edge runtime is configured)
- Check browser console for errors

## Optional: Stripe Setup

To enable payments:

1. Create a Stripe account
2. Create products in Stripe Dashboard:
   - Pro subscription ($19.99/month)
   - Unlimited subscription ($49.99/month)
   - Credit top-ups ($9.99, $24.99, $74.99)
3. Copy the price IDs to `.env.local`
4. Set up webhook endpoint: `http://localhost:3000/api/billing/webhook`
5. Add webhook secret to `.env.local`

For local testing:
```bash
npm run stripe:listen
```

## Next Steps

- Customize model costs in `types/models.ts`
- Add your branding to `components/landing/landing-page.tsx`
- Configure Stripe subscription tiers in `lib/stripe.ts`
- Deploy to Vercel for production use

## Need Help?

- Check the main README.md for detailed documentation
- Open an issue: https://github.com/royalfut18-byte/easyplus/issues
