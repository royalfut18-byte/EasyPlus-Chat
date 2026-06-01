import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getAccountEntitlement, getEntitlementBlockResponse } from '@/lib/account-entitlements.server'
import { createProjectForUser, getProjectsForUser, getProjectsWithStatsForUser, ensureUserActive } from '@/lib/projects.server'
import { sanitizeConversation } from '@/lib/ai/model-routing.server'

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const view = request.nextUrl.searchParams.get('view')
    if (view === 'stats') {
      const projects = await getProjectsWithStatsForUser(user.id)
      return NextResponse.json({ projects })
    }

    const projects = await getProjectsForUser(user.id)
    if (view !== 'sidebar' || projects.length === 0) {
      return NextResponse.json({ projects })
    }

    const db = supabase as any
    const { data: conversations, error } = await db
      .from('conversations')
      .select('*')
      .eq('user_id', user.id)
      .not('project_id', 'is', null)
      .order('updated_at', { ascending: false, nullsFirst: false })
      .limit(40)

    if (error) throw error
    return NextResponse.json({
      projects,
      conversations: (conversations || []).map(sanitizeConversation),
    })
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
