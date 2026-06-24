'use client'

import { useState, useEffect, useMemo, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { motion, AnimatePresence } from 'framer-motion'
import { Brain, Trash2, Edit3, Check, X, ArrowLeft, AlertTriangle } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { toast } from '@/components/ui/use-toast'

interface Memory {
  id: string
  memory_text: string
  category: string
  importance: number
  created_at: string
  updated_at: string
}

export default function MemorySettingsPage() {
  const [memories, setMemories] = useState<Memory[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [tableExists, setTableExists] = useState(true)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editText, setEditText] = useState('')
  const [showClearConfirm, setShowClearConfirm] = useState(false)
  const router = useRouter()
  const supabase = useMemo(() => createClient(), [])

  const loadMemories = useCallback(async () => {
    try {
      setIsLoading(true)
      const response = await fetch('/api/memories')
      if (response.ok) {
        const data = await response.json()
        setMemories(data.memories || [])
        setTableExists(data.tableExists !== false)
      }
    } catch (error) {
      console.error('Failed to load memories:', error)
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    let active = true

    const loadPage = async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!active) return

      if (!user) {
        router.push('/login')
        return
      }

      await loadMemories()
    }

    loadPage().catch(() => {
      if (active) {
        setIsLoading(false)
      }
    })

    return () => {
      active = false
    }
  }, [loadMemories, router, supabase])

  const deleteMemory = async (id: string) => {
    try {
      const response = await fetch(`/api/memories?id=${id}`, { method: 'DELETE' })
      if (response.ok) {
        setMemories(prev => prev.filter(m => m.id !== id))
        toast({ title: 'Memory deleted' })
      }
    } catch (error) {
      toast({ title: 'Error', description: 'Failed to delete memory', variant: 'destructive' })
    }
  }

  const clearAllMemories = async () => {
    try {
      const response = await fetch('/api/memories?clearAll=true', { method: 'DELETE' })
      if (response.ok) {
        setMemories([])
        setShowClearConfirm(false)
        toast({ title: 'All memories cleared' })
      }
    } catch (error) {
      toast({ title: 'Error', description: 'Failed to clear memories', variant: 'destructive' })
    }
  }

  const startEdit = (memory: Memory) => {
    setEditingId(memory.id)
    setEditText(memory.memory_text)
  }

  const saveEdit = async () => {
    if (!editingId || !editText.trim()) return

    try {
      const response = await fetch('/api/memories', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: editingId, memory_text: editText.trim() }),
      })

      if (response.ok) {
        setMemories(prev =>
          prev.map(m => m.id === editingId ? { ...m, memory_text: editText.trim() } : m)
        )
        setEditingId(null)
        setEditText('')
        toast({ title: 'Memory updated' })
      }
    } catch (error) {
      toast({ title: 'Error', description: 'Failed to update memory', variant: 'destructive' })
    }
  }

  const cancelEdit = () => {
    setEditingId(null)
    setEditText('')
  }

  const getCategoryColor = (category: string) => {
    switch (category) {
      case 'preference': return 'text-clay-400 bg-clay-500/10 border-clay-500/20'
      case 'project': return 'text-blue-400 bg-blue-500/10 border-blue-500/30'
      case 'personal': return 'text-green-400 bg-green-500/10 border-green-500/30'
      case 'workflow': return 'text-orange-400 bg-orange-500/10 border-orange-500/30'
      default: return 'text-gray-400 bg-gray-500/10 border-gray-500/30'
    }
  }

  return (
    <div className="min-h-screen bg-[#12100e] p-4 md:p-8">
      <div className="max-w-3xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center gap-4">
          <button
            onClick={() => router.push('/chat')}
            className="p-2 rounded-lg glass hover:bg-white/10 transition-colors"
          >
            <ArrowLeft className="h-5 w-5 text-gray-400" />
          </button>
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-clay-500/10 border border-clay-500/20">
              <Brain className="h-6 w-6 text-clay-400" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-white">Memory</h1>
              <p className="text-sm text-gray-400">
                Things EasyPlus remembers about you across chats
              </p>
            </div>
          </div>
        </div>

        {/* Setup notice */}
        {!tableExists && (
          <div className="bg-white/[0.02] border border-white/[0.06] rounded-xl p-4 border border-yellow-500/30 bg-yellow-500/5">
            <div className="flex items-center gap-3">
              <AlertTriangle className="h-5 w-5 text-yellow-400 shrink-0" />
              <p className="text-sm text-yellow-200">
                Memory table not set up yet. Run <code className="px-1.5 py-0.5 rounded bg-black/30 text-yellow-300">MEMORY_SETUP.sql</code> in your Supabase SQL Editor.
              </p>
            </div>
          </div>
        )}

        {/* Actions */}
        {memories.length > 0 && (
          <div className="flex justify-end">
            {showClearConfirm ? (
              <div className="flex items-center gap-2">
                <span className="text-sm text-red-400">Clear all memories?</span>
                <button
                  onClick={clearAllMemories}
                  className="px-3 py-1.5 rounded-lg text-sm bg-red-500/20 text-red-400 border border-red-500/40 hover:bg-red-500/30 transition-colors"
                >
                  Yes, clear all
                </button>
                <button
                  onClick={() => setShowClearConfirm(false)}
                  className="px-3 py-1.5 rounded-lg text-sm glass text-gray-400 hover:text-white transition-colors"
                >
                  Cancel
                </button>
              </div>
            ) : (
              <button
                onClick={() => setShowClearConfirm(true)}
                className="px-3 py-1.5 rounded-lg text-sm glass text-gray-400 hover:text-red-400 transition-colors flex items-center gap-1.5"
              >
                <Trash2 className="h-3.5 w-3.5" />
                Clear all
              </button>
            )}
          </div>
        )}

        {/* Memory list */}
        {isLoading ? (
          <div className="space-y-3">
            {[1, 2, 3].map(i => (
              <div key={i} className="bg-white/[0.02] border border-white/[0.06] rounded-xl p-4 animate-pulse">
                <div className="h-4 bg-white/10 rounded w-3/4 mb-2" />
                <div className="h-3 bg-white/10 rounded w-1/4" />
              </div>
            ))}
          </div>
        ) : memories.length === 0 ? (
          <div className="bg-white/[0.02] border border-white/[0.06] rounded-xl p-12 text-center">
            <Brain className="h-12 w-12 text-gray-600 mx-auto mb-4" />
            <h3 className="text-lg font-medium text-gray-300 mb-2">No memories yet</h3>
            <p className="text-sm text-gray-500 max-w-sm mx-auto">
              EasyPlus will remember important things you tell it during chats.
              Try saying &ldquo;Remember that I prefer TypeScript&rdquo; in a chat.
            </p>
          </div>
        ) : (
          <AnimatePresence mode="popLayout">
            <div className="space-y-3">
              {memories.map(memory => (
                <motion.div
                  key={memory.id}
                  layout
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, x: -20 }}
                  className="bg-white/[0.02] border border-white/[0.06] rounded-xl p-4 group"
                >
                  {editingId === memory.id ? (
                    <div className="space-y-3">
                      <textarea
                        value={editText}
                        onChange={e => setEditText(e.target.value)}
                        className="w-full bg-black/30 border border-white/20 rounded-lg p-3 text-sm text-white resize-none focus:outline-none focus:border-clay-500/40"
                        rows={3}
                        autoFocus
                      />
                      <div className="flex gap-2">
                        <button
                          onClick={saveEdit}
                          className="px-3 py-1.5 rounded-lg text-sm bg-green-500/20 text-green-400 border border-green-500/40 hover:bg-green-500/30 transition-colors flex items-center gap-1"
                        >
                          <Check className="h-3.5 w-3.5" /> Save
                        </button>
                        <button
                          onClick={cancelEdit}
                          className="px-3 py-1.5 rounded-lg text-sm glass text-gray-400 hover:text-white transition-colors flex items-center gap-1"
                        >
                          <X className="h-3.5 w-3.5" /> Cancel
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm text-gray-200 leading-relaxed">
                          {memory.memory_text}
                        </p>
                        <div className="flex items-center gap-2 mt-2">
                          <span className={`text-xs px-2 py-0.5 rounded-full border ${getCategoryColor(memory.category)}`}>
                            {memory.category}
                          </span>
                          <span className="text-xs text-gray-500">
                            {new Date(memory.updated_at).toLocaleDateString()}
                          </span>
                        </div>
                      </div>
                      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                        <button
                          onClick={() => startEdit(memory)}
                          className="p-1.5 rounded-lg hover:bg-white/10 text-gray-400 hover:text-white transition-colors"
                          title="Edit"
                        >
                          <Edit3 className="h-3.5 w-3.5" />
                        </button>
                        <button
                          onClick={() => deleteMemory(memory.id)}
                          className="p-1.5 rounded-lg hover:bg-red-500/10 text-gray-400 hover:text-red-400 transition-colors"
                          title="Delete"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>
                  )}
                </motion.div>
              ))}
            </div>
          </AnimatePresence>
        )}

        {/* Info */}
        <div className="glass rounded-xl p-4 text-xs text-gray-500 space-y-1">
          <p>Memories help EasyPlus personalize responses across conversations.</p>
          <p>Say &ldquo;remember that...&rdquo; or &ldquo;forget that...&rdquo; in any chat to manage memories.</p>
          <p>Sensitive data (API keys, passwords) is never saved.</p>
        </div>
      </div>
    </div>
  )
}
