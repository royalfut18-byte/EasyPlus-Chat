'use client'

import { motion, useAnimation } from 'framer-motion'
import { useEffect } from 'react'
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
  Crown,
  Users,
  Settings,
  Infinity as InfinityIcon,
} from 'lucide-react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'

export function LandingPage() {
  return (
    <div className="min-h-screen bg-[#050508] text-white relative overflow-hidden">
      {/* Animated Background Orbs */}
      <div className="absolute inset-0 overflow-hidden">
        <motion.div
          animate={{
            x: [0, 100, 0],
            y: [0, -100, 0],
            scale: [1, 1.2, 1],
          }}
          transition={{
            duration: 20,
            repeat: Infinity,
            ease: 'linear',
          }}
          className="absolute top-0 -left-20 w-[600px] h-[600px] bg-purple-500/20 rounded-full blur-[120px]"
        />
        <motion.div
          animate={{
            x: [0, -100, 0],
            y: [0, 100, 0],
            scale: [1, 1.3, 1],
          }}
          transition={{
            duration: 25,
            repeat: Infinity,
            ease: 'linear',
          }}
          className="absolute bottom-0 right-0 w-[700px] h-[700px] bg-blue-500/15 rounded-full blur-[120px]"
        />
        <motion.div
          animate={{
            x: [0, 50, 0],
            y: [0, -50, 0],
          }}
          transition={{
            duration: 15,
            repeat: Infinity,
            ease: 'linear',
          }}
          className="absolute top-1/3 right-1/4 w-[500px] h-[500px] bg-cyan-500/10 rounded-full blur-[100px]"
        />
      </div>

      {/* Animated Grid Pattern */}
      <div className="absolute inset-0 opacity-20">
        <div
          className="absolute inset-0"
          style={{
            backgroundImage: `linear-gradient(rgba(139, 92, 246, 0.1) 1px, transparent 1px),
                             linear-gradient(90deg, rgba(139, 92, 246, 0.1) 1px, transparent 1px)`,
            backgroundSize: '50px 50px',
            maskImage: 'radial-gradient(ellipse at center, black 20%, transparent 70%)',
          }}
        />
      </div>

      {/* Navbar */}
      <nav className="relative z-50 flex items-center justify-between p-6 max-w-7xl mx-auto">
        <motion.div
          initial={{ opacity: 0, x: -20 }}
          animate={{ opacity: 1, x: 0 }}
          className="flex items-center gap-3"
        >
          <img
            src="/logo.png"
            alt="EasyPlus AI"
            className="h-12 w-auto object-contain"
          />
          <span className="font-bold text-xl bg-gradient-to-r from-white to-gray-300 bg-clip-text text-transparent">
            EasyPlus AI
          </span>
        </motion.div>
        <motion.div
          initial={{ opacity: 0, x: 20 }}
          animate={{ opacity: 1, x: 0 }}
        >
          <Link href="/login">
            <Button className="gradient-primary shadow-2xl shadow-purple-500/50 hover:shadow-purple-500/70 transition-all hover:scale-105">
              <Lock className="mr-2 h-4 w-4" />
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
          className="text-center pt-20 md:pt-32 pb-24 space-y-10"
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: 0.2 }}
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-full glass-strong border border-purple-500/30 text-sm backdrop-blur-xl shadow-xl shadow-purple-500/20"
          >
            <div className="relative">
              <Lock className="h-4 w-4 text-purple-300" />
              <div className="absolute inset-0 animate-ping">
                <Lock className="h-4 w-4 text-purple-300 opacity-20" />
              </div>
            </div>
            <span className="text-gray-200 font-medium">Private Access • Admin Managed</span>
          </motion.div>

          <motion.h1
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3 }}
            className="text-6xl md:text-8xl lg:text-9xl font-black leading-[1.1] max-w-5xl mx-auto"
          >
            Your private
            <br />
            <span className="relative inline-block">
              <span className="absolute inset-0 blur-2xl bg-gradient-to-r from-purple-400 via-blue-500 to-cyan-400 opacity-50" />
              <span className="relative bg-gradient-to-r from-purple-400 via-blue-500 to-cyan-400 bg-clip-text text-transparent">
                AI workspace.
              </span>
            </span>
          </motion.h1>

          <motion.p
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.4 }}
            className="text-xl md:text-2xl text-gray-400 max-w-3xl mx-auto leading-relaxed font-light"
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
                className="gradient-primary text-lg px-12 py-7 rounded-2xl shadow-2xl shadow-purple-500/50 hover:shadow-purple-500/70 hover:scale-105 transition-all group"
              >
                <Lock className="mr-2 h-5 w-5 group-hover:rotate-12 transition-transform" />
                Sign In
                <ArrowRight className="ml-2 h-5 w-5 group-hover:translate-x-1 transition-transform" />
              </Button>
            </Link>
            <p className="text-sm text-gray-500">
              Access is managed by your workspace admin
            </p>
          </motion.div>
        </motion.div>

        {/* Floating Product Preview */}
        <motion.div
          initial={{ opacity: 0, y: 60 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 1, delay: 0.6 }}
          className="max-w-6xl mx-auto mb-40 relative"
        >
          <motion.div
            animate={{
              y: [0, -10, 0],
            }}
            transition={{
              duration: 6,
              repeat: Infinity,
              ease: 'easeInOut',
            }}
            className="relative"
          >
            {/* Glow Effect */}
            <div className="absolute -inset-4 bg-gradient-to-r from-purple-500/20 via-blue-500/20 to-cyan-500/20 rounded-[2.5rem] blur-3xl" />

            <div className="relative glass-strong rounded-[2rem] border-2 border-white/10 overflow-hidden shadow-2xl backdrop-blur-2xl">
              {/* Window Chrome */}
              <div className="bg-gradient-to-r from-white/10 to-white/5 p-4 border-b border-white/10 backdrop-blur-xl">
                <div className="flex items-center justify-between">
                  <div className="flex gap-2">
                    <div className="w-3 h-3 rounded-full bg-red-500/90 shadow-lg shadow-red-500/50" />
                    <div className="w-3 h-3 rounded-full bg-yellow-500/90 shadow-lg shadow-yellow-500/50" />
                    <div className="w-3 h-3 rounded-full bg-green-500/90 shadow-lg shadow-green-500/50" />
                  </div>
                  <div className="flex items-center gap-2 px-4 py-1.5 rounded-lg glass border border-white/10">
                    <div className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
                    <span className="text-xs text-gray-300">EasyPlus AI</span>
                  </div>
                  <div className="w-16" />
                </div>
              </div>

              {/* Chat Interface */}
              <div className="flex bg-gradient-to-b from-transparent to-white/5">
                {/* Sidebar */}
                <div className="w-64 border-r border-white/10 p-4 space-y-2 hidden md:block">
                  <div className="flex items-center justify-between mb-4">
                    <span className="text-xs font-semibold text-gray-400">Conversations</span>
                    <Crown className="h-3 w-3 text-yellow-500" />
                  </div>
                  {['Latest AI News', 'Code Review Help', 'Research Summary'].map((title, i) => (
                    <motion.div
                      key={i}
                      initial={{ opacity: 0, x: -20 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: 1 + i * 0.1 }}
                      className={`p-3 rounded-xl transition-all cursor-pointer ${
                        i === 0 ? 'glass-strong border border-purple-500/30' : 'hover:bg-white/5'
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        <MessageSquare className="h-4 w-4 text-gray-400" />
                        <span className="text-xs text-gray-300 truncate">{title}</span>
                      </div>
                    </motion.div>
                  ))}
                </div>

                {/* Chat Area */}
                <div className="flex-1 p-6 md:p-8 space-y-6">
                  <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 1.2 }}
                    className="flex justify-end"
                  >
                    <div className="max-w-lg gradient-primary rounded-2xl rounded-br-sm p-4 shadow-lg">
                      <p className="text-sm text-white">
                        What's the latest news about AI today? Search the web.
                      </p>
                    </div>
                  </motion.div>

                  <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 1.4 }}
                    className="flex justify-start"
                  >
                    <div className="max-w-2xl glass-strong rounded-2xl rounded-bl-sm p-5 border border-purple-500/20 space-y-4 shadow-xl">
                      <div className="flex items-center gap-2 text-xs text-purple-300">
                        <Search className="h-3.5 w-3.5 animate-pulse" />
                        <span>Searching the web...</span>
                      </div>
                      <p className="text-sm text-gray-200 leading-relaxed">
                        Based on recent web search results, here are today's key AI developments:
                      </p>
                      <div className="space-y-2">
                        {['OpenAI safety research', 'Claude 4.6 reasoning', 'DeepMind protein folding'].map((item, i) => (
                          <motion.div
                            key={i}
                            initial={{ opacity: 0, x: -10 }}
                            animate={{ opacity: 1, x: 0 }}
                            transition={{ delay: 1.6 + i * 0.1 }}
                            className="flex items-center gap-2 text-sm text-gray-300"
                          >
                            <div className="w-1.5 h-1.5 rounded-full bg-purple-400" />
                            <span>{item}</span>
                          </motion.div>
                        ))}
                      </div>
                      <div className="flex flex-wrap gap-2 pt-2">
                        {['TechCrunch', 'The Verge', 'MIT Tech'].map((source, i) => (
                          <motion.div
                            key={i}
                            initial={{ opacity: 0, scale: 0.8 }}
                            animate={{ opacity: 1, scale: 1 }}
                            transition={{ delay: 1.9 + i * 0.1 }}
                            className="px-2.5 py-1 rounded-full glass border border-white/10 text-xs text-gray-400 flex items-center gap-1"
                          >
                            <Globe2 className="h-3 w-3" />
                            {source}
                          </motion.div>
                        ))}
                      </div>
                    </div>
                  </motion.div>

                  <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ delay: 2.2 }}
                    className="flex items-center gap-2 text-xs text-gray-500"
                  >
                    <div className="flex gap-1">
                      <motion.div
                        animate={{ scale: [1, 1.2, 1] }}
                        transition={{ duration: 1, repeat: Infinity, delay: 0 }}
                        className="w-2 h-2 rounded-full bg-purple-500"
                      />
                      <motion.div
                        animate={{ scale: [1, 1.2, 1] }}
                        transition={{ duration: 1, repeat: Infinity, delay: 0.2 }}
                        className="w-2 h-2 rounded-full bg-purple-500"
                      />
                      <motion.div
                        animate={{ scale: [1, 1.2, 1] }}
                        transition={{ duration: 1, repeat: Infinity, delay: 0.4 }}
                        className="w-2 h-2 rounded-full bg-purple-500"
                      />
                    </div>
                    <span>Claude is responding...</span>
                  </motion.div>
                </div>
              </div>
            </div>
          </motion.div>
        </motion.div>

        {/* Features Grid */}
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6 mb-40">
          {[
            {
              icon: <Brain className="h-7 w-7" />,
              title: 'Claude-Powered',
              description: 'Advanced Claude Opus 4.6 model for intelligent responses',
              color: 'from-purple-500 to-violet-600',
              delay: 0,
            },
            {
              icon: <Search className="h-7 w-7" />,
              title: 'Web Search',
              description: 'Access current information with real-time web search',
              color: 'from-blue-500 to-cyan-500',
              delay: 0.1,
            },
            {
              icon: <History className="h-7 w-7" />,
              title: 'Conversation History',
              description: 'Save and revisit all your chats with organization',
              color: 'from-cyan-500 to-teal-500',
              delay: 0.2,
            },
            {
              icon: <Shield className="h-7 w-7" />,
              title: 'Admin-Controlled',
              description: 'Secure workspace with admin-managed permissions',
              color: 'from-teal-500 to-green-500',
              delay: 0.3,
            },
            {
              icon: <Lock className="h-7 w-7" />,
              title: 'Private Access',
              description: 'Invite-only workspace for authorized users',
              color: 'from-green-500 to-emerald-500',
              delay: 0.4,
            },
            {
              icon: <Zap className="h-7 w-7" />,
              title: 'Credit Management',
              description: 'Admin controls with unlimited access options',
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
          className="max-w-5xl mx-auto mb-40"
        >
          <div className="text-center mb-16 space-y-4">
            <h2 className="text-4xl md:text-5xl font-bold">Admin-Managed Access</h2>
            <p className="text-xl text-gray-400 max-w-2xl mx-auto">
              EasyPlus is a private workspace. All accounts are created and managed by your administrator.
            </p>
          </div>

          <motion.div
            animate={{
              y: [0, -5, 0],
            }}
            transition={{
              duration: 5,
              repeat: Infinity,
              ease: 'easeInOut',
            }}
            className="relative"
          >
            <div className="absolute -inset-4 bg-gradient-to-r from-green-500/20 via-emerald-500/20 to-teal-500/20 rounded-3xl blur-3xl" />

            <div className="relative glass-strong rounded-2xl border-2 border-white/10 overflow-hidden shadow-2xl">
              <div className="bg-gradient-to-r from-white/10 to-white/5 p-4 border-b border-white/10">
                <div className="flex items-center gap-2">
                  <Shield className="h-5 w-5 text-green-400" />
                  <span className="font-semibold">Admin Control Panel</span>
                </div>
              </div>

              <div className="p-6 space-y-3">
                {[
                  { icon: <Users className="h-4 w-4" />, label: 'Create User Account', color: 'text-blue-400' },
                  { icon: <Settings className="h-4 w-4" />, label: 'Set User Role: Admin / User', color: 'text-purple-400' },
                  { icon: <Zap className="h-4 w-4" />, label: 'Allocate Credits', color: 'text-yellow-400' },
                  { icon: <InfinityIcon className="h-4 w-4" />, label: 'Toggle Unlimited Credits', color: 'text-green-400' },
                  { icon: <Lock className="h-4 w-4" />, label: 'Manage Permissions', color: 'text-red-400' },
                ].map((item, i) => (
                  <motion.div
                    key={i}
                    initial={{ opacity: 0, x: -20 }}
                    whileInView={{ opacity: 1, x: 0 }}
                    viewport={{ once: true }}
                    transition={{ delay: i * 0.1 }}
                    className="flex items-center gap-3 p-4 rounded-xl glass border border-white/10 hover:border-white/20 transition-all"
                  >
                    <div className={`${item.color}`}>{item.icon}</div>
                    <span className="text-sm text-gray-300">{item.label}</span>
                  </motion.div>
                ))}
              </div>
            </div>
          </motion.div>
        </motion.div>

        {/* Final CTA */}
        <motion.div
          initial={{ opacity: 0 }}
          whileInView={{ opacity: 1 }}
          viewport={{ once: true }}
          transition={{ duration: 0.8 }}
          className="relative text-center pb-32 pt-20"
        >
          <div className="absolute inset-0 bg-gradient-to-b from-purple-500/5 via-blue-500/5 to-transparent rounded-3xl blur-3xl" />

          <div className="relative space-y-8">
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              className="space-y-4"
            >
              <h2 className="text-5xl md:text-6xl font-bold">
                Already approved?
              </h2>
              <p className="text-xl text-gray-400 max-w-xl mx-auto">
                Sign in to access your private AI workspace
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
                  className="gradient-primary text-xl px-16 py-8 rounded-2xl shadow-2xl shadow-purple-500/50 hover:shadow-purple-500/70 hover:scale-105 transition-all group"
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
      <footer className="relative z-10 border-t border-white/5 py-12 backdrop-blur-xl">
        <div className="max-w-7xl mx-auto px-6">
          <div className="flex flex-col md:flex-row justify-between items-center gap-6">
            <div className="flex items-center gap-3">
              <div className="h-9 w-9 rounded-lg gradient-primary flex items-center justify-center text-xl font-bold shadow-lg">
                +
              </div>
              <div className="text-left">
                <div className="font-semibold text-sm">EasyPlus AI</div>
                <div className="text-xs text-gray-500">© 2024 All rights reserved</div>
              </div>
            </div>
            <div className="flex items-center gap-2 text-sm text-gray-400">
              <Brain className="h-4 w-4 text-purple-400" />
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
      whileHover={{ y: -8, scale: 1.02 }}
      className="relative group"
    >
      <div className={`absolute -inset-0.5 bg-gradient-to-r ${color} rounded-2xl blur-xl opacity-0 group-hover:opacity-30 transition-opacity duration-500`} />
      <div className="relative glass-strong rounded-2xl p-6 border border-white/10 group-hover:border-white/20 transition-all space-y-4 h-full backdrop-blur-2xl">
        <div className={`h-14 w-14 rounded-xl bg-gradient-to-br ${color} flex items-center justify-center shadow-xl shadow-purple-500/20 group-hover:shadow-purple-500/40 transition-all`}>
          {icon}
        </div>
        <h3 className="text-xl font-bold text-white">{title}</h3>
        <p className="text-gray-400 leading-relaxed text-sm">{description}</p>
      </div>
    </motion.div>
  )
}
