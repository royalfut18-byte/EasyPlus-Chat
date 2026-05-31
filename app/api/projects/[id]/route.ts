import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getAccountEntitlement, getEntitlementBlockResponse } from '@/lib/account-entitlements.server'
import { getProjectById, updateProject, archiveProject, ensureUserActive } from '@/lib/projects.server'

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const url = new URL(request.url)
    const parts = url.pathname.split('/').filter(Boolean)
    const id = parts[parts.length - 1]

    const project = await getProjectById(id)
    if (!project || project.user_id !== user.id || project.archived_at) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    return NextResponse.json({ project })
  } catch (error: any) {
    console.error('[Projects API] GET /[id] failed:', error)
    return NextResponse.json({ error: error.message || 'Failed' }, { status: 500 })
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const id = request.url.split('/').filter(Boolean).pop() as string
    const payload = await request.json()
    if ('name' in payload && (!payload.name || !payload.name.trim())) {
      return NextResponse.json({ error: 'Project name is required' }, { status: 400 })
    }
    const project = await getProjectById(id)
    if (!project || project.user_id !== user.id || project.archived_at) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    await ensureUserActive(user.id)

    const updated = await updateProject(id, user.id, {
      name: payload.name,
      description: payload.description,
      instructions: payload.instructions,
    } as any)

    return NextResponse.json({ project: updated })
  } catch (error: any) {
    console.error('[Projects API] PATCH failed:', error)
    return NextResponse.json({ error: error.message || 'Failed to update' }, { status: 500 })
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const id = request.url.split('/').filter(Boolean).pop() as string
    const project = await getProjectById(id)
    if (!project || project.user_id !== user.id || project.archived_at) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    await ensureUserActive(user.id)
    await archiveProject(id, user.id)
    return NextResponse.json({ success: true })
  } catch (error: any) {
    console.error('[Projects API] DELETE failed:', error)
    return NextResponse.json({ error: error.message || 'Failed to archive' }, { status: 500 })
  }
}
