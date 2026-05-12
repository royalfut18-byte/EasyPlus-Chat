import type { SupabaseClient } from '@supabase/supabase-js'

export interface UserMemory {
  id: string
  user_id: string
  memory_text: string
  category: string
  importance: number
  source_conversation_id: string | null
  created_at: string
  updated_at: string
}

const MEMORY_TRIGGER_PATTERNS = [
  /\bremember\s+that\b/i,
  /\bfrom\s+now\s+on\b/i,
  /\bgoing\s+forward\b/i,
  /\bmy\s+preference\s+is\b/i,
  /\bi\s+want\s+you\s+to\s+always\b/i,
  /\bthis\s+project\s+uses\b/i,
  /\beasyplus\s+should\b/i,
  /\balways\s+use\b/i,
  /\bnever\s+use\b/i,
  /\bi\s+prefer\b/i,
  /\bmy\s+stack\s+is\b/i,
  /\bi\s+am\s+building\b/i,
  /\bi('m|\s+am)\s+a\b/i,
  /\bmy\s+name\s+is\b/i,
  /\bcall\s+me\b/i,
]

const FORGET_PATTERNS = [
  /\bforget\s+(that|about|my)\b/i,
  /\bdelete\s+(that\s+)?memory\b/i,
  /\bremove\s+(that\s+)?memory\b/i,
  /\bdon'?t\s+remember\b/i,
  /\bstop\s+remembering\b/i,
]

const MEMORY_QUERY_PATTERNS = [
  /\bwhat\s+do\s+you\s+(remember|know)\s+about\s+me\b/i,
  /\bwhat\s+are\s+my\s+memories\b/i,
  /\blist\s+my\s+memories\b/i,
  /\bshow\s+my\s+memories\b/i,
  /\bwhat\s+have\s+you\s+saved\b/i,
]

const SENSITIVE_PATTERNS = [
  /\b(api[_\s]?key|secret[_\s]?key|password|token|credential|private[_\s]?key)\b/i,
  /\b(sk-|pk-|Bearer\s+)\w+/i,
  /\b[A-Za-z0-9+/]{40,}\b/,
]

export async function getUserMemories(
  supabase: SupabaseClient,
  userId: string,
  latestMessage: string
): Promise<UserMemory[]> {
  try {
    const { data, error } = await supabase
      .from('user_memories')
      .select('*')
      .eq('user_id', userId)
      .order('importance', { ascending: false })
      .order('updated_at', { ascending: false })
      .limit(20)

    if (error) {
      if (error.code === '42P01') return []
      console.error('[Memory] Failed to fetch memories:', error.message)
      return []
    }

    if (!data || data.length === 0) return []

    return rankMemories(data as UserMemory[], latestMessage)
  } catch (error: any) {
    console.error('[Memory] Error fetching memories:', error.message)
    return []
  }
}

function rankMemories(memories: UserMemory[], latestMessage: string): UserMemory[] {
  const messageWords = latestMessage.toLowerCase().split(/\s+/).filter(w => w.length > 3)

  const scored = memories.map(memory => {
    let score = memory.importance * 10

    const memoryLower = memory.memory_text.toLowerCase()
    const matchingWords = messageWords.filter(w => memoryLower.includes(w))
    score += matchingWords.length * 15

    const ageHours = (Date.now() - new Date(memory.updated_at).getTime()) / (1000 * 60 * 60)
    if (ageHours < 24) score += 10
    else if (ageHours < 168) score += 5

    if (memory.category === 'preference') score += 5
    if (memory.category === 'project') score += 5

    return { memory, score }
  })

  scored.sort((a, b) => b.score - a.score)

  return scored.slice(0, 10).map(s => s.memory)
}

export function formatMemoriesForPrompt(memories: UserMemory[]): string {
  if (!memories || memories.length === 0) return ''

  const lines = memories.map(m => `- ${m.memory_text}`)

  return `LONG-TERM MEMORY (about this user):
The following are facts you previously saved about this user. Use them to personalize your responses when relevant. Do not mention that you have a memory system unless the user asks. If a memory seems irrelevant to the current question, ignore it.

${lines.join('\n')}`
}

export function shouldExtractMemory(message: string): boolean {
  return MEMORY_TRIGGER_PATTERNS.some(pattern => pattern.test(message))
}

export function isForgetRequest(message: string): boolean {
  return FORGET_PATTERNS.some(pattern => pattern.test(message))
}

export function isMemoryQuery(message: string): boolean {
  return MEMORY_QUERY_PATTERNS.some(pattern => pattern.test(message))
}

function containsSensitiveData(text: string): boolean {
  return SENSITIVE_PATTERNS.some(pattern => pattern.test(text))
}

function detectCategory(text: string): string {
  const lower = text.toLowerCase()
  if (/\b(prefer|style|always|never|like|dislike|want)\b/.test(lower)) return 'preference'
  if (/\b(project|stack|build|app|deploy|repo|code)\b/.test(lower)) return 'project'
  if (/\b(name|role|job|work|team)\b/.test(lower)) return 'personal'
  if (/\b(workflow|process|routine|setup)\b/.test(lower)) return 'workflow'
  return 'general'
}

export function extractMemoryText(message: string): string | null {
  if (containsSensitiveData(message)) return null

  let memoryText = message.trim()

  const cleanPatterns = [
    /^remember\s+that\s+/i,
    /^from\s+now\s+on,?\s*/i,
    /^going\s+forward,?\s*/i,
    /^my\s+preference\s+is\s+/i,
    /^i\s+want\s+you\s+to\s+always\s+/i,
  ]

  for (const pattern of cleanPatterns) {
    memoryText = memoryText.replace(pattern, '')
  }

  memoryText = memoryText.replace(/^[,.\s]+/, '').trim()

  if (memoryText.length < 5 || memoryText.length > 500) return null

  return memoryText
}

export async function saveMemory(
  supabase: SupabaseClient,
  userId: string,
  memoryText: string,
  conversationId?: string
): Promise<{ saved: boolean; error?: string }> {
  if (containsSensitiveData(memoryText)) {
    return { saved: false, error: 'Cannot save sensitive data (keys, passwords, tokens).' }
  }

  const category = detectCategory(memoryText)

  try {
    const { data: existing } = await supabase
      .from('user_memories')
      .select('id, memory_text')
      .eq('user_id', userId)
      .ilike('memory_text', `%${memoryText.substring(0, 30)}%`)
      .limit(1)

    if (existing && existing.length > 0) {
      const { error } = await supabase
        .from('user_memories')
        .update({ memory_text: memoryText, updated_at: new Date().toISOString() })
        .eq('id', existing[0].id)

      if (error) return { saved: false, error: error.message }
      return { saved: true }
    }

    const { error } = await supabase
      .from('user_memories')
      .insert({
        user_id: userId,
        memory_text: memoryText,
        category,
        importance: 3,
        source_conversation_id: conversationId || null,
      })

    if (error) {
      if (error.code === '42P01') return { saved: false, error: 'Memory table not set up yet.' }
      return { saved: false, error: error.message }
    }

    return { saved: true }
  } catch (error: any) {
    console.error('[Memory] Error saving:', error.message)
    return { saved: false, error: error.message }
  }
}

export async function deleteMemoryByContent(
  supabase: SupabaseClient,
  userId: string,
  searchText: string
): Promise<{ deleted: boolean; error?: string }> {
  try {
    const words = searchText.toLowerCase().split(/\s+/).filter(w => w.length > 3).slice(0, 5)

    if (words.length === 0) {
      return { deleted: false, error: 'Could not determine which memory to forget.' }
    }

    const { data: memories } = await supabase
      .from('user_memories')
      .select('id, memory_text')
      .eq('user_id', userId)

    if (!memories || memories.length === 0) {
      return { deleted: false, error: 'No memories found.' }
    }

    const match = memories.find(m => {
      const memLower = m.memory_text.toLowerCase()
      return words.filter(w => memLower.includes(w)).length >= Math.min(2, words.length)
    })

    if (!match) {
      return { deleted: false, error: 'Could not find a matching memory to delete.' }
    }

    const { error } = await supabase
      .from('user_memories')
      .delete()
      .eq('id', match.id)

    if (error) return { deleted: false, error: error.message }
    return { deleted: true }
  } catch (error: any) {
    return { deleted: false, error: error.message }
  }
}
