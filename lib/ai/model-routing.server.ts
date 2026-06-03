import 'server-only'

import { AI_MODELS, PUBLIC_MODEL_CAPABILITIES, type AIModel } from '@/types/models'
import { getAzureDeepSeekDiagnostics } from '@/lib/ai/azure-deepseek.server'
import { getAzureGpt54Diagnostics } from '@/lib/ai/azure-gpt54.server'
import { isAzureImageAvailable } from '@/lib/ai/azure-image.server'
import { readServerEnv } from '@/lib/server-env'
import { isR2Configured } from '@/lib/storage/r2'

export type AIProvider = 'anthropic' | 'google' | 'azure-gpt54' | 'azure-deepseek' | 'image'

export interface InternalAIModel extends AIModel {
  provider: AIProvider
  bedrockModelId?: string
  geminiModelId?: string
}

export interface ResolvedInternalAIModel extends InternalAIModel {
  originalProvider: AIProvider
  fallbackActive: boolean
  adminDiagnostic?: string
  publicError?: string
}

const INTERNAL_AI_MODELS: InternalAIModel[] = [
  {
    ...AI_MODELS[0],
    provider: 'azure-gpt54',
  },
  {
    ...AI_MODELS[1],
    provider: 'azure-gpt54',
  },
  {
    ...AI_MODELS[2],
    provider: 'google',
    geminiModelId: 'gemini-2.5-flash',
  },
  {
    ...AI_MODELS[3],
    provider: 'azure-gpt54',
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

function hasConfiguredEnv(names: string[]): boolean {
  return names.every((name) => Boolean(readServerEnv(name)))
}

function isAzureGpt54Configured(): boolean {
  return hasConfiguredEnv([
    'AZURE_GPT54_API_KEY',
    'AZURE_GPT54_BASE_URL',
    'AZURE_GPT54_MODEL',
  ])
}

function isAzureDeepSeekConfigured(): boolean {
  return hasConfiguredEnv([
    'AZURE_DEEPSEEK_API_KEY',
    'AZURE_DEEPSEEK_BASE_URL',
    'AZURE_DEEPSEEK_MODEL',
  ])
}

function resolveModel(
  model: InternalAIModel,
  provider: AIProvider,
  overrides: Partial<Omit<ResolvedInternalAIModel, keyof InternalAIModel | 'originalProvider'>> = {}
): ResolvedInternalAIModel {
  return {
    ...model,
    provider,
    originalProvider: model.provider,
    fallbackActive: false,
    ...overrides,
  }
}

async function resolveAzureTextModel(model: InternalAIModel): Promise<ResolvedInternalAIModel> {
  const gpt54Configured = isAzureGpt54Configured()
  if (gpt54Configured) {
    const gpt54Diagnostics = await getAzureGpt54Diagnostics()
    if (gpt54Diagnostics.probeOk) {
      return resolveModel(model, 'azure-gpt54')
    }
  }

  const deepSeekConfigured = isAzureDeepSeekConfigured()
  if (deepSeekConfigured) {
    const deepSeekDiagnostics = await getAzureDeepSeekDiagnostics()
    if (deepSeekDiagnostics.probeOk) {
      return resolveModel(model, 'azure-deepseek', {
        fallbackActive: true,
        adminDiagnostic: gpt54Configured
          ? 'GPT-5.4 unavailable, using DeepSeek fallback'
          : 'GPT-5.4 missing, using DeepSeek fallback',
      })
    }
  }

  return resolveModel(model, model.provider, {
    adminDiagnostic: gpt54Configured
      ? deepSeekConfigured
        ? 'GPT-5.4 unavailable and DeepSeek fallback unavailable'
        : 'GPT-5.4 unavailable and DeepSeek fallback is not configured'
      : deepSeekConfigured
        ? 'GPT-5.4 missing and DeepSeek fallback unavailable'
        : 'GPT-5.4 missing and DeepSeek fallback is not configured',
    publicError: 'Model provider is not configured.',
  })
}

export function toPublicModelId(modelId: unknown): string {
  if (typeof modelId !== 'string') return ''
  return LEGACY_MODEL_IDS[modelId] || modelId
}

export function getInternalModel(modelId: string): InternalAIModel | undefined {
  const publicId = toPublicModelId(modelId)
  return INTERNAL_AI_MODELS.find((model) => model.id === publicId)
}

export async function getResolvedInternalModel(modelId: string): Promise<ResolvedInternalAIModel | undefined> {
  const model = getInternalModel(modelId)
  if (!model) return undefined
  if (model.provider === 'azure-gpt54') return resolveAzureTextModel(model)
  return resolveModel(model, model.provider)
}

export function getPublicModelName(modelId: string): string {
  return getInternalModel(modelId)?.name || 'EasyPlus'
}

export async function isChatModelAvailable(modelId: string): Promise<boolean> {
  const model = await getResolvedInternalModel(modelId)
  return Boolean(model && model.provider !== 'image' && !model.publicError)
}

export async function getAvailablePublicModelIds(): Promise<string[]> {
  const availableModels = await Promise.all(INTERNAL_AI_MODELS.map(async (model) => {
    if (model.provider === 'image') {
      const configured = Boolean(
        readServerEnv('AZURE_IMAGE_API_KEY') &&
        readServerEnv('AZURE_IMAGE_BASE_URL') &&
        isR2Configured()
      )
      return configured && await isAzureImageAvailable()
    }

    if (model.provider === 'azure-gpt54') {
      const resolved = await getResolvedInternalModel(model.id)
      return Boolean(resolved && !resolved.publicError)
    }

    return true
  }))

  return INTERNAL_AI_MODELS
    .filter((_, index) => availableModels[index])
    .map((model) => model.id)
}

export async function getPublicChatRoutingDiagnostics() {
  const gpt54Configured = isAzureGpt54Configured()
  if (gpt54Configured) {
    const gpt54Diagnostics = await getAzureGpt54Diagnostics()
    if (gpt54Diagnostics.probeOk) {
      return {
        effectiveProvider: 'azure-gpt54' as const,
        fallbackActive: false,
        safeReason: 'GPT-5.4 active',
      }
    }
  }

  const deepSeekConfigured = isAzureDeepSeekConfigured()
  if (deepSeekConfigured) {
    const deepSeekDiagnostics = await getAzureDeepSeekDiagnostics()
    if (deepSeekDiagnostics.probeOk) {
      return {
        effectiveProvider: 'azure-deepseek' as const,
        fallbackActive: true,
        safeReason: gpt54Configured
          ? 'GPT-5.4 unavailable, using DeepSeek fallback'
          : 'GPT-5.4 missing, using DeepSeek fallback',
      }
    }
  }

  return {
    effectiveProvider: null,
    fallbackActive: false,
    safeReason: 'Model provider is not configured.',
  }
}

export function getPublicModelCapabilities() {
  return PUBLIC_MODEL_CAPABILITIES
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
