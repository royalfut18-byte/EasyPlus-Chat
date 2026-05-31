import type { Metadata } from "next"
import { Inter } from "next/font/google"
import { Analytics } from "@vercel/analytics/next"
import "./globals.css"
import { Toaster } from "@/components/ui/toaster"

const inter = Inter({ subsets: ["latin"] })

export const metadata: Metadata = {
  title: "EasyPlus AI - One Interface. Every AI.",
  description: "Premium multi-model AI chat platform with Chat GPT 5.5, Claude Opus 4.7, and Gemini 3.1 Pro",
  keywords: "AI, Chat GPT, Claude Opus 4.7, Gemini 3.1 Pro, AI Chat, Multi-model AI",
  icons: {
    icon: "/newlogo.png",
    apple: "/newlogo.png",
  },
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en" className="dark">
      <body className={inter.className}>
        {children}
        <Toaster />
        <Analytics />
      </body>
    </html>
  )
}
