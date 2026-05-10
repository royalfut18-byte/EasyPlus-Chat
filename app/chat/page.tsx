'use client'

import { useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { motion, AnimatePresence } from 'framer-motion'
import { Sparkles, Box, PanelRightOpen } from 'lucide-react'
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

const DEFAULT_PANEL_WIDTH = 560
const PANEL_WIDTH_KEY = 'easyplus-artifact-panel-width'
const ARTIFACT_LOADING_MARKER = '__ARTIFACT_LOADING__'

// Artifact persistence keys
const getArtifactKey = (conversationId: string) => `easyplus:artifact:${conversationId}`
const LAST_ARTIFACT_KEY = 'easyplus:lastArtifact'

// Save artifact to localStorage
function saveArtifact(artifact: Artifact, conversationId?: string) {
  try {
    const data = JSON.stringify(artifact)
    localStorage.setItem(LAST_ARTIFACT_KEY, data)
    if (conversationId) {
      localStorage.setItem(getArtifactKey(conversationId), data)
    }
  } catch (e) {
    console.error('[Artifact] Failed to save to localStorage:', e)
  }
}

// Load artifact from localStorage
function loadArtifact(conversationId?: string): Artifact | null {
  try {
    const key = conversationId ? getArtifactKey(conversationId) : LAST_ARTIFACT_KEY
    const data = localStorage.getItem(key)
    if (data) {
      return JSON.parse(data) as Artifact
    }
  } catch (e) {
    console.error('[Artifact] Failed to load from localStorage:', e)
  }
  return null
}

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
  const [messageCache, setMessageCache] = useState<Record<string, Message[]>>({})
  const [isLoading, setIsLoading] = useState(false)
  const [isLoadingConversation, setIsLoadingConversation] = useState(false)
  const [userProfile, setUserProfile] = useState<any>(null)
  const [isCreatingConversation, setIsCreatingConversation] = useState(false)
  const [artifactMode, setArtifactMode] = useState(false)
  const [activeArtifact, setActiveArtifact] = useState<Artifact | null>(null)
  const [isArtifactOpen, setIsArtifactOpen] = useState(false)
  const [artifactMessageId, setArtifactMessageId] = useState<string | null>(null)
  const [artifactPanelWidth, setArtifactPanelWidth] = useState(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem(PANEL_WIDTH_KEY)
      return saved ? parseInt(saved, 10) : DEFAULT_PANEL_WIDTH
    }
    return DEFAULT_PANEL_WIDTH
  })
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const isSendingRef = useRef(false)
  const lastUserPromptRef = useRef<string>('')
  const artifactModeAtSendRef = useRef(false)
  const loadingConversationIdRef = useRef<string | null>(null)
  const abortControllerRef = useRef<AbortController | null>(null)
  const router = useRouter()
  const supabase = createClient()

  useEffect(() => {
    loadUserProfile()
    loadConversations()

    // Try to restore last artifact
    const lastArtifact = loadArtifact()
    if (lastArtifact) {
      setActiveArtifact(lastArtifact)
      // Don't open automatically on page load
    }
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
    // Abort previous request if still loading
    if (abortControllerRef.current) {
      abortControllerRef.current.abort()
    }

    // Create new abort controller for this request
    const controller = new AbortController()
    abortControllerRef.current = controller
    loadingConversationIdRef.current = conversationId

    try {
      setIsLoadingConversation(true)

      const response = await fetch(`/api/conversations/${conversationId}`, {
        signal: controller.signal,
      })

      // Ignore response if we've moved to a different conversation
      if (loadingConversationIdRef.current !== conversationId) {
        console.log('[Chat] Ignoring stale response for:', conversationId)
        return
      }

      if (response.ok) {
        const data = await response.json()
        setMessages(data)
        // Update cache
        setMessageCache(prev => ({ ...prev, [conversationId]: data }))
      } else {
        setMessages([])
      }
    } catch (error: any) {
      if (error.name === 'AbortError') {
        console.log('[Chat] Request aborted for:', conversationId)
      } else {
        console.error('[Chat] Failed to load messages:', error)
        setMessages([])
      }
    } finally {
      if (loadingConversationIdRef.current === conversationId) {
        setIsLoadingConversation(false)
        loadingConversationIdRef.current = null
      }
    }
  }

  const handleNewChat = () => {
    if (!currentConversation && messages.length === 0) return
    setCurrentConversation(null)
    setMessages([])
    setActiveArtifact(null)
    setIsArtifactOpen(false)
    setArtifactMessageId(null)
  }

  const handleSelectConversation = async (id: string) => {
    const conv = conversations.find((c) => c.id === id)
    if (!conv) return

    // IMMEDIATELY update UI - don't wait for fetch
    setCurrentConversation(conv)
    setSelectedModel(conv.model_used)
    setIsArtifactOpen(false) // Close artifact panel when switching

    // Try to load cached messages first
    const cached = messageCache[id]
    if (cached) {
      console.log('[Chat] Using cached messages for:', id)
      setMessages(cached)
      setIsLoadingConversation(false)
    } else {
      // Show empty/loading state immediately
      setMessages([])
      setIsLoadingConversation(true)
    }

    // Try to load artifact for this conversation
    const savedArtifact = loadArtifact(id)
    if (savedArtifact) {
      setActiveArtifact(savedArtifact)
      // Don't open automatically
    } else {
      setActiveArtifact(null)
    }

    // Fetch messages in background (with cache and abort)
    await loadConversationMessages(id)
  }

  const handleDeleteConversation = async (id: string) => {
    const deletedConversation = conversations.find((c) => c.id === id)
    setConversations((prev) => prev.filter((c) => c.id !== id))

    // Clear cache for deleted conversation
    setMessageCache(prev => {
      const next = { ...prev }
      delete next[id]
      return next
    })

    // Clear artifact for deleted conversation
    try {
      localStorage.removeItem(getArtifactKey(id))
    } catch (e) {
      // ignore
    }

    if (currentConversation?.id === id) {
      setCurrentConversation(null)
      setMessages([])
      setActiveArtifact(null)
      setIsArtifactOpen(false)
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

    if (isSendingRef.current) {
      console.log('[Chat] Duplicate send blocked')
      return
    }
    isSendingRef.current = true

    artifactModeAtSendRef.current = artifactMode
    lastUserPromptRef.current = trimmedContent

    const userMessageId = typeof crypto !== 'undefined' && crypto.randomUUID
      ? `user-${crypto.randomUUID()}`
      : `user-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
    const assistantMessageId = typeof crypto !== 'undefined' && crypto.randomUUID
      ? `assistant-${crypto.randomUUID()}`
      : `assistant-${Date.now() + 1}-${Math.random().toString(36).substr(2, 9)}`

    const userMessage: Message = {
      id: userMessageId,
      conversation_id: currentConversation?.id || 'temp',
      role: 'user',
      content: trimmedContent,
      model: selectedModel,
      created_at: new Date().toISOString(),
      attachments,
    }

    setMessages((prev) => {
      const exists = prev.some(m => m.id === userMessageId)
      if (exists) return prev
      return [...prev, userMessage]
    })
    setIsLoading(true)

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

        setMessages((prev) =>
          prev.map((m) =>
            m.id === userMessageId ? { ...m, conversation_id: conversation!.id } : m
          )
        )

        setIsCreatingConversation(false)
      } catch (error: any) {
        console.error('[Chat] Failed to create conversation:', error.message)
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

    const assistantPlaceholder: Message = {
      id: assistantMessageId,
      conversation_id: conversation.id,
      role: 'assistant',
      content: artifactModeAtSendRef.current ? ARTIFACT_LOADING_MARKER : '',
      model: selectedModel,
      created_at: new Date().toISOString(),
    }

    setMessages((prev) => {
      const exists = prev.some(m => m.id === assistantMessageId)
      if (exists) return prev
      return [...prev, assistantPlaceholder]
    })

    try {
      const contextMessages = messages.filter(m => m.role === 'user' || m.role === 'assistant')
      const messagesToSend = [...contextMessages, userMessage].map((m) => ({
        role: m.role,
        content: m.content,
        attachments: m.attachments,
      }))

      if (artifactModeAtSendRef.current) {
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
          artifactMode: artifactModeAtSendRef.current,
        }),
      })

      if (response.status === 402) {
        const errorData = await response.json().catch(() => ({}))
        toast({
          title: 'Insufficient credits',
          description: errorData.error || 'Please top up your credits to continue',
          variant: 'destructive',
        })
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantMessageId
              ? { ...m, content: 'Error: Insufficient credits. Please top up to continue.' }
              : m
          )
        )
        setIsLoading(false)
        setIsCreatingConversation(false)
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

      while (reader) {
        const { done, value } = await reader.read()
        if (done) break

        const chunk = decoder.decode(value)
        assistantContent += chunk

        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantMessageId ? { ...m, content: assistantContent } : m
          )
        )
      }

      console.log('[Chat] Stream complete, content length:', assistantContent.length)

      if (!assistantContent || assistantContent.trim() === '') {
        console.error('[Chat] Empty response from API')
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantMessageId
              ? { ...m, content: 'Error: Received empty response from AI.' }
              : m
          )
        )
        setIsLoading(false)
        setIsCreatingConversation(false)
        isSendingRef.current = false
        return
      }

      if (artifactModeAtSendRef.current) {
        const { artifact, cleanContent } = parseArtifactFromResponse(
          assistantContent,
          artifactModeAtSendRef.current,
          lastUserPromptRef.current
        )

        if (artifact) {
          console.log('[Chat] Artifact detected:', artifact.title)

          let finalContent = cleanContent.trim()
          if (!finalContent) {
            finalContent = `I created an artifact for you: **${artifact.title}**.`
          }

          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantMessageId ? { ...m, content: finalContent } : m
            )
          )

          setActiveArtifact(artifact)
          setIsArtifactOpen(true)
          setArtifactMessageId(assistantMessageId)

          // Save artifact to localStorage
          saveArtifact(artifact, conversation.id)
        } else {
          console.log('[Chat] No artifact detected, showing normal response')
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantMessageId ? { ...m, content: assistantContent } : m
            )
          )
        }
      } else {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantMessageId ? { ...m, content: assistantContent } : m
          )
        )
      }

      // Update cache with new messages
      setMessageCache(prev => ({
        ...prev,
        [conversation!.id]: [...messages, userMessage, {
          ...assistantPlaceholder,
          content: assistantContent
        }]
      }))

      loadUserProfile().catch(e => console.error('[Chat] Profile load failed:', e))
      if (messages.length === 0) {
        loadConversations().catch(e => console.error('[Chat] Conversations load failed:', e))
      }
    } catch (error: any) {
      console.error('[Chat] Send message error:', error.message)
      setMessages((prev) =>
        prev.map((m) =>
          m.id === assistantMessageId
            ? { ...m, content: `Sorry, something went wrong: ${error.message}` }
            : m
        )
      )
      toast({
        title: 'Error',
        description: error.message || 'Failed to send message',
        variant: 'destructive',
      })
    } finally {
      setIsLoading(false)
      setIsCreatingConversation(false)
      isSendingRef.current = false
      console.log('[Chat] Send complete, loading states reset')
    }
  }

  const handleToggleArtifactMode = () => {
    if (isLoading || isCreatingConversation || isSendingRef.current) {
      return
    }
    setArtifactMode(!artifactMode)
  }

  const handleOpenArtifact = () => {
    if (activeArtifact) {
      setIsArtifactOpen(true)
    }
  }

  const handlePanelWidthChange = (width: number) => {
    setArtifactPanelWidth(width)
  }

  if (!userProfile) {
    return (
      <div className="min-h-screen bg-[#0A0A0F] flex items-center justify-center">
        <div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full" />
      </div>
    )
  }

  const isRequestInProgress = isLoading || isCreatingConversation || isSendingRef.current
  const showReopenButton = activeArtifact && !isArtifactOpen

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

      <main
        className={cn(
          'flex-1 flex flex-col ml-0 md:ml-80 transition-all duration-300'
        )}
        style={{
          marginRight: isArtifactOpen && typeof window !== 'undefined' && window.innerWidth >= 768 ? `${artifactPanelWidth}px` : undefined,
        }}
      >
        <div className="flex items-center justify-between flex-wrap gap-2 border-b border-white/10 bg-[#0A0A0F]/90 backdrop-blur-xl">
          <div className="flex-1 min-w-0">
            <ModelSelector selectedModel={selectedModel} onSelectModel={setSelectedModel} />
          </div>
          <div className="px-4 py-2 flex items-center gap-2">
            {showReopenButton && (
              <motion.button
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.9 }}
                onClick={handleOpenArtifact}
                className="px-3 py-2 rounded-lg text-sm font-medium transition-all flex items-center gap-2 glass hover:bg-white/10 text-gray-300 hover:text-white border border-white/20"
                title="Reopen latest artifact"
              >
                <PanelRightOpen className="h-4 w-4" />
                <span className="hidden sm:inline">Open Artifact</span>
              </motion.button>
            )}

            <button
              onClick={handleToggleArtifactMode}
              disabled={isRequestInProgress}
              title={isRequestInProgress ? 'Wait for the current response to finish' : 'Toggle Artifact Mode'}
              className={cn(
                'px-4 py-2 rounded-lg text-sm font-medium transition-all flex items-center gap-2',
                artifactMode
                  ? 'bg-purple-500/20 text-purple-400 border border-purple-500/50 glow-border'
                  : 'glass hover:bg-white/10 text-gray-400',
                isRequestInProgress && 'opacity-50 cursor-not-allowed'
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
              {messages.length === 0 && !isLoadingConversation ? (
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
                        disabled={isRequestInProgress}
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
              ) : isLoadingConversation && messages.length === 0 ? (
                <motion.div
                  key="loading"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="space-y-4 mt-8"
                >
                  {[1, 2].map((i) => (
                    <div key={i} className={cn('flex', i % 2 === 0 ? 'justify-start' : 'justify-end')}>
                      <div className={cn(
                        'rounded-2xl p-4 md:p-6 animate-pulse',
                        i % 2 === 0 ? 'w-full glass' : 'max-w-[70%] gradient-primary'
                      )}>
                        <div className="h-4 bg-white/20 rounded w-3/4 mb-2" />
                        <div className="h-4 bg-white/20 rounded w-1/2" />
                      </div>
                    </div>
                  ))}
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
                      onOpenArtifact={artifactMessageId === message.id && activeArtifact ? handleOpenArtifact : undefined}
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
          disabled={isRequestInProgress}
          isLoading={isLoading || isCreatingConversation}
        />
      </main>

      <ArtifactPanel
        artifact={activeArtifact}
        isOpen={isArtifactOpen}
        onClose={() => setIsArtifactOpen(false)}
        width={artifactPanelWidth}
        onWidthChange={handlePanelWidthChange}
      />
    </div>
  )
}
