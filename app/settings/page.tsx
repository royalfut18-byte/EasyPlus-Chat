'use client'

import { useRouter } from 'next/navigation'
import { useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Brain, ArrowLeft } from 'lucide-react'

export default function SettingsPage() {
  const router = useRouter()
  const supabase = createClient()

  useEffect(() => {
    const checkAuth = async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) router.push('/login')
    }
    checkAuth()
  }, [])

  return (
    <div className="min-h-screen bg-[#0A0A0F] p-4 md:p-8">
      <div className="max-w-3xl mx-auto space-y-6">
        <div className="flex items-center gap-4">
          <button
            onClick={() => router.push('/chat')}
            className="p-2 rounded-lg glass hover:bg-white/10 transition-colors"
          >
            <ArrowLeft className="h-5 w-5 text-gray-400" />
          </button>
          <h1 className="text-2xl font-bold text-white">Settings</h1>
        </div>

        <div className="space-y-3">
          <button
            onClick={() => router.push('/settings/memory')}
            className="w-full glass-strong rounded-xl p-5 text-left hover:bg-white/5 transition-colors group"
          >
            <div className="flex items-center gap-4">
              <div className="p-2.5 rounded-xl bg-gradient-to-br from-purple-500/20 to-blue-500/20 border border-purple-500/30">
                <Brain className="h-5 w-5 text-purple-400" />
              </div>
              <div>
                <h3 className="text-base font-medium text-white group-hover:text-purple-300 transition-colors">
                  Memory
                </h3>
                <p className="text-sm text-gray-400">
                  View and manage what EasyPlus remembers about you
                </p>
              </div>
            </div>
          </button>
        </div>
      </div>
    </div>
  )
}
