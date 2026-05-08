export interface AIModel {
  id: string
  name: string
  provider: 'anthropic' | 'google' | 'openai'
  bedrockModelId: string
  costPerMessage: number
  color: string
  icon: string
}

export const AI_MODELS: AIModel[] = [
  {
    id: 'claude-opus-4.6',
    name: 'Claude Opus 4.6',
    provider: 'anthropic',
    bedrockModelId: 'au.anthropic.claude-opus-4-6-v1',
    costPerMessage: 50,
    color: '#FF6B35',
    icon: '🔥',
  },
]

export interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
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
}
