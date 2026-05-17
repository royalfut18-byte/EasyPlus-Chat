import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { processLoadedMessages } from '@/lib/chat/message-utils'

const MARKER_CONTENTS = new Set([
  '__ARTIFACT_LOADING__',
  '__ASSISTANT_LOADING__',
  '__LONG_TASK_LOADING__',
  '__RECOVERY_POLLING__',
])

export async function GET(request: NextRequest) {
  const conversationId = request.nextUrl.searchParams.get('conversationId')
  if (!conversationId) {
    return NextResponse.json({ error: 'Missing conversationId param' }, { status: 400 })
  }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const db = supabase as any
  const { data: rawMessages, error } = await db
    .from('messages')
    .select('*')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: true })

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const messages: any[] = rawMessages || []

  const isMarker = (c: string) => !c || MARKER_CONTENTS.has(c) || c.trim() === '...' || c.trim() === ''
  const isReal = (c: string) => c && c.trim().length > 20 && !MARKER_CONTENTS.has(c) && c.trim() !== '...'

  // Run the same cleanup pipeline the frontend uses (without artifact parsing)
  const cleaned = processLoadedMessages(messages, { conversationId, parseArtifacts: false })

  // Compare raw vs cleaned to detect any content changes
  const comparison = messages.map(m => {
    const cleanedVersion = cleaned.find(c => c.id === m.id)
    const rawContent = m.content || ''
    const cleanedContent = cleanedVersion?.content || ''
    const wasRemoved = !cleanedVersion
    const wasContentChanged = !wasRemoved && rawContent !== cleanedContent
    const wasTruncated = wasContentChanged && cleanedContent.length < rawContent.length

    return {
      id: m.id,
      role: m.role,
      rawContentLength: rawContent.length,
      cleanedContentLength: wasRemoved ? 0 : cleanedContent.length,
      contentFirst500: rawContent.substring(0, 500),
      contentLast500: rawContent.length > 500 ? rawContent.substring(rawContent.length - 500) : null,
      isReal: isReal(rawContent),
      isMarker: isMarker(rawContent),
      status: m.status || null,
      request_id: m.request_id || null,
      client_message_id: m.client_message_id || null,
      parent_message_id: m.parent_message_id || null,
      order_index: m.order_index,
      created_at: m.created_at,
      updated_at: m.updated_at || null,
      wasRemoved,
      wasContentChangedByCleanup: wasContentChanged,
      wasContentTruncated: wasTruncated,
      removalReason: wasRemoved ? 'filtered by processLoadedMessages' : null,
    }
  })

  // Detect potentially truncated assistant messages (real content that ends abruptly)
  const suspectedTruncated = messages
    .filter(m => m.role === 'assistant' && isReal(m.content || ''))
    .filter(m => {
      const content = m.content || ''
      // Heuristics for truncation: ends mid-word, mid-sentence, or very short for a "completed" status
      const endsAbruptly = content.length > 50 && /[a-z]$/i.test(content.trim()) && !/[.!?:;)\]"']$/.test(content.trim())
      const statusIsCompleted = m.status === 'completed'
      return endsAbruptly && statusIsCompleted
    })
    .map(m => ({
      id: m.id,
      contentLength: (m.content || '').length,
      lastChars: (m.content || '').substring((m.content || '').length - 80),
      status: m.status,
      updated_at: m.updated_at,
    }))

  const roleCounts: Record<string, number> = {}
  const statusCounts: Record<string, number> = {}
  for (const m of messages) {
    roleCounts[m.role] = (roleCounts[m.role] || 0) + 1
    statusCounts[m.status || 'null'] = (statusCounts[m.status || 'null'] || 0) + 1
  }

  return NextResponse.json({
    conversationId,
    rawMessageCount: messages.length,
    cleanedMessageCount: cleaned.length,
    removedCount: messages.length - cleaned.length,
    roleCounts,
    statusCounts,
    suspectedTruncated,
    messages: comparison,
  })
}
