'use client'

import { useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { motion, AnimatePresence } from 'framer-motion'
import { Sparkles, Box, PanelRightOpen, Globe, Paperclip, Send, Loader2, X, FileText } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { ensureProfile } from '@/lib/supabase/ensure-profile'
import { ModelSelector } from '@/components/chat/model-selector'
import { ReasoningSelector } from '@/components/chat/reasoning-selector'
import { MessageBubble } from '@/components/chat/message-bubble'
import { ChatInput } from '@/components/chat/chat-input'
import { Sidebar } from '@/components/chat/sidebar'
import { ArtifactPanel } from '@/components/chat/artifact-panel'
import { toast } from '@/components/ui/use-toast'
import { AI_MODELS } from '@/types/models'
import { cn } from '@/lib/utils'
import { parseArtifactFromResponse } from '@/lib/artifact-parser'
import { sortMessagesChronologically, dedupeMessages, processMessages, processLoadedMessages, getStoredArtifact } from '@/lib/chat/message-utils'
import { useR2Upload } from '@/hooks/use-r2-upload'
import { parsePageRangeRequest } from '@/lib/ai/document-requests'
import type { Conversation, Message, ChatAttachment, Artifact, ReasoningMode } from '@/types/models'

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

function attachmentHasCloudStorage(attachment: ChatAttachment): boolean {
  return attachment.storageProvider === 'r2' || !!(attachment.storageKey || attachment.storagePath)
}

function stripCloudPreviewData(attachment: ChatAttachment): ChatAttachment {
  if (!attachmentHasCloudStorage(attachment)) return attachment
  const { dataUrl, ...safeAttachment } = attachment
  return safeAttachment
}

async function dataUrlToFile(dataUrl: string, filename: string, mimeType: string): Promise<File> {
  const response = await fetch(dataUrl)
  const blob = await response.blob()
  return new File([blob], filename, { type: mimeType || blob.type })
}

// Artifact persistence keys
const getArtifactKey = (conversationId: string) => `easyplus:artifact:${conversationId}`
const LAST_ARTIFACT_KEY = 'easyplus:lastArtifact'

// Save artifact to localStorage
function saveArtifact(artifact: Artifact, conversationId?: string, messageId?: string) {
  if (typeof window === 'undefined') return

  try {
    const data = JSON.stringify(artifact)
    localStorage.setItem(LAST_ARTIFACT_KEY, data)
    if (conversationId) {
      localStorage.setItem(getArtifactKey(conversationId), data)
      localStorage.setItem(`easyplus:artifact:${conversationId}:latest`, data)
      if (messageId) {
        localStorage.setItem(`easyplus:artifact:${conversationId}:${messageId}`, data)
      }
    }
  } catch (e) {
    console.error('[Artifact] Failed to save to localStorage:', e)
  }
}

// Load artifact from localStorage
function loadArtifact(conversationId?: string): Artifact | null {
  if (typeof window === 'undefined') return null

  try {
    const primaryKey = conversationId ? getArtifactKey(conversationId) : LAST_ARTIFACT_KEY
    const latestKey = conversationId ? `easyplus:artifact:${conversationId}:latest` : LAST_ARTIFACT_KEY
    const data = localStorage.getItem(primaryKey) || localStorage.getItem(latestKey)
    if (!data) return null

    const parsed = JSON.parse(data)
    // Validate artifact has required fields
    if (parsed && parsed.title && parsed.language && parsed.code) {
      return parsed as Artifact
    }

    // Invalid artifact, remove it
    localStorage.removeItem(primaryKey)
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
  const [reasoningMode, setReasoningMode] = useState<ReasoningMode>('thinking')
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
  const [heroAttachments, setHeroAttachments] = useState<ChatAttachment[]>([])
  const [heroUploading, setHeroUploading] = useState(false)
  const [heroIsDragging, setHeroIsDragging] = useState(false)
  const heroTextareaRef = useRef<HTMLTextAreaElement>(null)
  const heroFileInputRef = useRef<HTMLInputElement>(null)
  const heroDragDepthRef = useRef(0)
  const { uploadToR2, maxUploadMB: heroMaxUploadMB } = useR2Upload()
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

        // Check for generating messages — but only poll if RECENTLY generating (not stale)
        // IMPORTANT: Only touch the ONE generating message, never modify/remove other messages
        const generatingMsg = final.find(m => m.role === 'assistant' && m.status === 'generating')
        const STALE_THRESHOLD = 60_000 // 60 seconds

        if (generatingMsg) {
          const msgAge = Date.now() - new Date(generatingMsg.created_at || 0).getTime()
          const isStale = msgAge > STALE_THRESHOLD
          const hasRealContent = generatingMsg.content && generatingMsg.content.length > 20 &&
            generatingMsg.content !== '__RECOVERY_POLLING__' &&
            generatingMsg.content !== ARTIFACT_LOADING_MARKER &&
            generatingMsg.content !== ASSISTANT_LOADING_MARKER &&
            generatingMsg.content !== LONG_TASK_LOADING_MARKER

          if (hasRealContent) {
            // The response exists but status wasn't updated — show the content directly
            setMessages(final.map(m =>
              m.id === generatingMsg.id ? { ...m, status: 'completed' as const, statusLabel: null } : m
            ))
          } else if (isStale) {
            // Stale generating with no real content — show interrupted state for THIS message only
            setMessages(final.map(m =>
              m.id === generatingMsg.id
                ? { ...m, content: 'Response interrupted. You can retry this message.', status: 'error' as const, statusLabel: null }
                : m
            ))
          } else {
            // Actively generating (< 60s old) — show recovery UI for THIS message only and poll
            const updatedFinal = final.map(m =>
              m.id === generatingMsg.id && (!m.content || m.content.length < 10)
                ? { ...m, content: '__RECOVERY_POLLING__', statusLabel: 'Reconnecting and recovering response...' }
                : m
            )
            setMessages(updatedFinal)

            // Poll — but with a hard 2-minute cap (not 5 minutes)
            const pollForCompletion = async () => {
              const pollRequestId = generatingMsg.request_id
              const maxAttempts = 60 // 2 minutes at 2s intervals
              for (let i = 0; i < maxAttempts; i++) {
                await new Promise(resolve => setTimeout(resolve, 2000))
                if (selectedConversationIdRef.current !== conversationId) return

                try {
                  const url = pollRequestId
                    ? `/api/chat/status?requestId=${pollRequestId}&conversationId=${conversationId}`
                    : `/api/chat/status?conversationId=${conversationId}`
                  const res = await fetch(url, { cache: 'no-store' })
                  if (!res.ok) continue
                  const data = await res.json()
                  if (data.found && data.content && data.content.length > 10 && !['__RECOVERY_POLLING__', '__ASSISTANT_LOADING__', '__LONG_TASK_LOADING__', '__ARTIFACT_LOADING__'].includes(data.content)) {
                    if (selectedConversationIdRef.current === conversationId) {
                      setMessages(prev => prev.map(m =>
                        m.id === generatingMsg.id ? { ...m, content: data.content, status: 'completed' as const, statusLabel: null } : m
                      ))
                    }
                    return
                  }
                  if (data.status === 'error') {
                    if (selectedConversationIdRef.current === conversationId) {
                      setMessages(prev => prev.map(m =>
                        m.id === generatingMsg.id
                          ? { ...m, content: 'Response interrupted. You can retry this message.', status: 'error' as const, statusLabel: null }
                          : m
                      ))
                    }
                    return
                  }
                } catch { /* keep polling */ }
              }
              // Polling exhausted — show retry state
              if (selectedConversationIdRef.current === conversationId) {
                setMessages(prev => prev.map(m =>
                  m.id === generatingMsg.id
                    ? { ...m, content: 'Response interrupted. You can retry this message.', status: 'error' as const, statusLabel: null }
                    : m
                ))
              }
            }
            pollForCompletion()
          }
        } else {
          setMessages(final)
        }

        // Restore artifact from messages if exists
        const messageWithArtifact = [...final].reverse().find(m => m.artifact)
        if (messageWithArtifact?.artifact) {
          setActiveArtifact(messageWithArtifact.artifact)
          setArtifactMessageId(messageWithArtifact.id)
        } else {
          const storedArtifact = loadArtifact(conversationId) || getStoredArtifact(conversationId)
          if (storedArtifact) {
            setActiveArtifact(storedArtifact)
            setArtifactMessageId(null)
          }
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
    setReasoningMode(conv.reasoning_mode || 'thinking')
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
          content: '',
          model: pending.model,
          created_at: pending.startedAt,
          request_id: pending.requestId,
          status: 'generating',
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

    let safeAttachments: ChatAttachment[] | undefined
    if (attachments && attachments.length > 0) {
      try {
        safeAttachments = await Promise.all(attachments.map(async (attachment) => {
          if (attachmentHasCloudStorage(attachment)) {
            return stripCloudPreviewData(attachment)
          }

          if (!attachment.dataUrl) {
            return attachment
          }

          const file = await dataUrlToFile(attachment.dataUrl, attachment.name, attachment.mimeType)
          const result = await uploadToR2(file, currentConversation?.id || null, undefined, { forceCloud: true })
          if (result.error) {
            throw new Error(result.error)
          }
          return stripCloudPreviewData({
            ...result.attachment,
            type: attachment.type,
            name: attachment.name,
            mimeType: result.attachment.mimeType || attachment.mimeType,
            size: result.attachment.size || attachment.size,
            clientUploadId: attachment.clientUploadId,
          })
        }))
      } catch (error: any) {
        toast({
          title: 'Upload failed',
          description: error.message || 'Could not move this attachment to cloud storage. Try attaching it again.',
          variant: 'destructive',
        })
        isSendingRef.current = false
        return
      }
    }

    // 3. Create stable IDs and timestamps - user MUST be before assistant
    const clientUserMessageId = crypto.randomUUID()
    const clientAssistantMessageId = crypto.randomUUID()
    const requestId = crypto.randomUUID()
    const requestArtifactMode = artifactMode
    const requestWebSearchEnabled = webSearchEnabled
    const requestReasoningMode = reasoningMode

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
      attachments: safeAttachments,
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
            reasoningMode: requestReasoningMode,
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
    const isLongTask = isLongTaskClient(trimmedContent, safeAttachments)
    const hasAttachments = safeAttachments && safeAttachments.length > 0
    const loadingMarker = requestArtifactMode
      ? ARTIFACT_LOADING_MARKER
      : isLongTask
        ? LONG_TASK_LOADING_MARKER
        : ASSISTANT_LOADING_MARKER

    // Determine initial status label based on reasoning mode
    const initialStatusLabel = requestArtifactMode
      ? 'Creating artifact...'
      : hasAttachments
        ? 'Reading attached files...'
        : requestWebSearchEnabled
          ? 'Searching the web...'
          : isLongTask
            ? 'Working through a larger task...'
            : requestReasoningMode === 'extended'
              ? 'Deep reasoning...'
              : requestReasoningMode === 'instant'
                ? 'Responding...'
                : 'Thinking...'

    const assistantPlaceholder: Message = {
      id: clientAssistantMessageId,
      conversation_id: sendConversationId,
      role: 'assistant',
      content: '',
      model: modelToUse,
      created_at: assistantCreatedAt,
      request_id: requestId,
      client_message_id: clientAssistantMessageId,
      status: 'generating',
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
        .slice(-20) // Last 20 messages for context

      const messagesToSend = [...contextMessages, userMessage].map((m, idx, arr) => ({
        role: m.role,
        content: m.content,
        attachments: idx === arr.length - 1
          ? m.attachments
          : (m.attachments && m.attachments.length > 0
            ? m.attachments.map(a => {
              if (a.type === 'image') {
                return { type: a.type, name: a.name, mimeType: a.mimeType, storageProvider: a.storageProvider, storageKey: a.storageKey, storagePath: a.storagePath, bucket: a.bucket }
              }
              return { type: a.type, name: a.name, mimeType: a.mimeType, textContent: a.textContent }
            })
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
- Use language values: html, tsx, jsx, javascript, css, python, markdown, text, docx, xlsx, pptx, gdoc, gsheet, gslides, canva.
- Default to artifact:html with a full single-file HTML document, inline CSS, and inline JS so it opens as a live side-panel preview.
- Only use artifact:docx, artifact:xlsx, artifact:pptx, artifact:gdoc, artifact:gsheet, or artifact:gslides when the user explicitly asks for that exact Office/Google file type.
- Do not choose Word/docx for generic requests like "make something", "make an artifact", "make a document", "write this up", or "create a page".
- For explicit Microsoft Word documents, use artifact:docx:Title and put clean markdown/plain text inside. The app will convert it into a downloadable .docx file.
- For explicit Excel or Google Sheets, use artifact:xlsx:Title or artifact:gsheet:Title and put CSV/markdown-table content inside. The app will convert it into a downloadable .xlsx file.
- For explicit PowerPoint or Google Slides, use artifact:pptx:Title or artifact:gslides:Title and separate slides with --- lines. The app will convert it into a downloadable .pptx file.
- For explicit Google Docs, use artifact:gdoc:Title and put clean markdown/plain text inside. The app will convert it into a downloadable .docx file.
- For Canva-style designs, use artifact:canva:Title and put complete HTML/CSS inside. The app previews and downloads it as .html because Canva has no open native file format.
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
          reasoningMode: requestReasoningMode,
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
            errorMessage = 'File too large for inline upload. Use the attachment button to upload large files via R2.'
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

      const stripThinkingTags = (text: string): string => {
        return text.replace(/<thinking>[\s\S]*?<\/thinking>\s*/g, '').replace(/<thinking>[\s\S]*$/g, '')
      }

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

        // Strip <thinking> tags before displaying to user
        const displayContent = stripThinkingTags(assistantContent)

        // Update by ID only - clear statusLabel so real content shows
        if (contentStarted && displayContent && selectedConversationIdRef.current === sendConversationId) {
          setMessages((prev) =>
            processMessages(
              prev.map((m) =>
                m.id === clientAssistantMessageId ? { ...m, content: displayContent, statusLabel: null } : m
              ),
              sendConversationId
            )
          )
        }
      }

      if (process.env.NODE_ENV !== 'production') {
        console.log('[Chat] Stream complete, content length:', assistantContent.length)
      }

      // Strip thinking tags from final content
      const finalAssistantContent = stripThinkingTags(assistantContent).trim()

      if (!finalAssistantContent) {
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
          finalAssistantContent,
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
                    ? { ...m, content: finalContent, artifact, status: 'completed' as const, statusLabel: null }
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
          saveArtifact(artifact, sendConversationId, clientAssistantMessageId)
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
                    ? { ...m, content: finalAssistantContent || 'I could not create an artifact from this response.', status: 'completed' as const, statusLabel: null }
                    : m
                ),
                sendConversationId
              )
            )
          }
        }
      } else {
        // Normal mode (not artifact mode) - attempt a best-effort artifact parse
        // Some models output artifact/code blocks even when artifactMode wasn't toggled.
        // Try to parse artifact metadata and attach it so the UI can offer "Open Artifact".
        try {
          const { artifact, cleanContent } = parseArtifactFromResponse(
            finalAssistantContent,
            true,
            lastUserPromptRef.current
          )

          if (artifact) {
            if (process.env.NODE_ENV !== 'production') {
              console.log('[Chat] Artifact auto-detected (fallback):', artifact.title)
            }

            let finalContent = cleanContent.trim()
            if (!finalContent) {
              finalContent = `I created an artifact for you: **${artifact.title}**.`
            }

            if (selectedConversationIdRef.current === sendConversationId) {
              setMessages((prev) =>
                processMessages(
                  prev.map((m) =>
                    m.id === clientAssistantMessageId
                      ? { ...m, content: finalContent, artifact, status: 'completed' as const, statusLabel: null }
                      : m
                  ),
                  sendConversationId
                )
              )

              setActiveArtifact(artifact)
              setIsArtifactOpen(true)
              setArtifactMessageId(clientAssistantMessageId)
            }

            // Save artifact to localStorage for persistence
            saveArtifact(artifact, sendConversationId, clientAssistantMessageId)
          } else {
            // No artifact found - update with normal response
            if (selectedConversationIdRef.current === sendConversationId) {
              setMessages((prev) =>
                processMessages(
                  prev.map((m) =>
                    m.id === clientAssistantMessageId
                      ? { ...m, content: finalAssistantContent || 'I received an empty response.', status: 'completed' as const, statusLabel: null }
                      : m
                  ),
                  sendConversationId
                )
              )
            }
          }
        } catch (e) {
          console.error('[Chat] Artifact fallback parse failed:', e)
          if (selectedConversationIdRef.current === sendConversationId) {
            setMessages((prev) =>
              processMessages(
                prev.map((m) =>
                  m.id === clientAssistantMessageId
                    ? { ...m, content: finalAssistantContent || 'I received an empty response.', status: 'completed' as const, statusLabel: null }
                    : m
                ),
                sendConversationId
              )
            )
          }
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

        // Poll for recovery — reject marker/empty content
        const RECOVERY_MARKERS = ['__RECOVERY_POLLING__', '__ASSISTANT_LOADING__', '__LONG_TASK_LOADING__', '__ARTIFACT_LOADING__', '...']
        const isRecoveredReal = (c: string | null) => c && c.trim().length > 20 && !RECOVERY_MARKERS.includes(c)

        let recovered = false
        const maxAttempts = 150 // 5 minutes at 2s intervals
        for (let attempt = 0; attempt < maxAttempts && !recovered; attempt++) {
          await new Promise(resolve => setTimeout(resolve, 2000))

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

            if (statusData.found && isRecoveredReal(statusData.content)) {
              console.log('[Chat] Recovery successful, content length:', statusData.content.length)
              if (selectedConversationIdRef.current === sendConversationId) {
                setMessages((prev) =>
                  processMessages(
                    prev.map((m) =>
                      m.id === clientAssistantMessageId
                        ? { ...m, content: statusData.content, status: 'completed' as const, statusLabel: null }
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
                  (m: any) => m.role === 'assistant' && m.request_id === requestId && isRecoveredReal(m.content)
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
                  ? { ...m, content: 'Response interrupted. You can retry this message.', status: 'error' as const, statusLabel: null }
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

  const HERO_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/jpg', 'image/webp']
  const HERO_ALLOWED_EXTENSIONS = ['.pdf', '.txt', '.md', '.csv', '.json', '.docx', '.xlsx', '.pptx', '.png', '.jpg', '.jpeg', '.webp', '.gif', '.mp4', '.webm', '.mp3', '.wav', '.zip', '.tar', '.gz']
  const HERO_MAX_FILE_SIZE = heroMaxUploadMB * 1024 * 1024
  const HERO_MAX_FILES = 30

  function getHeroFileKey(file: File | ChatAttachment): string {
    return `${file.name}|${file.size}`
  }

  function deduplicateHeroFiles(existing: ChatAttachment[], incoming: File[]): File[] {
    const existingKeys = new Set(existing.map(a => getHeroFileKey(a)))
    return Array.from(incoming).filter(f => !existingKeys.has(getHeroFileKey(f)))
  }

  const heroProcessFile = async (file: File): Promise<void> => {
    const ext = '.' + (file.name.split('.').pop()?.toLowerCase() || '')
    const mimeMap: Record<string, string> = {
      '.pdf': 'application/pdf', '.txt': 'text/plain', '.md': 'text/markdown',
      '.csv': 'text/csv', '.json': 'application/json',
      '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif',
      '.mp4': 'video/mp4', '.webm': 'video/webm', '.mp3': 'audio/mpeg', '.wav': 'audio/wav',
      '.zip': 'application/zip', '.tar': 'application/x-tar', '.gz': 'application/gzip',
    }
    const mime = mimeMap[ext] || file.type
    const sourceFile = file.type === mime ? file : new File([file], file.name, { type: mime, lastModified: file.lastModified })

    if (!HERO_ALLOWED_EXTENSIONS.includes(ext)) {
      toast({ title: 'Unsupported file type', description: `Supported: ${HERO_ALLOWED_EXTENSIONS.join(', ')}`, variant: 'destructive' })
      return
    }
    if (file.size > HERO_MAX_FILE_SIZE) {
      toast({ title: 'File too large', description: `Maximum upload size is ${heroMaxUploadMB}MB.`, variant: 'destructive' })
      return
    }

    const isImage = HERO_IMAGE_TYPES.includes(mime)
    // Use file key instead of index to avoid race conditions with multiple files
    const fileKey = `${file.name}|${file.size}|${file.lastModified}`

    if (process.env.NODE_ENV !== 'production') {
      console.log('[Hero Upload] Using R2 upload for:', file.name, `${(file.size / 1024 / 1024).toFixed(1)}MB`)
    }

    const placeholder: ChatAttachment = {
      type: isImage ? 'image' : 'document',
      name: file.name,
      mimeType: mime,
      size: file.size,
      clientUploadId: fileKey,
      uploadStatus: 'pending',
      uploadProgress: 0,
    }
    
    setHeroAttachments((prev) => {
      if (prev.length >= HERO_MAX_FILES) {
        if (process.env.NODE_ENV !== 'production') {
          console.warn('[Hero Upload] Max files reached when adding placeholder', { current: prev.length, max: HERO_MAX_FILES })
        }
        return prev
      }
      if (process.env.NODE_ENV !== 'production') {
        console.log('[Hero Upload] Adding placeholder:', { name: file.name, count: prev.length + 1 })
      }
      return [...prev, placeholder]
    })
    setHeroUploading(true)

    const result = await uploadToR2(sourceFile, null, (updated) => {
      if (process.env.NODE_ENV !== 'production') {
        console.log('[Hero Upload] Progress update:', { name: file.name, status: updated.uploadStatus, progress: updated.uploadProgress })
      }
      // Use file key matching instead of index to avoid race conditions
      setHeroAttachments((prev) => prev.map((a) => 
        a.clientUploadId === fileKey ? { ...a, ...updated, clientUploadId: fileKey } : a
      ))
    }, { forceCloud: true })

    if (result.error) {
      toast({ title: 'Upload failed', description: result.error, variant: 'destructive' })
      if (process.env.NODE_ENV !== 'production') {
        console.error('[Hero Upload] R2 upload failed:', { name: file.name, error: result.error })
      }
    } else if (process.env.NODE_ENV !== 'production') {
      console.log('[Hero Upload] R2 upload success:', {
        name: file.name,
        storageProvider: result.attachment.storageProvider,
        storageKey: result.attachment.storageKey,
        uploadStatus: result.attachment.uploadStatus,
      })
    }

    const finalAttachment = { ...result.attachment, clientUploadId: fileKey }
    setHeroAttachments((prev) => prev.map((a) => 
      a.clientUploadId === fileKey ? finalAttachment : a
    ))
    setHeroUploading(false)
  }

  const handleHeroFileSelect = async (files: FileList | null) => {
    if (!files || files.length === 0) return
    if (process.env.NODE_ENV !== 'production') {
      console.log('[Hero Upload] Files selected:', {
        count: files.length,
        names: Array.from(files).map(f => f.name),
        currentAttachments: heroAttachments.length,
      })
    }
    const uniqueFiles = deduplicateHeroFiles(heroAttachments, Array.from(files))
    if (uniqueFiles.length === 0) {
      toast({
        title: 'Duplicate files',
        description: 'All selected files are already attached',
        variant: 'destructive',
      })
      return
    }
    if (process.env.NODE_ENV !== 'production') {
      console.log('[Hero Upload] After dedup:', {
        uniqueCount: uniqueFiles.length,
        names: uniqueFiles.map(f => f.name),
      })
    }

    const remaining = HERO_MAX_FILES - heroAttachments.length
    const filesToProcess = uniqueFiles.slice(0, remaining)

    if (filesToProcess.length < uniqueFiles.length) {
      toast({
        title: 'Attachment limit reached',
        description: `Maximum ${HERO_MAX_FILES} files per chat`,
        variant: 'destructive',
      })
    }

    await Promise.all(filesToProcess.map(file => heroProcessFile(file)))

    if (process.env.NODE_ENV !== 'production') {
      console.log('[Hero Upload] File selection complete')
    }
    if (heroFileInputRef.current) {
      heroFileInputRef.current.value = ''
    }
  }

  const hasHeroDraggedFiles = (dataTransfer: DataTransfer | null): boolean => {
    if (!dataTransfer) return false
    return Array.from(dataTransfer.types || []).includes('Files')
  }

  const handleHeroDragEnter = (event: React.DragEvent) => {
    if (!hasHeroDraggedFiles(event.dataTransfer)) return
    event.preventDefault()
    event.stopPropagation()
    heroDragDepthRef.current += 1
    setHeroIsDragging(true)
  }

  const handleHeroDragOver = (event: React.DragEvent) => {
    if (!hasHeroDraggedFiles(event.dataTransfer)) return
    event.preventDefault()
    event.stopPropagation()
    event.dataTransfer.dropEffect = 'copy'
    setHeroIsDragging(true)
  }

  const handleHeroDragLeave = (event: React.DragEvent) => {
    if (!hasHeroDraggedFiles(event.dataTransfer)) return
    event.preventDefault()
    event.stopPropagation()
    heroDragDepthRef.current = Math.max(0, heroDragDepthRef.current - 1)
    if (heroDragDepthRef.current === 0) {
      setHeroIsDragging(false)
    }
  }

  const handleHeroDrop = async (event: React.DragEvent) => {
    if (!hasHeroDraggedFiles(event.dataTransfer)) return
    event.preventDefault()
    event.stopPropagation()
    heroDragDepthRef.current = 0
    setHeroIsDragging(false)

    if (isRequestInProgress) {
      toast({
        title: 'Upload unavailable',
        description: 'Wait for the current response to finish before adding files.',
        variant: 'destructive',
      })
      return
    }

    if (event.dataTransfer.files?.length) {
      await handleHeroFileSelect(event.dataTransfer.files)
    }
  }

  const handleRequestOcr = async (attachment: ChatAttachment, pageRangeText: string) => {
    if (!currentConversation?.id || !attachment.attachmentId) {
      toast({
        title: 'OCR unavailable',
        description: 'Refresh the chat, then try OCR again for this file.',
        variant: 'destructive',
      })
      return
    }

    const parsedRange = parsePageRangeRequest(`pages ${pageRangeText || '1-5'}`)
    if (!parsedRange) {
      toast({
        title: 'Enter a page range',
        description: 'Use a range like 120-125 or a single page like 5.',
        variant: 'destructive',
      })
      return
    }

    try {
      toast({
        title: 'OCR started',
        description: `Processing pages ${parsedRange.pageStart}-${parsedRange.pageEnd}`,
      })

      const response = await fetch('/api/attachments/ocr-pages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          attachmentId: attachment.attachmentId,
          conversationId: currentConversation.id,
          pageStart: parsedRange.pageStart,
          pageEnd: parsedRange.pageEnd,
        }),
      })

      const result = await response.json()
      if (!response.ok) {
        throw new Error(result.error || 'OCR failed')
      }

      setMessages((prev) => processMessages(prev.map((message) => ({
        ...message,
        attachments: message.attachments?.map((att) =>
          att.attachmentId === attachment.attachmentId
            ? {
                ...att,
                processingStatus: 'ocr_ready',
                ocrStatus: result.status === 'completed' ? 'completed' : att.ocrStatus,
                pageCount: result.pageCount || att.pageCount,
                ocrPagesProcessed: result.pagesProcessed || att.ocrPagesProcessed,
              }
            : att
        ),
      })), currentConversation.id))

      toast({
        title: 'OCR complete',
        description: `Saved ${result.extractedTextLength || 0} characters from selected pages.`,
      })
    } catch (error: any) {
      toast({
        title: 'OCR failed',
        description: error.message || 'Could not OCR those pages.',
        variant: 'destructive',
      })
    }
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
                  onDragEnter={handleHeroDragEnter}
                  onDragOver={handleHeroDragOver}
                  onDragLeave={handleHeroDragLeave}
                  onDrop={handleHeroDrop}
                >
                  {heroIsDragging && (
                    <div className="fixed inset-0 z-[80] bg-violet-500/10 backdrop-blur-md flex items-center justify-center p-4 pointer-events-none">
                      <div className="w-full max-w-lg rounded-3xl border-2 border-dashed border-violet-400/60 bg-[#0b0a12]/95 p-8 text-center shadow-2xl shadow-violet-950/40">
                        <Paperclip className="h-12 w-12 text-violet-300 mx-auto mb-3" />
                        <p className="text-lg font-semibold text-white">Drop files to attach</p>
                        <p className="text-gray-400 text-sm mt-1">
                          PDFs, images, Word, Excel, PowerPoint, text, CSV, JSON, ZIP, audio, and video
                        </p>
                        <p className="text-xs text-gray-500 mt-3">
                          Up to {HERO_MAX_FILES} files, {heroMaxUploadMB}MB each
                        </p>
                      </div>
                    </div>
                  )}
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
                    <div className="relative bg-white/[0.03] border border-white/[0.08] rounded-2xl md:rounded-3xl px-4 md:px-5 py-3 md:py-4 focus-within:border-white/[0.16] transition-colors">
                      <input
                        ref={heroFileInputRef}
                        type="file"
                        accept=".pdf,.txt,.md,.csv,.json,.docx,.xlsx,.pptx,.png,.jpg,.jpeg,.webp,.gif,.mp4,.webm,.mp3,.wav,.zip,.tar,.gz"
                        multiple
                        onChange={(e) => {
                          handleHeroFileSelect(e.target.files)
                          e.target.value = ''
                        }}
                        className="hidden"
                      />
                      {heroAttachments.length > 0 && (
                        <div className="text-xs text-gray-400 mb-2 px-1">
                          {heroAttachments.length} / {HERO_MAX_FILES} attachments
                        </div>
                      )}
                      {heroAttachments.length > 0 && (
                        <div className="flex gap-2 mb-3 pb-3 border-b border-white/10 overflow-x-auto">
                          {heroAttachments.map((att, idx) => (
                            <div key={idx} className="relative group shrink-0">
                              {att.type === 'image' && att.dataUrl ? (
                                <div className="h-16 w-16 md:h-20 md:w-20 rounded-xl border-2 border-white/20 bg-black/20 overflow-hidden">
                                  <img src={att.dataUrl} alt={att.name} className="h-full w-full object-cover" />
                                </div>
                              ) : (
                                <div className="h-16 w-40 md:h-20 md:w-48 rounded-xl border-2 border-white/15 bg-white/5 p-2 flex items-center gap-2">
                                  <FileText className="h-5 w-5 text-gray-400 shrink-0" />
                                  <div className="min-w-0">
                                    <p className="text-xs font-medium text-white truncate">{att.name}</p>
                                    <p className="text-[10px] text-gray-400">
                                      {att.uploadStatus === 'pending' ? 'Preparing...' :
                                       att.uploadStatus === 'uploading' ? `Uploading ${att.uploadProgress || 0}%` :
                                       att.uploadStatus === 'processing' ? 'Processing in cloud...' :
                                       att.uploadStatus === 'compressing' ? 'Compressing...' :
                                       att.uploadStatus === 'uploaded' ? 'Uploaded' :
                                       att.uploadStatus === 'failed' ? `Failed${att.uploadError ? `: ${att.uploadError}` : ''}` :
                                       att.size ? (att.size >= 1024 * 1024 ? `${(att.size / 1024 / 1024).toFixed(1)} MB` : `${(att.size / 1024).toFixed(0)} KB`) : ''}
                                    </p>
                                  </div>
                                </div>
                              )}
                              {(att.uploadStatus === 'uploading' || att.uploadStatus === 'processing') && (
                                <div className="absolute bottom-0 left-0 right-0 h-1 bg-white/10 rounded-b-xl overflow-hidden">
                                  <div className={cn('h-full transition-all', att.uploadStatus === 'processing' ? 'bg-amber-400' : 'bg-violet-500')} style={{ width: `${att.uploadProgress || 0}%` }} />
                                </div>
                              )}
                              <button
                                type="button"
                                onClick={() => setHeroAttachments(prev => prev.filter((_, i) => i !== idx))}
                                className="absolute -top-2 -right-2 h-5 w-5 bg-red-500 hover:bg-red-600 rounded-full flex items-center justify-center shadow-lg"
                              >
                                <X className="h-3 w-3 text-white" />
                              </button>
                            </div>
                          ))}
                        </div>
                      )}
                      <div className="flex items-end gap-3">
                        <button
                          type="button"
                          onClick={() => {
                            if (process.env.NODE_ENV !== 'production') {
                              console.log('[Hero Upload] Paperclip clicked, fileInput exists:', !!heroFileInputRef.current)
                            }
                            heroFileInputRef.current?.click()
                          }}
                          disabled={isRequestInProgress}
                          className="shrink-0 mb-1 text-gray-500 hover:text-gray-300 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                          title="Attach files"
                        >
                          <Paperclip className="h-[18px] w-[18px] md:h-5 md:w-5" />
                        </button>
                        <textarea
                          ref={heroTextareaRef}
                          value={heroInput}
                          onChange={(e) => {
                            setHeroInput(e.target.value)
                            e.target.style.height = 'auto'
                            e.target.style.height = `${Math.min(e.target.scrollHeight, 160)}px`
                          }}
                          onPaste={async (e) => {
                            const items = e.clipboardData?.items
                            if (!items) return
                            const imageFiles: File[] = []
                            for (const item of Array.from(items)) {
                              if (item.type.startsWith('image/')) {
                                const file = item.getAsFile()
                                if (file) imageFiles.push(file)
                              }
                            }
                            if (imageFiles.length > 0) {
                              e.preventDefault()
                              const remaining = HERO_MAX_FILES - heroAttachments.length
                              const filesToProcess = imageFiles.slice(0, remaining)
                              await Promise.all(filesToProcess.map(file => heroProcessFile(file)))
                            }
                          }}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' && !e.shiftKey) {
                              e.preventDefault()
                              const hasActiveHeroUpload = heroAttachments.some(a => a.uploadStatus === 'pending' || a.uploadStatus === 'uploading' || a.uploadStatus === 'processing' || a.uploadStatus === 'compressing')
                              if ((heroInput.trim() || heroAttachments.length > 0) && !isRequestInProgress && !hasActiveHeroUpload) {
                                const readyAttachments = heroAttachments.filter(a => a.uploadStatus !== 'failed')
                                const content = heroInput.trim() || (readyAttachments.length > 0 ? 'Please analyze the attached file.' : '')
                                handleSendMessage(content, readyAttachments.length > 0 ? readyAttachments : undefined)
                                setHeroInput('')
                                setHeroAttachments([])
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
                          type="button"
                          onClick={() => {
                            const hasActiveHeroUpload = heroAttachments.some(a => a.uploadStatus === 'pending' || a.uploadStatus === 'uploading' || a.uploadStatus === 'processing' || a.uploadStatus === 'compressing')
                            if ((heroInput.trim() || heroAttachments.length > 0) && !isRequestInProgress && !hasActiveHeroUpload) {
                              const readyAttachments = heroAttachments.filter(a => a.uploadStatus !== 'failed')
                              const content = heroInput.trim() || (readyAttachments.length > 0 ? 'Please analyze the attached file.' : '')
                              handleSendMessage(content, readyAttachments.length > 0 ? readyAttachments : undefined)
                              setHeroInput('')
                              setHeroAttachments([])
                              if (heroTextareaRef.current) heroTextareaRef.current.style.height = 'auto'
                            }
                          }}
                          disabled={(!heroInput.trim() && heroAttachments.length === 0) || isRequestInProgress || heroAttachments.some(a => a.uploadStatus === 'pending' || a.uploadStatus === 'uploading' || a.uploadStatus === 'processing' || a.uploadStatus === 'compressing')}
                          className="bg-violet-600 hover:bg-violet-500 h-8 w-8 md:h-9 md:w-9 rounded-xl shrink-0 flex items-center justify-center transition-all disabled:opacity-30 disabled:cursor-not-allowed mb-0.5"
                        >
                          {isRequestInProgress || heroAttachments.some(a => a.uploadStatus === 'pending' || a.uploadStatus === 'uploading' || a.uploadStatus === 'processing') ? (
                            <Loader2 className="h-3.5 w-3.5 md:h-4 md:w-4 text-white animate-spin" />
                          ) : (
                            <Send className="h-3.5 w-3.5 md:h-4 md:w-4 text-white" />
                          )}
                        </button>
                      </div>
                      {/* Reasoning selector in hero input */}
                      <div className="flex items-center mt-2.5 pt-2 border-t border-white/[0.05]">
                        <ReasoningSelector
                          selectedMode={reasoningMode}
                          onSelectMode={setReasoningMode}
                          disabled={isRequestInProgress}
                        />
                      </div>
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
                  {displayedMessages.map((message) => {
                    const artifactForMessage = message.artifact || (artifactMessageId === message.id ? activeArtifact : null)

                    return (
                      <MessageBubble
                        key={message.id}
                        role={message.role}
                        content={message.content}
                        model={message.model}
                        attachments={message.attachments}
                        hasArtifact={!!artifactForMessage}
                        artifact={artifactForMessage}
                        onOpenArtifact={artifactForMessage ? handleOpenArtifact : undefined}
                        statusLabel={message.statusLabel}
                        onRequestOcr={handleRequestOcr}
                      />
                    )
                  })}
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
            conversationId={currentConversation?.id || null}
            reasoningMode={reasoningMode}
            onReasoningModeChange={setReasoningMode}
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
