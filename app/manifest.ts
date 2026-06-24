import type { MetadataRoute } from 'next'

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'EasyPlus AI',
    short_name: 'EasyPlus',
    description: 'A private AI workspace for chat, files, Projects, research, and artifacts.',
    start_url: '/chat',
    scope: '/',
    display: 'standalone',
    background_color: '#12100e',
    theme_color: '#12100e',
    icons: [
      {
        src: '/pwa-icon-192.png',
        sizes: '192x192',
        type: 'image/png',
      },
      {
        src: '/pwa-icon-512.png',
        sizes: '512x512',
        type: 'image/png',
      },
    ],
  }
}
