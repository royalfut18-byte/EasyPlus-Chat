import Stripe from 'stripe'

if (!process.env.STRIPE_SECRET_KEY) {
  throw new Error('STRIPE_SECRET_KEY is not set')
}

export const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: '2024-12-18.acacia',
  typescript: true,
})

export const SUBSCRIPTION_TIERS = {
  free: {
    name: 'Free',
    credits: 1000,
    priceId: null,
    price: 0,
  },
  pro: {
    name: 'Pro',
    credits: 10000,
    priceId: process.env.STRIPE_PRO_PRICE_ID,
    price: 1999,
  },
  unlimited: {
    name: 'Unlimited',
    credits: 100000,
    priceId: process.env.STRIPE_UNLIMITED_PRICE_ID,
    price: 4999,
  },
}

export const CREDIT_TOP_UPS = [
  { credits: 5000, price: 999, priceId: process.env.STRIPE_TOPUP_5K_PRICE_ID },
  { credits: 15000, price: 2499, priceId: process.env.STRIPE_TOPUP_15K_PRICE_ID },
  { credits: 50000, price: 7499, priceId: process.env.STRIPE_TOPUP_50K_PRICE_ID },
]
