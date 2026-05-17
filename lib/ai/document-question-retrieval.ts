export interface QuestionExcerptMatch {
  questionNumber: number
  matchIndex: number
  excerpt: string
}

function questionStartPatterns(questionNumber: number): RegExp[] {
  const n = String(questionNumber)
  return [
    new RegExp(`(?:^|[\\r\\n])\\s*(?:question\\s+|q\\s*)?${n}\\s*[\\).:\\-]`, 'i'),
    new RegExp(`\\b(?:question|q)\\s*${n}\\b`, 'i'),
    new RegExp(`(?:^|[\\r\\n])\\s*${n}\\s+`, 'i'),
  ]
}

export function findQuestionNumberIndex(text: string, questionNumber: number): number {
  if (!text || !Number.isFinite(questionNumber) || questionNumber <= 0) return -1

  let bestIndex = -1
  for (const pattern of questionStartPatterns(questionNumber)) {
    const match = pattern.exec(text)
    if (!match || typeof match.index !== 'number') continue

    const index = Math.max(0, match.index)
    if (bestIndex === -1 || index < bestIndex) {
      bestIndex = index
    }
  }

  return bestIndex
}

export function containsQuestionNumber(text: string, questionNumber: number): boolean {
  return findQuestionNumberIndex(text, questionNumber) >= 0
}

export function extractQuestionNumberExcerpt(
  text: string,
  questionNumber: number,
  options: { beforeChars?: number; maxChars?: number } = {}
): QuestionExcerptMatch | null {
  const matchIndex = findQuestionNumberIndex(text, questionNumber)
  if (matchIndex < 0) return null

  const beforeChars = options.beforeChars ?? 250
  const maxChars = options.maxChars ?? 3600
  const contextStart = Math.max(0, matchIndex - beforeChars)
  const searchStart = Math.min(text.length, matchIndex + 1)
  const nextIndex = findQuestionNumberIndex(text.slice(searchStart), questionNumber + 1)
  const naturalEnd = nextIndex >= 0 ? searchStart + nextIndex : matchIndex + maxChars
  const contextEnd = Math.min(text.length, naturalEnd, matchIndex + maxChars)

  return {
    questionNumber,
    matchIndex,
    excerpt: text.slice(contextStart, contextEnd).trim(),
  }
}

export function compactPreview(text: string, maxChars = 180): string {
  return text.replace(/\s+/g, ' ').trim().slice(0, maxChars)
}
