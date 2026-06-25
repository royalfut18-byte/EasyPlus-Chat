import type { NextConfig } from "next"

const nextConfig: NextConfig = {
  serverExternalPackages: ['@napi-rs/canvas'],
  // Keep visited pages in the client Router Cache so navigating back and forth
  // between sections is instant instead of re-fetching the server every time.
  experimental: {
    staleTimes: {
      dynamic: 180,
      static: 300,
    },
  },
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'aidvozedwqxvtqrvrdrw.supabase.co',
      },
      {
        protocol: 'https',
        hostname: 'lh3.googleusercontent.com',
      },
    ],
  },
}

export default nextConfig
