export interface AzureProviderEnvStatus {
  apiKey: { exists: boolean; configured: boolean }
  baseUrl: { exists: boolean; configured: boolean }
  model: { exists: boolean; configured: boolean }
}

export interface AzureTextProviderConfigSnapshot {
  provider: 'azure-gpt54' | 'azure-deepseek'
  apiKeyConfigured: boolean
  baseUrlConfigured: boolean
  modelConfigured: boolean
  endpointHost: string | null
  endpointPath: string
  model: string
  envStatus: AzureProviderEnvStatus
}

export class AzureTextProviderError extends Error {
  readonly provider: 'azure-gpt54' | 'azure-deepseek'
  readonly status: number | null
  readonly timeoutHit: boolean
  readonly safeReason: string
  readonly providerErrorCode: string | null
  readonly providerErrorMessage: string | null
  readonly endpointHost: string | null
  readonly endpointPath: string
  readonly model: string
  readonly envStatus: AzureProviderEnvStatus
  readonly envConfigured: boolean

  constructor(
    message: string,
    options: {
      provider: 'azure-gpt54' | 'azure-deepseek'
      status?: number | null
      timeoutHit?: boolean
      safeReason: string
      providerErrorCode?: string | null
      providerErrorMessage?: string | null
      endpointHost: string | null
      endpointPath: string
      model: string
      envStatus: AzureProviderEnvStatus
      envConfigured: boolean
    }
  ) {
    super(message)
    this.name = 'AzureTextProviderError'
    this.provider = options.provider
    this.status = options.status ?? null
    this.timeoutHit = Boolean(options.timeoutHit)
    this.safeReason = options.safeReason
    this.providerErrorCode = options.providerErrorCode ?? null
    this.providerErrorMessage = options.providerErrorMessage ?? null
    this.endpointHost = options.endpointHost
    this.endpointPath = options.endpointPath
    this.model = options.model
    this.envStatus = options.envStatus
    this.envConfigured = options.envConfigured
  }
}

export function isAzureTextProviderError(error: unknown): error is AzureTextProviderError {
  return error instanceof AzureTextProviderError
}
