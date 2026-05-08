'use client'

import { motion } from 'framer-motion'
import { ArrowRight, Sparkles, Zap, Shield, Globe } from 'lucide-react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { AI_MODELS } from '@/types/models'

export function LandingPage() {
  return (
    <div className="min-h-screen bg-[#0A0A0F] text-white relative overflow-hidden">
      <div className="absolute inset-0 bg-gradient-radial from-purple-900/20 via-transparent to-transparent" />
      <div className="absolute inset-0 bg-[url('/grid.svg')] opacity-10" />

      <nav className="relative z-10 flex items-center justify-between p-6 max-w-7xl mx-auto">
        <div className="flex items-center gap-2">
          <div className="h-10 w-10 rounded-lg gradient-primary flex items-center justify-center text-2xl font-bold">
            +
          </div>
          <span className="font-bold text-xl gradient-text">Easy Plus AI</span>
        </div>
        <div className="flex gap-4">
          <Link href="/login">
            <Button variant="ghost">Sign In</Button>
          </Link>
          <Link href="/signup">
            <Button className="gradient-primary">Get Started</Button>
          </Link>
        </div>
      </nav>

      <main className="relative z-10 max-w-7xl mx-auto px-6 pt-20 pb-32">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8 }}
          className="text-center space-y-8 mb-16"
        >
          <h1 className="text-6xl md:text-8xl font-bold leading-tight">
            One Interface.
            <br />
            <span className="gradient-text">Every AI.</span>
          </h1>
          <p className="text-xl text-gray-400 max-w-2xl mx-auto">
            Access Claude, Gemini, and ChatGPT in one beautiful platform. Switch models
            instantly, stream responses in real-time, and pay only for what you use.
          </p>
          <div className="flex gap-4 justify-center">
            <Link href="/signup">
              <Button size="lg" className="gradient-primary text-lg px-8">
                Start Free Trial
                <ArrowRight className="ml-2 h-5 w-5" />
              </Button>
            </Link>
            <Link href="/login">
              <Button size="lg" variant="outline" className="text-lg px-8">
                Sign In
              </Button>
            </Link>
          </div>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.8, delay: 0.2 }}
          className="glass-strong rounded-3xl p-8 max-w-4xl mx-auto mb-20"
        >
          <div className="space-y-4">
            <p className="text-sm text-gray-400 mb-4">Available AI Models</p>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
              {AI_MODELS.map((model, i) => (
                <motion.div
                  key={model.id}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.3 + i * 0.1 }}
                  className="glass rounded-xl p-4 text-center space-y-2 glow-border"
                  style={{
                    borderColor: `${model.color}40`,
                  }}
                >
                  <div className="text-3xl">{model.icon}</div>
                  <p className="text-xs font-medium">{model.name}</p>
                </motion.div>
              ))}
            </div>
          </div>
        </motion.div>

        <div className="grid md:grid-cols-3 gap-8 mb-20">
          <FeatureCard
            icon={<Zap className="h-8 w-8" />}
            title="Lightning Fast"
            description="Real-time streaming responses with sub-second latency"
          />
          <FeatureCard
            icon={<Shield className="h-8 w-8" />}
            title="Secure & Private"
            description="Your conversations are encrypted and never used for training"
          />
          <FeatureCard
            icon={<Globe className="h-8 w-8" />}
            title="Multi-Model"
            description="Switch between 5 cutting-edge AI models in one interface"
          />
        </div>

        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.8 }}
          className="text-center space-y-4"
        >
          <div className="flex items-center justify-center gap-2 text-yellow-400">
            <Sparkles className="h-5 w-5" />
            <p className="text-sm font-medium">1,000 free credits on signup</p>
          </div>
        </motion.div>
      </main>
    </div>
  )
}

function FeatureCard({
  icon,
  title,
  description,
}: {
  icon: React.ReactNode
  title: string
  description: string
}) {
  return (
    <motion.div
      whileHover={{ y: -5 }}
      className="glass-strong rounded-2xl p-6 space-y-3"
    >
      <div className="h-12 w-12 rounded-lg gradient-primary flex items-center justify-center">
        {icon}
      </div>
      <h3 className="text-xl font-semibold">{title}</h3>
      <p className="text-gray-400">{description}</p>
    </motion.div>
  )
}
