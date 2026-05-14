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
    <div className="min-h-screen bg-[#08070d] p-4 md:p-8">
      <div className="max-w-3xl mx-auto space-y-6">
        <div className="flex items-center gap-4">
          <button
            onClick={() => router.push('/chat')}
            className="p-2 rounded-lg bg-white/[0.03] border border-white/[0.06] hover:bg-white/[0.06] transition-colors"
          >
            <ArrowLeft className="h-5 w-5 text-gray-400" />
          </button>
          <h1 className="text-2xl font-semibold text-white/90">Settings</h1>
        </div>

        <div className="space-y-3">
          <button
            onClick={() => router.push('/settings/memory')}
            className="w-full bg-white/[0.02] border border-white/[0.06] rounded-xl p-5 text-left hover:bg-white/[0.04] hover:border-white/[0.1] transition-colors group"
          >
            <div className="flex items-center gap-4">
              <div className="p-2.5 rounded-xl bg-violet-500/10 border border-violet-500/20">
                <Brain className="h-5 w-5 text-violet-400" />
              </div>
              <div>
                <h3 className="text-base font-medium text-white group-hover:text-violet-300 transition-colors">
                  Memory
                </h3>
                <p className="text-sm text-gray-500">
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
