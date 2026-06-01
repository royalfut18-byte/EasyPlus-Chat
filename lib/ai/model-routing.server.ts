import 'server-only'

import { AI_MODELS, type AIModel } from '@/types/models'

export type AIProvider = 'anthropic' | 'google' | 'nvidia'

export interface InternalAIModel extends AIModel {
  provider: AIProvider
  bedrockModelId?: string
  geminiModelId?: string
}

const INTERNAL_AI_MODELS: InternalAIModel[] = [
  {
    ...AI_MODELS[0],
    provider: 'anthropic',
    bedrockModelId: 'au.anthropic.claude-opus-4-6-v1',
  },
  {
    ...AI_MODELS[1],
    provider: 'anthropic',
    bedrockModelId: 'global.anthropic.claude-opus-4-5-20251101-v1:0',
  },
  {
    ...AI_MODELS[2],
    provider: 'google',
    geminiModelId: 'gemini-2.5-flash',
  },
  {
    ...AI_MODELS[3],
    provider: 'nvidia',
  },
]

const LEGACY_MODEL_IDS: Record<string, string> = {
  'claude-opus-4.6': 'claude-opus-4.8',
  'claude-opus-4.7': 'claude-opus-4.8',
  'claude-haiku-4.5': 'chat-gpt-5.5',
  'gemini-2.5-flash': 'gemini-3.1-pro',
  'deepseek-ai/deepseek-v4-pro': 'deepseek-v4-pro',
  'easyplus-max': 'claude-opus-4.8',
  'easyplus-fast': 'chat-gpt-5.5',
  'easyplus-pro': 'gemini-3.1-pro',
  'epm-7f3a9c': 'claude-opus-4.8',
  'epm-b1d4e8': 'chat-gpt-5.5',
  'epm-c6a275': 'gemini-3.1-pro',
}

export function toPublicModelId(modelId: unknown): string {
  if (typeof modelId !== 'string') return ''
  return LEGACY_MODEL_IDS[modelId] || modelId
}

export function getInternalModel(modelId: string): InternalAIModel | undefined {
  const publicId = toPublicModelId(modelId)
  return INTERNAL_AI_MODELS.find((model) => model.id === publicId)
}

export function getPublicModelName(modelId: string): string {
  return getInternalModel(modelId)?.name || 'EasyPlus'
}

export function isModelAvailable(modelId: string): boolean {
  const model = getInternalModel(modelId)
  if (!model) return false
  if (model.provider !== 'nvidia') return true
  return Boolean(process.env.DEEPSEEK_V4_PRO_API_KEY || process.env.NVIDIA_API_KEY)
}

export async function getAvailablePublicModelIds(): Promise<string[]> {
  return INTERNAL_AI_MODELS.filter((model) => isModelAvailable(model.id)).map((model) => model.id)
}

export function sanitizeConversation<T extends Record<string, any>>(conversation: T): T {
  return {
    ...conversation,
    model_used: toPublicModelId(conversation.model_used),
  }
}

export function sanitizeMessage<T extends Record<string, any>>(message: T): T {
  return {
    ...message,
    model: toPublicModelId(message.model),
  }
}
