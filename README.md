# Easy Plus AI

> **One Interface. Every AI.**

A premium multi-model AI chat platform that aggregates Claude, Gemini, and ChatGPT into one beautiful interface. Built with Next.js 14, Supabase, AWS Bedrock, and Stripe.

## Features

- **Multi-Model Support**: Access Claude Opus 4.6, Claude 4.5, Gemini 3.1, ChatGPT 5.4, and ChatGPT 5.5 via AWS Bedrock
- **Real-Time Streaming**: Server-sent events for token-by-token streaming responses
- **Authentication**: Supabase Auth with email/password and Google OAuth
- **Credit System**: Pay-as-you-go credits with subscription tiers
- **Conversation Management**: Persistent chat history with auto-generated titles
- **Billing Integration**: Stripe subscriptions and one-time credit purchases
- **Admin Panel**: User management, credit adjustments, and usage analytics
- **Beautiful UI**: Glassmorphism design with gradient accents and smooth animations

## Tech Stack

- **Framework**: Next.js 14 (App Router) + TypeScript
- **Styling**: Tailwind CSS + shadcn/ui
- **Auth & Database**: Supabase
- **AI**: AWS Bedrock SDK (all models accessed via AWS)
- **Payments**: Stripe
- **Animations**: Framer Motion
- **Deployment**: Vercel-compatible

## Prerequisites

- Node.js 18+
- Supabase account and project
- AWS account with Bedrock access
- Stripe account

## Setup

### 1. Clone the repository

```bash
git clone https://github.com/royalfut18-byte/easyplus.git
cd easyplus
npm install
```

### 2. Environment Variables

Create a `.env.local` file in the root directory:

```bash
# AWS (used for all model inference via Bedrock)
AWS_ACCESS_KEY_ID=your_aws_access_key
AWS_SECRET_ACCESS_KEY=your_aws_secret_key
AWS_REGION=us-east-1

# Supabase
NEXT_PUBLIC_SUPABASE_URL=https://aidvozedwqxvtqrvrdrw.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_supabase_anon_key
SUPABASE_SERVICE_ROLE_KEY=your_supabase_service_role_key

# Stripe
STRIPE_SECRET_KEY=your_stripe_secret_key
STRIPE_WEBHOOK_SECRET=your_stripe_webhook_secret
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=your_stripe_publishable_key

# Optional: Stripe Price IDs (create products in Stripe dashboard)
STRIPE_PRO_PRICE_ID=price_xxx
STRIPE_UNLIMITED_PRICE_ID=price_xxx
STRIPE_TOPUP_5K_PRICE_ID=price_xxx
STRIPE_TOPUP_15K_PRICE_ID=price_xxx
STRIPE_TOPUP_50K_PRICE_ID=price_xxx

# App
NEXT_PUBLIC_APP_URL=http://localhost:3000
```

### 3. Database Setup

Run the Supabase migration:

```bash
# Using Supabase CLI
supabase db push

# Or manually execute the SQL in:
# supabase/migrations/20260507000000_initial_schema.sql
```

This creates:
- `profiles` - user profiles with credits and subscription info
- `conversations` - chat conversations
- `messages` - individual messages
- `subscriptions` - Stripe subscription tracking
- `credit_transactions` - credit usage history

### 4. AWS Bedrock Setup

1. Enable AWS Bedrock in your AWS account
2. Request access to the following models in AWS Bedrock console:
   - Anthropic Claude Opus 4.6
   - Anthropic Claude Sonnet 4.5
   - Google Gemini 3.1
   - OpenAI ChatGPT 5.4
   - OpenAI ChatGPT 5.5

3. Create an IAM user with Bedrock access and save credentials

### 5. Stripe Setup

1. Create products and prices in Stripe dashboard
2. Set up webhook endpoint: `https://your-domain.com/api/billing/webhook`
3. Listen for events: `checkout.session.completed`, `customer.subscription.updated`, `customer.subscription.deleted`
4. Copy webhook secret to `.env.local`

### 6. Run Development Server

```bash
npm run dev
```

Visit `http://localhost:3000`

## Deployment

### Vercel

1. Push to GitHub
2. Import project to Vercel
3. Add environment variables
4. Deploy

### Stripe Webhooks (Production)

```bash
# Update webhook URL in Stripe dashboard to:
https://your-production-domain.com/api/billing/webhook
```

## Project Structure

```
├── app/
│   ├── (auth)/           # Authentication pages
│   ├── api/              # API routes
│   ├── admin/            # Admin panel
│   ├── billing/          # Billing page
│   ├── chat/             # Main chat interface
│   └── dashboard/        # User dashboard
├── components/
│   ├── admin/            # Admin components
│   ├── billing/          # Billing components
│   ├── chat/             # Chat UI components
│   ├── landing/          # Landing page
│   └── ui/               # shadcn/ui components
├── lib/
│   ├── ai/               # AWS Bedrock integration
│   ├── supabase/         # Supabase clients
│   ├── stripe.ts         # Stripe configuration
│   └── utils.ts          # Utility functions
├── supabase/
│   └── migrations/       # Database schema
└── types/                # TypeScript definitions
```

## Key Files

- `lib/ai/bedrock.ts` - AWS Bedrock streaming implementation
- `app/api/chat/route.ts` - Chat endpoint with credit deduction
- `middleware.ts` - Supabase auth middleware
- `app/chat/page.tsx` - Main chat interface
- `components/chat/sidebar.tsx` - Conversation history sidebar

## Admin Panel

Set a user's role to `admin` in the `profiles` table to access `/admin`:

```sql
UPDATE profiles SET role = 'admin' WHERE user_id = 'user-uuid';
```

## Credits System

- Free tier: 1,000 credits on signup
- Each message deducts credits based on model cost
- Users can purchase subscriptions or one-time top-ups
- Admins can manually adjust user credits

## Model Configuration

Edit `types/models.ts` to modify:
- Model names and IDs
- Bedrock model ARNs
- Cost per message
- Display colors and icons

## License

MIT

## Support

For issues and questions, visit: https://github.com/royalfut18-byte/easyplus/issues
