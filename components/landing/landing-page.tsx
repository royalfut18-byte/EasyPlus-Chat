'use client'

import { motion } from 'framer-motion'
import {
  Shield,
  Zap,
  MessageSquare,
  Globe2,
  Lock,
  History,
  Search,
  Brain,
  ArrowRight,
  Sparkles,
} from 'lucide-react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'

export function LandingPage() {
  return (
    <div className="min-h-screen bg-[#0A0A0F] text-white relative overflow-hidden">
      {/* Background Effects */}
      <div className="absolute inset-0 bg-gradient-radial from-purple-900/20 via-transparent to-transparent" />
      <div className="absolute inset-0" style={{
        backgroundImage: 'radial-gradient(circle at 1px 1px, rgba(255,255,255,0.05) 1px, transparent 0)',
        backgroundSize: '40px 40px'
      }} />

      {/* Navbar */}
      <nav className="relative z-10 flex items-center justify-between p-6 max-w-7xl mx-auto border-b border-white/5 backdrop-blur-sm">
        <div className="flex items-center gap-2">
          <div className="h-10 w-10 rounded-xl gradient-primary flex items-center justify-center text-2xl font-bold shadow-lg shadow-purple-500/30">
            +
          </div>
          <span className="font-bold text-xl">EasyPlus AI</span>
        </div>
        <Link href="/login">
          <Button className="gradient-primary shadow-lg shadow-purple-500/30">
            Sign In
          </Button>
        </Link>
      </nav>

      <main className="relative z-10 max-w-7xl mx-auto px-6">
        {/* Hero Section */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6 }}
          className="text-center pt-24 pb-16 space-y-8"
        >
          <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full glass border border-white/10 text-sm text-gray-300 mb-4">
            <Lock className="h-4 w-4 text-purple-400" />
            <span>Private AI Workspace • Invite Only</span>
          </div>

          <h1 className="text-5xl md:text-7xl font-bold leading-tight max-w-4xl mx-auto">
            Your private
            <br />
            <span className="gradient-text">AI workspace.</span>
          </h1>

          <p className="text-lg md:text-xl text-gray-400 max-w-2xl mx-auto leading-relaxed">
            EasyPlus gives approved users access to a fast Claude-powered chat workspace
            with web search, conversation history, and admin-managed credits.
          </p>

          <div className="flex flex-col sm:flex-row gap-4 justify-center items-center pt-4">
            <Link href="/login">
              <Button size="lg" className="gradient-primary text-lg px-8 shadow-xl shadow-purple-500/30">
                Sign In
                <ArrowRight className="ml-2 h-5 w-5" />
              </Button>
            </Link>
            <p className="text-sm text-gray-500">Access is managed by the admin</p>
          </div>
        </motion.div>

        {/* Product Preview */}
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.2 }}
          className="max-w-5xl mx-auto mb-32"
        >
          <div className="glass-strong rounded-3xl border border-white/10 overflow-hidden shadow-2xl">
            <div className="bg-gradient-to-b from-white/5 to-transparent p-3 border-b border-white/10">
              <div className="flex items-center gap-2">
                <div className="flex gap-1.5">
                  <div className="w-3 h-3 rounded-full bg-red-500/80" />
                  <div className="w-3 h-3 rounded-full bg-yellow-500/80" />
                  <div className="w-3 h-3 rounded-full bg-green-500/80" />
                </div>
                <div className="flex-1 text-center text-sm text-gray-400">
                  EasyPlus AI Workspace
                </div>
              </div>
            </div>

            <div className="p-8 space-y-4">
              <div className="flex justify-end">
                <div className="max-w-md glass rounded-2xl p-4 border border-white/10">
                  <p className="text-sm text-gray-200">
                    What's the latest news about AI today? Search the web.
                  </p>
                </div>
              </div>

              <div className="flex justify-start">
                <div className="max-w-2xl glass-strong rounded-2xl p-5 border border-purple-500/20 space-y-3">
                  <div className="flex items-center gap-2 text-xs text-gray-400">
                    <Search className="h-3 w-3" />
                    <span>Searching the web...</span>
                  </div>
                  <p className="text-sm text-gray-200 leading-relaxed">
                    Based on recent web search results, here are the key AI developments today:
                    <br /><br />
                    • OpenAI announces new safety research initiatives
                    <br />
                    • Anthropic releases Claude 4.6 with improved reasoning
                    <br />
                    • Google DeepMind publishes breakthrough in protein folding
                  </p>
                  <div className="flex items-center gap-2 text-xs text-gray-500">
                    <Globe2 className="h-3 w-3" />
                    <span>Sources: TechCrunch, The Verge, MIT Technology Review</span>
                  </div>
                </div>
              </div>

              <div className="flex justify-center pt-4">
                <div className="flex items-center gap-2 text-xs text-gray-500">
                  <Sparkles className="h-4 w-4 text-purple-400 animate-pulse" />
                  <span>Claude-powered • Real-time web search</span>
                </div>
              </div>
            </div>
          </div>
        </motion.div>

        {/* Features Grid */}
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6 mb-32">
          <FeatureCard
            icon={<Brain className="h-7 w-7" />}
            title="Claude-Powered"
            description="Advanced Claude Opus 4.6 model for intelligent, nuanced responses"
            color="from-purple-500 to-blue-500"
          />
          <FeatureCard
            icon={<Search className="h-7 w-7" />}
            title="Web Search"
            description="Access current information with integrated real-time web search"
            color="from-blue-500 to-cyan-500"
          />
          <FeatureCard
            icon={<History className="h-7 w-7" />}
            title="Conversation History"
            description="Save and revisit all your chats with organized conversation management"
            color="from-cyan-500 to-teal-500"
          />
          <FeatureCard
            icon={<Shield className="h-7 w-7" />}
            title="Admin-Controlled"
            description="Secure workspace with admin-managed user accounts and permissions"
            color="from-teal-500 to-green-500"
          />
          <FeatureCard
            icon={<Lock className="h-7 w-7" />}
            title="Private Access"
            description="No public signups. Access is invite-only for authorized users"
            color="from-green-500 to-emerald-500"
          />
          <FeatureCard
            icon={<Zap className="h-7 w-7" />}
            title="Credit Management"
            description="Admin controls credit allocation with unlimited access for premium users"
            color="from-emerald-500 to-yellow-500"
          />
        </div>

        {/* Admin Access Section */}
        <motion.div
          initial={{ opacity: 0 }}
          whileInView={{ opacity: 1 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6 }}
          className="max-w-4xl mx-auto mb-32"
        >
          <div className="glass-strong rounded-3xl border border-white/10 p-12 text-center space-y-6">
            <div className="inline-flex h-16 w-16 rounded-2xl gradient-primary items-center justify-center mx-auto shadow-lg shadow-purple-500/30">
              <Lock className="h-8 w-8" />
            </div>
            <h2 className="text-3xl md:text-4xl font-bold">Private Workspace Access</h2>
            <p className="text-lg text-gray-400 max-w-2xl mx-auto leading-relaxed">
              EasyPlus is a private AI workspace. There are no public signups or free trials.
              All user accounts are created and managed by the workspace administrator.
            </p>
            <div className="flex flex-col sm:flex-row gap-4 justify-center pt-4">
              <div className="glass rounded-xl px-6 py-3 border border-white/10">
                <div className="flex items-center gap-2 text-sm">
                  <Shield className="h-4 w-4 text-purple-400" />
                  <span className="text-gray-300">Secure & Private</span>
                </div>
              </div>
              <div className="glass rounded-xl px-6 py-3 border border-white/10">
                <div className="flex items-center gap-2 text-sm">
                  <MessageSquare className="h-4 w-4 text-blue-400" />
                  <span className="text-gray-300">Invite Only</span>
                </div>
              </div>
              <div className="glass rounded-xl px-6 py-3 border border-white/10">
                <div className="flex items-center gap-2 text-sm">
                  <Lock className="h-4 w-4 text-green-400" />
                  <span className="text-gray-300">Admin Managed</span>
                </div>
              </div>
            </div>
          </div>
        </motion.div>

        {/* Final CTA */}
        <motion.div
          initial={{ opacity: 0 }}
          whileInView={{ opacity: 1 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6 }}
          className="text-center pb-32 space-y-6"
        >
          <h2 className="text-4xl md:text-5xl font-bold">
            Already have an account?
          </h2>
          <p className="text-lg text-gray-400">
            Sign in to access your private AI workspace
          </p>
          <Link href="/login">
            <Button size="lg" className="gradient-primary text-lg px-10 shadow-xl shadow-purple-500/30">
              Sign In
              <ArrowRight className="ml-2 h-5 w-5" />
            </Button>
          </Link>
        </motion.div>
      </main>

      {/* Footer */}
      <footer className="relative z-10 border-t border-white/5 py-8">
        <div className="max-w-7xl mx-auto px-6">
          <div className="flex flex-col md:flex-row justify-between items-center gap-4">
            <div className="flex items-center gap-2">
              <div className="h-8 w-8 rounded-lg gradient-primary flex items-center justify-center text-lg font-bold">
                +
              </div>
              <span className="text-sm text-gray-400">© 2024 EasyPlus AI. All rights reserved.</span>
            </div>
            <div className="text-sm text-gray-500">
              A private AI workspace powered by Claude
            </div>
          </div>
        </div>
      </footer>
    </div>
  )
}

function FeatureCard({
  icon,
  title,
  description,
  color,
}: {
  icon: React.ReactNode
  title: string
  description: string
  color: string
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true }}
      whileHover={{ y: -5, scale: 1.02 }}
      transition={{ duration: 0.3 }}
      className="glass-strong rounded-2xl p-6 border border-white/10 space-y-4 hover:border-white/20 transition-all"
    >
      <div className={`h-12 w-12 rounded-xl bg-gradient-to-br ${color} flex items-center justify-center shadow-lg`}>
        {icon}
      </div>
      <h3 className="text-xl font-semibold text-white">{title}</h3>
      <p className="text-gray-400 leading-relaxed">{description}</p>
    </motion.div>
  )
}
