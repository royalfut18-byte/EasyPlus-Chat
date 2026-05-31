import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getAccountEntitlement, getEntitlementBlockResponse } from '@/lib/account-entitlements.server'
import { createProjectMemory, getProjectForUser, getProjectMemories } from '@/lib/projects.server'

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

    const memories = await getProjectMemories(id, user.id)
    return NextResponse.json({ memories })
  } catch (error: any) {
    console.error('[Project Memories API] GET failed:', error)
    return NextResponse.json({ error: error.message || 'Failed to list project memories' }, { status: 500 })
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

    const payload = await request.json()
    const memory = await createProjectMemory(id, user.id, payload)
    return NextResponse.json({ memory })
  } catch (error: any) {
    console.error('[Project Memories API] POST failed:', error)
    return NextResponse.json({ error: error.message || 'Failed to create project memory' }, { status: 500 })
  }
}
