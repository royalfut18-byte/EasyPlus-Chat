# Easy Plus AI - Project Structure

```
EasyPlus/
├── 📄 Configuration Files
│   ├── .env.example              # Environment variables template
│   ├── .env.local                # Your local environment (git-ignored)
│   ├── .gitignore                # Git ignore rules
│   ├── next.config.ts            # Next.js configuration
│   ├── package.json              # Dependencies and scripts
│   ├── postcss.config.mjs        # PostCSS configuration
│   ├── tailwind.config.ts        # Tailwind CSS configuration
│   ├── tsconfig.json             # TypeScript configuration
│   ├── middleware.ts             # Next.js middleware (auth)
│   ├── README.md                 # Main documentation
│   ├── QUICKSTART.md             # Quick start guide
│   └── PROJECT_STRUCTURE.md      # This file
│
├── 📁 app/                       # Next.js 14 App Router
│   ├── layout.tsx                # Root layout
│   ├── page.tsx                  # Landing page (/)
│   ├── globals.css               # Global styles
│   │
│   ├── (auth)/                   # Auth pages group
│   │   ├── login/
│   │   │   └── page.tsx          # Login page
│   │   └── signup/
│   │       └── page.tsx          # Signup page
│   │
│   ├── auth/
│   │   └── callback/
│   │       └── route.ts          # OAuth callback handler
│   │
│   ├── chat/
│   │   └── page.tsx              # Main chat interface
│   │
│   ├── dashboard/
│   │   └── page.tsx              # User dashboard
│   │
│   ├── billing/
│   │   └── page.tsx              # Billing & subscriptions
│   │
│   ├── admin/
│   │   └── page.tsx              # Admin panel (role-protected)
│   │
│   └── api/                      # API routes
│       ├── chat/
│       │   └── route.ts          # Chat streaming endpoint
│       ├── conversations/
│       │   ├── route.ts          # GET/POST conversations
│       │   └── [id]/
│       │       └── route.ts      # GET/DELETE conversation
│       ├── billing/
│       │   ├── create-checkout/
│       │   │   └── route.ts      # Create Stripe checkout
│       │   ├── portal/
│       │   │   └── route.ts      # Stripe billing portal
│       │   └── webhook/
│       │       └── route.ts      # Stripe webhook handler
│       └── admin/
│           └── users/
│               ├── route.ts      # GET all users
│               └── [id]/
│                   └── credits/
│                       └── route.ts  # PATCH user credits
│
├── 📁 components/                # React components
│   ├── ui/                       # shadcn/ui components
│   │   ├── avatar.tsx
│   │   ├── button.tsx
│   │   ├── card.tsx
│   │   ├── dialog.tsx
│   │   ├── dropdown-menu.tsx
│   │   ├── input.tsx
│   │   ├── label.tsx
│   │   ├── toast.tsx
│   │   ├── toaster.tsx
│   │   └── use-toast.ts
│   │
│   ├── chat/                     # Chat UI components
│   │   ├── model-selector.tsx   # AI model picker
│   │   ├── message-bubble.tsx   # Message display with markdown
│   │   ├── chat-input.tsx       # Message input with auto-resize
│   │   └── sidebar.tsx          # Conversation history sidebar
│   │
│   ├── landing/
│   │   └── landing-page.tsx     # Landing page content
│   │
│   ├── billing/
│   │   └── billing-actions.tsx  # Billing portal button
│   │
│   └── admin/
│       └── admin-user-table.tsx # Admin user management table
│
├── 📁 lib/                       # Library code
│   ├── utils.ts                  # Utility functions (cn, formatters)
│   ├── stripe.ts                 # Stripe client & config
│   │
│   ├── supabase/                 # Supabase clients
│   │   ├── client.ts             # Browser client
│   │   ├── server.ts             # Server & service clients
│   │   └── middleware.ts         # Middleware session handler
│   │
│   └── ai/
│       └── bedrock.ts            # AWS Bedrock streaming service
│
├── 📁 types/                     # TypeScript types
│   ├── database.ts               # Supabase database types
│   └── models.ts                 # AI model definitions & types
│
└── 📁 supabase/
    └── migrations/
        └── 20260507000000_initial_schema.sql  # Database schema
```

## Key Features by File

### Authentication Flow
- `middleware.ts` → Session validation
- `app/(auth)/login/page.tsx` → Login UI
- `app/(auth)/signup/page.tsx` → Signup UI
- `app/auth/callback/route.ts` → OAuth redirect

### Chat System
- `app/chat/page.tsx` → Main chat interface
- `components/chat/model-selector.tsx` → Switch AI models
- `components/chat/message-bubble.tsx` → Render messages with syntax highlighting
- `app/api/chat/route.ts` → Streaming API with credit deduction
- `lib/ai/bedrock.ts` → AWS Bedrock integration

### Billing & Credits
- `app/billing/page.tsx` → Subscription & top-up UI
- `app/api/billing/create-checkout/route.ts` → Create Stripe session
- `app/api/billing/webhook/route.ts` → Handle Stripe events
- `lib/stripe.ts` → Stripe config & pricing

### Admin Panel
- `app/admin/page.tsx` → Admin dashboard
- `components/admin/admin-user-table.tsx` → User management
- `app/api/admin/users/[id]/credits/route.ts` → Manual credit adjustment

### Database
- `supabase/migrations/20260507000000_initial_schema.sql` → Schema with RLS
- `types/database.ts` → Type-safe database access

## Architecture Highlights

### Real-Time Streaming
Uses Server-Sent Events (SSE) via Edge Runtime for token-by-token streaming from AWS Bedrock.

### Credit System
Each message deducts credits based on model cost, tracked in `credit_transactions` table.

### Authentication
Supabase Auth with Row Level Security ensures users can only access their own data.

### Glassmorphism Design
Custom Tailwind utilities in `globals.css` for glass effects and gradients.

### Type Safety
Fully typed with TypeScript, including Supabase database schema types.

## API Routes Summary

| Route | Method | Purpose |
|-------|--------|---------|
| `/api/chat` | POST | Stream AI response, deduct credits |
| `/api/conversations` | GET | List user's conversations |
| `/api/conversations` | POST | Create new conversation |
| `/api/conversations/[id]` | GET | Get conversation messages |
| `/api/conversations/[id]` | DELETE | Delete conversation |
| `/api/billing/create-checkout` | POST | Create Stripe checkout |
| `/api/billing/portal` | GET | Get billing portal URL |
| `/api/billing/webhook` | POST | Handle Stripe webhooks |
| `/api/admin/users` | GET | List all users (admin) |
| `/api/admin/users/[id]/credits` | PATCH | Adjust user credits (admin) |

## Database Tables

1. **profiles** - User profiles, credits, subscription tier
2. **conversations** - Chat conversations
3. **messages** - Individual messages
4. **subscriptions** - Stripe subscription tracking
5. **credit_transactions** - Credit usage history
