'use client'

import { motion } from 'framer-motion'
import {
  Shield,
  MessageSquare,
  Globe2,
  Lock,
  ArrowRight,
  Sparkles,
  Crown,
  FileCode,
  Image as ImageIcon,
} from 'lucide-react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Logo } from '@/components/brand/logo'
import { ChatGPTIcon } from '@/components/icons/chatgpt-icon'
import { AnthropicIcon } from '@/components/icons/anthropic-icon'
import { WorkspacePreview } from './workspace-preview'

export function LandingPage() {
  return (
    <div className="min-h-screen bg-[#05050a] text-white relative overflow-hidden">
      {/* Subtle Background Texture */}
      <div className="absolute inset-0 overflow-hidden">
        <motion.div
          animate={{
            opacity: [0.45, 0.65, 0.45],
          }}
          transition={{
            duration: 12,
            repeat: Infinity,
            ease: 'easeInOut',
          }}
          className="absolute inset-x-0 top-0 h-[520px] bg-[radial-gradient(ellipse_at_top,rgba(124,58,237,0.18),rgba(14,165,233,0.06)_38%,transparent_72%)]"
        />
        <motion.div
          animate={{
            opacity: [0.25, 0.4, 0.25],
          }}
          transition={{
            duration: 15,
            repeat: Infinity,
            ease: 'easeInOut',
          }}
          className="absolute inset-x-0 top-[360px] h-[420px] bg-[linear-gradient(120deg,transparent,rgba(79,70,229,0.08),rgba(236,72,153,0.05),transparent)]"
        />
      </div>

      {/* Subtle Grid Pattern */}
      <div className="absolute inset-0 opacity-[0.08]">
        <div
          className="absolute inset-0"
          style={{
            backgroundImage: `linear-gradient(rgba(139, 92, 246, 0.15) 1px, transparent 1px),
                             linear-gradient(90deg, rgba(139, 92, 246, 0.15) 1px, transparent 1px)`,
            backgroundSize: '60px 60px',
            maskImage: 'radial-gradient(ellipse at center, black 15%, transparent 65%)',
          }}
        />
      </div>

      {/* Navbar */}
      <nav className="relative z-50 flex items-center justify-between p-4 md:p-6 max-w-7xl mx-auto">
        <motion.div
          initial={{ opacity: 0, x: -20 }}
          animate={{ opacity: 1, x: 0 }}
        >
          <Logo size="sm" showText className="md:w-auto" />
        </motion.div>
        <motion.div
          initial={{ opacity: 0, x: 20 }}
          animate={{ opacity: 1, x: 0 }}
        >
          <Link href="/login">
            <Button className="bg-violet-600/80 hover:bg-violet-600 text-white border border-violet-500/30 transition-all hover:scale-105 text-sm md:text-base px-4 md:px-6 h-9 md:h-10">
              <Lock className="mr-1.5 md:mr-2 h-3.5 w-3.5 md:h-4 md:w-4" />
              Sign In
            </Button>
          </Link>
        </motion.div>
      </nav>

      <main className="relative z-10 max-w-7xl mx-auto px-6">
        {/* Hero Section */}
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8 }}
          className="text-center pt-10 md:pt-14 lg:pt-16 pb-14 md:pb-16 space-y-7 md:space-y-8"
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: 0.2 }}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-white/[0.03] border border-white/[0.08] text-sm"
          >
            <Lock className="h-3.5 w-3.5 text-violet-400" />
            <span className="text-gray-400 font-medium text-xs">Private Access</span>
          </motion.div>

          <motion.h1
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3 }}
            className="text-4xl sm:text-5xl md:text-7xl lg:text-8xl font-black leading-[1.08] max-w-5xl mx-auto px-4"
          >
            Your private
            <br />
            <span className="relative inline-block">
              <span className="absolute inset-0 blur-xl md:blur-2xl bg-gradient-to-r from-violet-400 via-indigo-400 to-violet-300 opacity-30" />
              <span className="relative bg-gradient-to-r from-violet-300 via-indigo-300 to-violet-400 bg-clip-text text-transparent">
                AI workspace.
              </span>
            </span>
          </motion.h1>

          <motion.p
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.4 }}
            className="text-base md:text-xl lg:text-2xl text-gray-400 max-w-3xl mx-auto leading-relaxed font-light px-4"
          >
            EasyPlus gives approved users access to a fast Claude-powered chat workspace
            with web search, conversation history, and admin-managed credits.
          </motion.p>

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.5 }}
            className="flex flex-col items-center gap-6 pt-6"
          >
            <Link href="/login">
              <Button
                size="lg"
                className="bg-violet-600 hover:bg-violet-500 text-white text-base md:text-lg px-8 md:px-12 py-5 md:py-7 rounded-xl md:rounded-2xl transition-all group shadow-lg shadow-violet-950/40"
              >
                <Lock className="mr-2 h-4 w-4 md:h-5 md:w-5 group-hover:rotate-12 transition-transform" />
                Sign In
                <ArrowRight className="ml-2 h-4 w-4 md:h-5 md:w-5 group-hover:translate-x-1 transition-transform" />
              </Button>
            </Link>
            <p className="text-xs md:text-sm text-gray-500 px-4">
              Access is managed by your workspace admin
            </p>
          </motion.div>
        </motion.div>

        <WorkspacePreview />

        {/* Features Grid */}
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4 md:gap-6 mb-20 md:mb-40 px-4">
          {[
            {
              icon: <Sparkles className="h-6 w-6" />,
              title: 'Top AI Models',
              description: 'Switch between leading models like Claude, ChatGPT, and Gemini for every workflow',
              color: 'from-purple-500 to-violet-600',
              delay: 0,
            },
            {
              icon: <Globe2 className="h-6 w-6" />,
              title: 'Web Search',
              description: 'Access current information with real-time web search',
              color: 'from-blue-500 to-cyan-500',
              delay: 0.1,
            },
            {
              icon: <MessageSquare className="h-6 w-6" />,
              title: 'Conversation History',
              description: 'Save and revisit all your chats with organization',
              color: 'from-cyan-500 to-teal-500',
              delay: 0.2,
            },
            {
              icon: <Shield className="h-6 w-6" />,
              title: 'Private Workspace',
              description: 'Secure, invite-only environment for authorized users',
              color: 'from-teal-500 to-green-500',
              delay: 0.3,
            },
            {
              icon: <Lock className="h-6 w-6" />,
              title: 'Private Access',
              description: 'Invite-only workspace for authorized users',
              color: 'from-green-500 to-emerald-500',
              delay: 0.4,
            },
            {
              icon: <Crown className="h-6 w-6" />,
              title: 'Unlimited Credits',
              description: 'Keep working without usage caps or credit limits getting in the way',
              color: 'from-yellow-500 to-orange-500',
              delay: 0.5,
            },
          ].map((feature, index) => (
            <FeatureCard key={index} {...feature} />
          ))}
        </div>

        {/* Admin Dashboard Preview */}
        <motion.div
          initial={{ opacity: 0, y: 40 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.8 }}
          className="max-w-6xl mx-auto mb-20 md:mb-40 px-4"
        >
          <div className="text-center mb-12 md:mb-16 space-y-3 md:space-y-4">
            <h2 className="text-3xl md:text-4xl lg:text-5xl font-bold">One workspace. Multiple AI powers.</h2>
            <p className="text-base md:text-lg lg:text-xl text-gray-400 max-w-3xl mx-auto">
              Use ChatGPT 5.5, Claude Opus 4.6, Gemini 3.1 Pro, live web search, image understanding, and interactive artifacts — all inside one private EasyPlus workspace.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {[
              {
                icon: <ChatGPTIcon className="h-5 w-5" />,
                title: 'ChatGPT 5.5',
                description: 'A powerful OpenAI-style assistant experience for fast answers, writing, reasoning, and everyday tasks.',
                color: 'text-[#10a37f]',
                bgGradient: 'from-[#10a37f]/20 to-[#10a37f]/5',
              },
              {
                icon: <AnthropicIcon className="h-5 w-5" />,
                title: 'Claude Opus 4.6',
                description: 'Premium reasoning, coding, research, and artifact creation for complex work.',
                color: 'text-[#d97757]',
                bgGradient: 'from-[#d97757]/20 to-[#d97757]/5',
              },
              {
                icon: <Sparkles className="h-5 w-5" />,
                title: 'Gemini 3.1 Pro',
                description: 'A Google-powered AI experience for fast answers, multimodal help, and lightweight reasoning.',
                color: 'text-blue-400',
                bgGradient: 'from-blue-500/20 to-blue-500/5',
              },
              {
                icon: <Globe2 className="h-5 w-5" />,
                title: 'Web Search',
                description: 'Search the live web when you need current news, scores, prices, or recent updates.',
                color: 'text-cyan-400',
                bgGradient: 'from-cyan-500/20 to-cyan-500/5',
              },
              {
                icon: <FileCode className="h-5 w-5" />,
                title: 'Artifacts Mode',
                description: 'Create interactive HTML previews, games, landing pages, dashboards, and code artifacts in a side panel.',
                color: 'text-purple-400',
                bgGradient: 'from-purple-500/20 to-purple-500/5',
              },
              {
                icon: <ImageIcon className="h-5 w-5" />,
                title: 'Image Understanding',
                description: 'Upload or paste images and ask the AI to analyze, explain, solve, or extract information.',
                color: 'text-pink-400',
                bgGradient: 'from-pink-500/20 to-pink-500/5',
              },
            ].map((feature, i) => (
              <motion.div
                key={i}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: i * 0.1 }}
                className="bg-white/[0.02] rounded-2xl border border-white/[0.06] p-6 hover:border-white/[0.12] transition-all group"
              >
                <div className={`h-12 w-12 rounded-xl bg-gradient-to-br ${feature.bgGradient} border border-white/10 flex items-center justify-center mb-4 ${feature.color}`}>
                  {feature.icon}
                </div>
                <h3 className="text-xl font-semibold mb-2">{feature.title}</h3>
                <p className="text-sm text-gray-400 leading-relaxed">
                  {feature.description}
                </p>
              </motion.div>
            ))}
          </div>
        </motion.div>

        {/* Final CTA */}
        <motion.div
          initial={{ opacity: 0 }}
          whileInView={{ opacity: 1 }}
          viewport={{ once: true }}
          transition={{ duration: 0.8 }}
          className="relative text-center pb-32 pt-20"
        >
          <div className="absolute inset-0 bg-gradient-to-b from-violet-500/3 via-indigo-500/2 to-transparent rounded-3xl blur-3xl" />

          <div className="relative space-y-8">
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              className="space-y-4"
            >
              <h2 className="text-5xl md:text-6xl font-bold">
                Already have access?
              </h2>
              <p className="text-xl text-gray-400 max-w-xl mx-auto">
                Sign in to use your private EasyPlus AI workspace.
              </p>
            </motion.div>

            <motion.div
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: 0.2 }}
            >
              <Link href="/login">
                <Button
                  size="lg"
                  className="bg-violet-600 hover:bg-violet-500 text-white text-xl px-16 py-8 rounded-2xl transition-all group"
                >
                  <Lock className="mr-3 h-6 w-6 group-hover:rotate-12 transition-transform" />
                  Sign In
                  <ArrowRight className="ml-3 h-6 w-6 group-hover:translate-x-1 transition-transform" />
                </Button>
              </Link>
            </motion.div>
          </div>
        </motion.div>
      </main>

      {/* Footer */}
      <footer className="relative z-10 border-t border-white/[0.04] py-12">
        <div className="max-w-7xl mx-auto px-6">
          <div className="flex flex-col md:flex-row justify-between items-center gap-6">
            <div className="flex items-center gap-3">
              <Logo size="sm" />
              <div className="text-left">
                <div className="font-medium text-sm text-gray-300">EasyPlus AI</div>
                <div className="text-xs text-gray-600">© 2026 All rights reserved</div>
              </div>
            </div>
            <div className="flex items-center gap-2 text-sm text-gray-500">
              <Sparkles className="h-3.5 w-3.5 text-violet-400/60" />
              <span>Powered by Claude Opus 4.6</span>
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
  delay,
}: {
  icon: React.ReactNode
  title: string
  description: string
  color: string
  delay: number
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 30 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true }}
      transition={{ duration: 0.5, delay }}
      whileHover={{ y: -4, scale: 1.01 }}
      className="relative group"
    >
      <div className="relative bg-white/[0.02] rounded-2xl p-7 border border-white/[0.06] group-hover:border-white/[0.12] transition-all space-y-4 h-full">
        <div className="h-11 w-11 rounded-xl bg-white/[0.04] border border-white/[0.08] flex items-center justify-center text-violet-300 transition-all">
          {icon}
        </div>
        <h3 className="text-lg font-semibold text-white/90">{title}</h3>
        <p className="text-gray-500 leading-relaxed text-sm">{description}</p>
      </div>
    </motion.div>
  )
}
