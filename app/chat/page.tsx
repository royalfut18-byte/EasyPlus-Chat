'use client'

import { useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { motion, AnimatePresence } from 'framer-motion'
import { Sparkles } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { ensureProfile } from '@/lib/supabase/ensure-profile'
import { ModelSelector } from '@/components/chat/model-selector'
import { MessageBubble } from '@/components/chat/message-bubble'
import { ChatInput } from '@/components/chat/chat-input'
import { Sidebar } from '@/components/chat/sidebar'
import { toast } from '@/components/ui/use-toast'
import { AI_MODELS } from '@/types/models'
import type { Conversation, Message } from '@/types/models'

export default function ChatPage() {
  const [selectedModel, setSelectedModel] = useState(AI_MODELS[0].id)
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [currentConversation, setCurrentConversation] = useState<Conversation | null>(null)
  const [messages, setMessages] = useState<Message[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [userProfile, setUserProfile] = useState<any>(null)
  const [isCreatingConversation, setIsCreatingConversation] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const isSendingRef = useRef(false)
  const router = useRouter()
  const supabase = createClient()

  useEffect(() => {
    loadUserProfile()
    loadConversations()
  }, [])

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const loadUserProfile = async () => {
    try {
      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser()

      if (userError || !user) {
        console.error('Auth error:', userError)
        router.push('/login')
        return
      }

      // Use helper to ensure profile exists
      const profile = await ensureProfile(supabase, user.id)
      setUserProfile(profile)
    } catch (error) {
      console.error('Failed to load user profile:', error)
      // Set fallback to prevent infinite loading
      setUserProfile({ credits: 1000 })
    }
  }

  const loadConversations = async () => {
    try {
      const response = await fetch('/api/conversations', {
        signal: AbortSignal.timeout(10000), // 10 second timeout
      })
      if (response.ok) {
        const data = await response.json()
        setConversations(data)
      }
    } catch (error) {
      console.error('Failed to load conversations:', error)
      // Continue even if conversations fail to load
      setConversations([])
    }
  }

  const loadConversationMessages = async (conversationId: string) => {
    try {
      const response = await fetch(`/api/conversations/${conversationId}`, {
        signal: AbortSignal.timeout(10000),
      })
      if (response.ok) {
        const data = await response.json()
        setMessages(data)
      }
    } catch (error) {
      console.error('Failed to load messages:', error)
      setMessages([])
    }
  }

  const handleNewChat = async () => {
    if (isCreatingConversation) return

    setIsCreatingConversation(true)
    try {
      const response = await fetch('/api/conversations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: 'New Conversation',
          model: selectedModel,
        }),
      })

      if (response.ok) {
        const conversation = await response.json()
        setCurrentConversation(conversation)
        setMessages([])
        await loadConversations()
      }
    } finally {
      setIsCreatingConversation(false)
    }
  }

  const handleSelectConversation = async (id: string) => {
    const conv = conversations.find((c) => c.id === id)
    if (conv) {
      setCurrentConversation(conv)
      setSelectedModel(conv.model_used)
      await loadConversationMessages(id)
    }
  }

  const handleDeleteConversation = async (id: string) => {
    const response = await fetch(`/api/conversations/${id}`, {
      method: 'DELETE',
    })

    if (response.ok) {
      toast({
        title: 'Conversation deleted',
        description: 'The conversation has been removed',
      })
      if (currentConversation?.id === id) {
        setCurrentConversation(null)
        setMessages([])
      }
      loadConversations()
    }
  }

  const handleSendMessage = async (content: string) => {
    // Prevent duplicate sends
    if (isSendingRef.current || isLoading || isCreatingConversation) {
      return
    }

    isSendingRef.current = true

    // Create conversation if needed
    let conversation = currentConversation
    if (!conversation) {
      setIsCreatingConversation(true)
      try {
        const response = await fetch('/api/conversations', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title: 'New Conversation',
            model: selectedModel,
          }),
        })

        if (!response.ok) {
          throw new Error('Failed to create conversation')
        }

        conversation = await response.json()
        setCurrentConversation(conversation)
        await loadConversations()
        setIsCreatingConversation(false)
      } catch (error) {
        console.error('Failed to create conversation:', error)
        toast({
          title: 'Error',
          description: 'Failed to create conversation',
          variant: 'destructive',
        })
        setIsCreatingConversation(false)
        isSendingRef.current = false
        return
      }
    }

    if (!conversation) {
      isSendingRef.current = false
      return
    }

    const userMessage: Message = {
      id: Date.now().toString(),
      conversation_id: conversation.id,
      role: 'user',
      content,
      model: selectedModel,
      created_at: new Date().toISOString(),
    }

    setMessages((prev) => [...prev, userMessage])
    setIsLoading(true)

    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: selectedModel,
          messages: [...messages, userMessage].map((m) => ({
            role: m.role,
            content: m.content,
          })),
          conversationId: conversation.id,
        }),
      })

      if (response.status === 402) {
        const errorData = await response.json().catch(() => ({}))
        toast({
          title: 'Insufficient credits',
          description: errorData.error || 'Please top up your credits to continue',
          variant: 'destructive',
        })
        setIsLoading(false)
        isSendingRef.current = false
        return
      }

      if (!response.ok) {
        let errorMessage = 'Failed to send message'
        try {
          const errorData = await response.json()
          errorMessage = errorData.error || errorMessage
          console.error('[Chat] API error:', {
            status: response.status,
            error: errorData,
          })
        } catch (e) {
          console.error('[Chat] Failed to parse error response:', e)
        }
        throw new Error(errorMessage)
      }

      const reader = response.body?.getReader()
      const decoder = new TextDecoder()
      let assistantContent = ''

      const assistantMessage: Message = {
        id: (Date.now() + 1).toString(),
        conversation_id: conversation.id,
        role: 'assistant',
        content: '',
        model: selectedModel,
        created_at: new Date().toISOString(),
      }

      setMessages((prev) => [...prev, assistantMessage])

      while (reader) {
        const { done, value } = await reader.read()
        if (done) break

        const chunk = decoder.decode(value)
        assistantContent += chunk

        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantMessage.id ? { ...m, content: assistantContent } : m
          )
        )
      }

      loadUserProfile()
      loadConversations()
    } catch (error: any) {
      console.error('[Chat] Send message error:', error)
      toast({
        title: 'Error',
        description: error.message || 'Failed to send message',
        variant: 'destructive',
      })
    } finally {
      setIsLoading(false)
      isSendingRef.current = false
    }
  }

  if (!userProfile) {
    return (
      <div className="min-h-screen bg-[#0A0A0F] flex items-center justify-center">
        <div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full" />
      </div>
    )
  }

  return (
    <div className="h-screen bg-[#0A0A0F] flex overflow-hidden">
      <Sidebar
        conversations={conversations}
        currentConversationId={currentConversation?.id}
        onSelectConversation={handleSelectConversation}
        onNewChat={handleNewChat}
        onDeleteConversation={handleDeleteConversation}
        userProfile={userProfile}
      />

      <main className="flex-1 flex flex-col ml-0 md:ml-80">
        <ModelSelector selectedModel={selectedModel} onSelectModel={setSelectedModel} />

        <div className="flex-1 overflow-y-auto px-6 py-8 scrollbar-thin">
          <div className="max-w-4xl mx-auto">
            <AnimatePresence mode="popLayout">
              {messages.length === 0 ? (
                <motion.div
                  key="empty"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="flex flex-col items-center justify-center h-full min-h-[60vh] text-center space-y-6"
                >
                  <div className="h-20 w-20 rounded-2xl gradient-primary flex items-center justify-center">
                    <Sparkles className="h-10 w-10" />
                  </div>
                  <div>
                    <h2 className="text-3xl font-bold mb-2">Ready to chat?</h2>
                    <p className="text-gray-400">
                      Select a model above and start a conversation
                    </p>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3 max-w-2xl w-full">
                    {[
                      'Explain quantum computing',
                      'Write a Python function',
                      'Plan a trip to Japan',
                      'Debug this code',
                    ].map((prompt, i) => (
                      <button
                        key={i}
                        onClick={() => handleSendMessage(prompt)}
                        disabled={isLoading || isCreatingConversation}
                        className="glass-strong p-4 rounded-xl text-left hover:glow-border transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        <p className="text-sm text-gray-300">{prompt}</p>
                      </button>
                    ))}
                  </div>
                </motion.div>
              ) : (
                messages.map((message) => (
                  <MessageBubble
                    key={message.id}
                    role={message.role}
                    content={message.content}
                    model={message.model}
                  />
                ))
              )}
            </AnimatePresence>
            <div ref={messagesEndRef} />
          </div>
        </div>

        <ChatInput
          onSend={handleSendMessage}
          disabled={isLoading || isCreatingConversation}
          isLoading={isLoading || isCreatingConversation}
        />
      </main>
    </div>
  )
}
