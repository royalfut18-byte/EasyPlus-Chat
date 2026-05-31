import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getAccountEntitlement, getEntitlementBlockResponse } from '@/lib/account-entitlements.server'
import { getProjectConversations, getProjectForUser } from '@/lib/projects.server'
import { getInternalModel, sanitizeConversation, toPublicModelId } from '@/lib/ai/model-routing.server'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const project = await getProjectForUser(id, user.id)
    if (!project || project.archived_at) return NextResponse.json({ error: 'Project not found' }, { status: 404 })

    const conversations = await getProjectConversations(id, user.id)
    return NextResponse.json({ conversations: conversations.map(sanitizeConversation) })
  } catch (error: any) {
    console.error('[Project Conversations API] GET failed:', error)
    return NextResponse.json({ error: error.message || 'Failed to list project conversations' }, { status: 500 })
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const supabase = await createClient()
    const db = supabase as any
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const entitlementBlock = getEntitlementBlockResponse(await getAccountEntitlement(db, user.id))
    if (entitlementBlock) return entitlementBlock

    const project = await getProjectForUser(id, user.id)
    if (!project || project.archived_at) return NextResponse.json({ error: 'Project not found' }, { status: 404 })

    const { title, model, reasoningMode } = await request.json()
    const publicModelId = toPublicModelId(model)
    if (!getInternalModel(publicModelId)) {
      return NextResponse.json({ error: 'Model is not available' }, { status: 400 })
    }

    const insertPayload: Record<string, any> = {
      user_id: user.id,
      title: title || 'New Project Chat',
      model_used: publicModelId,
      project_id: id,
    }
    if (reasoningMode) insertPayload.reasoning_mode = reasoningMode

    const { data, error } = await db
      .from('conversations')
      .insert(insertPayload)
      .select()
      .single()

    if (error) throw error

    await db.from('projects').update({ updated_at: new Date().toISOString() }).eq('id', id).eq('user_id', user.id)
    return NextResponse.json(sanitizeConversation(data))
  } catch (error: any) {
    console.error('[Project Conversations API] POST failed:', error)
    return NextResponse.json({ error: error.message || 'Failed to create project conversation' }, { status: 500 })
  }
}
