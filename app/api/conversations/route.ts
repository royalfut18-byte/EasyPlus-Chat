import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getInternalModel, sanitizeConversation, toPublicModelId } from '@/lib/ai/model-routing.server'
import { getAccountEntitlement, getEntitlementBlockResponse } from '@/lib/account-entitlements.server'

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient()
    const db = supabase as any
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const projectId = request.nextUrl.searchParams.get('projectId')
    let query = db
      .from('conversations')
      .select('*')
      .eq('user_id', user.id)
      .order('updated_at', { ascending: false, nullsFirst: false })
      .order('created_at', { ascending: false, nullsFirst: false })

    query = projectId ? query.eq('project_id', projectId) : query.is('project_id', null)

    const { data: conversations, error } = await query

    if (error) throw error

    return NextResponse.json((conversations || []).map(sanitizeConversation))
  } catch (error: any) {
    console.error('Conversations GET error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
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

    const { title, model, reasoningMode, projectId } = await request.json()
    const publicModelId = toPublicModelId(model)

    if (!getInternalModel(publicModelId)) {
      return NextResponse.json({ error: 'Model is not available' }, { status: 400 })
    }

    // Try with reasoning_mode first, fall back without it if column doesn't exist
    let conversation: any = null
    let error: any = null

    const insertPayload: any = {
      user_id: user.id,
      title: title || 'New Conversation',
      model_used: publicModelId,
    }

    if (projectId) {
      // validate ownership of the project
      const { data: projectRow, error: projectErr } = await db
        .from('projects')
        .select('id, user_id')
        .eq('id', projectId)
        .limit(1)
        .single()
      if (projectErr || !projectRow || projectRow.user_id !== user.id) {
        return NextResponse.json({ error: 'Invalid project' }, { status: 403 })
      }
      insertPayload.project_id = projectId
    }

    if (reasoningMode) {
      insertPayload.reasoning_mode = reasoningMode
    }

    const result = await db
      .from('conversations')
      .insert(insertPayload)
      .select()
      .single()

    if (result.error && result.error.message?.includes('reasoning_mode')) {
      // Column doesn't exist yet — retry without it
      const fallback = await db
        .from('conversations')
        .insert({
          user_id: user.id,
          title: title || 'New Conversation',
          model_used: publicModelId,
          ...(projectId ? { project_id: projectId } : {}),
        })
        .select()
        .single()
      conversation = fallback.data
      error = fallback.error
    } else {
      conversation = result.data
      error = result.error
    }

    if (error) throw error

    // Attach reasoning mode to the response even if not stored in DB
    if (reasoningMode && conversation && !conversation.reasoning_mode) {
      conversation.reasoning_mode = reasoningMode
    }

    return NextResponse.json(sanitizeConversation(conversation))
  } catch (error: any) {
    console.error('Conversations POST error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
