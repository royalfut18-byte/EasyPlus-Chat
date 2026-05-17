import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'

const MARKER_CONTENTS = new Set([
  '__ARTIFACT_LOADING__',
  '__ASSISTANT_LOADING__',
  '__LONG_TASK_LOADING__',
  '__RECOVERY_POLLING__',
])

function isRealContent(c: string | null | undefined): boolean {
  if (!c) return false
  if (c.trim().length <= 20) return false
  if (MARKER_CONTENTS.has(c)) return false
  if (c.trim() === '...') return false
  return true
}

function isSuspectedTruncated(content: string): boolean {
  if (!content || content.length < 50) return false
  const trimmed = content.trim()
  // Ends mid-word (letter not followed by sentence-ending punctuation)
  if (/[a-z]$/i.test(trimmed) && !/[.!?:;)\]"']$/.test(trimmed)) return true
  // Ends with an incomplete markdown structure
  if (/\*\*[^*]*$/.test(trimmed)) return true
  if (/\[[^\]]*$/.test(trimmed)) return true
  if (/```[^`]*$/.test(trimmed) && (trimmed.match(/```/g) || []).length % 2 !== 0) return true
  return false
}

interface RecoveryCandidate {
  sourceTable: string
  sourceId: string
  contentLength: number
  contentPreview: string
  matchType: 'request_id' | 'parent_message_id' | 'content_prefix' | 'chunk_reassembly'
  confidence: 'high' | 'medium' | 'low'
}

interface TruncatedMessage {
  id: string
  role: string
  contentLength: number
  contentFirst300: string
  contentLast300: string
  status: string | null
  request_id: string | null
  parent_message_id: string | null
  order_index: number | null
  created_at: string
  updated_at: string | null
  truncationEvidence: string
  recoveryCandidates: RecoveryCandidate[]
  recoverable: 'yes' | 'partial' | 'no'
  bestRecoverySource: string | null
  suggestedSQL: string | null
}

export async function GET(request: NextRequest) {
  const conversationId = request.nextUrl.searchParams.get('conversationId')
  const repair = request.nextUrl.searchParams.get('repair') === 'true'

  if (!conversationId) {
    return NextResponse.json({ error: 'Missing conversationId param' }, { status: 400 })
  }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Use service client for cross-table access
  let db: any
  try {
    db = await createServiceClient()
  } catch {
    db = supabase
  }

  // STEP 1: Load raw messages
  const { data: rawMessages, error: msgErr } = await (db as any)
    .from('messages')
    .select('*')
    .eq('conversation_id', conversationId)
    .order('order_index', { ascending: true })

  if (msgErr) {
    return NextResponse.json({ error: msgErr.message }, { status: 500 })
  }

  const messages: any[] = rawMessages || []

  // STEP 1 output: All messages with key fields
  const allMessages = messages.map(m => ({
    id: m.id,
    role: m.role,
    contentLength: (m.content || '').length,
    contentFirst300: (m.content || '').substring(0, 300),
    contentLast300: (m.content || '').length > 300
      ? (m.content || '').substring((m.content || '').length - 300)
      : null,
    status: m.status || null,
    request_id: m.request_id || null,
    parent_message_id: m.parent_message_id || null,
    order_index: m.order_index,
    created_at: m.created_at,
    updated_at: m.updated_at || null,
  }))

  // STEP 2: Identify truncated assistant messages
  const assistantMessages = messages.filter(m => m.role === 'assistant' && isRealContent(m.content))
  const truncatedMessages: TruncatedMessage[] = []

  for (const msg of assistantMessages) {
    const content = msg.content || ''
    if (!isSuspectedTruncated(content)) continue

    const truncated: TruncatedMessage = {
      id: msg.id,
      role: msg.role,
      contentLength: content.length,
      contentFirst300: content.substring(0, 300),
      contentLast300: content.length > 300 ? content.substring(content.length - 300) : content,
      status: msg.status || null,
      request_id: msg.request_id || null,
      parent_message_id: msg.parent_message_id || null,
      order_index: msg.order_index,
      created_at: msg.created_at,
      updated_at: msg.updated_at || null,
      truncationEvidence: detectTruncationEvidence(content),
      recoveryCandidates: [],
      recoverable: 'no',
      bestRecoverySource: null,
      suggestedSQL: null,
    }

    // STEP 2a: Search for duplicate assistant messages with same request_id
    if (msg.request_id) {
      const duplicates = messages.filter(m =>
        m.id !== msg.id &&
        m.role === 'assistant' &&
        m.request_id === msg.request_id &&
        isRealContent(m.content) &&
        (m.content || '').length > content.length
      )
      for (const dup of duplicates) {
        truncated.recoveryCandidates.push({
          sourceTable: 'messages',
          sourceId: dup.id,
          contentLength: (dup.content || '').length,
          contentPreview: (dup.content || '').substring(0, 150),
          matchType: 'request_id',
          confidence: 'high',
        })
      }
    }

    // STEP 2b: Search for duplicate with same parent_message_id
    if (msg.parent_message_id) {
      const parentDups = messages.filter(m =>
        m.id !== msg.id &&
        m.role === 'assistant' &&
        m.parent_message_id === msg.parent_message_id &&
        isRealContent(m.content) &&
        (m.content || '').length > content.length
      )
      for (const dup of parentDups) {
        if (!truncated.recoveryCandidates.some(c => c.sourceId === dup.id)) {
          truncated.recoveryCandidates.push({
            sourceTable: 'messages',
            sourceId: dup.id,
            contentLength: (dup.content || '').length,
            contentPreview: (dup.content || '').substring(0, 150),
            matchType: 'parent_message_id',
            confidence: 'high',
          })
        }
      }
    }

    // STEP 2c: Search for nearby messages with similar order_index/created_at
    if (msg.order_index != null) {
      const nearbyDups = messages.filter(m =>
        m.id !== msg.id &&
        m.role === 'assistant' &&
        isRealContent(m.content) &&
        (m.content || '').length > content.length &&
        Math.abs((m.order_index || 0) - (msg.order_index || 0)) <= 2 &&
        Math.abs(new Date(m.created_at || 0).getTime() - new Date(msg.created_at || 0).getTime()) < 30000
      )
      for (const dup of nearbyDups) {
        if (!truncated.recoveryCandidates.some(c => c.sourceId === dup.id)) {
          // Check if content starts the same (strong match)
          const prefix = content.substring(0, Math.min(100, content.length))
          const dupContent = dup.content || ''
          if (dupContent.startsWith(prefix)) {
            truncated.recoveryCandidates.push({
              sourceTable: 'messages',
              sourceId: dup.id,
              contentLength: dupContent.length,
              contentPreview: dupContent.substring(0, 150),
              matchType: 'content_prefix',
              confidence: 'high',
            })
          }
        }
      }
    }

    // STEP 3: Search recovery tables
    // 3a: memory_chunks for this message
    try {
      const { data: chunks } = await (db as any)
        .from('memory_chunks')
        .select('id, content, summary, chunk_index, source_id, source_type')
        .eq('source_id', msg.id)
        .eq('user_id', user.id)
        .order('chunk_index', { ascending: true })

      if (chunks && chunks.length > 0) {
        const reassembled = chunks.map((c: any) => c.content).join('')
        if (reassembled.length > content.length) {
          truncated.recoveryCandidates.push({
            sourceTable: 'memory_chunks',
            sourceId: chunks.map((c: any) => c.id).join(','),
            contentLength: reassembled.length,
            contentPreview: reassembled.substring(0, 150),
            matchType: 'chunk_reassembly',
            confidence: 'medium',
          })
        }
      }
    } catch { /* table may not exist */ }

    // 3b: conversation_memories that reference this message
    try {
      const { data: memories } = await (db as any)
        .from('conversation_memories')
        .select('id, content, title, scope, source_message_id')
        .eq('conversation_id', conversationId)
        .eq('user_id', user.id)

      if (memories && memories.length > 0) {
        // Check if any memory contains content that extends the truncated message
        for (const mem of memories) {
          if (mem.source_message_id === msg.id && mem.content && mem.content.length > 50) {
            truncated.recoveryCandidates.push({
              sourceTable: 'conversation_memories',
              sourceId: mem.id,
              contentLength: mem.content.length,
              contentPreview: mem.content.substring(0, 150),
              matchType: 'content_prefix',
              confidence: 'low',
            })
          }
        }
      }
    } catch { /* table may not exist */ }

    // 3c: context_snapshots
    try {
      const { data: snapshots } = await (db as any)
        .from('context_snapshots')
        .select('id, summary, key_decisions, open_tasks')
        .eq('conversation_id', conversationId)
        .eq('user_id', user.id)

      if (snapshots && snapshots.length > 0) {
        for (const snap of snapshots) {
          if (snap.summary && snap.summary.length > content.length) {
            // Only relevant if the summary contains content from this message
            const prefix = content.substring(0, 80)
            if (snap.summary.includes(prefix.substring(0, 40))) {
              truncated.recoveryCandidates.push({
                sourceTable: 'context_snapshots',
                sourceId: snap.id,
                contentLength: snap.summary.length,
                contentPreview: snap.summary.substring(0, 150),
                matchType: 'content_prefix',
                confidence: 'low',
              })
            }
          }
        }
      }
    } catch { /* table may not exist */ }

    // STEP 4: Determine recoverability
    const highConfidence = truncated.recoveryCandidates.filter(c => c.confidence === 'high')
    const mediumConfidence = truncated.recoveryCandidates.filter(c => c.confidence === 'medium')

    if (highConfidence.length > 0) {
      truncated.recoverable = 'yes'
      const best = highConfidence.sort((a, b) => b.contentLength - a.contentLength)[0]
      truncated.bestRecoverySource = `${best.sourceTable}:${best.sourceId} (${best.contentLength} chars, ${best.matchType})`

      if (best.sourceTable === 'messages') {
        truncated.suggestedSQL = `-- SAFE: Only updates if source is longer and shares request_id/parent_message_id
UPDATE public.messages
SET content = (SELECT content FROM public.messages WHERE id = '${best.sourceId}'),
    updated_at = NOW()
WHERE id = '${msg.id}'
  AND length(content) < (SELECT length(content) FROM public.messages WHERE id = '${best.sourceId}');`
      }
    } else if (mediumConfidence.length > 0) {
      truncated.recoverable = 'partial'
      const best = mediumConfidence.sort((a, b) => b.contentLength - a.contentLength)[0]
      truncated.bestRecoverySource = `${best.sourceTable}:${best.sourceId} (${best.contentLength} chars, ${best.matchType})`

      if (best.matchType === 'chunk_reassembly') {
        truncated.suggestedSQL = `-- PARTIAL: Reassembled from memory_chunks. Verify content before applying.
-- Chunks: ${best.sourceId}
-- Manual review required before running.`
      }
    } else {
      truncated.recoverable = 'no'
      truncated.bestRecoverySource = 'No recovery source found. Content is permanently lost unless Supabase backup exists.'
    }

    truncatedMessages.push(truncated)
  }

  // STEP 5: Optional safe repair (only high-confidence message duplicates)
  const repairResults: Array<{ messageId: string; action: string; success: boolean; error?: string }> = []

  if (repair) {
    for (const truncated of truncatedMessages) {
      if (truncated.recoverable !== 'yes') continue

      const highCandidates = truncated.recoveryCandidates
        .filter(c => c.confidence === 'high' && c.sourceTable === 'messages')
        .sort((a, b) => b.contentLength - a.contentLength)

      if (highCandidates.length === 0) continue

      const best = highCandidates[0]

      // Fetch the full content from the source message
      const { data: sourceMsg, error: srcErr } = await (db as any)
        .from('messages')
        .select('content')
        .eq('id', best.sourceId)
        .single()

      if (srcErr || !sourceMsg || !sourceMsg.content) {
        repairResults.push({
          messageId: truncated.id,
          action: `fetch source ${best.sourceId}`,
          success: false,
          error: srcErr?.message || 'Source message not found',
        })
        continue
      }

      // Safety check: source must be longer
      if (sourceMsg.content.length <= truncated.contentLength) {
        repairResults.push({
          messageId: truncated.id,
          action: 'skip - source not longer',
          success: false,
          error: `Source length ${sourceMsg.content.length} <= truncated length ${truncated.contentLength}`,
        })
        continue
      }

      // Safety check: truncated content must be a prefix of source content
      const truncatedContent = truncated.contentFirst300.length >= 300
        ? truncated.contentFirst300
        : truncated.contentFirst300
      if (!sourceMsg.content.startsWith(truncatedContent.substring(0, Math.min(100, truncatedContent.length)))) {
        repairResults.push({
          messageId: truncated.id,
          action: 'skip - content prefix mismatch',
          success: false,
          error: 'Source content does not start with truncated content prefix',
        })
        continue
      }

      // Safe to repair: update truncated message with longer source content
      const { error: updateErr } = await (db as any)
        .from('messages')
        .update({
          content: sourceMsg.content,
          status: 'completed',
          updated_at: new Date().toISOString(),
        })
        .eq('id', truncated.id)

      if (updateErr) {
        repairResults.push({
          messageId: truncated.id,
          action: `update from ${best.sourceId}`,
          success: false,
          error: updateErr.message,
        })
      } else {
        repairResults.push({
          messageId: truncated.id,
          action: `restored from ${best.sourceId} (${sourceMsg.content.length} chars)`,
          success: true,
        })
      }
    }
  }

  // Summary
  const totalAssistant = messages.filter(m => m.role === 'assistant').length
  const totalReal = assistantMessages.length
  const totalTruncated = truncatedMessages.length
  const totalRecoverableYes = truncatedMessages.filter(t => t.recoverable === 'yes').length
  const totalRecoverablePartial = truncatedMessages.filter(t => t.recoverable === 'partial').length
  const totalPermanentlyLost = truncatedMessages.filter(t => t.recoverable === 'no').length

  return NextResponse.json({
    conversationId,
    summary: {
      totalMessages: messages.length,
      totalAssistantMessages: totalAssistant,
      totalRealAssistantMessages: totalReal,
      totalSuspectedTruncated: totalTruncated,
      recoverableFromDuplicates: totalRecoverableYes,
      partiallyRecoverable: totalRecoverablePartial,
      permanentlyLost: totalPermanentlyLost,
    },
    allMessages,
    truncatedMessages,
    ...(repair ? { repairResults } : {}),
    instructions: repair
      ? 'Repair mode was active. See repairResults for outcomes.'
      : 'Read-only inspection. To attempt safe repair of high-confidence matches, add ?repair=true',
  })
}

function detectTruncationEvidence(content: string): string {
  const trimmed = content.trim()
  const reasons: string[] = []

  if (/[a-z]$/i.test(trimmed) && !/[.!?:;)\]"']$/.test(trimmed)) {
    reasons.push('ends mid-word')
  }
  if (/\*\*[^*]*$/.test(trimmed)) {
    reasons.push('unclosed bold markdown')
  }
  if (/\[[^\]]*$/.test(trimmed)) {
    reasons.push('unclosed markdown link/ref')
  }
  if ((trimmed.match(/```/g) || []).length % 2 !== 0) {
    reasons.push('unclosed code block')
  }
  if (/[,;]\s*$/.test(trimmed)) {
    reasons.push('ends with comma/semicolon')
  }
  if (/:\s*$/.test(trimmed)) {
    reasons.push('ends with colon (incomplete list)')
  }

  return reasons.length > 0 ? reasons.join(', ') : 'heuristic match'
}
