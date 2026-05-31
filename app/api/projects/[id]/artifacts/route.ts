import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { getAccountEntitlement, getEntitlementBlockResponse } from '@/lib/account-entitlements.server'
import { getProjectArtifacts, getProjectForUser } from '@/lib/projects.server'

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

    const artifacts = await getProjectArtifacts(id, user.id)
    return NextResponse.json({ artifacts })
  } catch (error: any) {
    console.error('[Project Artifacts API] GET failed:', error)
    return NextResponse.json({ error: error.message || 'Failed to list project artifacts' }, { status: 500 })
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const supabase = await createClient()
    const db = await createServiceClient() as any
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const entitlementBlock = getEntitlementBlockResponse(await getAccountEntitlement(db, user.id))
    if (entitlementBlock) return entitlementBlock

    const project = await getProjectForUser(id, user.id)
    if (!project || project.archived_at) return NextResponse.json({ error: 'Project not found' }, { status: 404 })

    const { title, language, code, explanation, conversationId, messageId } = await request.json()
    if (!title || !language || !code) {
      return NextResponse.json({ error: 'Artifact title, language, and code are required' }, { status: 400 })
    }

    if (conversationId) {
      const { data: conversation } = await db
        .from('conversations')
        .select('id, project_id')
        .eq('id', conversationId)
        .eq('user_id', user.id)
        .single()

      if (!conversation || conversation.project_id !== id) {
        return NextResponse.json({ error: 'Conversation does not belong to this project' }, { status: 403 })
      }
    }

    const payload = {
        project_id: id,
        user_id: user.id,
        conversation_id: conversationId || null,
        message_id: messageId || null,
        title: String(title).slice(0, 200),
        language: String(language).slice(0, 40),
        code,
        explanation: explanation || null,
        updated_at: new Date().toISOString(),
      }

    let query
    if (messageId) {
      const { data: existing } = await db
        .from('project_artifacts')
        .select('id')
        .eq('project_id', id)
        .eq('user_id', user.id)
        .eq('message_id', messageId)
        .limit(1)
        .single()

      query = existing?.id
        ? db.from('project_artifacts').update(payload).eq('id', existing.id)
        : db.from('project_artifacts').insert(payload)
    } else {
      query = db.from('project_artifacts').insert(payload)
    }

    const { data, error } = await query
      .select('id, title, language, explanation, created_at, updated_at, conversation_id, message_id')
      .single()

    if (error) throw error
    return NextResponse.json({ artifact: data })
  } catch (error: any) {
    console.error('[Project Artifacts API] POST failed:', error)
    return NextResponse.json({ error: error.message || 'Failed to save project artifact' }, { status: 500 })
  }
}
