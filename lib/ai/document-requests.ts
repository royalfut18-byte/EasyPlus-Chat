export interface PageRangeRequest {
  pageStart: number
  pageEnd: number
}

const NUMBER_WORDS: Record<string, number> = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
}

export function parseQuestionNumberRequest(message: string): number | null {
  const normalized = message
    .toLowerCase()
    .replace(/\u2019/g, "'")
    .replace(/[\u2013\u2014]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()

  const patterns = [
    /\bq(?:uestion)?\s*#?\s*(\d{1,3})\b/i,
    /\b(?:do|solve|answer|explain|calculate|find|work\s*out|help\s+with)\s+(?:the\s+)?(?:question\s+|q\s*)?(\d{1,3})\b/i,
    /\bwhat(?:'s| is)?\s+(?:the\s+)?answer\s+(?:to|for)\s+(?:question\s+|q\s*)?(\d{1,3})\b/i,
    /\b(?:answer|solution)\s+(?:to|for)\s+(?:question\s+|q\s*)?(\d{1,3})\b/i,
  ]

  for (const pattern of patterns) {
    const match = normalized.match(pattern)
    if (!match) continue

    const questionNumber = Number.parseInt(match[1], 10)
    if (Number.isFinite(questionNumber) && questionNumber > 0 && questionNumber < 1000) {
      return questionNumber
    }
  }

  return null
}

export function isDocumentFollowUpRequest(message: string): boolean {
  if (parseQuestionNumberRequest(message) || parsePageRangeRequest(message)) return true

  return /\b(question\s+(?:one|two|three|four|five|six|seven|eight|nine|ten)|chapter\s+\d+(?:\.\d+)?|next\s+(?:one|question)|do\s+the\s+next\s+one|previous\s+(?:one|question)|the\s+(?:pdf|document|file|worksheet|attachment)|uploaded\s+(?:pdf|document|file)|what\s+(?:pdf|document|file)\s+did\s+i\s+upload|continue|do\s+(?:q|question)|solve\s+(?:q|question)|ocr\s+(?:pages?|the\s+first)|pages?\s+\d+)\b/i.test(message)
}

export function parsePageRangeRequest(message: string, maxPages = 10): PageRangeRequest | null {
  const normalized = message.toLowerCase().replace(/[–—]/g, '-')

  const firstPages = normalized.match(/\b(?:ocr|read|scan)?\s*(?:the\s+)?first\s+(\d+|one|two|three|four|five|six|seven|eight|nine|ten)\s+pages?\b/)
  if (firstPages) {
    const count = NUMBER_WORDS[firstPages[1]] || Number.parseInt(firstPages[1], 10)
    if (Number.isFinite(count) && count > 0) {
      return { pageStart: 1, pageEnd: Math.min(count, maxPages) }
    }
  }

  const range = normalized.match(/\bpages?\s+(\d{1,4})\s*(?:-|to|through)\s*(\d{1,4})\b/)
  if (range) {
    const start = Number.parseInt(range[1], 10)
    const end = Number.parseInt(range[2], 10)
    if (Number.isFinite(start) && Number.isFinite(end) && start > 0 && end >= start) {
      return { pageStart: start, pageEnd: Math.min(end, start + maxPages - 1) }
    }
  }

  const singlePage = normalized.match(/\bpage\s+(\d{1,4})\b/)
  if (singlePage) {
    const page = Number.parseInt(singlePage[1], 10)
    if (Number.isFinite(page) && page > 0) {
      return { pageStart: page, pageEnd: page }
    }
  }

  return null
}
