import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getAccountEntitlement, getEntitlementBlockResponse } from '@/lib/account-entitlements.server'
import { archiveProjectMemory, getProjectForUser, updateProjectMemory } from '@/lib/projects.server'

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; memoryId: string }> }
) {
  try {
    const { id, memoryId } = await params
    const supabase = await createClient()
    const db = supabase as any
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const entitlementBlock = getEntitlementBlockResponse(await getAccountEntitlement(db, user.id))
    if (entitlementBlock) return entitlementBlock

    const project = await getProjectForUser(id, user.id)
    if (!project || project.archived_at) return NextResponse.json({ error: 'Project not found' }, { status: 404 })

    const updated = await updateProjectMemory(id, user.id, memoryId, await request.json())
    return NextResponse.json({ memory: updated })
  } catch (error: any) {
    console.error('[Project Memory API] PATCH failed:', error)
    return NextResponse.json({ error: error.message || 'Failed to update project memory' }, { status: 500 })
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; memoryId: string }> }
) {
  try {
    const { id, memoryId } = await params
    const supabase = await createClient()
    const db = supabase as any
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const entitlementBlock = getEntitlementBlockResponse(await getAccountEntitlement(db, user.id))
    if (entitlementBlock) return entitlementBlock

    const project = await getProjectForUser(id, user.id)
    if (!project || project.archived_at) return NextResponse.json({ error: 'Project not found' }, { status: 404 })

    await archiveProjectMemory(id, user.id, memoryId)
    return NextResponse.json({ success: true })
  } catch (error: any) {
    console.error('[Project Memory API] DELETE failed:', error)
    return NextResponse.json({ error: error.message || 'Failed to archive project memory' }, { status: 500 })
  }
}
