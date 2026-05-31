import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getAccountEntitlement, getEntitlementBlockResponse } from '@/lib/account-entitlements.server'
import { createProjectForUser, getProjectsForUser, ensureUserActive } from '@/lib/projects.server'

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const projects = await getProjectsForUser(user.id)
    return NextResponse.json({ projects })
  } catch (error: any) {
    console.error('[Projects API] GET failed:', error)
    return NextResponse.json({ error: error.message || 'Failed to list projects' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const entitlementBlock = getEntitlementBlockResponse(await getAccountEntitlement(supabase as any, user.id))
    if (entitlementBlock) return entitlementBlock

    // prevent expired/disabled users from creating projects
    await ensureUserActive(user.id)

    const { name, description, instructions } = await request.json()
    if (!name || !name.trim()) return NextResponse.json({ error: 'Project name is required' }, { status: 400 })

    const project = await createProjectForUser(user.id, { name: name.trim(), description: description || '', instructions: instructions || '' })
    return NextResponse.json({ project })
  } catch (error: any) {
    console.error('[Projects API] POST failed:', error)
    return NextResponse.json({ error: error.message || 'Failed to create project' }, { status: 500 })
  }
}
