export interface AIModel {
  id: string
  name: string
  provider: 'anthropic' | 'google' | 'openai'
  bedrockModelId?: string // Optional: only for Bedrock/Claude models
  geminiModelId?: string // Optional: only for Gemini models
  costPerMessage: number
  color: string
  icon?: string // Optional: for non-Anthropic models that use emoji
}

export const AI_MODELS: AIModel[] = [
  {
    id: 'claude-opus-4.6',
    name: 'Claude Opus 4.6',
    provider: 'anthropic',
    bedrockModelId: 'au.anthropic.claude-opus-4-6-v1',
    costPerMessage: 50,
    color: '#d97757', // Anthropic warm neutral
  },
  {
    id: 'claude-haiku-4.5',
    name: 'Chat GPT 5.5',
    provider: 'anthropic',
    bedrockModelId: 'global.anthropic.claude-opus-4-5-20251101-v1:0',
    costPerMessage: 15,
    color: '#10b981', // Green for fast/cheaper
  },
  {
    id: 'gemini-2.5-flash',
    name: 'Gemini 3.1 Pro',
    provider: 'google',
    geminiModelId: 'gemini-2.5-flash',
    costPerMessage: 15,
    color: '#4285f4', // Google blue
  },
]

export interface ChatAttachment {
  type: 'image' | 'document'
  name: string
  mimeType: string
  size?: number
  dataUrl?: string
  textContent?: string
  url?: string
  storagePath?: string
  bucket?: string
}

export interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
  attachments?: ChatAttachment[]
}

export interface Conversation {
  id: string
  user_id: string
  title: string
  model_used: string
  created_at: string
  updated_at: string
}

export interface Message {
  id: string
  conversation_id: string
  role: 'user' | 'assistant'
  content: string
  model: string
  created_at: string
  order_index?: number | null
  attachments?: ChatAttachment[]
  // Local-only metadata for artifact support (not in Supabase)
  artifact?: Artifact | null
  displayContent?: string
}

export interface Artifact {
  id: string
  title: string
  language: 'html' | 'tsx' | 'jsx' | 'javascript' | 'css' | 'python' | 'markdown' | 'text'
  code: string
  explanation?: string
  createdAt: string
}
