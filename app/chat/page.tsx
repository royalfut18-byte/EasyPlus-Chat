'use client'

import { useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { motion, AnimatePresence } from 'framer-motion'
import { Sparkles, Box, PanelRightOpen, Globe, Paperclip, Send, Loader2 } from 'lucide-react'
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
import { parseArtifactFromResponse } from '@/lib/artifact-parser'
import { sortMessagesChronologically, dedupeMessages, processMessages, processLoadedMessages, getStoredArtifact } from '@/lib/chat/message-utils'
import type { Conversation, Message, ChatAttachment, Artifact } from '@/types/models'

const DEFAULT_PANEL_WIDTH = 560
const PANEL_WIDTH_KEY = 'easyplus-artifact-panel-width'
const ARTIFACT_LOADING_MARKER = '__ARTIFACT_LOADING__'
const ASSISTANT_LOADING_MARKER = '__ASSISTANT_LOADING__'
const LONG_TASK_LOADING_MARKER = '__LONG_TASK_LOADING__'

function isLongTaskClient(message: string, attachments?: ChatAttachment[]): boolean {
  const lower = message.toLowerCase()
  const longKeywords = ['scan', 'analyse', 'analyze', 'mark', 'refine', '20/20', 'band 6', 'skeletal essay', 'full essay', 'detailed', 'step by step', 'explain fully', 'solve all', 'generate full', 'long response', 'comprehensive', 'in detail', 'mark out of']
  const hasLongKeyword = longKeywords.some((kw) => lower.includes(kw))
  const hasDocOrImage = attachments?.some((a) => a.type === 'document' || a.type === 'image')
  if (hasDocOrImage && hasLongKeyword) return true
  if (hasLongKeyword && lower.length > 100) return true
  return false
}

// Artifact persistence keys
const getArtifactKey = (conversationId: string) => `easyplus:artifact:${conversationId}`
const LAST_ARTIFACT_KEY = 'easyplus:lastArtifact'

// Save artifact to localStorage
function saveArtifact(artifact: Artifact, conversationId?: string) {
  if (typeof window === 'undefined') return

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
  if (typeof window === 'undefined') return null

  try {
    const key = conversationId ? getArtifactKey(conversationId) : LAST_ARTIFACT_KEY
    const data = localStorage.getItem(key)
    if (!data) return null

    const parsed = JSON.parse(data)
    // Validate artifact has required fields
    if (parsed && parsed.title && parsed.language && parsed.code) {
      return parsed as Artifact
    }

    // Invalid artifact, remove it
    localStorage.removeItem(key)
    return null
  } catch (e) {
    console.error('[Artifact] Failed to load from localStorage:', e)
    // Try to remove corrupted data
    try {
      const key = conversationId ? getArtifactKey(conversationId) : LAST_ARTIFACT_KEY
      localStorage.removeItem(key)
    } catch (e2) {
      // Ignore
    }
    return null
  }
}

function generateConversationTitle(message: string): string {
  const trimmed = message.trim().toLowerCase()

  // Handle greetings
  if (/^(hey|hi|hello|yo|sup)[\s!.]*$/.test(trimmed)) {
    return 'Quick Chat'
  }

  // Handle model identity questions
  if (/what (ai|model|gemini|claude|gpt|chatgpt)|which (ai|model)|who are you|what are you/.test(trimmed)) {
    return 'Model Identity'
  }

  // Remove common filler phrases
  let title = message.replace(
    /^(what is|what's|can you|could you|please|tell me about|tell me|explain|explain to me|search the web for|search for|latest|give me|show me|find|look up|help me with|i need|i want)\s+/i,
    ''
  )

  // Handle creation/generation requests
  const creationMatch = title.match(/^(make|build|create|generate|design|code|write)\s+(me\s+)?(a|an)?\s*(.+?)\s+(website|site|page|game|app|component|tool|calculator|dashboard|bracket)/i)
  if (creationMatch) {
    const topic = creationMatch[4] ? creationMatch[4].trim() : ''
    const type = creationMatch[5].charAt(0).toUpperCase() + creationMatch[5].slice(1).toLowerCase()
    if (topic) {
      return `${topic.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')} ${type}`
    }
    return `${type} Project`
  }

  // Handle "X Explained" pattern
  if (/^explain/i.test(message)) {
    title = title.replace(/^explain\s+/i, '').trim()
    if (title.length > 0 && title.length < 40) {
      return toTitleCase(title) + ' Explained'
    }
  }

  // Handle "latest X news"
  if (/latest.*news/i.test(title)) {
    title = title.replace(/latest\s+/i, '').replace(/\s+news/i, ' News')
    return toTitleCase(title)
  }

  // Remove question words at the start
  title = title.replace(/^(how|why|when|where|who)\s+(do|does|did|is|are|was|were|can|could|will|would|should)\s+/i, '')

  // Limit length
  if (title.length > 50) {
    title = title.substring(0, 50)
    const lastSpace = title.lastIndexOf(' ')
    if (lastSpace > 20) {
      title = title.substring(0, lastSpace)
    }
  }

  // Remove trailing punctuation
  title = title.replace(/[.,;:!?]+$/, '').trim()

  // If too short or empty, fallback
  if (!title || title.length < 2) {
    return 'New Chat'
  }

  // Title case
  return toTitleCase(title)
}

function toTitleCase(str: string): string {
  return str
    .split(' ')
    .map((word, index) => {
      // Keep small words lowercase unless they're the first word
      if (index > 0 && /^(a|an|the|in|on|at|to|for|of|and|or|but|is|are|was|were)$/i.test(word)) {
        return word.toLowerCase()
      }
      return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()
    })
    .join(' ')
}

type PendingResponse = {
  conversationId: string
  assistantMessageId: string
  userMessageId: string
  requestId: string
  startedAt: string
  model: string
  mode: 'normal' | 'artifact' | 'agent'
  status: 'thinking' | 'streaming'
  loadingMarker: string
}

export default function ChatPage() {
  const [selectedModel, setSelectedModel] = useState(AI_MODELS[0].id)
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [currentConversation, setCurrentConversation] = useState<Conversation | null>(null)
  const [messages, setMessages] = useState<Message[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [isLoadingConversation, setIsLoadingConversation] = useState(false)
  const [userProfile, setUserProfile] = useState<any>(null)
  const [isCreatingConversation, setIsCreatingConversation] = useState(false)
  const [artifactMode, setArtifactMode] = useState(false)
  const [webSearchEnabled, setWebSearchEnabled] = useState(false)
  const [activeArtifact, setActiveArtifact] = useState<Artifact | null>(null)
  const [isArtifactOpen, setIsArtifactOpen] = useState(false)
  const [artifactMessageId, setArtifactMessageId] = useState<string | null>(null)
  const [artifactPanelWidth, setArtifactPanelWidth] = useState(DEFAULT_PANEL_WIDTH)
  const [pendingResponses, setPendingResponses] = useState<Record<string, PendingResponse>>({})
  const [heroInput, setHeroInput] = useState('')
  const heroTextareaRef = useRef<HTMLTextAreaElement>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const isSendingRef = useRef(false)
  const lastUserPromptRef = useRef<string>('')
  const artifactModeAtSendRef = useRef(false)
  const webSearchEnabledAtSendRef = useRef(false)
  const abortControllerRef = useRef<AbortController | null>(null)
  const selectedConversationIdRef = useRef<string | null>(null)
  const conversationRequestSeqRef = useRef(0)
  const pendingResponsesRef = useRef<Record<string, PendingResponse>>({})
  const router = useRouter()
  const supabase = createClient()

  const setPendingResponse = (conversationId: string, pending: PendingResponse) => {
    pendingResponsesRef.current = { ...pendingResponsesRef.current, [conversationId]: pending }
    setPendingResponses(prev => ({ ...prev, [conversationId]: pending }))
  }

  const clearPendingResponse = (conversationId: string) => {
    const { [conversationId]: _, ...rest } = pendingResponsesRef.current
    pendingResponsesRef.current = rest
    setPendingResponses(prev => {
      const { [conversationId]: __, ...remaining } = prev
      return remaining
    })
  }

  useEffect(() => {
    loadUserProfile()
    loadConversations()

    // Load panel width from localStorage
    try {
      const saved = localStorage.getItem(PANEL_WIDTH_KEY)
      if (saved) {
        const width = parseInt(saved, 10)
        if (!isNaN(width) && width > 0) {
          setArtifactPanelWidth(width)
        }
      }
    } catch (e) {
      // Ignore localStorage errors
    }

    // Don't restore any artifact on page load - wait for conversation selection
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

  const loadConversationMessages = async (conversationId: string, requestSeq: number) => {
    // Create new abort controller for this request
    const controller = new AbortController()
    abortControllerRef.current = controller

    try {
      setIsLoadingConversation(true)

      const response = await fetch(`/api/conversations/${conversationId}`, {
        signal: controller.signal,
        cache: 'no-store',
      })

      // Check if aborted first
      if (controller.signal.aborted) {
        if (process.env.NODE_ENV !== 'production') {
          console.log('[ChatSwitch]', { conversationId, requestSeq, action: 'aborted' })
        }
        return
      }

      // Check if conversation changed
      if (selectedConversationIdRef.current !== conversationId) {
        if (process.env.NODE_ENV !== 'production') {
          console.log('[ChatSwitch]', { conversationId, requestSeq, action: 'ignored - conversation changed' })
        }
        return
      }

      // Check if sequence is stale
      if (conversationRequestSeqRef.current !== requestSeq) {
        if (process.env.NODE_ENV !== 'production') {
          console.log('[ChatSwitch]', { conversationId, requestSeq, action: 'ignored - stale sequence' })
        }
        return
      }

      if (response.ok) {
        const rawData = await response.json()

        // Final check before applying
        if (
          selectedConversationIdRef.current !== conversationId ||
          conversationRequestSeqRef.current !== requestSeq ||
          controller.signal.aborted
        ) {
          return
        }

        // Filter to only messages for this conversation (safety check)
        const safeFetched = Array.isArray(rawData)
          ? rawData.filter(m => m?.conversation_id === conversationId)
          : []

        // Warn if we filtered any out
        if (process.env.NODE_ENV !== 'production' && safeFetched.length !== rawData.length) {
          console.warn('[Chat] API returned messages from wrong conversation', {
            conversationId,
            expected: rawData.length,
            filtered: safeFetched.length
          })
        }

        // Process loaded messages: dedupe, sort, parse artifacts
        const processed = processLoadedMessages(safeFetched, {
          conversationId,
          parseArtifacts: true,
        })

        // Filter by conversation ID as final safety
        const final = processMessages(processed, conversationId)

        // Check for generating messages and show recovery UI + auto-poll
        const generatingMsg = final.find(m => m.role === 'assistant' && m.status === 'generating')
        if (generatingMsg) {
          // Show partial content or recovery marker — ensure only ONE assistant bubble exists for this
          const updatedFinal = final
            .filter(m => {
              // Remove any loading marker duplicates for the same request
              const isMarker = m.content === ARTIFACT_LOADING_MARKER || m.content === ASSISTANT_LOADING_MARKER || m.content === LONG_TASK_LOADING_MARKER || m.content === '__RECOVERY_POLLING__'
              if (m.role === 'assistant' && m.id !== generatingMsg.id && isMarker &&
                  m.request_id === generatingMsg.request_id) return false
              return true
            })
            .map(m =>
              m.id === generatingMsg.id && (!m.content || m.content.length < 10)
                ? { ...m, content: '__RECOVERY_POLLING__', statusLabel: 'Reconnecting and recovering response...' }
                : m
            )
          setMessages(updatedFinal)

          // Start polling for this generating message
          const pollForCompletion = async () => {
            const pollRequestId = generatingMsg.request_id
            for (let i = 0; i < 150; i++) {
              await new Promise(resolve => setTimeout(resolve, 2000))
              if (selectedConversationIdRef.current !== conversationId) return

              try {
                const url = pollRequestId
                  ? `/api/chat/status?requestId=${pollRequestId}&conversationId=${conversationId}`
                  : `/api/chat/status?conversationId=${conversationId}`
                const res = await fetch(url, { cache: 'no-store' })
                if (!res.ok) continue
                const data = await res.json()
                if (data.found && data.content && data.content.length > 10 && data.status === 'completed') {
                  if (selectedConversationIdRef.current === conversationId) {
                    setMessages(prev => processMessages(
                      prev.map(m => m.id === generatingMsg.id ? { ...m, content: data.content, status: 'completed', statusLabel: null } : m),
                      conversationId
                    ))
                  }
                  return
                }
                if (data.found && data.content && data.content.length > 10) {
                  if (selectedConversationIdRef.current === conversationId) {
                    setMessages(prev => processMessages(
                      prev.map(m => m.id === generatingMsg.id ? { ...m, content: data.content, statusLabel: 'Writing response...' } : m),
                      conversationId
                    ))
                  }
                }
                if (data.status === 'error') return
              } catch { /* keep polling */ }
            }
          }
          pollForCompletion()
        } else {
          setMessages(final)
        }

        // Restore artifact from messages if exists
        const messageWithArtifact = final.find(m => m.artifact)
        if (messageWithArtifact?.artifact) {
          setActiveArtifact(messageWithArtifact.artifact)
          setArtifactMessageId(messageWithArtifact.id)
        }
      } else {
        setMessages([])
      }
    } catch (error: any) {
      // Don't show error toast for aborted requests
      if (error.name === 'AbortError') {
        if (process.env.NODE_ENV !== 'production') {
          console.log('[ChatSwitch]', { conversationId, requestSeq, action: 'caught abort error' })
        }
        return
      }
      console.error('[Chat] Failed to load messages:', error)
      setMessages([])
    } finally {
      // Only clear loading if this is still the selected conversation AND sequence matches
      if (
        selectedConversationIdRef.current === conversationId &&
        conversationRequestSeqRef.current === requestSeq
      ) {
        setIsLoadingConversation(false)
      }
    }
  }

  const generateSmartTitle = async (conversationId: string, _currentTitle: string) => {

    try {
      const response = await fetch(`/api/conversations/${conversationId}/title`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      })

      if (!response.ok) return

      const { title } = await response.json()
      if (!title) return

      // Update sidebar conversation list
      setConversations((prev) =>
        prev.map((c) => c.id === conversationId ? { ...c, title } : c)
      )

      // Update current conversation if it matches
      setCurrentConversation((prev) =>
        prev && prev.id === conversationId ? { ...prev, title } : prev
      )
    } catch (e) {
      // Silently fail - fallback title remains
    }
  }

  const handleNewChat = () => {
    if (!currentConversation && messages.length === 0) return

    // Increment sequence to invalidate any pending requests
    ++conversationRequestSeqRef.current
    selectedConversationIdRef.current = null

    setCurrentConversation(null)
    setMessages([])
    setActiveArtifact(null)
    setIsArtifactOpen(false)
    setArtifactMessageId(null)
  }

  const handleSelectConversation = async (id: string) => {
    const conv = conversations.find((c) => c.id === id)
    if (!conv) return

    // Mark this conversation as selected
    const requestSeq = ++conversationRequestSeqRef.current
    selectedConversationIdRef.current = id

    // Abort any previous message-loading request (NOT the active AI generation)
    if (abortControllerRef.current) {
      abortControllerRef.current.abort()
    }

    // IMMEDIATELY update UI
    setCurrentConversation(conv)
    setSelectedModel(conv.model_used)
    setIsArtifactOpen(false)
    setActiveArtifact(null)
    setArtifactMessageId(null)

    // Clear immediately for clean switch - NO CACHE
    setMessages([])
    setIsLoadingConversation(true)

    // Fetch messages (with sequence check)
    await loadConversationMessages(id, requestSeq)

    // After loading, restore pending placeholder ONLY if no assistant message exists from server
    const pending = pendingResponsesRef.current[id]
    if (pending && selectedConversationIdRef.current === id) {
      setMessages(prev => {
        // Don't add placeholder if we already have it by ID
        if (prev.some(m => m.id === pending.assistantMessageId)) return prev
        // Don't add placeholder if server already has an assistant message for this request
        // (the server-created message with same request_id supersedes the client placeholder)
        const serverHasAssistant = prev.some(m =>
          m.role === 'assistant' &&
          m.request_id === pending.requestId
        )
        if (serverHasAssistant) return prev
        const statusFromMarker = pending.loadingMarker === ARTIFACT_LOADING_MARKER
          ? 'Creating artifact...'
          : pending.loadingMarker === LONG_TASK_LOADING_MARKER
            ? 'Working through a larger task...'
            : pending.status === 'streaming'
              ? 'Writing response...'
              : 'Thinking...'
        const placeholder: Message = {
          id: pending.assistantMessageId,
          conversation_id: id,
          role: 'assistant',
          content: pending.loadingMarker,
          model: pending.model,
          created_at: pending.startedAt,
          request_id: pending.requestId,
          statusLabel: statusFromMarker,
        }
        return processMessages([...prev, placeholder], id)
      })
    }
  }

  const handleDeleteConversation = async (id: string) => {
    const deletedConversation = conversations.find((c) => c.id === id)
    setConversations((prev) => prev.filter((c) => c.id !== id))

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
    // 1. Guard: Block duplicate sends - check if current conversation already has pending
    const guardConvId = currentConversation?.id
    if (guardConvId && pendingResponsesRef.current[guardConvId]) {
      if (process.env.NODE_ENV !== 'production') {
        console.log('[Chat] Duplicate send blocked - conversation has pending response')
      }
      return
    }
    if (isSendingRef.current) {
      if (process.env.NODE_ENV !== 'production') {
        console.log('[Chat] Duplicate send blocked')
      }
      return
    }
    isSendingRef.current = true

    // 2. Trim content
    const trimmedContent = content.trim()
    if (!trimmedContent && (!attachments || attachments.length === 0)) {
      isSendingRef.current = false
      return
    }

    // 3. Create stable IDs and timestamps - user MUST be before assistant
    const clientUserMessageId = crypto.randomUUID()
    const clientAssistantMessageId = crypto.randomUUID()
    const requestId = crypto.randomUUID()
    const requestArtifactMode = artifactMode
    const requestWebSearchEnabled = webSearchEnabled

    const sentAt = new Date()
    const userCreatedAt = sentAt.toISOString()
    const assistantCreatedAt = new Date(sentAt.getTime() + 1).toISOString()

    // Determine which model to use: locked conversation model OR selected model
    const modelToUse = currentConversation?.model_used || selectedModel

    artifactModeAtSendRef.current = requestArtifactMode
    webSearchEnabledAtSendRef.current = requestWebSearchEnabled
    lastUserPromptRef.current = trimmedContent

    const userMessage: Message = {
      id: clientUserMessageId,
      conversation_id: currentConversation?.id || 'temp',
      role: 'user',
      content: trimmedContent,
      model: modelToUse,
      created_at: userCreatedAt,
      attachments,
      client_message_id: clientUserMessageId,
      request_id: requestId,
    }

    // 4. Add optimistic user message exactly once with processing
    // Use current conversation ID or temp for filtering
    const tempConvId = currentConversation?.id || 'temp'
    setMessages((prev) => processMessages([...prev, userMessage], tempConvId))
    setIsLoading(true)

    let conversation = currentConversation

    // 5. Create conversation if needed (only once, no duplication after)
    if (!conversation) {
      setIsCreatingConversation(true)
      try {
        const title = generateConversationTitle(trimmedContent)

        const response = await fetch('/api/conversations', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title,
            model: modelToUse,
          }),
        })

        if (!response.ok) {
          throw new Error('Failed to create conversation')
        }

        conversation = await response.json()
        setCurrentConversation(conversation)
        setConversations((prev) => [conversation!, ...prev])

        // Mark this as the selected conversation
        selectedConversationIdRef.current = conversation!.id

        // Update user message with real conversation ID
        const updatedUserMessage = { ...userMessage, conversation_id: conversation!.id }
        setMessages((prev) =>
          processMessages(
            prev.map((m) =>
              m.id === clientUserMessageId ? updatedUserMessage : m
            ),
            conversation!.id
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
        setMessages((prev) => processMessages(prev.filter((m) => m.id !== clientUserMessageId), tempConvId))
        setIsCreatingConversation(false)
        setIsLoading(false)
        isSendingRef.current = false
        return
      }
    }

    if (!conversation) {
      setMessages((prev) => processMessages(prev.filter((m) => m.id !== clientUserMessageId), tempConvId))
      setIsLoading(false)
      isSendingRef.current = false
      return
    }

    // Capture conversation ID for this send - used throughout to prevent mixing
    const sendConversationId = conversation.id

    // 6. Add assistant placeholder exactly once with correct timestamp
    const isLongTask = isLongTaskClient(trimmedContent, attachments)
    const hasAttachments = attachments && attachments.length > 0
    const loadingMarker = requestArtifactMode
      ? ARTIFACT_LOADING_MARKER
      : isLongTask
        ? LONG_TASK_LOADING_MARKER
        : ASSISTANT_LOADING_MARKER

    // Determine initial status label
    const initialStatusLabel = requestArtifactMode
      ? 'Creating artifact...'
      : hasAttachments
        ? 'Reading attached files...'
        : requestWebSearchEnabled
          ? 'Searching the web...'
          : isLongTask
            ? 'Working through a larger task...'
            : 'Thinking...'

    const assistantPlaceholder: Message = {
      id: clientAssistantMessageId,
      conversation_id: sendConversationId,
      role: 'assistant',
      content: loadingMarker,
      model: modelToUse,
      created_at: assistantCreatedAt,
      request_id: requestId,
      client_message_id: clientAssistantMessageId,
      statusLabel: initialStatusLabel,
    }

    setMessages((prev) => processMessages([...prev, assistantPlaceholder], sendConversationId))

    // Register pending response for this conversation
    setPendingResponse(sendConversationId, {
      conversationId: sendConversationId,
      assistantMessageId: clientAssistantMessageId,
      userMessageId: clientUserMessageId,
      requestId,
      startedAt: assistantCreatedAt,
      model: modelToUse,
      mode: requestArtifactMode ? 'artifact' : 'normal',
      status: 'thinking',
      loadingMarker,
    })

    try {
      // 7. Prepare messages for API (exclude artifact metadata and loading markers)
      const isLoadingMarker = (content: string) => {
        return content === ARTIFACT_LOADING_MARKER || content === ASSISTANT_LOADING_MARKER || content === LONG_TASK_LOADING_MARKER || content === '__RECOVERY_POLLING__'
      }

      // Get recent conversation context (last 16 messages)
      const contextMessages = messages
        .filter(m => m.conversation_id === sendConversationId) // Only same conversation
        .filter(m => m.role === 'user' || m.role === 'assistant')
        .filter(m => m.content && !isLoadingMarker(m.content)) // Exclude empty and loading markers
        .slice(-16) // Last 16 messages for context

      const messagesToSend = [...contextMessages, userMessage].map((m, idx, arr) => ({
        role: m.role,
        content: m.content,
        attachments: idx === arr.length - 1
          ? m.attachments
          : (m.attachments && m.attachments.length > 0
            ? m.attachments.map(a => ({ type: a.type, name: a.name, mimeType: a.mimeType, textContent: a.textContent }))
            : undefined),
      }))

      if (requestArtifactMode) {
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

      // 8. Send one API request
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: modelToUse,
          messages: messagesToSend,
          conversationId: conversation.id,
          artifactMode: requestArtifactMode,
          webSearchEnabled: requestWebSearchEnabled,
          requestId,
          clientMessageId: clientUserMessageId,
        }),
      })

      // Check if memory was saved
      const memorySaved = response.headers.get('X-Memory-Saved') === 'true'

      if (response.status === 402) {
        const errorData = await response.json().catch(() => ({}))
        toast({
          title: 'Insufficient credits',
          description: errorData.error || 'Please top up your credits to continue',
          variant: 'destructive',
        })
        // Only update if still on this conversation
        if (selectedConversationIdRef.current === sendConversationId) {
          setMessages((prev) =>
            processMessages(
              prev.map((m) =>
                m.id === clientAssistantMessageId
                  ? { ...m, content: 'Error: Insufficient credits. Please top up to continue.' }
                  : m
              ),
              sendConversationId
            )
          )
        }
        setIsLoading(false)
        setIsCreatingConversation(false)
        isSendingRef.current = false
        return
      }

      if (!response.ok) {
        let errorMessage = `Server error (${response.status})`
        try {
          const text = await response.text()
          if (response.status === 413 || text.includes('PAYLOAD_TOO_LARGE') || text.includes('FUNCTION_PAYLOAD_TOO_LARGE') || text.includes('Request Entity Too Large')) {
            errorMessage = 'File too large for upload. Try a smaller file under 5MB.'
          } else if (response.status === 504 || text.includes('FUNCTION_INVOCATION_TIMEOUT')) {
            try {
              const errorData = JSON.parse(text)
              errorMessage = errorData.error || 'The response timed out. Try saying "continue" or asking for the next part.'
            } catch {
              errorMessage = 'The response timed out. Try saying "continue" or asking for the next part.'
            }
          } else {
            try {
              const errorData = JSON.parse(text)
              errorMessage = errorData.error || errorMessage
            } catch {
              if (text.length > 0 && text.length < 500) {
                errorMessage = text
              }
            }
          }
        } catch (e) {
          errorMessage = `Connection failed (${response.status})`
        }
        console.error('[Chat] API error:', response.status, errorMessage)
        throw new Error(errorMessage)
      }

      // 9. Stream response and update assistant message by ID only
      const reader = response.body?.getReader()
      const decoder = new TextDecoder()
      let assistantContent = ''
      let streamingStatusSet = false
      let contentStarted = false

      while (reader) {
        const { done, value } = await reader.read()
        if (done) break

        const chunk = decoder.decode(value)

        // Skip keepalive whitespace-only chunks before real content starts
        if (!contentStarted) {
          const trimmed = chunk.trimStart()
          if (trimmed.length === 0) continue // Pure keepalive, skip
          assistantContent += trimmed
          contentStarted = true
        } else {
          assistantContent += chunk
        }

        // Update pending status to streaming on first real content — clear statusLabel
        if (!streamingStatusSet && contentStarted) {
          streamingStatusSet = true
          const currentPending = pendingResponsesRef.current[sendConversationId]
          if (currentPending) {
            setPendingResponse(sendConversationId, { ...currentPending, status: 'streaming' })
          }
        }

        // Update by ID only - clear statusLabel so real content shows
        if (contentStarted && selectedConversationIdRef.current === sendConversationId) {
          setMessages((prev) =>
            processMessages(
              prev.map((m) =>
                m.id === clientAssistantMessageId ? { ...m, content: assistantContent, statusLabel: null } : m
              ),
              sendConversationId
            )
          )
        }
      }

      if (process.env.NODE_ENV !== 'production') {
        console.log('[Chat] Stream complete, content length:', assistantContent.length)
      }

      if (!assistantContent || assistantContent.trim() === '') {
        console.error('[Chat] Empty response from API')
        if (selectedConversationIdRef.current === sendConversationId) {
          setMessages((prev) =>
            processMessages(
              prev.map((m) =>
                m.id === clientAssistantMessageId
                  ? { ...m, content: 'Error: Received empty response from AI.' }
                  : m
              ),
              sendConversationId
            )
          )
        }
        setIsLoading(false)
        setIsCreatingConversation(false)
        isSendingRef.current = false
        return
      }

      // 10. Parse artifact if enabled and update final message
      if (requestArtifactMode) {
        const { artifact, cleanContent } = parseArtifactFromResponse(
          assistantContent,
          requestArtifactMode,
          lastUserPromptRef.current
        )

        if (artifact) {
          if (process.env.NODE_ENV !== 'production') {
            console.log('[Chat] Artifact detected:', artifact.title)
          }

          let finalContent = cleanContent.trim()
          if (!finalContent) {
            finalContent = `I created an artifact for you: **${artifact.title}**.`
          }

          // Update with artifact - only if still on this conversation
          if (selectedConversationIdRef.current === sendConversationId) {
            setMessages((prev) =>
              processMessages(
                prev.map((m) =>
                  m.id === clientAssistantMessageId
                    ? { ...m, content: finalContent, artifact }
                    : m
                ),
                sendConversationId
              )
            )

            setActiveArtifact(artifact)
            setIsArtifactOpen(true)
            setArtifactMessageId(clientAssistantMessageId)
          }

          // Save artifact to localStorage
          saveArtifact(artifact, sendConversationId)
        } else {
          // No artifact found - update with normal response
          if (process.env.NODE_ENV !== 'production') {
            console.log('[Chat] No artifact detected, showing normal response')
          }

          // IMPORTANT: Replace loading marker with actual content
          if (selectedConversationIdRef.current === sendConversationId) {
            setMessages((prev) =>
              processMessages(
                prev.map((m) =>
                  m.id === clientAssistantMessageId
                    ? { ...m, content: assistantContent || 'I could not create an artifact from this response.' }
                    : m
                ),
                sendConversationId
              )
            )
          }
        }
      } else {
        // Normal mode (not artifact mode) - ensure content is updated
        // This handles case where artifact mode was toggled off
        if (selectedConversationIdRef.current === sendConversationId) {
          setMessages((prev) =>
            processMessages(
              prev.map((m) =>
                m.id === clientAssistantMessageId
                  ? { ...m, content: assistantContent || 'I received an empty response.' }
                  : m
              ),
              sendConversationId
            )
          )
        }
      }

      // Show memory saved toast (subtle)
      if (memorySaved) {
        toast({ title: 'Memory saved', description: 'I\'ll remember that for future chats.' })
      }

      // Generate smart title after first exchange
      if (conversation && messages.length === 0) {
        generateSmartTitle(conversation.id, conversation.title)
      }

      loadUserProfile().catch((e) => console.error('[Chat] Profile load failed:', e))
      if (messages.length === 0) {
        loadConversations().catch((e) => console.error('[Chat] Conversations load failed:', e))
      }
    } catch (error: any) {
      console.error('[Chat] Send message error:', error.message)

      const isNetworkError =
        error.message?.includes('Failed to fetch') ||
        error.message?.includes('network') ||
        error.name === 'TypeError' ||
        error.message?.includes('FUNCTION_INVOCATION_TIMEOUT') ||
        error.message?.includes('took too long') ||
        error.message?.includes('timeout') ||
        error.message?.includes('TIMEOUT')

      // Auto-recovery: poll for the response instead of showing an error
      if (isNetworkError && sendConversationId && requestId) {
        console.log('[Chat] Connection issue — starting auto-recovery polling for requestId:', requestId)
        if (selectedConversationIdRef.current === sendConversationId) {
          setMessages((prev) =>
            processMessages(
              prev.map((m) =>
                m.id === clientAssistantMessageId
                  ? { ...m, content: '__RECOVERY_POLLING__', statusLabel: 'Reconnecting and recovering response...' }
                  : m
              ),
              sendConversationId
            )
          )
        }

        // Poll for recovery
        let recovered = false
        const maxAttempts = 150 // 5 minutes at 2s intervals
        for (let attempt = 0; attempt < maxAttempts && !recovered; attempt++) {
          await new Promise(resolve => setTimeout(resolve, 2000))

          // Stop if user navigated away
          if (selectedConversationIdRef.current !== sendConversationId) {
            console.log('[Chat] User navigated away during recovery, stopping poll')
            break
          }

          try {
            const statusRes = await fetch(
              `/api/chat/status?requestId=${requestId}&conversationId=${sendConversationId}`,
              { cache: 'no-store' }
            )
            if (!statusRes.ok) continue

            const statusData = await statusRes.json()

            if (statusData.found && statusData.content && statusData.content.length > 10) {
              console.log('[Chat] Recovery successful, content length:', statusData.content.length)
              if (selectedConversationIdRef.current === sendConversationId) {
                setMessages((prev) =>
                  processMessages(
                    prev.map((m) =>
                      m.id === clientAssistantMessageId
                        ? { ...m, content: statusData.content, statusLabel: null }
                        : m
                    ),
                    sendConversationId
                  )
                )
              }
              recovered = true
            } else if (statusData.status === 'error') {
              break
            }
            // If status is 'generating' or 'pending', keep polling
          } catch {
            // Network still down, keep trying
          }
        }

        if (!recovered && selectedConversationIdRef.current === sendConversationId) {
          // Final attempt: reload full conversation
          try {
            const reloadRes = await fetch(`/api/conversations/${sendConversationId}`, { cache: 'no-store' })
            if (reloadRes.ok) {
              const reloadedMessages = await reloadRes.json()
              if (Array.isArray(reloadedMessages)) {
                const assistantMsg = reloadedMessages.find(
                  (m: any) => m.role === 'assistant' && m.request_id === requestId && m.content && m.content.length > 10
                )
                if (assistantMsg) {
                  const processed = processLoadedMessages(reloadedMessages, { conversationId: sendConversationId, parseArtifacts: true })
                  setMessages(processMessages(processed, sendConversationId))
                  recovered = true
                }
              }
            }
          } catch { /* ignore */ }
        }

        if (!recovered && selectedConversationIdRef.current === sendConversationId) {
          setMessages((prev) =>
            processMessages(
              prev.map((m) =>
                m.id === clientAssistantMessageId
                  ? { ...m, content: 'The AI is still generating a response. It will appear when you return to this chat.' }
                  : m
              ),
              sendConversationId
            )
          )
        }
      } else {
        // Non-recoverable error (auth, credits, etc.)
        const displayMessage = `Sorry, something went wrong: ${error.message}`

        if (selectedConversationIdRef.current === sendConversationId) {
          setMessages((prev) =>
            processMessages(
              prev.map((m) =>
                m.id === clientAssistantMessageId
                  ? { ...m, content: displayMessage }
                  : m
              ),
              sendConversationId
            )
          )
        }
        toast({
          title: 'Error',
          description: error.message || 'Failed to send message',
          variant: 'destructive',
        })
      }
    } finally {
      setIsLoading(false)
      setIsCreatingConversation(false)
      isSendingRef.current = false
      clearPendingResponse(sendConversationId)
      if (process.env.NODE_ENV !== 'production') {
        console.log('[Chat] Send complete, loading states reset')
      }
    }
  }

  const handleToggleArtifactMode = () => {
    if (isLoading || isCreatingConversation || isSendingRef.current) {
      return
    }
    const newArtifactMode = !artifactMode
    setArtifactMode(newArtifactMode)
  }

  const handleToggleWebSearch = () => {
    if (isLoading || isCreatingConversation || isSendingRef.current) {
      return
    }
    setWebSearchEnabled(!webSearchEnabled)
  }

  const handleOpenArtifact = (artifact?: Artifact) => {
    // If artifact is provided (from message bubble), use it
    if (artifact) {
      if (process.env.NODE_ENV !== 'production') {
        console.log('[Chat] Opening artifact:', {
          title: artifact.title,
          language: artifact.language,
          codeLength: artifact.code?.length,
        })
      }
      setActiveArtifact(artifact)
      setIsArtifactOpen(true)
    } else if (activeArtifact) {
      // Otherwise use current active artifact
      if (process.env.NODE_ENV !== 'production') {
        console.log('[Chat] Reopening existing artifact:', {
          title: activeArtifact.title,
          language: activeArtifact.language,
          codeLength: activeArtifact.code?.length,
        })
      }
      setIsArtifactOpen(true)
    } else {
      if (process.env.NODE_ENV !== 'production') {
        console.warn('[Chat] Cannot open artifact: no artifact available')
      }
    }
  }

  const handlePanelWidthChange = (width: number) => {
    setArtifactPanelWidth(width)
  }

  if (!userProfile) {
    return (
      <div className="min-h-screen bg-[#08070d] flex items-center justify-center">
        <div className="animate-spin h-8 w-8 border-2 border-violet-500/60 border-t-transparent rounded-full" />
      </div>
    )
  }

  const currentConvId = currentConversation?.id
  const currentChatPending = currentConvId ? !!pendingResponses[currentConvId] : false
  const isRequestInProgress = currentChatPending || isLoading || isCreatingConversation
  const showReopenButton = currentConversation && activeArtifact && !isArtifactOpen

  // Process messages before rendering - filter by current conversation ID as final safety
  const activeConversationId = currentConversation?.id || null
  const displayedMessages = processMessages(messages, activeConversationId)

  const isEmptyDraft = !currentConversation && displayedMessages.length === 0

  const currentModelData = AI_MODELS.find(m => m.id === selectedModel)
  const modelFamily = (() => {
    const name = currentModelData?.name || ''
    if (name.includes('Claude')) return 'Claude'
    if (name.includes('GPT') || name.includes('Chat GPT')) return 'Chat GPT'
    if (name.includes('Gemini')) return 'Gemini'
    return name
  })()

  return (
    <div className="h-[100dvh] md:h-screen bg-[#08070d] flex overflow-hidden">
      <Sidebar
        conversations={conversations}
        currentConversationId={currentConversation?.id}
        pendingConversationIds={Object.keys(pendingResponses)}
        onSelectConversation={handleSelectConversation}
        onNewChat={handleNewChat}
        onDeleteConversation={handleDeleteConversation}
        userProfile={userProfile}
      />

      {/* Main content + artifact panel flex container */}
      <div className="flex min-w-0 flex-1 overflow-hidden ml-0 md:ml-80">
        {/* Chat section */}
        <main className="flex min-w-0 flex-1 flex-col overflow-hidden h-full">
        <div className="border-b border-white/[0.06] bg-[#08070d]/90 backdrop-blur-sm md:backdrop-blur-xl">
          <div className="flex items-center gap-2 overflow-x-auto px-3 py-3 md:px-4">
            <div className="flex-1 min-w-0">
              <ModelSelector
                selectedModel={selectedModel}
                onSelectModel={setSelectedModel}
                disabled={currentConversation !== null}
                disabledReason="Start a new chat to switch models"
              />
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {showReopenButton && (
                <motion.button
                  initial={{ opacity: 0, scale: 0.9 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.9 }}
                  onClick={() => handleOpenArtifact()}
                  className="px-2.5 md:px-3 py-1.5 md:py-2 rounded-full text-xs md:text-sm font-medium transition-all flex items-center gap-1.5 bg-white/[0.03] border border-white/[0.08] hover:border-white/[0.15] text-gray-300 hover:text-white"
                  title="Reopen latest artifact"
                >
                  <PanelRightOpen className="h-4 w-4" />
                  <span className="hidden sm:inline">Open</span>
                </motion.button>
              )}

              <button
                onClick={handleToggleWebSearch}
                disabled={isRequestInProgress}
                title={isRequestInProgress ? 'Wait for the current response to finish' : 'Toggle Web Search'}
                className={cn(
                  'px-2.5 md:px-3 py-1.5 md:py-2 rounded-full text-xs md:text-sm font-medium transition-all flex items-center gap-1.5',
                  webSearchEnabled
                    ? 'bg-violet-500/10 text-violet-300 border border-violet-500/30'
                    : 'bg-white/[0.03] border border-white/[0.08] hover:border-white/[0.15] text-gray-400',
                  isRequestInProgress && 'opacity-50 cursor-not-allowed'
                )}
              >
                <Globe className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">Search</span>
              </button>

              <button
                onClick={handleToggleArtifactMode}
                disabled={isRequestInProgress}
                title={isRequestInProgress ? 'Wait for the current response to finish' : 'Toggle Artifact Mode'}
                className={cn(
                  'px-2.5 md:px-3 py-1.5 md:py-2 rounded-full text-xs md:text-sm font-medium transition-all flex items-center gap-1.5',
                  artifactMode
                    ? 'bg-violet-500/10 text-violet-300 border border-violet-500/30'
                    : 'bg-white/[0.03] border border-white/[0.08] hover:border-white/[0.15] text-gray-400',
                  isRequestInProgress && 'opacity-50 cursor-not-allowed'
                )}
              >
                <Box className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">Artifacts</span>
              </button>
            </div>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-3 md:px-4 lg:px-6 py-4 md:py-6 lg:py-8 scrollbar-thin">
          <div className="max-w-4xl mx-auto">
            <AnimatePresence mode="popLayout">
              {displayedMessages.length === 0 && !isLoadingConversation ? (
                <motion.div
                  key="empty"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  transition={{ duration: 0.4 }}
                  className="flex flex-col items-center justify-center h-full min-h-[65vh] text-center px-4 gap-7 md:gap-8 max-w-4xl mx-auto relative"
                >
                  {/* Subtle background glow */}
                  <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
                    <div className="w-[600px] h-[400px] bg-violet-600/[0.04] rounded-full blur-[120px]" />
                  </div>

                  {/* Badge */}
                  <motion.div
                    initial={{ opacity: 0, y: 5 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.1 }}
                    className="relative px-4 py-1.5 rounded-full bg-white/[0.03] border border-white/[0.08] text-xs text-gray-400 font-medium"
                  >
                    Private AI Workspace
                  </motion.div>

                  {/* Heading */}
                  <motion.div
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.15 }}
                    className="relative space-y-4"
                  >
                    <h1 className="text-3xl sm:text-4xl md:text-5xl lg:text-6xl font-semibold text-white/95 tracking-tight leading-[1.1]">
                      Ask anything. Build anything.
                    </h1>
                    <p className="text-sm md:text-base lg:text-lg text-gray-500 max-w-xl mx-auto leading-relaxed">
                      Chat with {modelFamily}, use web search, upload files, and create interactive artifacts from one focused workspace.
                    </p>
                  </motion.div>

                  {/* Interactive prompt input */}
                  <motion.div
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.25 }}
                    className="relative w-full max-w-3xl"
                  >
                    <div className="absolute -inset-1.5 bg-violet-500/[0.05] rounded-[28px] blur-xl" />
                    <div className="relative bg-white/[0.03] border border-white/[0.08] rounded-2xl md:rounded-3xl px-4 md:px-5 py-3 md:py-4 flex items-end gap-3 focus-within:border-white/[0.16] transition-colors">
                      <Paperclip className="h-4.5 w-4.5 md:h-5 md:w-5 text-gray-600 shrink-0 mb-1" />
                      <textarea
                        ref={heroTextareaRef}
                        value={heroInput}
                        onChange={(e) => {
                          setHeroInput(e.target.value)
                          e.target.style.height = 'auto'
                          e.target.style.height = `${Math.min(e.target.scrollHeight, 160)}px`
                        }}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' && !e.shiftKey) {
                            e.preventDefault()
                            if (heroInput.trim() && !isRequestInProgress) {
                              handleSendMessage(heroInput.trim())
                              setHeroInput('')
                              if (heroTextareaRef.current) heroTextareaRef.current.style.height = 'auto'
                            }
                          }
                        }}
                        placeholder="What do you want to work on today?"
                        disabled={isRequestInProgress}
                        className="flex-1 bg-transparent border-none outline-none resize-none text-white placeholder:text-gray-600 text-sm md:text-base min-h-[28px] max-h-[160px] py-1 scrollbar-thin disabled:opacity-50"
                        rows={1}
                        autoFocus
                      />
                      <button
                        onClick={() => {
                          if (heroInput.trim() && !isRequestInProgress) {
                            handleSendMessage(heroInput.trim())
                            setHeroInput('')
                            if (heroTextareaRef.current) heroTextareaRef.current.style.height = 'auto'
                          }
                        }}
                        disabled={!heroInput.trim() || isRequestInProgress}
                        className="bg-violet-600 hover:bg-violet-500 h-8 w-8 md:h-9 md:w-9 rounded-xl shrink-0 flex items-center justify-center transition-all disabled:opacity-30 disabled:cursor-not-allowed mb-0.5"
                      >
                        {isRequestInProgress ? (
                          <Loader2 className="h-3.5 w-3.5 md:h-4 md:w-4 text-white animate-spin" />
                        ) : (
                          <Send className="h-3.5 w-3.5 md:h-4 md:w-4 text-white" />
                        )}
                      </button>
                    </div>
                  </motion.div>

                  {/* Suggestion chips */}
                  <motion.div
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.35 }}
                    className="relative flex flex-wrap justify-center gap-2 md:gap-2.5"
                  >
                    {[
                      'Explain a maths question',
                      'Review my essay',
                      'Search current news',
                      'Build an artifact',
                      'Analyse a document',
                    ].map((text, i) => (
                      <button
                        key={i}
                        onClick={() => handleSendMessage(text)}
                        disabled={isRequestInProgress}
                        className="px-4 py-2 md:py-2.5 rounded-full text-xs md:text-sm text-gray-400 bg-white/[0.02] border border-white/[0.07] hover:border-white/[0.15] hover:text-gray-200 hover:bg-white/[0.04] transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {text}
                      </button>
                    ))}
                  </motion.div>
                </motion.div>
              ) : isLoadingConversation && displayedMessages.length === 0 ? (
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
                        i % 2 === 0 ? 'w-full bg-white/[0.03] border border-white/[0.06]' : 'max-w-[70%] bg-indigo-600/20'
                      )}>
                        <div className="h-4 bg-white/10 rounded w-3/4 mb-2" />
                        <div className="h-4 bg-white/10 rounded w-1/2" />
                      </div>
                    </div>
                  ))}
                </motion.div>
              ) : (
                <>
                  {displayedMessages.map((message) => (
                    <MessageBubble
                      key={message.id}
                      role={message.role}
                      content={message.content}
                      model={message.model}
                      attachments={message.attachments}
                      hasArtifact={artifactMessageId === message.id && !!activeArtifact}
                      artifact={message.artifact}
                      onOpenArtifact={message.artifact ? handleOpenArtifact : (artifactMessageId === message.id && activeArtifact ? handleOpenArtifact : undefined)}
                      statusLabel={message.statusLabel}
                    />
                  ))}
                </>
              )}
            </AnimatePresence>
            <div ref={messagesEndRef} />
          </div>
        </div>

        {!isEmptyDraft && (
          <ChatInput
            onSend={handleSendMessage}
            disabled={isRequestInProgress}
            isLoading={isLoading || isCreatingConversation}
          />
        )}
        </main>

        {/* Artifact panel as flex child */}
        {isArtifactOpen && activeArtifact && (
          <ArtifactPanel
            artifact={activeArtifact}
            isOpen={isArtifactOpen}
            onClose={() => setIsArtifactOpen(false)}
            width={artifactPanelWidth}
            onWidthChange={handlePanelWidthChange}
          />
        )}
      </div>
    </div>
  )
}
