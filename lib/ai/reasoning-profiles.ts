export type ReasoningMode = 'instant' | 'thinking' | 'extended'

export interface ReasoningProfile {
  label: string
  emoji: string
  description: string
  maxTokens: number
  retrievalDepth: 'low' | 'medium' | 'high'
  memoryLimit: number
  enableWebSearch: boolean
  enableOCRFallback: boolean
  enableArtifactsPlanning: boolean
  reasoningEffort: 'low' | 'medium' | 'high'
  chunkLimit: number
  temperature: number
  contextBudget: number
  systemPromptStyle: 'concise' | 'balanced' | 'analytical'
}

export const REASONING_PROFILES: Record<ReasoningMode, ReasoningProfile> = {
  instant: {
    label: 'Instant',
    emoji: '⚡',
    description: 'Fastest responses with lighter reasoning',
    maxTokens: 2500,
    retrievalDepth: 'low',
    memoryLimit: 3,
    enableWebSearch: false,
    enableOCRFallback: false,
    enableArtifactsPlanning: false,
    reasoningEffort: 'low',
    chunkLimit: 3,
    temperature: 0.7,
    contextBudget: 8000,
    systemPromptStyle: 'concise',
  },
  thinking: {
    label: 'Thinking',
    emoji: '🧠',
    description: 'Balanced speed and reasoning',
    maxTokens: 8000,
    retrievalDepth: 'medium',
    memoryLimit: 10,
    enableWebSearch: true,
    enableOCRFallback: true,
    enableArtifactsPlanning: true,
    reasoningEffort: 'medium',
    chunkLimit: 8,
    temperature: 0.5,
    contextBudget: 24000,
    systemPromptStyle: 'balanced',
  },
  extended: {
    label: 'Extended Thinking',
    emoji: '🚀',
    description: 'Deepest reasoning and strongest context usage',
    maxTokens: 16384,
    retrievalDepth: 'high',
    memoryLimit: 20,
    enableWebSearch: true,
    enableOCRFallback: true,
    enableArtifactsPlanning: true,
    reasoningEffort: 'high',
    chunkLimit: 20,
    temperature: 0.3,
    contextBudget: 48000,
    systemPromptStyle: 'analytical',
  },
}

export function getReasoningProfile(mode: ReasoningMode): ReasoningProfile {
  return REASONING_PROFILES[mode]
}

export function getReasoningSystemAddendum(mode: ReasoningMode): string {
  switch (mode) {
    case 'instant':
      return `\n\nREASONING MODE: Instant
- Be concise and direct. Prioritize speed over exhaustive detail.
- Give the answer first, then briefly explain if needed.
- Skip lengthy preambles, step-by-step breakdowns, or unnecessary qualifications.
- If the answer is straightforward, just state it.`

    case 'thinking':
      return `\n\nREASONING MODE: Thinking
- Balance thoroughness with clarity.
- Show your reasoning where it aids understanding.
- Provide context and detail where useful, but don't over-explain simple things.`

    case 'extended':
      return `\n\nREASONING MODE: Extended Thinking
- Engage in deep, systematic analysis.
- Break down complex problems step-by-step.
- Consider edge cases and verify your reasoning.
- Cross-reference available context thoroughly.
- Provide comprehensive, well-structured responses.
- Double-check calculations and factual claims.
- If multiple interpretations exist, explore them before concluding.`

    default:
      return ''
  }
}
