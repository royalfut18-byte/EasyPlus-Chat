import 'server-only'

import { AI_MODELS, type AIModel } from '@/types/models'
import { isAzureDeepSeekAvailable } from '@/lib/ai/azure-deepseek.server'
import { isAzureImageAvailable } from '@/lib/ai/azure-image.server'
import { readServerEnv } from '@/lib/server-env'
import { isR2Configured } from '@/lib/storage/r2'

export type AIProvider = 'anthropic' | 'google' | 'azure' | 'image'

export interface InternalAIModel extends AIModel {
  provider: AIProvider
  bedrockModelId?: string
  geminiModelId?: string
}

const INTERNAL_AI_MODELS: InternalAIModel[] = [
  {
    ...AI_MODELS[0],
    provider: 'azure',
  },
  {
    ...AI_MODELS[1],
    provider: 'azure',
  },
  {
    ...AI_MODELS[2],
    provider: 'google',
    geminiModelId: 'gemini-2.5-flash',
  },
  {
    ...AI_MODELS[3],
    provider: 'azure',
  },
  {
    ...AI_MODELS[4],
    provider: 'image',
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
  if (model.provider === 'azure') {
    return Boolean(readServerEnv('AZURE_DEEPSEEK_API_KEY') && readServerEnv('AZURE_DEEPSEEK_BASE_URL'))
  }
  if (model.provider === 'image') {
    return Boolean(
      readServerEnv('AZURE_IMAGE_API_KEY') &&
      readServerEnv('AZURE_IMAGE_BASE_URL') &&
      isR2Configured()
    )
  }
  return true
}

export function isChatModelAvailable(modelId: string): boolean {
  const model = getInternalModel(modelId)
  return Boolean(model && model.provider !== 'image' && isModelAvailable(modelId))
}

export async function getAvailablePublicModelIds(): Promise<string[]> {
  const availableModels = await Promise.all(INTERNAL_AI_MODELS.map(async (model) => {
    if (!isModelAvailable(model.id)) return false
    if (model.provider === 'azure') return isAzureDeepSeekAvailable()
    if (model.provider === 'image') return isAzureImageAvailable()
    return true
  }))

  return INTERNAL_AI_MODELS.filter((_, index) => availableModels[index]).map((model) => model.id)
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
