# Deployment Guide

Deploy Easy Plus AI to production in minutes.

## Prerequisites

- GitHub account
- Vercel account (free tier works)
- AWS account with Bedrock access
- Stripe account (optional, for payments)
- Supabase project (already configured)

## Step 1: Push to GitHub

```bash
cd EasyPlus
git init
git add .
git commit -m "Initial commit: Easy Plus AI"
git branch -M main
git remote add origin https://github.com/royalfut18-byte/easyplus.git
git push -u origin main
```

## Step 2: Deploy to Vercel

### Via Vercel Dashboard (Recommended)

1. Go to https://vercel.com/new
2. Click "Import Project"
3. Select your GitHub repository
4. Configure the project:
   - **Framework Preset**: Next.js
   - **Root Directory**: `./`
   - **Build Command**: `npm run build`
   - **Output Directory**: `.next`

### Via Vercel CLI

```bash
npm i -g vercel
vercel
# Follow the prompts
```

## Step 3: Add Environment Variables

In Vercel Dashboard → Settings → Environment Variables, add:

```bash
# AWS (Required)
AWS_ACCESS_KEY_ID=your_aws_access_key
AWS_SECRET_ACCESS_KEY=your_aws_secret_key
AWS_REGION=us-east-1

# Supabase (Required)
NEXT_PUBLIC_SUPABASE_URL=https://aidvozedwqxvtqrvrdrw.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFpZHZvemVkd3F4dnRxcnZyZHJ3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzgwOTk1NTQsImV4cCI6MjA5MzY3NTU1NH0.9fZ_ySG3nS0cURVbzQjtC_1iFgzN9uYucBkNpAln_X8
SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFpZHZvemVkd3F4dnRxcnZyZHJ3Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3ODA5OTU1NCwiZXhwIjoyMDkzNjc1NTU0fQ._clgP02fhgswsjyNLStNnjEQ4fOj3UnY2zFbxybyHxo

# Stripe (Optional)
STRIPE_SECRET_KEY=sk_live_...
STRIPE_WEBHOOK_SECRET=whsec_...
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_live_...

# App URL
NEXT_PUBLIC_APP_URL=https://your-domain.vercel.app
```

**Important**: Add these for all environments (Production, Preview, Development)

## Step 4: Configure Stripe Webhooks (Optional)

1. Go to Stripe Dashboard → Developers → Webhooks
2. Click "Add endpoint"
3. URL: `https://your-domain.vercel.app/api/billing/webhook`
4. Select events:
   - `checkout.session.completed`
   - `customer.subscription.updated`
   - `customer.subscription.deleted`
5. Copy the webhook secret
6. Add it to Vercel environment variables as `STRIPE_WEBHOOK_SECRET`

## Step 5: Update Supabase Auth Redirect URLs

1. Go to Supabase Dashboard → Authentication → URL Configuration
2. Add your Vercel domain to:
   - **Site URL**: `https://your-domain.vercel.app`
   - **Redirect URLs**:
     - `https://your-domain.vercel.app/auth/callback`
     - `http://localhost:3000/auth/callback` (for local dev)

## Step 6: Test the Deployment

1. Visit your Vercel deployment URL
2. Sign up for an account
3. Send a test message
4. Verify credits are deducted
5. Check Supabase database for records

## Post-Deployment Checklist

- [ ] Landing page loads correctly
- [ ] Sign up/login works
- [ ] OAuth (Google) works
- [ ] Chat interface loads
- [ ] AI streaming works
- [ ] Credits are deducted after messages
- [ ] Conversations are saved
- [ ] Dashboard shows correct data
- [ ] Admin panel accessible (if admin role set)
- [ ] Stripe checkout works (if configured)

## Custom Domain (Optional)

### Add Custom Domain in Vercel

1. Vercel Dashboard → Settings → Domains
2. Add your domain (e.g., `easyplus.ai`)
3. Configure DNS records as shown
4. Update `NEXT_PUBLIC_APP_URL` in environment variables

### Update Stripe Webhook

Change webhook URL to use your custom domain:
```
https://easyplus.ai/api/billing/webhook
```

### Update Supabase URLs

Add your custom domain to Supabase redirect URLs.

## Monitoring & Analytics

### Vercel Analytics (Built-in)

Vercel automatically tracks:
- Page views
- Response times
- Error rates

View at: Vercel Dashboard → Analytics

### Custom Monitoring

Add monitoring tools:
- **Sentry** for error tracking
- **Vercel Speed Insights** for performance
- **PostHog** for user analytics

## Performance Optimization

### Edge Runtime

Already configured for API routes that benefit from edge:
- `/api/chat` - Uses Edge runtime for streaming

### Image Optimization

Next.js automatically optimizes images. Add images to `public/` folder.

### Caching

Vercel automatically caches static assets and API routes where appropriate.

## Scaling Considerations

### Database (Supabase)

- Free tier: 500MB database, 2GB bandwidth
- Pro tier: 8GB database, 250GB bandwidth
- Monitor usage in Supabase Dashboard

### AWS Bedrock

- Pay per token
- Monitor costs in AWS Cost Explorer
- Set up billing alerts

### Vercel

- Free tier: 100GB bandwidth
- Pro tier: 1TB bandwidth
- Monitor usage in Vercel Dashboard

## Security Best Practices

1. **Environment Variables**: Never commit `.env.local` to git
2. **API Keys**: Rotate AWS keys regularly
3. **Supabase**: Use service role key only on server
4. **Stripe**: Use test mode for development
5. **HTTPS**: Always enabled on Vercel
6. **RLS**: Row Level Security enabled on all tables

## Troubleshooting

### Build Failures

Check Vercel build logs:
```bash
vercel logs
```

Common issues:
- Missing environment variables
- TypeScript errors
- Missing dependencies

### Runtime Errors

Check Vercel function logs in dashboard.

### Supabase Connection Issues

Verify:
- Environment variables are correct
- Supabase project is active
- Row Level Security policies are correct

### AWS Bedrock Errors

Verify:
- AWS credentials have Bedrock permissions
- Models are enabled in your region
- Model IDs match your configuration

## Rollback

If something goes wrong:

1. Go to Vercel Dashboard → Deployments
2. Find a previous working deployment
3. Click "..." → "Promote to Production"

## Continuous Deployment

Vercel automatically deploys:
- **Production**: Pushes to `main` branch
- **Preview**: Pull requests and other branches

## Cost Estimates

### Free Tier (Getting Started)
- Vercel: Free
- Supabase: Free (500MB)
- AWS Bedrock: ~$0.01-0.10 per request
- Stripe: Free (pay processing fees on sales)

### Production (100 users/day)
- Vercel: Free or $20/month (Pro)
- Supabase: $25/month (Pro)
- AWS Bedrock: $50-200/month (varies by usage)
- Stripe: 2.9% + $0.30 per transaction

## Support & Maintenance

- Monitor error logs daily
- Review AWS costs weekly
- Update dependencies monthly
- Backup database regularly (Supabase has automatic backups)

## Next Steps

1. Set up monitoring and alerts
2. Add custom domain
3. Configure email notifications
4. Implement rate limiting
5. Add more AI models as they become available
6. Build mobile app using same backend

---

**Need Help?** Open an issue: https://github.com/royalfut18-byte/easyplus/issues
