'use client'

import { useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { motion, AnimatePresence } from 'framer-motion'
import { Sparkles, Box, PanelRightOpen, Globe, BrainCircuit, Code2, MapPin, Bug, Image as ImageIcon } from 'lucide-react'
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
  const [isLoadingConversation, setIsLoadingConversation] = useState(false)
  const [userProfile, setUserProfile] = useState<any>(null)
  const [isCreatingConversation, setIsCreatingConversation] = useState(false)
  const [artifactMode, setArtifactMode] = useState(false)
  const [webSearchEnabled, setWebSearchEnabled] = useState(false)
  const [imageMode, setImageMode] = useState(false)
  const [imageAspectRatio, setImageAspectRatio] = useState<'1:1' | '16:9' | '9:16' | '4:3'>('1:1')
  const [activeArtifact, setActiveArtifact] = useState<Artifact | null>(null)
  const [isArtifactOpen, setIsArtifactOpen] = useState(false)
  const [artifactMessageId, setArtifactMessageId] = useState<string | null>(null)
  const [artifactPanelWidth, setArtifactPanelWidth] = useState(DEFAULT_PANEL_WIDTH)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const isSendingRef = useRef(false)
  const lastUserPromptRef = useRef<string>('')
  const artifactModeAtSendRef = useRef(false)
  const webSearchEnabledAtSendRef = useRef(false)
  const abortControllerRef = useRef<AbortController | null>(null)
  const selectedConversationIdRef = useRef<string | null>(null)
  const conversationRequestSeqRef = useRef(0)
  const router = useRouter()
  const supabase = createClient()

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

        setMessages(final)

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

    // Abort any previous request
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

  const handleImageGeneration = async (
    prompt: string,
    userMessageId: string,
    assistantMessageId: string,
    userCreatedAt: string,
    assistantCreatedAt: string
  ) => {
    let conversation = currentConversation

    // Create conversation if needed
    if (!conversation) {
      setIsCreatingConversation(true)
      try {
        const title = `Image: ${prompt.substring(0, 30)}...`

        const response = await fetch('/api/conversations', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title,
            model: 'image-generation',
          }),
        })

        if (!response.ok) {
          throw new Error('Failed to create conversation')
        }

        conversation = await response.json()
        setCurrentConversation(conversation)
        setConversations((prev) => [conversation!, ...prev])
        selectedConversationIdRef.current = conversation!.id
        setIsCreatingConversation(false)
      } catch (error: any) {
        console.error('[Image Gen] Failed to create conversation:', error.message)
        toast({
          title: 'Error',
          description: 'Failed to create conversation',
          variant: 'destructive',
        })
        setIsCreatingConversation(false)
        setIsLoading(false)
        isSendingRef.current = false
        return
      }
    }

    if (!conversation) {
      setIsLoading(false)
      isSendingRef.current = false
      return
    }

    const sendConversationId = conversation.id

    // Add user message
    const userMessage: Message = {
      id: userMessageId,
      conversation_id: sendConversationId,
      role: 'user',
      content: prompt,
      model: 'image-generation',
      created_at: userCreatedAt,
    }

    setMessages((prev) => processMessages([...prev, userMessage], sendConversationId))

    // Add loading placeholder
    const assistantPlaceholder: Message = {
      id: assistantMessageId,
      conversation_id: sendConversationId,
      role: 'assistant',
      content: '🎨 Generating image...',
      model: 'image-generation',
      created_at: assistantCreatedAt,
    }

    setMessages((prev) => processMessages([...prev, assistantPlaceholder], sendConversationId))
    setIsLoading(true)

    try {
      // Get recent messages for context
      const recentMessages = messages
        .filter(m => m.conversation_id === sendConversationId)
        .filter(m => m.role === 'user' || m.role === 'assistant')
        .slice(-10)
        .map(m => ({ role: m.role, content: m.content }))

      const response = await fetch('/api/image/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt,
          model: 'nano-banana',
          aspectRatio: imageAspectRatio,
          recentMessages,
          conversationId: sendConversationId,
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
          processMessages(
            prev.map((m) =>
              m.id === assistantMessageId
                ? { ...m, content: 'Error: Insufficient credits. Please top up to continue.' }
                : m
            ),
            sendConversationId
          )
        )
        setIsLoading(false)
        isSendingRef.current = false
        return
      }

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}))
        throw new Error(errorData.error || 'Failed to generate image')
      }

      const data = await response.json()

      if (!data.success || !data.image) {
        throw new Error('No image returned')
      }

      // Update assistant message with generated image
      const imageAttachment: ChatAttachment = {
        type: 'image',
        name: `generated-${Date.now()}.png`,
        mimeType: data.image.mimeType,
        dataUrl: data.image.dataUrl,
      }

      const assistantMessage: Message = {
        id: assistantMessageId,
        conversation_id: sendConversationId,
        role: 'assistant',
        content: `Generated image for: "${prompt}"`,
        model: 'image-generation',
        created_at: assistantCreatedAt,
        attachments: [imageAttachment],
      }

      setMessages((prev) =>
        processMessages(
          prev.map((m) => (m.id === assistantMessageId ? assistantMessage : m)),
          sendConversationId
        )
      )

      loadUserProfile().catch((e) => console.error('[Image Gen] Profile load failed:', e))
    } catch (error: any) {
      console.error('[Image Gen] Error:', error.message)
      setMessages((prev) =>
        processMessages(
          prev.map((m) =>
            m.id === assistantMessageId
              ? { ...m, content: `Sorry, image generation failed: ${error.message}` }
              : m
          ),
          sendConversationId
        )
      )
      toast({
        title: 'Error',
        description: error.message || 'Failed to generate image',
        variant: 'destructive',
      })
    } finally {
      setIsLoading(false)
      isSendingRef.current = false
    }
  }

  const handleSendMessage = async (content: string, attachments?: ChatAttachment[]) => {
    // 1. Guard: Block duplicate sends at the very top
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
    const requestArtifactMode = artifactMode
    const requestWebSearchEnabled = webSearchEnabled
    const requestImageMode = imageMode

    const sentAt = new Date()
    const userCreatedAt = sentAt.toISOString()
    const assistantCreatedAt = new Date(sentAt.getTime() + 1).toISOString()

    // Handle image generation mode separately
    if (requestImageMode) {
      return handleImageGeneration(trimmedContent, clientUserMessageId, clientAssistantMessageId, userCreatedAt, assistantCreatedAt)
    }

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
    const assistantPlaceholder: Message = {
      id: clientAssistantMessageId,
      conversation_id: sendConversationId,
      role: 'assistant',
      content: requestArtifactMode ? ARTIFACT_LOADING_MARKER : ASSISTANT_LOADING_MARKER,
      model: modelToUse,
      created_at: assistantCreatedAt, // Use the +1ms timestamp
    }

    setMessages((prev) => processMessages([...prev, assistantPlaceholder], sendConversationId))

    try {
      // 7. Prepare messages for API (exclude artifact metadata and loading markers)
      const isLoadingMarker = (content: string) => {
        return content === ARTIFACT_LOADING_MARKER || content === ASSISTANT_LOADING_MARKER
      }

      // Get recent conversation context (last 16 messages)
      const contextMessages = messages
        .filter(m => m.conversation_id === sendConversationId) // Only same conversation
        .filter(m => m.role === 'user' || m.role === 'assistant')
        .filter(m => m.content && !isLoadingMarker(m.content)) // Exclude empty and loading markers
        .slice(-16) // Last 16 messages for context

      const messagesToSend = [...contextMessages, userMessage].map((m) => ({
        role: m.role,
        content: m.content,
        attachments: m.attachments,
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
        }),
      })

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
        let errorMessage = 'Failed to send message'
        try {
          const errorData = await response.json()
          errorMessage = errorData.error || errorMessage
        } catch (e) {
          // ignore
        }
        throw new Error(errorMessage)
      }

      // 9. Stream response and update assistant message by ID only
      const reader = response.body?.getReader()
      const decoder = new TextDecoder()
      let assistantContent = ''

      while (reader) {
        const { done, value } = await reader.read()
        if (done) break

        const chunk = decoder.decode(value)
        assistantContent += chunk

        // Update by ID only - no new messages, only if still on this conversation
        if (selectedConversationIdRef.current === sendConversationId) {
          setMessages((prev) =>
            processMessages(
              prev.map((m) =>
                m.id === clientAssistantMessageId ? { ...m, content: assistantContent } : m
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

      loadUserProfile().catch((e) => console.error('[Chat] Profile load failed:', e))
      if (messages.length === 0) {
        loadConversations().catch((e) => console.error('[Chat] Conversations load failed:', e))
      }
    } catch (error: any) {
      console.error('[Chat] Send message error:', error.message)
      if (selectedConversationIdRef.current === sendConversationId) {
        setMessages((prev) =>
          processMessages(
            prev.map((m) =>
              m.id === clientAssistantMessageId
                ? { ...m, content: `Sorry, something went wrong: ${error.message}` }
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
    } finally {
      setIsLoading(false)
      setIsCreatingConversation(false)
      isSendingRef.current = false
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
    // Turn off Image mode if Artifact mode is turned on
    if (newArtifactMode) {
      setImageMode(false)
    }
  }

  const handleToggleImageMode = () => {
    if (isLoading || isCreatingConversation || isSendingRef.current) {
      return
    }
    const newImageMode = !imageMode
    setImageMode(newImageMode)
    // Turn off Artifact mode if Image mode is turned on
    if (newImageMode) {
      setArtifactMode(false)
    }
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
      <div className="min-h-screen bg-[#0A0A0F] flex items-center justify-center">
        <div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full" />
      </div>
    )
  }

  const isRequestInProgress = isLoading || isCreatingConversation || isSendingRef.current
  const showReopenButton = currentConversation && activeArtifact && !isArtifactOpen

  // Process messages before rendering - filter by current conversation ID as final safety
  const activeConversationId = currentConversation?.id || null
  const displayedMessages = processMessages(messages, activeConversationId)

  return (
    <div className="h-[100dvh] md:h-screen bg-[#0A0A0F] flex overflow-hidden">
      <Sidebar
        conversations={conversations}
        currentConversationId={currentConversation?.id}
        onSelectConversation={handleSelectConversation}
        onNewChat={handleNewChat}
        onDeleteConversation={handleDeleteConversation}
        userProfile={userProfile}
      />

      {/* Main content + artifact panel flex container */}
      <div className="flex min-w-0 flex-1 overflow-hidden ml-0 md:ml-80">
        {/* Chat section */}
        <main className="flex min-w-0 flex-1 flex-col overflow-hidden h-full">
        <div className="border-b border-white/10 bg-[#0A0A0F]/90 backdrop-blur-sm md:backdrop-blur-xl">
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
                  className="px-2 md:px-3 py-2 h-10 rounded-lg text-xs md:text-sm font-medium transition-all flex items-center gap-1.5 glass hover:bg-white/10 text-gray-300 hover:text-white border border-white/20"
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
                  'px-2 md:px-3 py-2 h-10 rounded-lg text-xs md:text-sm font-medium transition-all flex items-center gap-1.5',
                  webSearchEnabled
                    ? 'bg-blue-500/20 text-blue-400 border border-blue-500/50 glow-border'
                    : 'glass hover:bg-white/10 text-gray-400',
                  isRequestInProgress && 'opacity-50 cursor-not-allowed'
                )}
              >
                <Globe className="h-4 w-4" />
                <span className="hidden sm:inline">Search</span>
                {webSearchEnabled && <span className="hidden md:inline">✓</span>}
              </button>

              <button
                onClick={handleToggleImageMode}
                disabled={isRequestInProgress}
                title={isRequestInProgress ? 'Wait for the current response to finish' : 'Toggle Image Generation'}
                className={cn(
                  'px-2 md:px-3 py-2 h-10 rounded-lg text-xs md:text-sm font-medium transition-all flex items-center gap-1.5',
                  imageMode
                    ? 'bg-green-500/20 text-green-400 border border-green-500/50 glow-border'
                    : 'glass hover:bg-white/10 text-gray-400',
                  isRequestInProgress && 'opacity-50 cursor-not-allowed'
                )}
              >
                <ImageIcon className="h-4 w-4" />
                <span className="hidden sm:inline">Image</span>
                {imageMode && <span className="hidden md:inline">✓</span>}
              </button>

              <button
                onClick={handleToggleArtifactMode}
                disabled={isRequestInProgress}
                title={isRequestInProgress ? 'Wait for the current response to finish' : 'Toggle Artifact Mode'}
                className={cn(
                  'px-2 md:px-3 py-2 h-10 rounded-lg text-xs md:text-sm font-medium transition-all flex items-center gap-1.5',
                  artifactMode
                    ? 'bg-purple-500/20 text-purple-400 border border-purple-500/50 glow-border'
                    : 'glass hover:bg-white/10 text-gray-400',
                  isRequestInProgress && 'opacity-50 cursor-not-allowed'
                )}
              >
                <Box className="h-4 w-4" />
                <span className="hidden sm:inline">Artifacts</span>
                {artifactMode && <span className="hidden md:inline">✓</span>}
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
                      { text: 'Explain quantum computing', Icon: BrainCircuit, color: 'text-purple-400' },
                      { text: 'Write a Python function', Icon: Code2, color: 'text-blue-400' },
                      { text: 'Plan a trip to Japan', Icon: MapPin, color: 'text-cyan-400' },
                      { text: 'Debug this code', Icon: Bug, color: 'text-orange-400' },
                    ].map((prompt, i) => (
                      <motion.button
                        key={i}
                        onClick={() => handleSendMessage(prompt.text)}
                        disabled={isRequestInProgress}
                        className="glass-strong p-4 md:p-5 rounded-xl text-left hover:glow-border hover:bg-white/5 transition-all disabled:opacity-50 disabled:cursor-not-allowed group"
                        whileHover={{ scale: 1.02, y: -2 }}
                        whileTap={{ scale: 0.98 }}
                      >
                        <div className={`flex h-10 w-10 items-center justify-center rounded-xl border border-white/10 bg-white/5 mb-3 ${prompt.color} group-hover:bg-white/10 transition-colors`}>
                          <prompt.Icon className="h-5 w-5" />
                        </div>
                        <p className="text-sm md:text-base text-gray-300 group-hover:text-white transition-colors">
                          {prompt.text}
                        </p>
                      </motion.button>
                    ))}
                  </div>
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
                    />
                  ))}
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
