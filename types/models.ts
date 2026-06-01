export interface AIModel {
  id: string
  name: string
  description?: string
  tier: 'max' | 'fast' | 'pro' | 'image'
  costPerMessage: number
  color: string
}

export const AI_MODELS: AIModel[] = [
  {
    id: 'claude-opus-4.8',
    name: 'Claude Opus 4.8',
    tier: 'max',
    costPerMessage: 50,
    color: '#d97757',
  },
  {
    id: 'chat-gpt-5.5',
    name: 'Chat GPT 5.5',
    tier: 'fast',
    costPerMessage: 15,
    color: '#10b981',
  },
  {
    id: 'gemini-3.1-pro',
    name: 'Gemini 3.1 Pro',
    tier: 'pro',
    costPerMessage: 15,
    color: '#4285f4',
  },
  {
    id: 'deepseek-v4-pro',
    name: 'DeepSeek V4 Pro',
    description: 'Advanced coding, reasoning, and long-context project work.',
    tier: 'pro',
    costPerMessage: 15,
    color: '#a78bfa',
  },
  {
    id: 'image-generation',
    name: 'Image Generation',
    description: 'Create high-quality images from detailed prompts.',
    tier: 'image',
    costPerMessage: 0,
    color: '#ec4899',
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
  storageProvider?: 'supabase' | 'r2'
  storageKey?: string
  attachmentId?: string
  processingStatus?: string
  ocrStatus?: string
  pageCount?: number
  ocrPagesProcessed?: number[]
  clientUploadId?: string
  uploadProgress?: number
  uploadStatus?: 'pending' | 'compressing' | 'uploading' | 'processing' | 'uploaded' | 'failed'
  uploadError?: string
  generated?: boolean
  generatedFiles?: string[]
  createdAt?: string
}

export interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
  attachments?: ChatAttachment[]
}

export type ReasoningMode = 'instant' | 'thinking' | 'extended'

export interface Conversation {
  id: string
  user_id: string
  title: string
  model_used: string
  reasoning_mode?: ReasoningMode
  project_id?: string | null
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
  updated_at?: string | null
  order_index?: number | null
  attachments?: ChatAttachment[]
  client_message_id?: string | null
  request_id?: string | null
  status?: string | null
  parent_message_id?: string | null
  // Local-only metadata for artifact support (not in Supabase)
  artifact?: Artifact | null
  displayContent?: string
  // UI-only status label (never saved to DB, never sent to model)
  statusLabel?: string | null
}

export interface Artifact {
  id: string
  title: string
  language: 'html' | 'tsx' | 'jsx' | 'javascript' | 'typescript' | 'css' | 'python' | 'markdown' | 'json' | 'svg' | 'text' | 'docx' | 'xlsx' | 'pptx' | 'gdoc' | 'gsheet' | 'gslides' | 'canva'
  code: string
  explanation?: string
  createdAt: string
}
