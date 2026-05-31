import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { GoogleGenerativeAI } from '@google/generative-ai'
import { getAccountEntitlement, getEntitlementBlockResponse } from '@/lib/account-entitlements.server'

export const runtime = 'nodejs'
export const maxDuration = 30

function generateFallbackTitle(userMessage: string, attachmentNames?: string[]): string {
  const trimmed = userMessage.trim().toLowerCase()

  if (/^(hey|hi|hello|yo|sup)[\s!.]*$/.test(trimmed)) {
    return 'Quick Chat'
  }

  if (/what (ai|model|gemini|claude|gpt|chatgpt)|which (ai|model)|who are you|what are you/.test(trimmed)) {
    return 'Model Identity'
  }

  let title = userMessage.replace(
    /^(what is|what's|can you|could you|please|tell me about|tell me|explain to me|explain|search the web for|search for|latest|give me|show me|find|look up|help me with|i need|i want)\s+/i,
    ''
  )

  const creationMatch = title.match(/^(make|build|create|generate|design|code|write)\s+(me\s+)?(a|an)?\s*(.+?)\s+(website|site|page|game|app|component|tool|calculator|dashboard|bracket)/i)
  if (creationMatch) {
    const topic = creationMatch[4] ? creationMatch[4].trim() : ''
    const type = creationMatch[5].charAt(0).toUpperCase() + creationMatch[5].slice(1).toLowerCase()
    if (topic) {
      return `${topic.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')} ${type}`
    }
    return `${type} Project`
  }

  if (/^explain/i.test(userMessage)) {
    title = title.replace(/^explain\s+/i, '').trim()
    if (title.length > 0 && title.length < 40) {
      return toTitleCase(title) + ' Explained'
    }
  }

  if (/latest.*news/i.test(title)) {
    title = title.replace(/latest\s+/i, '').replace(/\s+news/i, ' News')
    return toTitleCase(title)
  }

  title = title.replace(/^(how|why|when|where|who)\s+(do|does|did|is|are|was|were|can|could|will|would|should)\s+/i, '')

  if (attachmentNames && attachmentNames.length > 0 && (!title || title.length < 5)) {
    const firstFile = attachmentNames[0].replace(/\.[^.]+$/, '').replace(/[-_]/g, ' ')
    return toTitleCase(firstFile) + ' Help'
  }

  if (title.length > 50) {
    title = title.substring(0, 50)
    const lastSpace = title.lastIndexOf(' ')
    if (lastSpace > 20) {
      title = title.substring(0, lastSpace)
    }
  }

  title = title.replace(/[.,;:!?]+$/, '').trim()

  if (!title || title.length < 2) {
    return 'Quick Chat'
  }

  return toTitleCase(title)
}

function toTitleCase(str: string): string {
  return str
    .split(' ')
    .map((word, index) => {
      if (index > 0 && /^(a|an|the|in|on|at|to|for|of|and|or|but|is|are|was|were)$/i.test(word)) {
        return word.toLowerCase()
      }
      return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()
    })
    .join(' ')
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const supabase = await createClient()
    const db = supabase as any
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const entitlementBlock = getEntitlementBlockResponse(await getAccountEntitlement(db, user.id))
    if (entitlementBlock) return entitlementBlock

    // Verify conversation belongs to user
    const { data: conversation, error: convError } = await db
      .from('conversations')
      .select('id, title, user_id')
      .eq('id', id)
      .eq('user_id', user.id)
      .single()

    if (convError || !conversation) {
      return NextResponse.json({ error: 'Conversation not found' }, { status: 404 })
    }

    // Fetch first few messages
    const { data: messages, error: msgError } = await db
      .from('messages')
      .select('role, content, attachments')
      .eq('conversation_id', id)
      .order('order_index', { ascending: true })
      .limit(4)

    if (msgError || !messages || messages.length === 0) {
      return NextResponse.json({ error: 'No messages found' }, { status: 400 })
    }

    const firstUserMsg = messages.find((m: any) => m.role === 'user')
    const firstAssistantMsg = messages.find((m: any) => m.role === 'assistant')

    if (!firstUserMsg) {
      return NextResponse.json({ error: 'No user message found' }, { status: 400 })
    }

    // Collect attachment names
    const attachmentNames: string[] = []
    for (const msg of messages) {
      if (msg.attachments && Array.isArray(msg.attachments)) {
        for (const att of msg.attachments) {
          if (att.name) attachmentNames.push(att.name)
        }
      }
    }

    // Build context for title generation (keep it small)
    const userContent = (firstUserMsg.content || '').substring(0, 500)
    const assistantContent = firstAssistantMsg
      ? (firstAssistantMsg.content || '').substring(0, 300)
      : ''

    // Try AI title generation with Gemini (cheap/fast)
    let aiTitle: string | null = null
    const geminiKey = process.env.GEMINI_API_KEY

    if (geminiKey) {
      try {
        const genAI = new GoogleGenerativeAI(geminiKey)
        const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' })

        let prompt = `Generate a short 2-6 word chat title based on this conversation. Return only the title. No quotes. No punctuation unless required. Title Case. No filler words like "can you", "please", "tell me", "explain", "what is".

User message: "${userContent}"`

        if (assistantContent) {
          prompt += `\n\nAssistant response (first 300 chars): "${assistantContent}"`
        }

        if (attachmentNames.length > 0) {
          prompt += `\n\nAttached files: ${attachmentNames.join(', ')}`
        }

        prompt += `\n\nExamples:
"can you explain price stability in economics" -> Price Stability Explained
"what was the latest ipl game score?" -> Latest IPL Game Score
"make me a flappy bird game" -> Flappy Bird Game
"hey" -> Quick Chat
"Jim Chalmers latest news" -> Jim Chalmers News

Return ONLY the title, nothing else:`

        const result = await model.generateContent({
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          generationConfig: {
            maxOutputTokens: 30,
            temperature: 0.3,
          },
        })

        const response = result.response.text().trim()

        // Validate: 2-6 words, no quotes, reasonable length
        const cleaned = response.replace(/^["']|["']$/g, '').replace(/[.!?]+$/, '').trim()
        const wordCount = cleaned.split(/\s+/).length

        if (cleaned && wordCount >= 1 && wordCount <= 8 && cleaned.length <= 60) {
          aiTitle = cleaned
        }
      } catch (aiErr: any) {
        console.warn('[Title] AI title generation failed, using fallback:', aiErr.message)
      }
    }

    const finalTitle = aiTitle || generateFallbackTitle(userContent, attachmentNames)

    // Update conversation title
    const { error: updateError } = await db
      .from('conversations')
      .update({ title: finalTitle })
      .eq('id', id)
      .eq('user_id', user.id)

    if (updateError) {
      console.error('[Title] Update failed:', updateError.message)
      return NextResponse.json({ error: 'Failed to update title' }, { status: 500 })
    }

    return NextResponse.json({ title: finalTitle })
  } catch (error: any) {
    console.error('[Title] Error:', error.message)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
