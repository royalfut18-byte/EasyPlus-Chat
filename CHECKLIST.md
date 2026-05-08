# Easy Plus AI - Setup Checklist

Use this checklist to ensure everything is properly configured.

## ✅ Initial Setup

- [ ] Cloned/downloaded the project
- [ ] Installed Node.js 18+ on your machine
- [ ] Opened terminal in project directory

## ✅ Dependencies

```bash
npm install
```

- [ ] All dependencies installed successfully
- [ ] No errors in terminal

## ✅ Environment Configuration

### Required Now

- [ ] Copied `.env.example` to `.env.local`
- [ ] Added `AWS_ACCESS_KEY_ID`
- [ ] Added `AWS_SECRET_ACCESS_KEY`
- [ ] Set `AWS_REGION` (e.g., us-east-1)

### Already Configured

- [ ] Verified Supabase URL is present
- [ ] Verified Supabase keys are present

### Optional (For Payments)

- [ ] Added `STRIPE_SECRET_KEY`
- [ ] Added `STRIPE_WEBHOOK_SECRET`
- [ ] Added `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`

## ✅ AWS Bedrock Setup

- [ ] Logged into AWS Console
- [ ] Navigated to AWS Bedrock service
- [ ] Opened "Model access" section
- [ ] Requested access to available models:
  - [ ] Anthropic Claude models
  - [ ] Google Gemini (if available)
  - [ ] OpenAI models (if available)
- [ ] Waited for approval (can take a few minutes)
- [ ] Verified models show as "Access granted"

**Note:** Not all models may be available in your region. That's okay! Adjust `types/models.ts` to match your available models.

## ✅ Database Setup

### Option A: Supabase Dashboard

- [ ] Opened Supabase project: https://supabase.com/dashboard/project/aidvozedwqxvtqrvrdrw
- [ ] Clicked on "SQL Editor"
- [ ] Opened `supabase/migrations/20260507000000_initial_schema.sql`
- [ ] Copied entire SQL content
- [ ] Pasted into Supabase SQL Editor
- [ ] Clicked "Run"
- [ ] Verified "Success" message

### Option B: Supabase CLI

```bash
supabase db push
```

- [ ] Migration completed successfully
- [ ] No errors reported

### Verification

Go to Supabase → Table Editor and verify these tables exist:
- [ ] profiles
- [ ] conversations
- [ ] messages
- [ ] subscriptions
- [ ] credit_transactions

## ✅ First Run

```bash
npm run dev
```

- [ ] Server started successfully
- [ ] No compilation errors
- [ ] App accessible at http://localhost:3000

## ✅ Basic Functionality Test

### Landing Page
- [ ] Landing page loads
- [ ] "Get Started" button visible
- [ ] UI looks correct (glassmorphism, gradients)

### Sign Up
- [ ] Clicked "Get Started" or "Sign Up"
- [ ] Filled out signup form
- [ ] Account created successfully
- [ ] Redirected to chat page

### Profile Check
Go to Supabase → Table Editor → profiles:
- [ ] Your profile row exists
- [ ] `credits` = 1000
- [ ] `subscription_tier` = 'free'
- [ ] `role` = 'user'

### Chat Test
- [ ] Model selector shows available models
- [ ] Can type in message input
- [ ] Sent a test message
- [ ] Received AI response (streaming)
- [ ] Credits were deducted

### Conversation Check
Go to Supabase → Table Editor → conversations:
- [ ] Conversation was created
- [ ] Messages table has your messages

## ✅ Optional: Make Yourself Admin

```sql
-- Run in Supabase SQL Editor
UPDATE profiles 
SET role = 'admin' 
WHERE user_id = 'your-user-id-from-auth-users-table';
```

- [ ] Updated role to 'admin'
- [ ] Can access `/admin` page
- [ ] See user list in admin panel

## ✅ Optional: Stripe Setup

### Create Products
- [ ] Signed up for Stripe
- [ ] Created "Pro Subscription" product ($19.99/month)
- [ ] Created "Unlimited Subscription" product ($49.99/month)
- [ ] Created credit top-up products
- [ ] Copied price IDs to `.env.local`

### Webhook Setup
- [ ] Created webhook endpoint in Stripe
- [ ] URL: `http://localhost:3000/api/billing/webhook`
- [ ] Selected events: checkout.session.completed, customer.subscription.*
- [ ] Copied webhook secret to `.env.local`
- [ ] Started webhook listener: `npm run stripe:listen`

### Test Payment
- [ ] Visited `/billing` page
- [ ] Clicked "Purchase" on a product
- [ ] Completed test payment
- [ ] Credits were added to account

## 🚀 Production Deployment (Optional)

- [ ] Read DEPLOYMENT.md
- [ ] Pushed code to GitHub
- [ ] Connected to Vercel
- [ ] Added environment variables to Vercel
- [ ] Deployed successfully
- [ ] Updated Stripe webhook to production URL
- [ ] Updated Supabase redirect URLs
- [ ] Tested production deployment

## 🛠️ Troubleshooting

### If signup doesn't work:
1. Check browser console for errors
2. Verify Supabase keys in `.env.local`
3. Check Supabase → Authentication → Providers (email should be enabled)

### If AI responses don't work:
1. Verify AWS credentials in `.env.local`
2. Check AWS Bedrock model access status
3. Check browser network tab for API errors
4. Verify model IDs in `types/models.ts` match your AWS region

### If credits aren't deducted:
1. Check database policies in Supabase
2. Verify profile exists with correct user_id
3. Check server logs for errors

### If streaming doesn't work:
1. Verify Edge runtime is enabled (it is by default)
2. Check browser supports Server-Sent Events
3. Look for CORS errors in console

## 📚 Next Steps

Once everything is checked:

1. **Customize branding**
   - Edit `components/landing/landing-page.tsx`
   - Update colors in `tailwind.config.ts`
   - Add your logo

2. **Adjust model costs**
   - Edit `types/models.ts`
   - Change `costPerMessage` values

3. **Configure subscription tiers**
   - Edit `lib/stripe.ts`
   - Update credit amounts and prices

4. **Add more features**
   - Custom system prompts
   - File uploads
   - Image generation
   - Voice input

5. **Deploy to production**
   - Follow DEPLOYMENT.md
   - Set up custom domain
   - Enable analytics

## ✨ You're Ready!

If all items are checked, you have a fully functional multi-model AI chat platform!

**Questions?** Check README.md or open an issue on GitHub.
