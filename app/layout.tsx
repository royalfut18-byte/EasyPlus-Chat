import type { Metadata } from "next"
import { Inter } from "next/font/google"
import { Analytics } from "@vercel/analytics/next"
import "./globals.css"
import { Toaster } from "@/components/ui/toaster"

const inter = Inter({ subsets: ["latin"] })

export const metadata: Metadata = {
  title: "EasyPlus AI - All-in-one AI workspace",
  description: "A premium AI workspace for chat, files, Projects, memory, research, artifacts, and admin-managed access.",
  keywords: "AI workspace, AI chat, file analysis, Projects, memory, artifacts, research tools",
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
