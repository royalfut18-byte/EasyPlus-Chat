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

// Generate a smart conversation title from the first user message
function generateConversationTitle(message: string): string {
  // Remove common filler words
  const fillers = /^(what is|what's|can you|please|could you|tell me|explain|search the web|latest|give me|show me|find)\s+/i
  let title = message.replace(fillers, '')

  // Take first 50 characters and find last complete word
  if (title.length > 50) {
    title = title.substring(0, 50)
    const lastSpace = title.lastIndexOf(' ')
    if (lastSpace > 20) {
      title = title.substring(0, lastSpace)
    }
  }

  // Capitalize first letter of each major word
  title = title
    .split(' ')
    .map((word, index) => {
      if (index === 0 || word.length > 3) {
        return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()
      }
      return word.toLowerCase()
    })
    .join(' ')

  // Remove trailing punctuation
  title = title.replace(/[.,;:!?]+$/, '')

  return title || 'New Chat'
}

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
        router.push('/login')
        return
      }

      // Use helper to ensure profile exists
      const profile = await ensureProfile(supabase, user.id)
      setUserProfile(profile)
    } catch (error) {
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
      setMessages([])
    }
  }

  const handleNewChat = () => {
    // Don't create blank chats - only clear UI to draft state
    // If already in a blank state, do nothing
    if (!currentConversation && messages.length === 0) return

    setCurrentConversation(null)
    setMessages([])
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
    // Store the conversation in case we need to restore it
    const deletedConversation = conversations.find((c) => c.id === id)

    // IMMEDIATELY update UI (optimistic delete)
    setConversations((prev) => prev.filter((c) => c.id !== id))

    if (currentConversation?.id === id) {
      setCurrentConversation(null)
      setMessages([])
    }

    // Send delete request in background
    try {
      const response = await fetch(`/api/conversations/${id}`, {
        method: 'DELETE',
      })

      if (!response.ok) {
        throw new Error('Failed to delete conversation')
      }

      toast({
        title: 'Conversation deleted',
        description: 'The conversation has been removed',
      })
    } catch (error: any) {
      // Restore conversation on error
      if (deletedConversation) {
        setConversations((prev) => [deletedConversation, ...prev].sort((a, b) =>
          new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()
        ))
      }

      toast({
        title: 'Error',
        description: 'Failed to delete conversation',
        variant: 'destructive',
      })
    }
  }

  const handleSendMessage = async (content: string) => {
    // Trim and validate input
    const trimmedContent = content.trim()
    if (!trimmedContent) {
      return
    }

    // Prevent duplicate sends
    if (isSendingRef.current) {
      return
    }

    isSendingRef.current = true

    // Create optimistic user message with temporary ID
    const tempMessageId = `temp-${Date.now()}`
    const userMessage: Message = {
      id: tempMessageId,
      conversation_id: currentConversation?.id || 'temp',
      role: 'user',
      content: trimmedContent,
      model: selectedModel,
      created_at: new Date().toISOString(),
    }

    // IMMEDIATELY show user message in UI (optimistic update)
    setMessages((prev) => [...prev, userMessage])
    setIsLoading(true)

    // Create conversation in background if needed (first message)
    let conversation = currentConversation
    if (!conversation) {
      setIsCreatingConversation(true)
      try {
        const title = generateConversationTitle(trimmedContent)

        const response = await fetch('/api/conversations', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title,
            model: selectedModel,
          }),
        })

        if (!response.ok) {
          throw new Error('Failed to create conversation')
        }

        conversation = await response.json()

        // Optimistically update conversation state and sidebar
        setCurrentConversation(conversation)
        setConversations((prev) => [conversation!, ...prev])

        // Update the temporary message with real conversation ID
        setMessages((prev) =>
          prev.map((m) =>
            m.id === tempMessageId ? { ...m, conversation_id: conversation!.id } : m
          )
        )

        setIsCreatingConversation(false)
      } catch (error: any) {
        toast({
          title: 'Error',
          description: 'Failed to create conversation',
          variant: 'destructive',
        })
        // Remove optimistic message on error
        setMessages((prev) => prev.filter((m) => m.id !== tempMessageId))
        setIsCreatingConversation(false)
        setIsLoading(false)
        isSendingRef.current = false
        return
      }
    }

    if (!conversation) {
      setMessages((prev) => prev.filter((m) => m.id !== tempMessageId))
      setIsLoading(false)
      isSendingRef.current = false
      return
    }

    // Create assistant message upfront for error handling
    const assistantMessage: Message = {
      id: (Date.now() + 1).toString(),
      conversation_id: conversation.id,
      role: 'assistant',
      content: '',
      model: selectedModel,
      created_at: new Date().toISOString(),
    }

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
        } catch (e) {
          // Failed to parse error
        }
        throw new Error(errorMessage)
      }

      const reader = response.body?.getReader()
      const decoder = new TextDecoder()
      let assistantContent = ''

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

      // Refresh user profile and conversations in background (non-blocking)
      loadUserProfile()
      // Only reload conversations if it was the first message (to get updated title)
      if (messages.length === 1) {
        loadConversations()
      }
    } catch (error: any) {
      // Remove assistant message on error
      setMessages((prev) => prev.filter((m) => m.id !== assistantMessage.id))
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

        <div className="flex-1 overflow-y-auto px-4 md:px-6 py-6 md:py-8 scrollbar-thin">
          <div className="max-w-4xl mx-auto">
            <AnimatePresence mode="popLayout">
              {messages.length === 0 ? (
                <motion.div
                  key="empty"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  transition={{ duration: 0.3 }}
                  className="flex flex-col items-center justify-center h-full min-h-[60vh] text-center space-y-8 px-4"
                >
                  <div className="h-24 w-24 rounded-3xl gradient-primary flex items-center justify-center shadow-2xl shadow-purple-500/30">
                    <Sparkles className="h-12 w-12 text-white" />
                  </div>
                  <div className="space-y-3">
                    <h2 className="text-3xl md:text-4xl font-bold gradient-text">Ready to explore?</h2>
                    <p className="text-gray-400 text-base md:text-lg max-w-md mx-auto">
                      Ask me anything. I can help with research, coding, analysis, and more.
                    </p>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3 w-full max-w-2xl">
                    {[
                      { text: 'Explain quantum computing', icon: '🔬' },
                      { text: 'Write a Python function', icon: '💻' },
                      { text: 'Plan a trip to Japan', icon: '✈️' },
                      { text: 'Debug this code', icon: '🐛' },
                    ].map((prompt, i) => (
                      <motion.button
                        key={i}
                        onClick={() => handleSendMessage(prompt.text)}
                        disabled={isLoading || isCreatingConversation}
                        className="glass-strong p-4 md:p-5 rounded-xl text-left hover:glow-border hover:bg-white/5 transition-all disabled:opacity-50 disabled:cursor-not-allowed group"
                        whileHover={{ scale: 1.02, y: -2 }}
                        whileTap={{ scale: 0.98 }}
                      >
                        <span className="text-2xl mb-2 block">{prompt.icon}</span>
                        <p className="text-sm md:text-base text-gray-300 group-hover:text-white transition-colors">
                          {prompt.text}
                        </p>
                      </motion.button>
                    ))}
                  </div>
                </motion.div>
              ) : (
                <>
                  {messages.map((message) => (
                    <MessageBubble
                      key={message.id}
                      role={message.role}
                      content={message.content}
                      model={message.model}
                    />
                  ))}
                  {isLoading && (
                    <motion.div
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      className="flex justify-start mb-6"
                    >
                      <div className="glass p-4 rounded-2xl">
                        <div className="flex gap-2">
                          <div className="w-2 h-2 bg-purple-500 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                          <div className="w-2 h-2 bg-purple-500 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                          <div className="w-2 h-2 bg-purple-500 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                        </div>
                      </div>
                    </motion.div>
                  )}
                </>
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
