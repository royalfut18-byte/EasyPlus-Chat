'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { motion } from 'framer-motion'
import { ShieldX } from 'lucide-react'
import { Button } from '@/components/ui/button'

export default function SignupPage() {
  const router = useRouter()

  useEffect(() => {
    // Redirect to login after 3 seconds
    const timer = setTimeout(() => {
      router.push('/login')
    }, 5000)

    return () => clearTimeout(timer)
  }, [router])

  return (
    <div className="min-h-screen bg-[#12100e] flex items-center justify-center p-6">
      <div className="absolute inset-0 bg-gradient-radial from-clay-900/10 via-transparent to-transparent" />

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="bg-[#11100d]/80 border border-white/[0.08] rounded-2xl p-8 w-full max-w-md relative z-10 text-center"
      >
        <div className="flex items-center justify-center mb-6">
          <div className="h-20 w-20 rounded-2xl bg-red-500/10 border border-red-500/20 flex items-center justify-center">
            <ShieldX className="h-10 w-10 text-red-400" />
          </div>
        </div>

        <h1 className="text-3xl font-bold mb-3 text-white">Signups Disabled</h1>
        <p className="text-gray-400 mb-6 leading-relaxed">
          This is a private application. New accounts can only be created by administrators.
        </p>

        <div className="glass p-4 rounded-xl mb-6 text-left">
          <p className="text-sm text-gray-300 mb-2">
            <strong className="text-white">Already have an account?</strong>
          </p>
          <p className="text-sm text-gray-400">
            You can sign in using your existing credentials.
          </p>
        </div>

        <div className="space-y-3">
          <Link href="/login">
            <Button className="w-full bg-clay-600 hover:bg-clay-500 text-white" size="lg">
              Go to Login
            </Button>
          </Link>

          <p className="text-xs text-gray-500">
            Redirecting to login in 5 seconds...
          </p>
        </div>
      </motion.div>
    </div>
  )
}
