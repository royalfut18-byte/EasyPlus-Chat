'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { motion } from 'framer-motion'
import { Mail, Lock, Loader2 } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { toast } from '@/components/ui/use-toast'
import { Logo } from '@/components/brand/logo'

export default function LoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const router = useRouter()
  const supabase = useMemo(() => createClient(), [])
  const navigationFallbackRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    return () => {
      if (navigationFallbackRef.current) clearTimeout(navigationFallbackRef.current)
    }
  }, [])

  const withTimeout = async <T,>(promise: PromiseLike<T>, timeoutMs: number): Promise<T> => {
    return await Promise.race([
      Promise.resolve(promise),
      new Promise<T>((_, reject) => {
        setTimeout(() => reject(new Error('Sign in took too long. Please try again.')), timeoutMs)
      }),
    ])
  }

  const handleEmailLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    if (isLoading) return
    setIsLoading(true)

    try {
      const { data, error } = await withTimeout(supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      }), 15000)

      if (error) throw error

      const session = data.session || (await withTimeout(supabase.auth.getSession(), 5000)).data.session
      if (!session) throw new Error('Your session could not be confirmed. Please try again.')

      router.refresh()
      router.replace('/chat')

      // A hard navigation makes the freshly written auth cookies visible to the
      // server in standalone PWAs where a soft App Router transition can stall.
      navigationFallbackRef.current = setTimeout(() => {
        if (window.location.pathname !== '/chat') window.location.assign('/chat')
      }, 1200)
    } catch (error) {
      toast({
        title: 'Sign in failed',
        description: error instanceof Error ? error.message : 'Something went wrong. Please try again.',
        variant: 'destructive',
      })
      setIsLoading(false)
    }
  }

  return (
    <div className="flex min-h-[100dvh] items-center justify-center bg-[#12100e] p-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-[max(1rem,env(safe-area-inset-top))] sm:p-6">
      <div className="absolute inset-0 bg-gradient-radial from-clay-900/10 via-transparent to-transparent" />

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="bg-[#11100d]/80 border border-white/[0.08] rounded-2xl p-8 w-full max-w-md relative z-10"
      >
        <div className="text-center mb-6">
          <div className="mb-5 flex items-center justify-center gap-3">
            <Logo size="md" showText={false} />
            <span className="text-xl font-semibold text-white/90">EasyPlus AI</span>
          </div>
          <h1 className="font-serif text-[1.75rem] font-medium mb-2 text-white/95">Welcome back</h1>
          <p className="text-gray-500 text-sm">Sign in to continue</p>
        </div>

        <form onSubmit={handleEmailLogin} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <div className="relative">
              <Mail className="absolute left-3 top-3 h-5 w-5 text-gray-500" />
              <Input
                id="email"
                type="email"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="pl-10 glass"
                required
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="password">Password</Label>
            <div className="relative">
              <Lock className="absolute left-3 top-3 h-5 w-5 text-gray-500" />
              <Input
                id="password"
                type="password"
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="pl-10 glass"
                required
              />
            </div>
          </div>

          <Button
            type="submit"
            className="w-full bg-clay-600 hover:bg-clay-500 text-white"
            size="lg"
            disabled={isLoading}
          >
            {isLoading ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Signing in...
              </>
            ) : (
              'Sign In'
            )}
          </Button>
        </form>

        <p className="text-center text-sm text-gray-500 mt-6">
          This is a private application. Contact admin for access.
        </p>
      </motion.div>
    </div>
  )
}
