'use client'

import { useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { motion, AnimatePresence } from 'framer-motion'
import { Sparkles, Box } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { ensureProfile } from '@/lib/supabase/ensure-profile'
import { ModelSelector } from '@/components/chat/model-selector'
import { MessageBubble } from '@/components/chat/message-bubble'
import { ChatInput } from '@/components/chat/chat-input'
import { Sidebar } from '@/components/chat/sidebar'
import { ArtifactPanel } from '@/components/chat/artifact-panel'
import { toast } from '@/components/ui/use-toast'
import { AI_MODELS } from '@/types/models'
import { cn } from '@/lib/utils'
import { parseArtifactFromResponse, dedupeMessages } from '@/lib/artifact-parser'
import type { Conversation, Message, ChatAttachment, Artifact } from '@/types/models'

// Generate a smart conversation title from the first user message
function generateConversationTitle(message: string): string {
  const fillers = /^(what is|what's|can you|please|could you|tell me|explain|search the web|latest|give me|show me|find)\s+/i
  let title = message.replace(fillers, '')

  if (title.length > 50) {
    title = title.substring(0, 50)
    const lastSpace = title.lastIndexOf(' ')
    if (lastSpace > 20) {
      title = title.substring(0, lastSpace)
    }
  }

  title = title
    .split(' ')
    .map((word, index) => {
      if (index === 0 || word.length > 3) {
        return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()
      }
      return word.toLowerCase()
    })
    .join(' ')

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
  const [artifactMode, setArtifactMode] = useState(false)
  const [activeArtifact, setActiveArtifact] = useState<Artifact | null>(null)
  const [artifactMessageId, setArtifactMessageId] = useState<string | null>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const isSendingRef = useRef(false)
  const lastUserPromptRef = useRef<string>('')
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

      const profile = await ensureProfile(supabase, user.id)
      setUserProfile(profile)
    } catch (error) {
      setUserProfile({ credits: 1000 })
    }
  }

  const loadConversations = async () => {
    try {
      const response = await fetch('/api/conversations', {
        signal: AbortSignal.timeout(10000),
      })
      if (response.ok) {
        const data = await response.json()
        setConversations(data)
      }
    } catch (error) {
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
    if (!currentConversation && messages.length === 0) return
    setCurrentConversation(null)
    setMessages([])
    setActiveArtifact(null)
    setArtifactMessageId(null)
  }

  const handleSelectConversation = async (id: string) => {
    const conv = conversations.find((c) => c.id === id)
    if (conv) {
      setCurrentConversation(conv)
      setSelectedModel(conv.model_used)
      setActiveArtifact(null)
      setArtifactMessageId(null)
      await loadConversationMessages(id)
    }
  }

  const handleDeleteConversation = async (id: string) => {
    const deletedConversation = conversations.find((c) => c.id === id)
    setConversations((prev) => prev.filter((c) => c.id !== id))

    if (currentConversation?.id === id) {
      setCurrentConversation(null)
      setMessages([])
      setActiveArtifact(null)
      setArtifactMessageId(null)
    }

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

  const handleSendMessage = async (content: string, attachments?: ChatAttachment[]) => {
    const trimmedContent = content.trim()
    if (!trimmedContent && (!attachments || attachments.length === 0)) {
      return
    }

    // CRITICAL: Prevent duplicate sends
    if (isSendingRef.current) {
      return
    }
    isSendingRef.current = true

    // Store user prompt for artifact parsing
    lastUserPromptRef.current = trimmedContent

    // Generate stable IDs
    const userMessageId = `user-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
    const assistantMessageId = `assistant-${Date.now() + 1}-${Math.random().toString(36).substr(2, 9)}`

    const userMessage: Message = {
      id: userMessageId,
      conversation_id: currentConversation?.id || 'temp',
      role: 'user',
      content: trimmedContent,
      model: selectedModel,
      created_at: new Date().toISOString(),
      attachments,
    }

    // IMMEDIATELY show user message
    setMessages((prev) => dedupeMessages([...prev, userMessage]))
    setIsLoading(true)

    // Create conversation if needed
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
        setCurrentConversation(conversation)
        setConversations((prev) => [conversation!, ...prev])

        // Update user message with real conversation ID
        setMessages((prev) =>
          prev.map((m) =>
            m.id === userMessageId ? { ...m, conversation_id: conversation!.id } : m
          )
        )

        setIsCreatingConversation(false)
      } catch (error: any) {
        toast({
          title: 'Error',
          description: 'Failed to create conversation',
          variant: 'destructive',
        })
        setMessages((prev) => prev.filter((m) => m.id !== userMessageId))
        setIsCreatingConversation(false)
        setIsLoading(false)
        isSendingRef.current = false
        return
      }
    }

    if (!conversation) {
      setMessages((prev) => prev.filter((m) => m.id !== userMessageId))
      setIsLoading(false)
      isSendingRef.current = false
      return
    }

    // Create assistant placeholder
    const assistantPlaceholder: Message = {
      id: assistantMessageId,
      conversation_id: conversation.id,
      role: 'assistant',
      content: '',
      model: selectedModel,
      created_at: new Date().toISOString(),
    }

    // IMMEDIATELY add assistant placeholder
    setMessages((prev) => dedupeMessages([...prev, assistantPlaceholder]))

    try {
      // Prepare messages for API
      const messagesToSend = [...messages, userMessage].map((m) => ({
        role: m.role,
        content: m.content,
        attachments: m.attachments,
      }))

      // Add artifact mode instruction
      if (artifactMode) {
        messagesToSend.unshift({
          role: 'user',
          content: `[ARTIFACT MODE ENABLED]

When the user asks for buildable code/UI artifacts (landing pages, HTML/CSS files, React components, games, dashboards, UI mockups, brackets, calculators, etc.), return a short explanation, then include exactly one artifact block in this exact format:

\`\`\`artifact:html:Title
CODE_HERE
\`\`\`

Rules:
- Use language values: html, tsx, jsx, javascript, css, python, markdown, text.
- For complete webpages/previews, prefer a full single-file HTML document with inline CSS and JS.
- Do NOT output raw HTML outside the artifact block.
- Do NOT include secrets, API keys, or env vars.
- If no artifact is needed, answer normally.

---`,
          attachments: undefined,
        })
      }

      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: selectedModel,
          messages: messagesToSend,
          conversationId: conversation.id,
          artifactMode,
        }),
      })

      if (response.status === 402) {
        const errorData = await response.json().catch(() => ({}))
        toast({
          title: 'Insufficient credits',
          description: errorData.error || 'Please top up your credits to continue',
          variant: 'destructive',
        })
        setMessages((prev) => prev.filter((m) => m.id !== assistantMessageId))
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
          // ignore
        }
        throw new Error(errorMessage)
      }

      const reader = response.body?.getReader()
      const decoder = new TextDecoder()
      let assistantContent = ''

      // Stream response
      while (reader) {
        const { done, value } = await reader.read()
        if (done) break

        const chunk = decoder.decode(value)
        assistantContent += chunk

        // Update message in real-time
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantMessageId ? { ...m, content: assistantContent } : m
          )
        )
      }

      // CRITICAL: Parse artifact AFTER streaming completes
      if (artifactMode && assistantContent) {
        const { artifact, cleanContent } = parseArtifactFromResponse(
          assistantContent,
          artifactMode,
          lastUserPromptRef.current
        )

        if (artifact) {
          // Update message with clean content
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantMessageId ? { ...m, content: cleanContent } : m
            )
          )

          // Open artifact panel
          setActiveArtifact(artifact)
          setArtifactMessageId(assistantMessageId)
        }
      }

      // Background tasks
      loadUserProfile()
      if (messages.length === 0) {
        loadConversations()
      }
    } catch (error: any) {
      setMessages((prev) => prev.filter((m) => m.id === assistantMessageId))
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

  const handleOpenArtifact = (messageId: string) => {
    const message = messages.find((m) => m.id === messageId)
    if (message && artifactMessageId === messageId && activeArtifact) {
      // Artifact already exists for this message
      return
    }
    // Otherwise, could re-parse if needed, but for now just show existing
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

      <main className={cn(
        'flex-1 flex flex-col ml-0 md:ml-80 transition-all duration-300',
        activeArtifact && 'md:mr-[45%]'
      )}>
        <div className="flex items-center justify-between flex-wrap gap-2 border-b border-white/10 bg-[#0A0A0F]/90 backdrop-blur-xl">
          <div className="flex-1 min-w-0">
            <ModelSelector selectedModel={selectedModel} onSelectModel={setSelectedModel} />
          </div>
          <div className="px-4 py-2">
            <button
              onClick={() => setArtifactMode(!artifactMode)}
              className={cn(
                'px-4 py-2 rounded-lg text-sm font-medium transition-all flex items-center gap-2',
                artifactMode
                  ? 'bg-purple-500/20 text-purple-400 border border-purple-500/50 glow-border'
                  : 'glass hover:bg-white/10 text-gray-400'
              )}
            >
              <Box className="h-4 w-4" />
              Artifacts {artifactMode && '✓'}
            </button>
          </div>
        </div>

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
                        disabled={isLoading || isCreatingConversation || isSendingRef.current}
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
                      attachments={message.attachments}
                      hasArtifact={artifactMessageId === message.id && !!activeArtifact}
                      onOpenArtifact={activeArtifact && artifactMessageId === message.id ? () => {} : undefined}
                    />
                  ))}
                  {isLoading && messages[messages.length - 1]?.role !== 'assistant' && (
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
          disabled={isLoading || isCreatingConversation || isSendingRef.current}
          isLoading={isLoading || isCreatingConversation}
        />
      </main>

      <ArtifactPanel
        artifact={activeArtifact}
        onClose={() => {
          setActiveArtifact(null)
          setArtifactMessageId(null)
        }}
      />
    </div>
  )
}
